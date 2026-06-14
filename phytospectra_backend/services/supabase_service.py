from supabase import create_client, Client
from core.config import settings
from typing import Optional
import logging
import os
import re

logger = logging.getLogger(__name__)
_client: Client = None

# Flights table uses created_at in Supabase; expose flight_date for the frontend.
FLIGHTS_ORDER_COLUMN = "created_at"


def normalize_flight_row(row: dict) -> dict:
    if row and not row.get("flight_date"):
        row["flight_date"] = row.get("created_at")
    return row


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
            logger.warning("Supabase credentials not set.")
            return None
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return _client


# ─────────────────────────────────────────────
# STORAGE
# ─────────────────────────────────────────────

async def upload_image(file_path: str, bucket: str, storage_path: str) -> str:
    """
    Upload a file to Supabase Storage and return its public URL.
    Raises RuntimeError on any failure — never returns a local:// fallback.
    """
    client = get_supabase()
    if not client:
        raise RuntimeError("Supabase client not available — check SUPABASE_URL and SUPABASE_KEY")

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File to upload does not exist: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()
    content_type = {
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".tif":  "image/tiff",
        ".tiff": "image/tiff",
    }.get(ext, "application/octet-stream")

    with open(file_path, "rb") as f:
        data = f.read()

    if not data:
        raise RuntimeError(f"File is empty, aborting upload: {file_path}")

    try:
        client.storage.from_(bucket).upload(
            storage_path,
            data,
            file_options={
                "content-type": content_type,
                "upsert": "true",   # overwrite if file already exists
            },
        )
    except Exception as e:
        logger.error(
            f"Storage upload FAILED | bucket={bucket} | path={storage_path} | error={e}"
        )
        raise RuntimeError(f"Storage upload failed for bucket '{bucket}': {e}") from e

    url = client.storage.from_(bucket).get_public_url(storage_path)

    if not url or not url.startswith("https://"):
        raise RuntimeError(
            f"Upload succeeded but got invalid public URL: {url!r} "
            f"— check that bucket '{bucket}' is public in Supabase Storage settings"
        )

    logger.info(f"Uploaded | bucket={bucket} | path={storage_path} | url={url}")
    return url


async def download_image(object_path: str, bucket: str, dest_path: str) -> str:
    """Download a file from Supabase Storage to dest_path. Raises on failure."""
    client = get_supabase()
    if not client:
        raise RuntimeError("Supabase client not available")

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    try:
        data = client.storage.from_(bucket).download(object_path)
    except Exception as e:
        logger.error(f"Storage download FAILED | bucket={bucket} | path={object_path} | error={e}")
        raise RuntimeError(f"Storage download failed: {e}") from e

    if not data:
        raise RuntimeError(
            f"Download returned empty data | bucket={bucket} | path={object_path}"
        )

    with open(dest_path, "wb") as f:
        f.write(data)

    logger.info(f"Downloaded | bucket={bucket} | path={object_path} | dest={dest_path} | {len(data)} bytes")
    return dest_path


# ─────────────────────────────────────────────
# IMAGES TABLE  (raw uploads)
# ─────────────────────────────────────────────

async def save_image(record: dict) -> dict:
    """Insert a raw image record. Raises on failure."""
    client = get_supabase()
    if not client:
        raise RuntimeError("Supabase client not available — image record not saved")

    try:
        result = client.table("images").insert({
            "user_id":       record["user_id"],
            "field_id":      record.get("field_id"),
            "flight_id":     record.get("flight_id"),
            "drone_id":      record.get("drone_id"),
            "storage_path":  record["storage_path"],
            "bucket_name":   record.get("bucket_name", "multispectral"),
            "gps":           record.get("gps"),
            "gps_source":    record.get("gps_source", "MAPIR Survey3W EXIF"),
            "upload_source": record.get("upload_source", "manual"),
        }).execute()

        logger.info(f"Image saved: {record['storage_path']}")
        return result.data[0] if result.data else {}

    except Exception as e:
        logger.error(f"Failed to save image record: {e}", exc_info=True)
        raise


