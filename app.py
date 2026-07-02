"""
iCloud Shared Album Downloader — Flask Web Server
Provides a Web UI for downloading iCloud shared album content.
"""

import sys
sys._called_from_web = True  # Prevent encoding reconfigure in module

from flask import Flask, render_template, request, jsonify, Response, send_file
import os
import sys

from icloud_downloader import fetch_album_info, download_album, create_zip_archive
from task_manager import task_manager

app = Flask(__name__)


# ── Routes ───────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main page."""
    return render_template("index.html")


@app.route("/api/album-info", methods=["POST"])
def api_album_info():
    """Fetch album metadata from an iCloud shared album URL."""
    data = request.get_json()
    url = data.get("url", "").strip()

    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        info = fetch_album_info(url)
        return jsonify(info)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Failed to fetch album info: {str(e)}"}), 500


# ── Folder Browser API ──────────────────────────────────────

@app.route("/api/browse")
def api_browse():
    """List subfolders at a given path for the folder browser UI."""
    browse_path = request.args.get("path", "").strip()

    # Default: list available drives on Windows, or home dir on Linux/macOS
    if not browse_path:
        if sys.platform == "win32":
            # List available drive letters
            import string
            drives = []
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if os.path.exists(drive):
                    drives.append(drive)
            return jsonify({
                "current": "",
                "parent": None,
                "folders": drives,
                "is_root": True,
            })
        else:
            browse_path = os.path.expanduser("~")

    browse_path = os.path.abspath(browse_path)

    if not os.path.isdir(browse_path):
        return jsonify({"error": f"Directory not found: {browse_path}"}), 404

    try:
        entries = sorted(os.listdir(browse_path), key=str.lower)
        folders = []
        for entry in entries:
            full_path = os.path.join(browse_path, entry)
            if os.path.isdir(full_path) and not entry.startswith('.'):
                try:
                    # Test if accessible
                    os.listdir(full_path)
                    folders.append(entry)
                except PermissionError:
                    pass  # Skip inaccessible folders

        parent = os.path.dirname(browse_path)
        # On Windows, if we're at a drive root (e.g., "D:\"), parent goes to drive list
        if parent == browse_path:
            parent = ""  # Signal to show drive list

        return jsonify({
            "current": browse_path,
            "parent": parent,
            "folders": folders,
            "is_root": False,
        })

    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Download API ─────────────────────────────────────────────

@app.route("/api/start-download", methods=["POST"])
def api_start_download():
    """Start downloading an album in a background thread."""
    data = request.get_json()
    url = data.get("url", "").strip()
    output_dir = data.get("output_dir", "./downloads").strip()

    if not url:
        return jsonify({"error": "URL is required"}), 400

    task_id = task_manager.start_task("dl", download_album, url, output_dir)
    return jsonify({"task_id": task_id, "status": "started"})


@app.route("/api/progress/<task_id>")
def api_progress(task_id):
    """SSE endpoint for real-time download progress."""
    generator = task_manager.stream_task_events(task_id)
    if not generator:
        return jsonify({"error": "Task not found"}), 404

    return Response(
        generator,
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/cancel/<task_id>", methods=["POST"])
def api_cancel(task_id):
    """Cancel a running download task."""
    if task_manager.cancel_task(task_id):
        return jsonify({"status": "cancelling"})
    return jsonify({"error": "Task not found"}), 404


# ── ZIP API ──────────────────────────────────────────────────

@app.route("/api/create-zip", methods=["POST"])
def api_create_zip():
    """Start creating a ZIP archive in a background thread."""
    data = request.get_json()
    output_dir = data.get("output_dir", "./downloads").strip()
    album_name = data.get("album_name", "album").strip()

    if not os.path.isdir(output_dir):
        return jsonify({"error": f"Directory not found: {output_dir}"}), 404

    # Sanitize album name for filename
    safe_name = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in album_name)
    safe_name = safe_name.strip() or "album"
    zip_path = os.path.join(os.path.dirname(os.path.abspath(output_dir)), f"{safe_name}.zip")

    task_id = task_manager.start_task("zip", create_zip_archive, output_dir, zip_path)

    return jsonify({"task_id": task_id, "status": "started", "zip_path": zip_path})


@app.route("/api/download-zip")
def api_download_zip():
    """Send a ZIP file as a browser download."""
    zip_path = request.args.get("path", "").strip()

    if not zip_path or not os.path.isfile(zip_path):
        return jsonify({"error": "ZIP file not found"}), 404

    return send_file(
        zip_path,
        as_attachment=True,
        download_name=os.path.basename(zip_path),
    )


# ── Main ─────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  iCloud Album Downloader — Web UI")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
