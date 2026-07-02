"""
iCloud Shared Album Downloader — Core Module
Downloads all photos and videos from a public iCloud shared album.
Can be used as CLI tool or imported by the Flask web app.
"""

import requests
import json
import os
import sys
import re
import time
import zipfile
from pathlib import Path

# Fix Windows console encoding when running as CLI
if sys.platform == "win32" and not hasattr(sys, '_called_from_web'):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Minimal headers — browser-like headers cause timeouts on Apple servers
HEADERS = {
    "User-Agent": "curl/8.19.0",
    "Content-Type": "text/plain",
    "Accept": "*/*",
}

BASE_HOST = "p13-sharedstreams.icloud.com"


def extract_token(url: str) -> str:
    """Extract the album token from an iCloud shared album URL."""
    match = re.search(r"#([A-Za-z0-9]+)", url)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract album token from URL: {url}")


def resolve_host(token: str) -> str:
    """Resolve the correct Apple host via HTTP 330 redirect."""
    url = f"https://{BASE_HOST}/{token}/sharedstreams/webstream"
    data = json.dumps({"streamCtag": None})

    resp = requests.post(url, data=data, headers=HEADERS, timeout=15, allow_redirects=False)

    if resp.status_code == 330:
        body = resp.json()
        host = body.get("X-Apple-MMe-Host", BASE_HOST)
        return host
    elif resp.status_code == 200:
        return BASE_HOST
    else:
        raise Exception(f"Unexpected status: {resp.status_code}")