async def get_image_by_storage_path(storage_path: str, user_id: str) -> dict:
    client = get_supabase()
    if not client:
        return {}
    try:
        result = (
            client.table("images")
            .select("*")
            .eq("storage_path", storage_path)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else {}
    except Exception as e:
        logger.error(f"Failed to lookup image by storage path: {e}")
        return {}


async def get_images(
    user_id: str,
    field_id: str = None,
    flight_id: str = None,
    limit: int = 50,
) -> list:
    client = get_supabase()
    if not client:
        return []

    def build_query():
        q = (
            client.table("images")
            .select("*")
            .eq("user_id", user_id)
            .limit(limit)
        )
        if field_id:
            q = q.eq("field_id", field_id)
        if flight_id:
            q = q.eq("flight_id", flight_id)
        return q

    try:
        rows = None
        for order_col in ("uploaded_at", "created_at", "id"):
            try:
                rows = build_query().order(order_col, desc=True).execute().data or []
                break
            except Exception as order_err:
                logger.warning("images order by %s failed: %s", order_col, order_err)

        if rows is None:
            rows = build_query().execute().data or []

        logger.info(
            "get_images user=%s field=%s flight=%s -> %d rows",
            user_id, field_id, flight_id, len(rows),
        )
        return _attach_image_urls(rows)
    except Exception as e:
        logger.error(f"Failed to fetch images: {e}", exc_info=True)
        return []


def _normalize_image_row(row: dict) -> dict:
    if row and not row.get("uploaded_at"):
        row["uploaded_at"] = row.get("created_at")
    return row


def _attach_image_urls(rows: list) -> list:
    """Add publicUrl — public buckets need no API calls; private uses batch signed URLs."""
    client = get_supabase()
    if not rows:
        return []

    normalized_rows = [_normalize_image_row(dict(row)) for row in rows]

    if settings.SUPABASE_STORAGE_PUBLIC and client:
        for row in normalized_rows:
            path = row.get("storage_path")
            bucket = row.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
            if path and not row.get("publicUrl"):
                row["publicUrl"] = client.storage.from_(bucket).get_public_url(path)
        return normalized_rows

    if not client:
        return normalized_rows

    # Private bucket: one batch request per bucket (not one HTTP call per image).
    by_bucket: dict[str, list[tuple[int, str]]] = {}
    for idx, row in enumerate(normalized_rows):
        path = row.get("storage_path")
        if not path or row.get("publicUrl"):
            continue
        bucket = row.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
        by_bucket.setdefault(bucket, []).append((idx, path))

    chunk_size = 100
    for bucket, entries in by_bucket.items():
        for start in range(0, len(entries), chunk_size):
            chunk = entries[start : start + chunk_size]
            paths = [path for _, path in chunk]
            try:
                signed_list = client.storage.from_(bucket).create_signed_urls(
                    paths, 3600
                )
            except Exception as e:
                logger.warning("Batch signed URLs failed bucket=%s: %s", bucket, e)
                continue
            for (idx, path), signed in zip(chunk, signed_list or []):
                url = (
                    signed.get("signedURL")
                    or signed.get("signedUrl")
                    if isinstance(signed, dict)
                    else None
                )
                if url:
                    normalized_rows[idx]["publicUrl"] = url
                elif isinstance(signed, dict) and signed.get("error"):
                    logger.warning(
                        "Signed URL failed for %s/%s: %s",
                        bucket,
                        path,
                        signed.get("error"),
                    )

    return normalized_rows


def _parse_storage_object_url(url: str) -> tuple[str, str] | None:
    if not url:
        return None
    match = re.search(r"/storage/v1/object/(?:public|sign)/([^/]+)/(.+?)(?:\?|$)", url)
    if not match:
        return None
    return match.group(1), match.group(2)


def attach_segmentation_mask_urls(rows: list) -> list:
    """Add mask_url with signed URLs for private mask buckets."""
    client = get_supabase()
    if not rows:
        return []

    out = [dict(row) for row in rows]

    if settings.SUPABASE_STORAGE_PUBLIC and client:
        for row in out:
            url = row.get("heatmap_url") or row.get("mask_url")
            if url and not str(url).startswith("local://"):
                row["mask_url"] = url
        return out

    if not client:
        return out

    by_bucket: dict[str, list[tuple[int, str]]] = {}
    for idx, row in enumerate(out):
        url = row.get("heatmap_url") or row.get("mask_url")
        if not url or str(url).startswith("local://"):
            continue
        parsed = _parse_storage_object_url(str(url))
        if not parsed:
            continue
        bucket, path = parsed
        by_bucket.setdefault(bucket, []).append((idx, path))

    chunk_size = 100
    for bucket, entries in by_bucket.items():
        for start in range(0, len(entries), chunk_size):
            chunk = entries[start : start + chunk_size]
            paths = [path for _, path in chunk]
            try:
                signed_list = client.storage.from_(bucket).create_signed_urls(
                    paths, 3600
                )
            except Exception as e:
                logger.warning("Mask signed URLs failed bucket=%s: %s", bucket, e)
                continue
            for (idx, _path), signed in zip(chunk, signed_list or []):
                url = (
                    signed.get("signedURL") or signed.get("signedUrl")
                    if isinstance(signed, dict)
                    else None
                )
                if url:
                    out[idx]["mask_url"] = url

    return out


# ─────────────────────────────────────────────
# SEGMENTATIONS TABLE  (model results)
# ─────────────────────────────────────────────

async def save_segmentation(record: dict) -> dict:
    """
    Insert a segmentation result.
    Raises on failure so the caller knows the record was NOT saved.
    """
    client = get_supabase()
    if not client:
        raise RuntimeError("Supabase client not available — segmentation not saved")

    # Validate the heatmap_url before saving so we never persist local:// paths
    heatmap_url = record.get("heatmap_url")
    if heatmap_url and not heatmap_url.startswith("https://"):
        raise ValueError(
            f"Refusing to save a non-HTTPS heatmap_url: {heatmap_url!r} — "
            "this usually means the mask upload failed. Fix the upload first."
        )

    try:
        result = client.table("segmentations").insert({
            "user_id":               record["user_id"],
            "image_id":              record["image_id"],
            "field_id":              record.get("field_id"),
            "flight_id":             record.get("flight_id"),
            "drone_id":              record.get("drone_id"),
            "heatmap_url":           heatmap_url,
            "ndvi_mean":             record.get("ndvi_mean"),
            "gndvi_mean":            record.get("gndvi_mean"),
            "health_score":          record.get("health_score"),
            "stress_class":          record.get("stress_class"),
            "confidence":            record.get("confidence"),
            "healthy_pixel_count":   record.get("healthy_pixel_count"),
            "stressed_pixel_count":  record.get("stressed_pixel_count"),
            "health_percentage":     record.get("health_percentage"),
            "gps":                   record.get("gps"),
        }).execute()

        logger.info(f"Segmentation saved | image_id={record['image_id']} | url={heatmap_url}")
        return result.data[0] if result.data else {}

    except Exception as e:
        logger.error(f"Failed to save segmentation for image {record.get('image_id')}: {e}", exc_info=True)
        raise


async def get_segmentations(
    user_id: str,
    field_id: str = None,
    flight_id: str = None,
    limit: int = 50,
) -> list:
    client = get_supabase()
    if not client:
        return []
    # Try embedded images join; fall back if FK or column names differ in DB.
    select_variants = [
        "*, images(storage_path, gps, uploaded_at)",
        "*, images(storage_path, gps)",
        "*",
    ]
    for sel in select_variants:
        try:
            query = (
                client.table("segmentations")
                .select(sel)
                .eq("user_id", user_id)
                .limit(limit)
            )
            if field_id:
                query = query.eq("field_id", field_id)
            if flight_id:
                query = query.eq("flight_id", flight_id)
            data = query.order("processed_at", desc=True).execute().data or []
            return data
        except Exception as e:
            logger.warning(f"segmentations select={sel!r} failed: {e}")
            continue
    return []


async def get_flight_segmentation_rows(
    flight_id: str,
    user_id: str | None = None,
    limit: int = 500,
) -> list:
    """
    Segmentations for a flight — matches flight_id on the row and/or image_id
    for images linked to that flight (covers rows saved before flight_id was set).
    """
    client = get_supabase()
    if not client:
        return []

    if user_id:
        owned = (
            client.table("flights")
            .select("id")
            .eq("id", flight_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not owned.data:
            return []

    img_query = client.table("images").select("id").eq("flight_id", flight_id)
    if user_id:
        img_query = img_query.eq("user_id", user_id)
    img_res = img_query.execute()
    image_ids = [r["id"] for r in (img_res.data or [])]

    select_cols = (
        "id, image_id, flight_id, heatmap_url, stress_class, health_score, "
        "health_percentage, healthy_pixel_count, stressed_pixel_count, "
        "confidence, processed_at"
    )
    rows_by_image: dict[str, dict] = {}

    try:
        res = (
            client.table("segmentations")
            .select(select_cols)
            .eq("flight_id", flight_id)
            .order("processed_at", desc=True)
            .limit(limit)
            .execute()
        )
        for row in res.data or []:
            rows_by_image[row["image_id"]] = row
    except Exception as e:
        logger.warning("segmentations by flight_id=%s failed: %s", flight_id, e)

    if image_ids:
        try:
            res = (
                client.table("segmentations")
                .select(select_cols)
                .in_("image_id", image_ids)
                .order("processed_at", desc=True)
                .limit(limit)
                .execute()
            )
            for row in res.data or []:
                if row["image_id"] not in rows_by_image:
                    rows_by_image[row["image_id"]] = row
        except Exception as e:
            logger.warning(
                "segmentations by image_ids for flight %s failed: %s", flight_id, e
            )

    rows = list(rows_by_image.values())[:limit]
    return attach_segmentation_mask_urls(rows)


# ─────────────────────────────────────────────
# FLIGHTS TABLE
# ─────────────────────────────────────────────

async def create_flight(
    user_id: str,
    field_id: str,
    drone_id: str = None,
    altitude: float = None,
    weather: str = None,
) -> dict:
    client = get_supabase()
    if not client:
        raise RuntimeError("Supabase client not available — flight not created")
    try:
        result = client.table("flights").insert({
            "user_id":  user_id,
            "field_id": field_id,
            "drone_id": drone_id,
            "altitude": altitude,
            "weather":  weather,
        }).execute()
        row = result.data[0] if result.data else {}
        if row and row.get("id"):
            ok = set_esp32_active_flight(client, user_id, drone_id, row["id"])
            row["esp32_active"] = ok
        return row
    except Exception as e:
        logger.error(f"Failed to create flight: {e}", exc_info=True)
        raise


def resolve_esp32_device_id(client, user_id: str, drone_id: str = None) -> Optional[str]:
    """Find the shared ESP32 device id (often only set on one drone row, e.g. North field)."""
    if drone_id:
        res = (
            client.table("drones")
            .select("esp32_device_id")
            .eq("id", drone_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if res.data and res.data[0].get("esp32_device_id"):
            return res.data[0]["esp32_device_id"]

    res = (
        client.table("drones")
        .select("esp32_device_id")
        .eq("user_id", user_id)
        .not_.is_("esp32_device_id", "null")
        .neq("esp32_device_id", "")
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0].get("esp32_device_id")
    return None


def get_esp32_active_flight_id(client, device_id: str) -> Optional[str]:
    try:
        res = (
            client.table("esp32_active_missions")
            .select("flight_id")
            .eq("device_id", device_id)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0].get("flight_id")
    except Exception as e:
        logger.warning("esp32_active_missions read failed (run migration?): %s", e)

    try:
        res = (
            client.table("drones")
            .select("active_flight_id")
            .eq("esp32_device_id", device_id)
            .not_.is_("active_flight_id", "null")
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0].get("active_flight_id")
    except Exception as e:
        logger.warning("drones.active_flight_id read failed: %s", e)
    return None


def set_esp32_active_flight(client, user_id: str, drone_id: str, flight_id: str) -> bool:
    """
    Mark flight active for the shared ESP32 (all drone rows use the same esp32_device_id).
    Returns True if the registry was updated.
    """
    device_id = resolve_esp32_device_id(client, user_id, drone_id)
    if not device_id:
        logger.warning(
            "No esp32_device_id for user %s — set esp32-mapir-01 on your drones",
            user_id,
        )
        return False

    registry_ok = False
    drones_ok = False
    try:
        client.table("esp32_active_missions").upsert({
            "device_id": device_id,
            "user_id": user_id,
            "flight_id": flight_id,
        }).execute()
        registry_ok = True
        logger.info("ESP32 active mission device=%s flight=%s", device_id, flight_id)
    except Exception as e:
        logger.error(
            "esp32_active_missions upsert failed — run Supabase migration SQL: %s",
            e,
        )

    try:
        client.table("drones").update({"active_flight_id": flight_id}).eq(
            "esp32_device_id", device_id
        ).eq("user_id", user_id).execute()
        drones_ok = True
    except Exception as e:
        logger.warning("drones.active_flight_id update failed: %s", e)

    return registry_ok or drones_ok


async def get_flights(user_id: str, field_id: str = None) -> list:
    client = get_supabase()
    if not client:
        return []
    select_variants = [
        "*, fields(field_name), drones(drone_name)",
        "*, fields(field_name)",
        "*",
    ]
    for sel in select_variants:
        try:
            query = (
                client.table("flights")
                .select(sel)
                .eq("user_id", user_id)
            )
            if field_id:
                query = query.eq("field_id", field_id)
            rows = query.order(FLIGHTS_ORDER_COLUMN, desc=True).execute().data or []
            return [normalize_flight_row(r) for r in rows]
        except Exception as e:
            logger.warning(f"get_flights select={sel!r} failed: {e}")
            continue
    return []


# ─────────────────────────────────────────────
# FIELDS TABLE
# ─────────────────────────────────────────────

async def get_fields(user_id: str) -> list:
    client = get_supabase()
    if not client:
        raise RuntimeError("Supabase client not configured (check SUPABASE_URL and SUPABASE_KEY in backend .env)")

    last_error: Exception | None = None
    attempts = [
        ("*", "created_at"),
        ("*", "id"),
        ("*", None),
        (
            "id, user_id, field_name, crop_type, latitude, longitude, area_hectares, boundary",
            None,
        ),
    ]
    for select_cols, order_col in attempts:
        try:
            query = client.table("fields").select(select_cols).eq("user_id", user_id)
            if order_col:
                query = query.order(order_col, desc=True)
            return query.execute().data or []
        except Exception as e:
            last_error = e
            logger.warning(f"get_fields failed select={select_cols!r} order={order_col!r}: {e}")

    raise RuntimeError(f"Could not load fields from Supabase: {last_error}")

async def get_conversation(conversation_id: str, user_id: str):
    client = get_supabase()
    
    # Log what we're searching for
    logger.info(f"[get_conversation] looking for conv={conversation_id} user={user_id}")
    
    res = client.table("conversations").select("*").eq("id", conversation_id).execute()
    logger.info(f"[get_conversation] raw result (no user filter): {res.data}")
    
    if not res.data:
        return None
    
    row = res.data[0]
    if row["farmer_id"] == user_id or row["agronomist_id"] == user_id:
        return row
    
    logger.warning(f"[get_conversation] user {user_id} not a participant. farmer={row['farmer_id']} agro={row['agronomist_id']}")
    return None

async def get_messages(conversation_id: str) -> list:
    client = get_supabase()
    res = client.table("chat_messages") \
        .select("*") \
        .eq("conversation_id", conversation_id) \
        .order("created_at") \
        .execute()
    return res.data or []

async def save_chat_message(payload: dict) -> dict:
    client = get_supabase()
    res = client.table("chat_messages").insert(payload).execute()
    return res.data[0]

async def get_open_conversations() -> list:
    client = get_supabase()
    res = client.table("conversations") \
        .select("*, profiles(display_name, farm_name)") \
        .eq("status", "open") \
        .order("created_at", desc=True) \
        .execute()
    return res.data or []

