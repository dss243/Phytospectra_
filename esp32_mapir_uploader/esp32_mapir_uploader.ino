/*
 * Phytospectra MAPIR ESP32 Uploader (no OLED)
 *
 * LittleFS uses the spiffs partition (~2.5 MB). Only ONE camera file
 * is stored at a time (/tmp.img). Batch-all-download needs a bigger partition.
 *
 * Hosted backend: HTTPS ngrok on home PC (uvicorn + ngrok http 8000).
 * Create a flight in phytospectra.vercel.app before sync — ESP32 uses latest flight.
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <FS.h>
#include <LittleFS.h>
#include <cstring>

// ── Backend mode ───────────────────────────────────────────────────────────
// 0 = lab/home LAN (old working setup: ESP32 + PC on same Wi‑Fi, HTTP :8000)
// 1 = hosted ngrok (HTTPS — ESP32 needs internet, home PC runs uvicorn + ngrok)
#define USE_NGROK_BACKEND 0

const char* CAM_SSID  = "MAPIR-S3WRGN-dbddbe";
const char* CAM_PASS  = "12345678";
const char* CAM_IP    = "192.168.1.254";

// Home Wi‑Fi (same network as PC when USE_NGROK_BACKEND=0)
const char* HOME_SSID = "dsds";
const char* HOME_PASS = "0798200237";

#if USE_NGROK_BACKEND
const char* BACKEND_URL     = "https://unseeing-purity-reluctant.ngrok-free.dev";
const char* BACKEND_HOST    = "unseeing-purity-reluctant.ngrok-free.dev";
const uint16_t BACKEND_PORT = 443;
#else
// PC running: uvicorn main:app --host 0.0.0.0 --port 8000
// Set this to YOUR PC's IP on HOME_SSID (ipconfig) — NOT localhost, NOT ESP32 IP
const char* BACKEND_URL     = "http://172.16.179.238:8000";
const char* BACKEND_HOST    = "172.16.179.238";
const uint16_t BACKEND_PORT = 8000;
#endif

const char* DEVICE_ID     = "esp32-mapir-01";
const char* ESP32_API_KEY = "esp32-dev-key";
const char* FW_VERSION    = "2026-06-14-lab-v3";

#define CHUNK_SIZE     8192
#define MAX_IMAGE_SIZE (20 * 1024 * 1024)
#define MAX_QUEUE      32
#define HTTP_TIMEOUT   45000
#define UPLOAD_TIMEOUT 180000
#define LOCAL_TMP      "/tmp.img"
#define FS_RESERVE     16384

struct QueuedImage {
  char name[128];
};

struct MissionConfig {
  bool   active = false;
  String userId;
  String fieldId;
  String flightId;
  String droneId;
  String bucket;
} mission;

// Detected MAPIR SSID from scan (may differ from CAM_SSID in sketch)
char activeCamSsid[33] = "";

// Static buffers avoid stack overflow / alignment crashes during large transfers
static uint8_t ioBuf[CHUNK_SIZE] __attribute__((aligned(4)));

size_t littleFsFreeBytes() {
  return LittleFS.totalBytes() - LittleFS.usedBytes();
}

void printLittleFsSpace() {
  Serial.printf("LittleFS: %u / %u KB free (one image at a time)\n",
    (unsigned)(littleFsFreeBytes() / 1024),
    (unsigned)(LittleFS.totalBytes() / 1024));
}

const char* contentTypeForName(const char* fname) {
  if (!fname) return "image/jpeg";
  size_t n = strlen(fname);
  if (n >= 4) {
    const char* ext = fname + n - 4;
    if (strcasecmp(ext, ".tif") == 0) return "image/tiff";
  }
  if (n >= 5) {
    const char* ext = fname + n - 5;
    if (strcasecmp(ext, ".tiff") == 0) return "image/tiff";
  }
  return "image/jpeg";
}

void closeHttp(HTTPClient& http, WiFiClient& client) {
  http.end();
  client.stop();
  delay(50);
}

void endBackendHttp(HTTPClient& http) {
  http.end();
  delay(50);
}

bool backendIsHttps() {
#if USE_NGROK_BACKEND
  return true;
#else
  return false;
#endif
}

void addBackendHeaders(HTTPClient& http) {
  http.addHeader("Connection", "close");
  http.addHeader("X-ESP32-Key", ESP32_API_KEY);
  if (strstr(BACKEND_HOST, "ngrok") != NULL) {
    http.addHeader("ngrok-skip-browser-warning", "true");
  }
}

int backendGet(const char* path, char* bodyOut, size_t bodyOutLen, int timeoutMs) {
  if (!bodyOut || bodyOutLen < 2) return -1;
  bodyOut[0] = '\0';

  char url[384];
  snprintf(url, sizeof(url), "%s%s", BACKEND_URL, path);

  Serial.printf("GET %s\n", url);
  Serial.flush();

  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(20000);
  http.setTimeout(timeoutMs);

  WiFiClient plain;
  WiFiClientSecure tls;
  bool begun = false;

  if (backendIsHttps()) {
    tls.setInsecure();
    Serial.println("  connecting (HTTPS)...");
    Serial.flush();
    begun = http.begin(tls, String(url));
  } else {
    Serial.println("  connecting (HTTP)...");
    Serial.flush();
    begun = http.begin(plain, String(url));
  }

  if (!begun) {
    Serial.println("  http.begin() failed");
    return -1;
  }

  addBackendHeaders(http);

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

  endBackendHttp(http);
  delay(100);
  return code;
}

bool waitForValidIp(int maxWaitMs = 10000) {
  unsigned long start = millis();
  while (millis() - start < (unsigned long)maxWaitMs) {
    yield();
    if (WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress(0, 0, 0, 0)) {
      return true;
    }
    delay(200);
  }
  return WiFi.localIP() != IPAddress(0, 0, 0, 0);
}

bool pingBackend() {
  char body[128];
  memset(body, 0, sizeof(body));
  int code = backendGet("/api/esp32/ping", body, sizeof(body), 20000);
  if (code == 200) {
    Serial.printf("Backend ping OK: %s\n", body);
    return true;
  }
  Serial.printf("Backend ping failed HTTP %d\n", code);
  if (code <= 0) {
    Serial.println("  Check: home PC uvicorn + ngrok running, ESP32 has internet");
  }
  return false;
}

String jsonValue(const char* body, const char* key) {
  if (!body || !key) return "";
  String search = "\"" + String(key) + "\":\"";
  String b(body);
  int start = b.indexOf(search);
  if (start == -1) {
    search = "\"" + String(key) + "\":";
    start = b.indexOf(search);
    if (start == -1) return "";
    start += search.length();
    int end = b.indexOf(",", start);
    if (end == -1) end = b.indexOf("}", start);
    return b.substring(start, end);
  }
  start += search.length();
  int end = b.indexOf("\"", start);
  if (end == -1) return "";
  return b.substring(start, end);
}

bool isImageFile(String fname) {
  String upper = fname;
  upper.toUpperCase();
  return upper.endsWith(".JPG") || upper.endsWith(".JPEG")
      || upper.endsWith(".TIF") || upper.endsWith(".TIFF");
}

bool onNetwork(const char* ssid) {
  if (WiFi.status() != WL_CONNECTED) return false;
  return WiFi.SSID().equals(ssid);
}

bool isCameraNetwork() {
  if (WiFi.status() != WL_CONNECTED) return false;
  String current = WiFi.SSID();
  if (activeCamSsid[0] != '\0' && current.equals(activeCamSsid)) return true;
  if (onNetwork(CAM_SSID)) return true;
  return current.startsWith("MAPIR");
}

// Scan while still on Home WiFi. Reuses cached SSID when already known.
bool scanForMapirSsid(bool forceRescan = false) {
  if (!forceRescan && activeCamSsid[0] != '\0') {
    Serial.printf("Using cached MAPIR SSID: %s\n", activeCamSsid);
    return true;
  }

  activeCamSsid[0] = '\0';
  Serial.println("Scanning for MAPIR WiFi...");
  Serial.flush();

  WiFi.scanDelete();
  delay(100);
  int found = WiFi.scanNetworks(false, true);
  if (found <= 0) {
    Serial.println("  Scan found no networks");
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
    Serial.println("  No MAPIR-* network — turn camera ON and take a photo first");
    return false;
  }

  Serial.printf("  Will connect to: %s\n", activeCamSsid);
  if (!String(activeCamSsid).equals(CAM_SSID)) {
    Serial.printf("  (Update CAM_SSID in sketch to: %s)\n", activeCamSsid);
  }
  Serial.flush();
  return true;
}

bool connectToHomeWiFi() {
  if (onNetwork(HOME_SSID) && waitForValidIp(1000)) return true;

  Serial.println("WiFi -> Home");
  WiFi.disconnect(false, false);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(HOME_SSID, HOME_PASS);

  for (int i = 0; i < 30; i++) {
    yield();
    if (onNetwork(HOME_SSID) && waitForValidIp(3000)) {
      Serial.printf("Connected Home (%s)\n", WiFi.localIP().toString().c_str());
      return true;
    }
    delay(200);
  }

  Serial.println("WiFi failed: Home");
  return false;
}

bool connectToCamera() {
  if (isCameraNetwork()) return true;

  const char* ssid = (activeCamSsid[0] != '\0') ? activeCamSsid : CAM_SSID;
  Serial.printf("WiFi -> MAPIR (%s)\n", ssid);
  Serial.flush();

  WiFi.disconnect(false, false);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, CAM_PASS);

  for (int i = 0; i < 30; i++) {
    yield();
    if (isCameraNetwork()) {
      Serial.printf("Connected MAPIR (%s)\n", WiFi.localIP().toString().c_str());
      delay(200);
      return true;
    }
    delay(300);
  }

  Serial.println("WiFi failed: MAPIR");
  activeCamSsid[0] = '\0';
  Serial.flush();
  return false;
}

bool fetchMissionConfig() {
  Serial.println("Fetching mission...");
  Serial.flush();

  char path[128];
  snprintf(path, sizeof(path), "/api/esp32/mission?device_id=%s", DEVICE_ID);

  char body[640];
  memset(body, 0, sizeof(body));
  int code = backendGet(path, body, sizeof(body), HTTP_TIMEOUT);

  if (code != 200) {
    mission.active = false;
    Serial.printf("Mission failed HTTP %d\n", code);
    if (body[0] != '\0') Serial.printf("  %s\n", body);
    if (code == 404) {
      Serial.println("  Create a flight in the app first");
    } else if (code <= 0) {
#if USE_NGROK_BACKEND
      Serial.println("  Check: home PC uvicorn + ngrok, ESP32 has internet");
#else
      Serial.println("  TCP failed — same Wi-Fi as PC? uvicorn on 0.0.0.0:8000?");
      Serial.printf("  Update BACKEND_HOST to PC ipconfig IP (now %s)\n", BACKEND_HOST);
      Serial.printf("  ESP32 is %s on %s\n",
        WiFi.localIP().toString().c_str(), WiFi.SSID().c_str());
#endif
    }
    return false;
  }

  mission.userId   = jsonValue(body, "user_id");
  mission.fieldId  = jsonValue(body, "field_id");
  mission.flightId = jsonValue(body, "flight_id");
  mission.droneId  = jsonValue(body, "drone_id");
  mission.bucket   = jsonValue(body, "bucket");
  mission.active   = mission.userId.length() > 0 && mission.flightId.length() > 0;

  if (!mission.active) {
    Serial.println("Invalid mission payload");
    return false;
  }

  Serial.printf("Mission OK field=%s flight=%s\n",
    jsonValue(body, "field_name").c_str(), mission.flightId.c_str());
  Serial.flush();
  return true;
}

String getAllImages() {
  HTTPClient http;
  WiFiClient client;
  http.begin(client, CAM_IP, 80, "/DCIM/PHOTO");
  http.setTimeout(HTTP_TIMEOUT);

  int code = http.GET();
  Serial.printf("Camera list HTTP %d\n", code);

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
    int end = html.indexOf("\"", start);
    if (end == -1) break;

    String fname = html.substring(start, end);
    fname.trim();
    if (isImageFile(fname)) {
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

  Serial.printf("Downloading %s...\n", filename);
  Serial.flush();

  char camPath[160];
  snprintf(camPath, sizeof(camPath), "/DCIM/PHOTO/%s", filename);

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
  if (contentLength <= 0 || contentLength > MAX_IMAGE_SIZE) {
    Serial.printf("Bad size %d for %s\n", contentLength, filename);
    closeHttp(http, client);
    return false;
  }

  size_t freeSp = littleFsFreeBytes();
  if ((size_t)contentLength + FS_RESERVE > freeSp) {
    Serial.printf("LittleFS full for %s: need ~%d KB, free %u KB\n",
      filename, contentLength / 1024, (unsigned)(freeSp / 1024));
    Serial.println("  Partition is ~2.5 MB — only one photo fits at a time.");
    closeHttp(http, client);
    return false;
  }

  if (LittleFS.exists(savePath)) LittleFS.remove(savePath);
  File file = LittleFS.open(savePath, FILE_WRITE);
  if (!file) {
    closeHttp(http, client);
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  int downloaded = 0;
  int lastPct = -1;

  while (http.connected() && downloaded < contentLength) {
    yield();
    int avail = stream->available();
    if (avail > 0) {
      int toRead = avail;
      if (toRead > CHUNK_SIZE) toRead = CHUNK_SIZE;
      int got = stream->readBytes(ioBuf, toRead);
      if (got > 0) {
        file.write(ioBuf, got);
        downloaded += got;
        int pct = (downloaded * 100) / contentLength;
        if (pct != lastPct && pct % 25 == 0) {
          lastPct = pct;
          Serial.printf("  download %d%%\n", pct);
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

  if (downloaded != contentLength) {
    Serial.printf("Download incomplete %s (%d/%d)\n", filename, downloaded, contentLength);
    return false;
  }

  Serial.printf("Downloaded %s (%d bytes)\n", filename, downloaded);
  return true;
}

void deleteCameraImage(const char* filename) {
  if (!filename) return;
  char camPath[192];
  snprintf(camPath, sizeof(camPath), "/DCIM/PHOTO/%s?del=1", filename);
  HTTPClient http;
  WiFiClient client;
  http.begin(client, CAM_IP, 80, camPath);
  http.setTimeout(5000);
  http.GET();
  closeHttp(http, client);
  Serial.printf("Deleted from camera: %s\n", filename);
}

bool uploadViaBackend(const char* filepath, const char* filename) {
  if (!filepath || !filename) return false;

  File file = LittleFS.open(filepath, FILE_READ);
  if (!file || file.size() == 0) {
    if (file) file.close();
    return false;
  }

  size_t fileSize = file.size();

  char path[384];
  snprintf(path, sizeof(path),
    "/api/esp32/upload-raw?device_id=%s&flight_id=%s&original_filename=%s",
    DEVICE_ID, mission.flightId.c_str(), filename);

  Serial.printf(">>> UPLOADING %s (%u bytes)\n", filename, (unsigned)fileSize);
  Serial.flush();

  if (!backendIsHttps()) {
    WiFiClient client;
    if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
      Serial.println("Upload HTTP connect failed");
      file.close();
      return false;
    }

    char line[384];
    snprintf(line, sizeof(line), "POST %s HTTP/1.1\r\n", path);
    client.print(line);
    snprintf(line, sizeof(line), "Host: %s\r\n", BACKEND_HOST);
    client.print(line);
    snprintf(line, sizeof(line), "Content-Type: %s\r\n", contentTypeForName(filename));
    client.print(line);
    snprintf(line, sizeof(line), "X-ESP32-Key: %s\r\n", ESP32_API_KEY);
    client.print(line);
    client.print("Connection: close\r\n");
    snprintf(line, sizeof(line), "Content-Length: %u\r\n\r\n", (unsigned)fileSize);
    client.print(line);

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
    while (client.connected() && !client.available() && (millis() - t0) < 30000) {
      yield();
      delay(10);
    }

    char resp[512];
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
      Serial.printf(">>> UPLOAD OK image_id=%s\n", jsonValue(resp, "image_id").c_str());
      return true;
    }
    Serial.printf(">>> UPLOAD FAILED HTTP %d\n", httpCode);
    if (respLen > 0) Serial.printf("  %s\n", resp);
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  if (!client.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("Upload TLS connect failed");
    file.close();
    return false;
  }

  char line[384];
  snprintf(line, sizeof(line), "POST %s HTTP/1.1\r\n", path);
  client.print(line);
  snprintf(line, sizeof(line), "Host: %s\r\n", BACKEND_HOST);
  client.print(line);
  snprintf(line, sizeof(line), "Content-Type: %s\r\n", contentTypeForName(filename));
  client.print(line);
  snprintf(line, sizeof(line), "X-ESP32-Key: %s\r\n", ESP32_API_KEY);
  client.print(line);
  client.print("ngrok-skip-browser-warning: true\r\n");
  client.print("Connection: close\r\n");
  snprintf(line, sizeof(line), "Content-Length: %u\r\n\r\n", (unsigned)fileSize);
  client.print(line);

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
  while (client.connected() && !client.available() && (millis() - t0) < 30000) {
    yield();
    delay(10);
  }

  char resp[512];
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
    Serial.printf(">>> UPLOAD OK image_id=%s\n", jsonValue(resp, "image_id").c_str());
    return true;
  }

  Serial.printf(">>> UPLOAD FAILED HTTP %d\n", httpCode);
  if (respLen > 0) Serial.printf("  %s\n", resp);
  return false;
}

int parseFileList(const String& fileList, QueuedImage* queue, int maxItems) {
  int count = 0;
  int pos = 0;
  while (pos <= (int)fileList.length() && count < maxItems) {
    int comma = fileList.indexOf(',', pos);
    if (comma == -1) comma = fileList.length();

    String fname = fileList.substring(pos, comma);
    fname.trim();
    pos = comma + 1;
    if (!fname.length()) continue;

    strncpy(queue[count].name, fname.c_str(), sizeof(queue[count].name) - 1);
    queue[count].name[sizeof(queue[count].name) - 1] = '\0';
    count++;
  }
  return count;
}

void processAllImages() {
  unsigned long cycleStart = millis();
  Serial.println("\n=== Sync cycle ===");
  Serial.flush();

  if (!connectToHomeWiFi()) return;
  if (!fetchMissionConfig()) return;
  if (!scanForMapirSsid()) return;

  printLittleFsSpace();

  if (!connectToCamera()) return;

  String fileList = getAllImages();
  if (fileList.length() == 0) return;

  QueuedImage queue[MAX_QUEUE];
  int total = parseFileList(fileList, queue, MAX_QUEUE);
  if (total <= 0) return;
  if (total >= MAX_QUEUE) {
    Serial.printf("Note: processing first %d images this cycle\n", MAX_QUEUE);
  }
  Serial.printf("Found %d image(s) — pipeline mode (1 file on disk at a time)\n", total);

  int uploaded = 0;

  for (int i = 0; i < total; i++) {
    Serial.printf("\n--- [%d/%d] %s ---\n", i + 1, total, queue[i].name);

    if (!isCameraNetwork() && !connectToCamera()) continue;
    if (!downloadImage(queue[i].name, LOCAL_TMP)) continue;

    if (!connectToHomeWiFi()) {
      LittleFS.remove(LOCAL_TMP);
      continue;
    }

    if (!uploadViaBackend(LOCAL_TMP, queue[i].name)) {
      LittleFS.remove(LOCAL_TMP);
      continue;
    }

    LittleFS.remove(LOCAL_TMP);
    uploaded++;

    if (connectToCamera()) {
      deleteCameraImage(queue[i].name);
    }
  }

  unsigned long elapsed = millis() - cycleStart;
  Serial.printf("=== Done: %d/%d uploaded in %lu.%lus (flight %s) ===\n",
    uploaded, total, elapsed / 1000, (elapsed % 1000) / 100, mission.flightId.c_str());
  Serial.flush();
}

const unsigned long SYNC_INTERVAL_MS = 30000;
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

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n--- boot ---");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.persistent(false);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
    return;
  }

  // Free space from older batch firmware (/q0, /q1, ...)
  for (int i = 0; i < 16; i++) {
    char p[8];
    snprintf(p, sizeof(p), "/q%d", i);
    if (LittleFS.exists(p)) LittleFS.remove(p);
  }
  if (LittleFS.exists("/img_tmp.jpg")) LittleFS.remove("/img_tmp.jpg");

  Serial.printf("MAPIR uploader fw=%s | backend=%s | device=%s\n",
    FW_VERSION, BACKEND_URL, DEVICE_ID);
#if USE_NGROK_BACKEND
  Serial.println("Mode: ngrok HTTPS (needs internet on HOME Wi-Fi)");
#else
  Serial.println("Mode: lab HTTP (ESP32 + PC on same Wi-Fi)");
#endif
  Serial.println("Setup done — starting sync...");
  Serial.flush();
}

bool firstSync = true;

void loop() {
  if (firstSync) {
    firstSync = false;
    runSyncCycle(true);
  } else {
    runSyncCycle(false);
  }
  delay(500);
}
