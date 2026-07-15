# iCloud Shared Album Downloader

A lightweight, fast, and beautiful Web UI tool to download all photos and videos from public iCloud shared albums. Built with Python (Flask) and Vanilla JS.

## Features

- **Beautiful Web UI:** Modern glassmorphism interface.
- **Fast Downloading:** Bypasses browser limits and downloads media concurrently.
- **Smart ZIP Compression:** Packages downloaded media into a ZIP file instantly. Uses `ZIP_STORED` for already compressed files (MP4, JPG, HEIC) to save CPU and time.
- **Auto-Naming & Folder Browser:** Automatically names folders based on the album name and lets you visually browse your local computer to pick download locations.
- **Real-Time Progress:** See download speeds, ETA, and progress bars updated in real-time via Server-Sent Events (SSE).
- **Retry Failed Downloads:** Easily retry only the failed files without re-downloading the entire album.

## Requirements

- Python 3.8+
- Windows / macOS / Linux

## Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/Arcie94/Icloud-Downloader.git
   cd icloud-album-downloader
   ```

2. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Using the Web UI (Recommended)

**On Windows:**
Simply double-click the `Start Web UI.bat` file. It will automatically start the local server and open your default web browser to `http://localhost:5000`.

**On Mac/Linux (or manually):**
Run the Flask app:

```bash
python app.py
```

Then open `http://localhost:5000` in your web browser.

### How to get an iCloud Shared Album URL?

1. Open the Photos app on your iPhone/Mac.
2. Go to the Shared Album.
3. Turn on "Public Website" in the album settings.
4. Copy the iCloud link provided (it should look like `https://www.icloud.com/sharedalbum/#...`).

## Technical Details

- **Backend:** Flask, Python `requests`, threading for background tasks.
- **Frontend:** HTML5, Vanilla JavaScript, CSS3 (No heavy frameworks used).
- **Communication:** Standard REST APIs and Server-Sent Events (SSE) for real-time streaming.

## License

MIT License