def get_stream_metadata(session: requests.Session, host: str, token: str) -> dict:
    """Fetch the album metadata including photos list."""
    url = f"https://{host}/{token}/sharedstreams/webstream"
    data = json.dumps({"streamCtag": None})

    resp = session.post(url, data=data, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.json()


def get_asset_urls(session: requests.Session, host: str, token: str, photo_guids: list) -> dict:
    """
    Get download URLs for photos/videos.
    photoGuids = actual photoGuid values (NOT checksums).
    Response items are keyed by checksum.
    """
    url = f"https://{host}/{token}/sharedstreams/webasseturls"
    data = json.dumps({"photoGuids": photo_guids})

    resp = session.post(url, data=data, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    result = resp.json()

    return result.get("items", {})


def pick_best_derivative(derivatives: dict) -> dict:
    """Pick the best (highest resolution/size) derivative for download."""
    if not derivatives:
        return None

    best = None
    best_size = 0

    for key, deriv in derivatives.items():
        if key == "PosterFrame":
            continue
        size = int(deriv.get("fileSize", 0))
        if size > best_size:
            best_size = size
            best = deriv

    return best


def extract_filename_from_url(url_path: str) -> str:
    """Extract the original filename from the iCloud asset URL."""
    path_part = url_path.split("?")[0]
    segments = path_part.split("/")
    for seg in reversed(segments):
        if "." in seg and not seg.startswith("."):
            return seg
    return None


def fetch_album_info(album_url: str) -> dict:
    """
    Fetch album metadata without downloading.
    Returns dict with album_name, owner, item_count, token, host.
    """
    token = extract_token(album_url)
    host = resolve_host(token)

    session = requests.Session()
    result = get_stream_metadata(session, host, token)

    photos = result.get("photos", [])

    # Calculate total size estimate
    total_size = 0
    video_count = 0
    photo_count = 0
    for photo in photos:
        media_type = photo.get("mediaAssetType", "image")
        if media_type == "video":
            video_count += 1
        else:
            photo_count += 1
        derivatives = photo.get("derivatives", {})
        best = pick_best_derivative(derivatives)
        if best:
            total_size += int(best.get("fileSize", 0))

    return {
        "album_name": result.get("streamName", "Unknown"),
        "owner_first": result.get("userFirstName", ""),
        "owner_last": result.get("userLastName", ""),
        "item_count": len(photos),
        "photo_count": photo_count,
        "video_count": video_count,
        "total_size_bytes": total_size,
        "token": token,
        "host": host,
    }


def download_album(album_url: str, output_dir: str, progress_callback=None, cancel_check=None):
    """
    Download all items from an iCloud shared album.

    Args:
        album_url: The iCloud shared album URL
        output_dir: Directory to save files
        progress_callback: Optional callable(event_type, data_dict) for progress
        cancel_check: Optional callable() -> bool, returns True if cancelled
    """
    def emit(event_type, **kwargs):
        if progress_callback:
            progress_callback(event_type, kwargs)

    token = extract_token(album_url)
    emit("status", message=f"Resolving host for token: {token}")

    host = resolve_host(token)
    emit("status", message=f"Connected to: {host}")

    session = requests.Session()
    result = get_stream_metadata(session, host, token)

    album_name = result.get("streamName", "Unknown")
    user_first = result.get("userFirstName", "")
    user_last = result.get("userLastName", "")
    photos = result.get("photos", [])

    emit("album_info", album_name=album_name, owner=f"{user_first} {user_last}",
         item_count=len(photos))

    if not photos:
        emit("error", message="No photos found in this album")
        return

    # Build photo info
    photo_info = []
    for i, photo in enumerate(photos):
        derivatives = photo.get("derivatives", {})
        best = pick_best_derivative(derivatives)
        if best:
            photo_info.append({
                "photo_guid": photo.get("photoGuid"),
                "best_checksum": best.get("checksum"),
                "file_size": int(best.get("fileSize", 0)),
                "media_type": photo.get("mediaAssetType", "image"),
                "index": i,
            })

    emit("status", message=f"{len(photo_info)} downloadable items identified")

    # Get download URLs in batches
    BATCH_SIZE = 25
    all_asset_urls = {}

    for batch_start in range(0, len(photo_info), BATCH_SIZE):
        if cancel_check and cancel_check():
            emit("cancelled", message="Download cancelled by user")
            return

        batch = photo_info[batch_start:batch_start + BATCH_SIZE]
        guids = [p["photo_guid"] for p in batch]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(photo_info) + BATCH_SIZE - 1) // BATCH_SIZE
        emit("status", message=f"Fetching URLs batch {batch_num}/{total_batches}...")

        try:
            assets = get_asset_urls(session, host, token, guids)
            all_asset_urls.update(assets)
        except Exception as e:
            emit("warning", message=f"Error fetching batch {batch_num}: {e}")

        if batch_start + BATCH_SIZE < len(photo_info):
            time.sleep(0.3)

    emit("status", message=f"Got {len(all_asset_urls)} download URLs. Starting downloads...")

    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Download all files
    success_count = 0
    fail_count = 0
    skip_count = 0
    total = len(photo_info)
    total_bytes = 0

    for i, info in enumerate(photo_info, 1):
        if cancel_check and cancel_check():
            emit("cancelled", message="Download cancelled by user")
            return

        best_checksum = info["best_checksum"]
        asset = all_asset_urls.get(best_checksum)

        if not asset:
            fail_count += 1
            emit("file_skip", current=i, total=total, reason="No URL available")
            continue

        url_location = asset.get("url_location", "")
        url_path = asset.get("url_path", "")
        if not url_location or not url_path:
            fail_count += 1
            emit("file_skip", current=i, total=total, reason="Incomplete URL")
            continue

        download_url = f"https://{url_location}{url_path}"
        original_name = extract_filename_from_url(url_path)
        if original_name:
            filename = f"{i:04d}_{original_name}"
        else:
            ext = "mp4" if info["media_type"] == "video" else "jpg"
            filename = f"{i:04d}_{best_checksum[:10]}.{ext}"

        filepath = output_path / filename

        if filepath.exists() and filepath.stat().st_size > 0:
            skip_count += 1
            total_bytes += filepath.stat().st_size
            emit("file_exists", current=i, total=total, filename=filename,
                 total_bytes_so_far=total_bytes)
            continue

        # Download
        try:
            resp = session.get(download_url, headers={"User-Agent": HEADERS["User-Agent"]},
                               timeout=120, stream=True)
            resp.raise_for_status()

            file_total = int(resp.headers.get("content-length", 0))
            downloaded = 0

            with open(filepath, "wb") as f:
                for chunk in resp.iter_content(chunk_size=65536):
                    if cancel_check and cancel_check():
                        emit("cancelled", message="Download cancelled by user")
                        return
                    f.write(chunk)
                    downloaded += len(chunk)
                    if file_total > 0:
                        pct = int((downloaded / file_total) * 100)
                        emit("file_progress", current=i, total=total,
                             filename=filename, percent=pct,
                             downloaded=downloaded, file_total=file_total,
                             total_bytes_so_far=total_bytes + downloaded)

            success_count += 1
            total_bytes += filepath.stat().st_size
            size_mb = filepath.stat().st_size / (1024 * 1024)
            emit("file_done", current=i, total=total,
                 filename=filename, size_mb=round(size_mb, 2),
                 total_bytes_so_far=total_bytes)

        except Exception as e:
            fail_count += 1
            emit("file_error", current=i, total=total,
                 filename=filename, error=str(e))

        time.sleep(0.1)

    # Final summary
    emit("complete",
         album_name=album_name,
         success=success_count,
         skipped=skip_count,
         failed=fail_count,
         total=total,
         total_bytes=total_bytes,
         output_dir=str(output_path.resolve()))


# ── ZIP Archive Creator ──────────────────────────────────────

def create_zip_archive(source_dir, zip_path=None, progress_callback=None, cancel_check=None):
    """
    Compress all files in source_dir into a ZIP archive.

    Args:
        source_dir: Path to directory containing files to compress.
        zip_path: Output ZIP file path. If None, auto-generates from source_dir.
        progress_callback: Optional fn(event_type, data_dict) for progress updates.
        cancel_check: Optional fn() -> bool, returns True if cancelled.

    Returns:
        dict with zip_path, file_count, zip_size_bytes.
    """
    source_dir = os.path.abspath(source_dir)

    if not os.path.isdir(source_dir):
        raise ValueError(f"Directory not found: {source_dir}")

    if zip_path is None:
        zip_path = source_dir.rstrip("/\\") + ".zip"

    # Gather all files
    files = sorted([
        f for f in os.listdir(source_dir)
        if os.path.isfile(os.path.join(source_dir, f))
    ])

    if not files:
        raise ValueError("No files found in directory")

    total = len(files)

    if progress_callback:
        progress_callback("zip_start", {"total": total, "zip_path": zip_path})

    compressed = 0
    total_original_size = 0

    # Media extensions that are already compressed — use ZIP_STORED (fast, no re-compress)
    ALREADY_COMPRESSED = {
        '.mp4', '.mov', '.avi', '.mkv', '.webm',  # Video
        '.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.webp',  # Photo
        '.aac', '.mp3', '.m4a', '.flac',  # Audio
    }

    with zipfile.ZipFile(zip_path, 'w') as zf:
        for i, filename in enumerate(files, 1):
            if cancel_check and cancel_check():
                if progress_callback:
                    progress_callback("zip_cancelled", {"message": "ZIP creation cancelled"})
                # Remove partial ZIP
                try:
                    os.remove(zip_path)
                except OSError:
                    pass
                return None

            filepath = os.path.join(source_dir, filename)
            file_size = os.path.getsize(filepath)
            total_original_size += file_size

            if progress_callback:
                progress_callback("zip_progress", {
                    "current": i,
                    "total": total,
                    "filename": filename,
                    "percent": round(i / total * 100),
                })

            # Use STORED for media (already compressed), DEFLATED for others
            ext = os.path.splitext(filename)[1].lower()
            method = zipfile.ZIP_STORED if ext in ALREADY_COMPRESSED else zipfile.ZIP_DEFLATED
            zf.write(filepath, filename, compress_type=method)
            compressed += 1

    zip_size = os.path.getsize(zip_path)

    result = {
        "zip_path": zip_path,
        "zip_filename": os.path.basename(zip_path),
        "file_count": compressed,
        "original_size_bytes": total_original_size,
        "zip_size_bytes": zip_size,
    }

    if progress_callback:
        progress_callback("zip_complete", result)

    return result


# ── CLI Mode ───────────────────────────────────────────────────

def cli_main():
    """Run as command-line tool with print-based progress."""
    ALBUM_URL = "https://www.icloud.com/sharedalbum/#B2V5yeZFhGnUyN8;E61BA362-0061-465D-880E-88900CFCA3DA"
    OUTPUT_DIR = "./downloads"

    def cli_progress(event_type, data):
        if event_type == "status":
            print(f"[*] {data['message']}")
        elif event_type == "album_info":
            print(f"[*] Album: {data['album_name']}")
            print(f"[*] Owner: {data['owner']}")
            print(f"[*] Items: {data['item_count']}")
        elif event_type == "file_done":
            print(f"    [{data['current']}/{data['total']}] [OK] {data['filename']} ({data['size_mb']} MB)")
        elif event_type == "file_exists":
            print(f"    [{data['current']}/{data['total']}] [EXISTS] {data['filename']}")
        elif event_type == "file_error":
            print(f"    [{data['current']}/{data['total']}] [FAIL] {data['filename']} - {data['error']}")
        elif event_type == "file_skip":
            print(f"    [{data['current']}/{data['total']}] [SKIP] {data['reason']}")
        elif event_type == "complete":
            total_mb = data['total_bytes'] / (1024 * 1024)
            print(f"\n{'='*60}")
            print(f"  Download Complete!")
            print(f"  Album:      {data['album_name']}")
            print(f"  Success:    {data['success']}")
            print(f"  Skipped:    {data['skipped']}")
            print(f"  Failed:     {data['failed']}")
            print(f"  Total:      {data['total']}")
            print(f"  Size:       {total_mb:.2f} MB")
            print(f"  Location:   {data['output_dir']}")
            print(f"{'='*60}")

    print(f"{'='*60}")
    print(f"  iCloud Shared Album Downloader")
    print(f"{'='*60}")
    download_album(ALBUM_URL, OUTPUT_DIR, progress_callback=cli_progress)


if __name__ == "__main__":
    cli_main()
