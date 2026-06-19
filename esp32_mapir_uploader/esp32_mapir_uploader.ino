/*
 * Phytospectra MAPIR ESP32 Uploader (no OLED)
 *
 * Flash layout — use esp32_mapir_uploader/partitions.csv (4 MB flash):
 *   nvs,      data, nvs,     0x9000,  0x5000,
 *   otadata,  data, ota,     0xe000,  0x2000,
 *   app0,     app,  ota_0,   0x10000, 0x100000,
 *   spiffs,   data, spiffs,  0x110000,0x2F0000,   ← temp photos (~3 MB)
 *
 * CHANGED vs original: app0 shrunk from 0x150000 (1.31MB) to 0x100000 (1MB)
 * to give the storage partition room to grow from 2.6MB to 3MB. This sketch
 * (WiFi + HTTPClient, no TLS, no OLED/graphics libs) should fit comfortably
 * under 1MB — verify the "Sketch uses ... bytes" line after compiling. If
 * it doesn't fit, bump app0 back up in small steps and shrink spiffs to match
 * (keep spiffs start = app0 end, and spiffs end at 0x400000).
 *
 * Arduino IDE: Tools → Flash Size → 4MB, Partition Scheme → Custom partition table
 * (partitions.csv in this sketch folder).
 *
 * Storage partition is mounted with LittleFS, not SPIFFS. SPIFFS does lazy
 * garbage collection and was failing to fully reclaim space from deleted
 * temp files once images got close to the partition's total size — "free"
 * space would drift down over repeated download/delete cycles even with
 * nothing left on disk. LittleFS handles near-capacity churn much more
 * reliably. The partition's on-flash "spiffs" subtype name is just a label
 * in the partition table; LittleFS works fine on a partition typed "spiffs".
 *
 * Backend: uvicorn main:app --host 0.0.0.0 --port 8000
 * Set BACKEND_HOST to your PC LAN IP (ipconfig).
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <FS.h>
#include <LittleFS.h>
#include <cstring>

// ── Network credentials ────────────────────────────────────────────────────
const char* CAM_SSID  = "MAPIR-S3WRGN-dbddbe";
const char* CAM_PASS  = "12345678";
const char* CAM_IP    = "192.168.1.254";

const char* HOME_SSID = "Wifi_network";
const char* HOME_PASS = "0798200237";

// ── Backend ────────────────────────────────────────────────────────────────
const char*    BACKEND_URL  = "http://172.16.179.238:8000";
const char*    BACKEND_HOST = "172.16.179.238";
const uint16_t BACKEND_PORT = 8000;

// ── Device identity ────────────────────────────────────────────────────────
const char* DEVICE_ID     = "esp32-mapir-01";
const char* ESP32_API_KEY = "esp32-dev-key";
const char* FW_VERSION    = "2026-06-18-fix5";

// Must match partitions.csv — spiffs row size 0x2F0000
#define STORAGE_PARTITION_LABEL "spiffs"
#define STORAGE_PARTITION_BYTES 0x2F0000UL
// LittleFS needs real headroom to do its own bookkeeping reliably when
// files are large relative to the partition. 16KB (the old SPIFFS reserve)
// was far too thin for a partition that's ~93% filled by one image; this
// keeps a safety margin so a near-max-size capture still leaves room for
// filesystem metadata instead of reporting "full" before it should.
#define FS_RESERVE              196608UL  // 192 KB

// ── Tuning ─────────────────────────────────────────────────────────────────
#define CHUNK_SIZE      8192
#define MAX_IMAGE_SIZE  (STORAGE_PARTITION_BYTES - FS_RESERVE)
#define HTTP_TIMEOUT    45000
#define UPLOAD_TIMEOUT  180000
#define LOCAL_TMP_JPG   "/tmp_img.jpg"
#define LOCAL_TMP_TIF   "/tmp_img.tif"

// ── Mission state ──────────────────────────────────────────────────────────
struct MissionConfig {
  bool   active = false;
  String userId;
  String fieldId;
  String flightId;
  String droneId;
  String bucket;
} mission;

// Detected MAPIR SSID from scan (may differ from CAM_SSID)
char activeCamSsid[33] = "";

// Static I/O buffer — MUST be global + 4-byte aligned (not on stack).
// Stack buf[8192] still panics LoadStoreAlignment on Core 1 during camera download.
static uint8_t ioBuf[CHUNK_SIZE] __attribute__((aligned(4)));

// ══════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════

void closeHttp(HTTPClient& http, WiFiClient& client) {
  http.end();
  client.stop();
  delay(150);
}

// Minimal JSON value extractor (no library dependency).
String jsonValue(const char* body, const char* key) {
  if (!body || !key) return "";
  String b(body);

  // Try quoted value first:  "key":"value"
  String search = "\"" + String(key) + "\":\"";
  int start = b.indexOf(search);
  if (start != -1) {
    start += search.length();
    int end = b.indexOf("\"", start);
    if (end == -1) return "";
    return b.substring(start, end);
  }

  // Try unquoted value:  "key":value
  search = "\"" + String(key) + "\":";
  start = b.indexOf(search);
  if (start == -1) return "";
  start += search.length();
  int end = b.indexOf(",", start);
  int endBrace = b.indexOf("}", start);
  if (end == -1 || (endBrace != -1 && endBrace < end)) end = endBrace;
  if (end == -1) return "";
  return b.substring(start, end);
}

bool isImageFile(const String& fname) {
  String upper = fname;
  upper.toUpperCase();
  return upper.endsWith(".JPG")  || upper.endsWith(".JPEG")
      || upper.endsWith(".TIF")  || upper.endsWith(".TIFF");
}

String contentTypeFor(const String& fname) {
  String upper = fname;
  upper.toUpperCase();
  if (upper.endsWith(".TIF") || upper.endsWith(".TIFF")) return "image/tiff";
  return "image/jpeg";
}

// Returns a /tmp_img.* path — one file at a time on the spiffs partition.
String localTmpPath(const String& fname) {
  String upper = fname;
  upper.toUpperCase();
  if (upper.endsWith(".TIF") || upper.endsWith(".TIFF")) return LOCAL_TMP_TIF;
  return LOCAL_TMP_JPG;
}

size_t storageFreeBytes() {
  return LittleFS.totalBytes() - LittleFS.usedBytes();
}

void printStorageSpace() {
  Serial.printf("spiffs partition: %u / %u KB free (max 1 image ~%u KB)\n",
    (unsigned)(storageFreeBytes() / 1024),
    (unsigned)(LittleFS.totalBytes() / 1024),
    (unsigned)(MAX_IMAGE_SIZE / 1024));
}

bool onNetwork(const char* ssid) {
  return WiFi.status() == WL_CONNECTED && WiFi.SSID().equals(ssid);
}

bool isCameraNetwork() {
  if (WiFi.status() != WL_CONNECTED) return false;
  String current = WiFi.SSID();
  if (activeCamSsid[0] != '\0' && current.equals(activeCamSsid)) return true;
  if (onNetwork(CAM_SSID)) return true;
  return current.startsWith("MAPIR");
}

// Scan while on Home Wi‑Fi — MAPIR SSID often differs from CAM_SSID in sketch.
bool scanForMapirSsid() {
  if (activeCamSsid[0] != '\0') {
    Serial.printf("Using cached MAPIR SSID: %s\n", activeCamSsid);
    return true;
  }

  Serial.println("Scanning for MAPIR WiFi...");
  WiFi.scanDelete();
  delay(100);
  int found = WiFi.scanNetworks(false, true);
  if (found <= 0) {
    Serial.println("  No networks found — turn camera ON, take a photo, retry");
    WiFi.scanDelete();
    return false;
  }

  int bestRssi = -999;
  for (int i = 0; i < found; i++) {
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    Serial.printf("  %s (%d dBm)\n", ssid.c_str(), rssi);
    if (ssid.startsWith("MAPIR") && rssi > bestRssi) {
      bestRssi = rssi;
      strncpy(activeCamSsid, ssid.c_str(), sizeof(activeCamSsid) - 1);
      activeCamSsid[sizeof(activeCamSsid) - 1] = '\0';
    }
  }
  WiFi.scanDelete();

  if (activeCamSsid[0] == '\0') {
    Serial.println("  No MAPIR-* network — power camera ON first");
    return false;
  }

  Serial.printf("  Will use: %s\n", activeCamSsid);
  if (!String(activeCamSsid).equals(CAM_SSID)) {
    Serial.printf("  (Update CAM_SSID to: %s)\n", activeCamSsid);
  }
  return true;
}

void logNearbyWiFi() {
  Serial.println("Scanning WiFi...");
  int found = WiFi.scanNetworks(false, true);
  if (found <= 0) {
    Serial.println("  No networks found — is the camera powered on?");
    return;
  }
  for (int i = 0; i < found; i++) {
    Serial.printf("  %s (%d dBm)\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Backend HTTP helper
// ══════════════════════════════════════════════════════════════════════════

int backendGet(const char* path, char* bodyOut, size_t bodyOutLen, int timeoutMs) {
  if (!bodyOut || bodyOutLen < 2) return -1;
  bodyOut[0] = '\0';

  WiFiClient client;
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(15000);

  if (!http.begin(client, BACKEND_HOST, BACKEND_PORT, path)) {
    Serial.println("HTTP begin() failed");
    return -1;
  }
  http.addHeader("Connection", "close");
  http.addHeader("X-ESP32-Key", ESP32_API_KEY);
  http.setTimeout(timeoutMs);

  Serial.printf("GET %s\n", path);
  Serial.flush();

  unsigned long t0 = millis();
  int code = http.GET();
  unsigned long elapsed = millis() - t0;

  if (code > 0) {
    String payload = http.getString();
    if (payload.length() >= bodyOutLen) {
      Serial.printf("Response too large (%u bytes)\n", payload.length());
      code = -2;
    } else {
      strncpy(bodyOut, payload.c_str(), bodyOutLen - 1);
      bodyOut[bodyOutLen - 1] = '\0';
      Serial.printf("HTTP %d in %lums (%u bytes)\n", code, elapsed, payload.length());
    }
  } else {
    Serial.printf("HTTP error %d: %s (%lums)\n",
      code, http.errorToString(code).c_str(), elapsed);
  }

  closeHttp(http, client);
  delay(300);
  return code;
}

// ══════════════════════════════════════════════════════════════════════════
// WiFi management
// ══════════════════════════════════════════════════════════════════════════

bool connectToHomeWiFi() {
  if (onNetwork(HOME_SSID)) {
    Serial.printf("Already on Home (%s)\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println("WiFi -> Home");
  // Soft disconnect: keep radio on, just leave current AP
  WiFi.disconnect(false, false);
  delay(500);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(HOME_SSID, HOME_PASS);

  for (int i = 0; i < 40; i++) {
    if (onNetwork(HOME_SSID)) {
      Serial.printf("Connected Home (%s)\n", WiFi.localIP().toString().c_str());
      return true;
    }
    delay(250);
  }

  Serial.println("WiFi failed: Home");
  return false;
}

bool connectToCamera() {
  if (isCameraNetwork()) {
    Serial.printf("Already on MAPIR (%s)\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.printf("WiFi -> MAPIR (%s)\n",
    activeCamSsid[0] != '\0' ? activeCamSsid : CAM_SSID);

  WiFi.disconnect(false, false);
  delay(1000);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  const char* ssid = (activeCamSsid[0] != '\0') ? activeCamSsid : CAM_SSID;
  WiFi.begin(ssid, CAM_PASS);

  for (int i = 0; i < 60; i++) {
    if (isCameraNetwork()) {
      Serial.printf("Connected MAPIR (%s)\n", WiFi.localIP().toString().c_str());
      delay(500);
      return true;
    }
    if (i > 0 && i % 10 == 0) {
      Serial.printf("  still connecting... (%ds)\n", i / 2);
    }
    delay(500);
  }

  Serial.println("WiFi failed: MAPIR");
  activeCamSsid[0] = '\0';
  logNearbyWiFi();
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
// Mission config
// ══════════════════════════════════════════════════════════════════════════

bool fetchMissionConfig() {
  Serial.println("Fetching mission...");
  Serial.flush();

  char path[128];
  snprintf(path, sizeof(path), "/api/esp32/mission?device_id=%s", DEVICE_ID);

  // FIX: aligned(4) prevents LoadStoreAlignment panic when the HTTP layer
  // writes multi-byte values into this buffer.
  char body[640] __attribute__((aligned(4)));
  memset(body, 0, sizeof(body));
  int code = backendGet(path, body, sizeof(body), HTTP_TIMEOUT);

  if (code != 200) {
    mission.active = false;
    Serial.printf("Mission fetch failed HTTP %d\n", code);
    if (body[0] != '\0') Serial.printf("  body: %s\n", body);
    if      (code == 404) Serial.println("  → Create a flight in the app first");
    else if (code <= 0)   Serial.println("  → Start uvicorn on the PC :8000");
    return false;
  }

  mission.userId   = jsonValue(body, "user_id");
  mission.fieldId  = jsonValue(body, "field_id");
  mission.flightId = jsonValue(body, "flight_id");
  mission.droneId  = jsonValue(body, "drone_id");
  mission.bucket   = jsonValue(body, "bucket");
  mission.active   = mission.userId.length() > 0 && mission.flightId.length() > 0;

  if (!mission.active) {
    Serial.println("Invalid mission payload — check backend response");
    Serial.printf("  raw: %s\n", body);
    return false;
  }

  Serial.printf("Mission OK  field=%s  flight=%s\n",
    jsonValue(body, "field_name").c_str(), mission.flightId.c_str());
  Serial.flush();
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
// Camera operations
// ══════════════════════════════════════════════════════════════════════════

// Returns comma-separated list of image filenames found on the camera.
String getAllImages() {
  HTTPClient http;
  WiFiClient client;
  http.begin(client, CAM_IP, 80, "/DCIM/PHOTO");
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.GET();
  Serial.printf("Camera directory HTTP %d\n", code);

  if (code != HTTP_CODE_OK) {
    closeHttp(http, client);
    return "";
  }

  String html = http.getString();
  closeHttp(http, client);

  String result = "";
  int pos = 0;
  while (true) {
    int hrefIdx = html.indexOf("href=\"", pos);
    if (hrefIdx == -1) break;
    int start = hrefIdx + 6;
    int end   = html.indexOf("\"", start);
    if (end == -1) break;

    String fname = html.substring(start, end);
    fname.trim();

    if (isImageFile(fname)) {
      // Strip any leading path component (handles both /DCIM/PHOTO/X and ../X)
      int slash = fname.lastIndexOf('/');
      if (slash != -1) fname = fname.substring(slash + 1);
      if (result.length()) result += ",";
      result += fname;
      Serial.printf("  found: %s\n", fname.c_str());
    }
    pos = end + 1;
  }

  if (result.length() == 0) {
    Serial.println("No JPG/TIF on camera — take a photo first.");
  }
  return result;
}

bool downloadImage(const char* filename, const char* savePath) {
  if (!filename || !savePath) return false;

  char camPath[128];
  snprintf(camPath, sizeof(camPath), "/DCIM/PHOTO/%s", filename);

  Serial.printf("Downloading %s...\n", filename);
  Serial.flush();

  HTTPClient http;
  WiFiClient client;
  http.begin(client, CAM_IP, 80, camPath);
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("Download HTTP %d: %s\n", code, filename);
    closeHttp(http, client);
    return false;
  }

  int contentLength = http.getSize();

  if (contentLength > MAX_IMAGE_SIZE) {
    Serial.printf("File too large (%d bytes, max %u): %s\n",
      contentLength, (unsigned)MAX_IMAGE_SIZE, filename);
    closeHttp(http, client);
    return false;
  }

  size_t freeSp = storageFreeBytes();
  if (contentLength > 0 && (size_t)contentLength + FS_RESERVE > freeSp) {
    Serial.printf("storage full: need %d KB, free %u KB — formatting and retrying once\n",
      contentLength / 1024, (unsigned)(freeSp / 1024));
    // LittleFS is far better than SPIFFS at reclaiming deleted-file space,
    // but if something still drifted (crash mid-cycle, orphaned temp file,
    // etc.) a full reformat is cheap insurance — there's nothing on this
    // partition we need to keep between sync cycles.
    closeHttp(http, client);
    LittleFS.format();
    LittleFS.begin(false, "/spiffs", 10, STORAGE_PARTITION_LABEL);
    freeSp = storageFreeBytes();
    Serial.printf("  after format: %u KB free\n", (unsigned)(freeSp / 1024));
    if ((size_t)contentLength + FS_RESERVE > freeSp) {
      Serial.println("  still won't fit — skipping this file");
      return false;
    }
    // Re-fetch the image since the first HTTP connection was closed above.
    http.begin(client, CAM_IP, 80, camPath);
    http.setTimeout(HTTP_TIMEOUT);
    int retryCode = http.GET();
    if (retryCode != HTTP_CODE_OK) {
      Serial.printf("Re-download HTTP %d: %s\n", retryCode, filename);
      closeHttp(http, client);
      return false;
    }
  }

  if (LittleFS.exists(savePath)) LittleFS.remove(savePath);
  File file = LittleFS.open(savePath, FILE_WRITE);
  if (!file) {
    Serial.println("LittleFS open() failed for write");
    closeHttp(http, client);
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  int downloaded = 0;
  int lastPct    = -1;

  while (http.connected() && (contentLength < 0 || downloaded < contentLength)) {
    yield();
    int avail = stream->available();
    if (avail > 0) {
      int toRead = avail;
      if (toRead > CHUNK_SIZE) toRead = CHUNK_SIZE;
      int got = stream->readBytes(ioBuf, toRead);
      if (got > 0) {
        file.write(ioBuf, got);
        downloaded += got;

        if (contentLength > 0) {
          int pct = (downloaded * 100) / contentLength;
          if (pct != lastPct && pct % 25 == 0) {
            lastPct = pct;
            Serial.printf("  download %d%%\n", pct);
          }
        }

        if (downloaded > MAX_IMAGE_SIZE) {
          Serial.println("Download exceeded MAX_IMAGE_SIZE, aborting");
          file.close();
          closeHttp(http, client);
          LittleFS.remove(savePath);
          return false;
        }
      }
    } else if (!stream->connected()) {
      break;
    } else {
      delay(1);
    }
  }

  file.close();
  closeHttp(http, client);

  if (contentLength > 0 && downloaded != contentLength) {
    Serial.printf("Download incomplete %s (%d/%d bytes)\n", filename, downloaded, contentLength);
    LittleFS.remove(savePath);
    return false;
  }
  if (downloaded == 0) {
    Serial.printf("Download produced 0 bytes: %s\n", filename);
    LittleFS.remove(savePath);
    return false;
  }

  Serial.printf("Downloaded %s (%d bytes)\n", filename, downloaded);
  return true;
}

void deleteCameraImage(const String& filename) {
  char camPath[160];
  snprintf(camPath, sizeof(camPath), "/DCIM/PHOTO/%s?del=1", filename.c_str());
  HTTPClient http;
  WiFiClient client;
  http.begin(client, CAM_IP, 80, camPath);
  http.setTimeout(5000);
  http.GET();
  closeHttp(http, client);
  Serial.printf("Deleted from camera: %s\n", filename.c_str());
}

// ══════════════════════════════════════════════════════════════════════════
// Backend upload
// ══════════════════════════════════════════════════════════════════════════

bool uploadViaBackend(const char* filepath, const char* filename) {
  File file = LittleFS.open(filepath, FILE_READ);
  if (!file || file.size() == 0) {
    if (file) file.close();
    Serial.printf("Cannot open for upload: %s\n", filepath);
    return false;
  }
  size_t fileSize = file.size();

  char path[384];
  snprintf(path, sizeof(path),
    "/api/esp32/upload-raw?device_id=%s&flight_id=%s&original_filename=%s",
    DEVICE_ID, mission.flightId.c_str(), filename);

  Serial.printf(">>> UPLOADING %s (%u bytes)\n", filename, (unsigned)fileSize);
  Serial.flush();

  WiFiClient client;
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("Upload TCP connect failed");
    file.close();
    return false;
  }

  client.printf("POST %s HTTP/1.1\r\n", path);
  client.printf("Host: %s\r\n", BACKEND_HOST);
  client.printf("Content-Type: %s\r\n", contentTypeFor(String(filename)));
  client.printf("X-ESP32-Key: %s\r\n", ESP32_API_KEY);
  client.print("Connection: close\r\n");
  client.printf("Content-Length: %u\r\n\r\n", (unsigned)fileSize);

  size_t sent = 0;
  while (file.available()) {
    yield();
    size_t n = file.read(ioBuf, CHUNK_SIZE);
    if (n == 0) break;
    size_t w = client.write(ioBuf, n);
    if (w != n) {
      Serial.println("Upload write failed");
      file.close();
      client.stop();
      return false;
    }
    sent += w;
  }
  file.close();

  unsigned long t0 = millis();
  while (client.connected() && !client.available() && (millis() - t0) < UPLOAD_TIMEOUT) {
    yield();
    delay(10);
  }

  char resp[512] __attribute__((aligned(4)));
  size_t respLen = 0;
  while (client.available() && respLen < sizeof(resp) - 1) {
    resp[respLen++] = (char)client.read();
    yield();
  }
  resp[respLen] = '\0';
  client.stop();

  int httpCode = 0;
  if (strncmp(resp, "HTTP/1.", 7) == 0) {
    httpCode = atoi(resp + 9);
  }

  Serial.printf("Upload HTTP %d (%u bytes sent)\n", httpCode, (unsigned)sent);

  if (httpCode == 200 || httpCode == 201) {
    Serial.printf(">>> UPLOAD OK  image_id=%s\n", jsonValue(resp, "image_id").c_str());
    return true;
  }

  Serial.printf(">>> UPLOAD FAILED HTTP %d\n", httpCode);
  if (respLen > 0) Serial.printf("    body: %s\n", resp);
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
// Main sync logic
// ══════════════════════════════════════════════════════════════════════════

void processAllImages() {
  Serial.println("\n=== Sync cycle ===");
  Serial.flush();

  // 1. Connect home, fetch mission config
  if (!connectToHomeWiFi())   return;
  if (!fetchMissionConfig())  return;
  if (!scanForMapirSsid())    return;

  printStorageSpace();

  // Switch to camera, list images
  if (!connectToCamera())     return;
  String fileList = getAllImages();
  if (fileList.length() == 0) return;

  int total = 1;
  for (unsigned i = 0; i < fileList.length(); i++) {
    if (fileList[i] == ',') total++;
  }
  Serial.printf("Found %d image(s)\n", total);

  int imgNum       = 0;
  int successCount = 0;
  int pos          = 0;

  while (pos <= (int)fileList.length()) {
    int comma = fileList.indexOf(',', pos);
    if (comma == -1) comma = fileList.length();

    String fname = fileList.substring(pos, comma);
    fname.trim();
    pos = comma + 1;
    if (!fname.length()) continue;

    imgNum++;
    Serial.printf("\n--- [%d/%d] %s ---\n", imgNum, total, fname.c_str());

    // 3a. Ensure we're on the camera network before downloading
    if (!isCameraNetwork() && !connectToCamera()) continue;

    String tmpPath = localTmpPath(fname);
    if (!downloadImage(fname.c_str(), tmpPath.c_str())) continue;

    // 3b. Switch back home to upload
    if (!connectToHomeWiFi()) {
      LittleFS.remove(tmpPath.c_str());
      continue;
    }

    if (!uploadViaBackend(tmpPath.c_str(), fname.c_str())) {
      LittleFS.remove(tmpPath.c_str());
      connectToCamera(); // restore camera connection for next iteration
      continue;
    }

    LittleFS.remove(tmpPath.c_str());
    successCount++;

    // 3c. Delete from camera after confirmed upload
    if (connectToCamera()) {
      deleteCameraImage(fname);
    }
  }

  Serial.printf("\n=== Done: %d/%d uploaded  (flight %s) ===\n",
    successCount, total, mission.flightId.c_str());
  Serial.flush();
}

// ══════════════════════════════════════════════════════════════════════════
// Scheduling
// ══════════════════════════════════════════════════════════════════════════

const unsigned long SYNC_INTERVAL_MS = 60000UL;
unsigned long lastSyncMs = 0;

void runSyncCycle(bool force) {
  unsigned long now = millis();
  if (!force && lastSyncMs != 0 && (now - lastSyncMs) < SYNC_INTERVAL_MS) {
    return;
  }
  lastSyncMs = now;
  processAllImages();
  Serial.printf("Next sync in %lu s\n", SYNC_INTERVAL_MS / 1000);
  Serial.flush();
}

// ══════════════════════════════════════════════════════════════════════════
// Arduino entry points
// ══════════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  // Mount spiffs partition from partitions.csv (0x2F0000 bytes)
  if (!LittleFS.begin(true, "/spiffs", 10, STORAGE_PARTITION_LABEL)) {
    Serial.printf("FATAL: cannot mount LittleFS partition '%s' — use partitions.csv + 4MB flash\n",
      STORAGE_PARTITION_LABEL);
    return;
  }

  const size_t total = LittleFS.totalBytes();
  if (total < STORAGE_PARTITION_BYTES / 2) {
    Serial.printf("WARN: spiffs only %u KB — expected ~%u KB from partitions.csv\n",
      (unsigned)(total / 1024), (unsigned)(STORAGE_PARTITION_BYTES / 1024));
  }

  Serial.printf("Storage: %u KB free / %u KB total (partition %s)\n",
    (unsigned)(storageFreeBytes() / 1024),
    (unsigned)(total / 1024),
    STORAGE_PARTITION_LABEL);

  Serial.printf("\nMAPIR uploader  fw=%s  backend=%s  device=%s\n\n",
    FW_VERSION, BACKEND_URL, DEVICE_ID);
  Serial.flush();

  runSyncCycle(true); // run immediately on boot
}

void loop() {
  runSyncCycle(false);
  delay(500);
}
