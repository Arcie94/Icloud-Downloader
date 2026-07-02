/**
 * iCloud Album Downloader — Frontend Logic
 * Handles album info fetching, download with SSE progress, folder browser, and ZIP compression.
 */

// ── DOM Elements ────────────────────────────────────────────
const urlInput = document.getElementById('urlInput');
const fetchBtn = document.getElementById('fetchBtn');
const errorBanner = document.getElementById('errorBanner');

const albumSection = document.getElementById('albumSection');
const albumName = document.getElementById('albumName');
const albumOwner = document.getElementById('albumOwner');
const statPhotos = document.getElementById('statPhotos');
const statVideos = document.getElementById('statVideos');
const statSize = document.getElementById('statSize');
const outputDir = document.getElementById('outputDir');
const outputSection = document.getElementById('outputSection');
const downloadBtn = document.getElementById('downloadBtn');
const browseBtn = document.getElementById('browseBtn');
const zipToggle = document.getElementById('zipToggle');

const progressSection = document.getElementById('progressSection');
const progressTitle = document.getElementById('progressTitle');
const progressCounter = document.getElementById('progressCounter');
const progressBarFill = document.getElementById('progressBarFill');
const progressSize = document.getElementById('progressSize');
const progressPercent = document.getElementById('progressPercent');
const currentFile = document.getElementById('currentFile');
const cancelBtn = document.getElementById('cancelBtn');

const zipSection = document.getElementById('zipSection');
const zipTitle = document.getElementById('zipTitle');
const zipCounter = document.getElementById('zipCounter');
const zipBarFill = document.getElementById('zipBarFill');
const zipCurrentFile = document.getElementById('zipCurrentFile');

const logSection = document.getElementById('logSection');
const logContainer = document.getElementById('logContainer');

const completeSection = document.getElementById('completeSection');
const completeSuccessVal = document.getElementById('completeSuccessVal');
const completeSkipVal = document.getElementById('completeSkipVal');
const completeFailVal = document.getElementById('completeFailVal');
const completePath = document.getElementById('completePath');
const newDownloadBtn = document.getElementById('newDownloadBtn');

const zipDownloadSection = document.getElementById('zipDownloadSection');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const zipBtnText = document.getElementById('zipBtnText');
const zipInfo = document.getElementById('zipInfo');

// Folder Modal
const folderModal = document.getElementById('folderModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalBreadcrumb = document.getElementById('modalBreadcrumb');
const folderList = document.getElementById('folderList');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const newFolderBtn = document.getElementById('newFolderBtn');

// Retry & Speed
const retryFailedBtn = document.getElementById('retryFailedBtn');
const retryCount = document.getElementById('retryCount');
const progressSpeed = document.getElementById('progressSpeed');
const progressEta = document.getElementById('progressEta');

// ── State ───────────────────────────────────────────────────
let currentTaskId = null;
let eventSource = null;
let albumData = null;
let currentBrowsePath = '';
let lastDownloadOutputDir = '';
let zipFilePath = '';
let downloadStartTime = null;
let totalBytesDownloaded = 0;
let estimatedTotalBytes = 0;

// ── Utility Functions ───────────────────────────────────────
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
    setTimeout(() => errorBanner.classList.remove('visible'), 6000);
}

function hideError() {
    errorBanner.classList.remove('visible');
}

function addLog(message, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function resetUI() {
    albumSection.classList.remove('visible');
    progressSection.classList.remove('visible');
    logSection.classList.remove('visible');
    completeSection.classList.remove('visible');
    outputSection.classList.remove('visible');
    zipSection.classList.remove('visible');
    zipDownloadSection.classList.remove('visible');
    retryFailedBtn.classList.remove('visible');
    hideError();
    logContainer.innerHTML = '';
    progressBarFill.style.width = '0%';
    currentFile.textContent = 'Waiting...';
    progressCounter.textContent = '0 / 0';
    progressSize.textContent = '';
    progressSpeed.textContent = '';
    progressEta.textContent = '';
    progressPercent.textContent = '0%';
    downloadStartTime = null;
    totalBytesDownloaded = 0;
    fetchBtn.disabled = false;
    downloadBtn.disabled = false;
    zipFilePath = '';
}

// ── Fetch Album Info ────────────────────────────────────────
async function fetchAlbumInfo() {
    const url = urlInput.value.trim();
    if (!url) {
        showError('Please enter an iCloud shared album URL');
        return;
    }

    if (!url.includes('icloud.com') || !url.includes('#')) {
        showError('Invalid URL. Please paste an iCloud shared album link.');
        return;
    }

    hideError();
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<div class="spinner"></div> Fetching...';

    // Hide previous results
    albumSection.classList.remove('visible');
    completeSection.classList.remove('visible');
    progressSection.classList.remove('visible');
    logSection.classList.remove('visible');
    zipSection.classList.remove('visible');
    zipDownloadSection.classList.remove('visible');

    try {
        const resp = await fetch('/api/album-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Failed to fetch album info');
        }

        albumData = data;

        // Populate album info
        albumName.textContent = data.album_name;
        albumOwner.textContent = `by ${data.owner_first} ${data.owner_last}`;
        statPhotos.textContent = data.photo_count;
        statVideos.textContent = data.video_count;
        statSize.textContent = formatBytes(data.total_size_bytes);

        // Auto-name folder from album name
        const safeName = data.album_name.replace(/[<>:"/\\|?*]/g, '_').trim();
        outputDir.value = `./downloads/${safeName}`;

        // Show album section with animation
        albumSection.classList.add('visible');
        outputSection.classList.add('visible');

    } catch (err) {
        showError(err.message);
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
            </svg>
            Fetch`;
    }
}

// ── Start Download ──────────────────────────────────────────
async function startDownload() {
    const url = urlInput.value.trim();
    const output = outputDir.value.trim();

    if (!url || !albumData) {
        showError('Please fetch album info first');
        return;
    }

    hideError();
    downloadBtn.disabled = true;
    fetchBtn.disabled = true;
    lastDownloadOutputDir = output;

    // Show progress UI
    progressSection.classList.add('visible');
    logSection.classList.add('visible');
    completeSection.classList.remove('visible');
    zipSection.classList.remove('visible');
    zipDownloadSection.classList.remove('visible');
    logContainer.innerHTML = '';
    progressBarFill.style.width = '0%';

    addLog('Starting download...', 'info');

    try {
        const resp = await fetch('/api/start-download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, output_dir: output }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Failed to start download');
        }

        downloadStartTime = Date.now();
        totalBytesDownloaded = 0;
        estimatedTotalBytes = albumData.total_size_bytes || 0;

        currentTaskId = data.task_id;
        addLog(`Task started: ${currentTaskId}`, 'info');

        // Connect to SSE for progress
        connectSSE(currentTaskId);

    } catch (err) {
        showError(err.message);
        downloadBtn.disabled = false;
        fetchBtn.disabled = false;
    }
}

function updateSpeedAndEta(bytesSoFar) {
    if (!downloadStartTime || bytesSoFar === 0) return;
    
    const elapsedSec = (Date.now() - downloadStartTime) / 1000;
    if (elapsedSec < 1) return; // Wait 1 second before showing speed
    
    const speedBps = bytesSoFar / elapsedSec;
    progressSpeed.textContent = ` • ${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
    
    if (estimatedTotalBytes > 0) {
        const remainingBytes = Math.max(0, estimatedTotalBytes - bytesSoFar);
        const etaSec = remainingBytes / speedBps;
        
        let etaStr = '';
        if (etaSec > 3600) {
            etaStr = `${Math.floor(etaSec / 3600)}h ${Math.floor((etaSec % 3600) / 60)}m`;
        } else if (etaSec > 60) {
            etaStr = `${Math.floor(etaSec / 60)}m ${Math.floor(etaSec % 60)}s`;
        } else if (etaSec > 0) {
            etaStr = `${Math.floor(etaSec)}s`;
        } else {
            etaStr = 'Almost done...';
        }
        progressEta.textContent = `ETA: ${etaStr}`;
    }
}

// ── SSE Progress Connection ─────────────────────────────────
function connectSSE(taskId) {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource(`/api/progress/${taskId}`);

    eventSource.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        addLog(data.message, 'info');
        progressTitle.textContent = 'Preparing...';
    });

    eventSource.addEventListener('album_info', (e) => {
        const data = JSON.parse(e.data);
        addLog(`Album: ${data.album_name} | Owner: ${data.owner} | Items: ${data.item_count}`, 'info');
    });

    eventSource.addEventListener('file_progress', (e) => {
        const data = JSON.parse(e.data);
        const overallPct = ((data.current - 1) / data.total * 100) + (data.percent / data.total);
        progressBarFill.style.width = `${Math.min(overallPct, 100)}%`;
        progressCounter.textContent = `${data.current} / ${data.total}`;
        progressPercent.textContent = `${Math.round(overallPct)}%`;
        currentFile.textContent = `${data.filename} (${data.percent}%)`;
        progressTitle.textContent = 'Downloading...';

        if (data.total_bytes_so_far) {
            progressSize.textContent = `${formatBytes(data.total_bytes_so_far)} / ${formatBytes(estimatedTotalBytes)}`;
            updateSpeedAndEta(data.total_bytes_so_far);
        }
    });

    eventSource.addEventListener('file_done', (e) => {
        const data = JSON.parse(e.data);
        addLog(`[${data.current}/${data.total}] OK ${data.filename} (${data.size_mb} MB)`, 'success');
        const pct = (data.current / data.total) * 100;
        progressBarFill.style.width = `${pct}%`;
        progressCounter.textContent = `${data.current} / ${data.total}`;
        progressPercent.textContent = `${Math.round(pct)}%`;
        currentFile.textContent = data.filename;
        
        if (data.total_bytes_so_far) {
            progressSize.textContent = `${formatBytes(data.total_bytes_so_far)} / ${formatBytes(estimatedTotalBytes)}`;
            updateSpeedAndEta(data.total_bytes_so_far);
        }
    });

    eventSource.addEventListener('file_exists', (e) => {
        const data = JSON.parse(e.data);
        addLog(`[${data.current}/${data.total}] SKIP ${data.filename} (already exists)`, 'warning');
        const pct = (data.current / data.total) * 100;
        progressBarFill.style.width = `${pct}%`;
        progressCounter.textContent = `${data.current} / ${data.total}`;
        progressPercent.textContent = `${Math.round(pct)}%`;
        
        if (data.total_bytes_so_far) {
            progressSize.textContent = `${formatBytes(data.total_bytes_so_far)} / ${formatBytes(estimatedTotalBytes)}`;
            updateSpeedAndEta(data.total_bytes_so_far);
        }
    });

    eventSource.addEventListener('file_error', (e) => {
        const data = JSON.parse(e.data);
        addLog(`[${data.current}/${data.total}] FAIL ${data.filename}: ${data.error}`, 'error');
    });

    eventSource.addEventListener('file_skip', (e) => {
        const data = JSON.parse(e.data);
        addLog(`[${data.current}/${data.total}] SKIP: ${data.reason}`, 'warning');
    });

    eventSource.addEventListener('warning', (e) => {
        const data = JSON.parse(e.data);
        addLog(`WARNING: ${data.message}`, 'warning');
    });

    eventSource.addEventListener('error_event', (e) => {
        const data = JSON.parse(e.data);
        addLog(`ERROR: ${data.message}`, 'error');
        showError(data.message);
    });

    eventSource.addEventListener('cancelled', (e) => {
        const data = JSON.parse(e.data);
        addLog(data.message, 'warning');
        progressTitle.textContent = 'Cancelled';
        cleanupAfterComplete();
    });

    eventSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        addLog(`Complete! Success: ${data.success}, Skipped: ${data.skipped}, Failed: ${data.failed}`, 'success');

        // Show complete section
        completeSection.classList.add('visible');
        completeSuccessVal.textContent = data.success;
        completeSkipVal.textContent = data.skipped;
        completeFailVal.textContent = data.failed;
        completePath.textContent = data.output_dir;
        
        if (data.failed > 0) {
            retryFailedBtn.classList.add('visible');
            retryCount.textContent = data.failed;
        }

        progressTitle.textContent = 'Complete!';
        progressBarFill.style.width = '100%';
        progressPercent.textContent = '100%';
        progressSize.textContent = formatBytes(data.total_bytes);

        cleanupAfterComplete();

        // Auto-start ZIP if toggle is on
        if (zipToggle.checked && data.success > 0) {
            startZipCompression(data.output_dir);
        }
    });

    eventSource.onerror = () => {
        // SSE connection closed (normal after complete)
    };
}

function cleanupAfterComplete() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    currentTaskId = null;
    downloadBtn.disabled = false;
    fetchBtn.disabled = false;
}

// ── Cancel Download ─────────────────────────────────────────
async function cancelDownload() {
    if (!currentTaskId) return;

    try {
        await fetch(`/api/cancel/${currentTaskId}`, { method: 'POST' });
        addLog('Cancellation requested...', 'warning');
    } catch (err) {
        showError('Failed to cancel: ' + err.message);
    }
}

// ── New Download ────────────────────────────────────────────
function newDownload() {
    resetUI();
    urlInput.value = '';
    urlInput.focus();
    albumData = null;
}

// ══════════════════════════════════════════════════════════════
// ── FOLDER BROWSER ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function openFolderBrowser() {
    folderModal.classList.add('visible');
    // Start from current outputDir value, or default empty (drives list)
    const startPath = outputDir.value.trim();
    await navigateFolder(startPath === './downloads' ? '' : startPath);
}

function closeFolderBrowser() {
    folderModal.classList.remove('visible');
}

async function navigateFolder(path) {
    currentBrowsePath = path;
    folderList.innerHTML = '<div class="folder-loading"><div class="spinner" style="margin: 0 auto;"></div></div>';

    try {
        const resp = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
        
        if (resp.status === 404) {
            // Folder doesn't exist yet (e.g. auto-named folder)
            // Fall back to parent directory
            const isWin = path.includes('\\') || /^[A-Z]:/i.test(path);
            const sep = isWin ? '\\' : '/';
            const parts = path.split(/[/\\]/).filter(Boolean);
            
            if (parts.length > 0) {
                parts.pop(); // Remove non-existent child
                let parentPath = '';
                if (parts.length > 0) {
                    parentPath = parts.join(sep);
                    if (isWin && parts.length === 1 && /^[A-Z]:$/i.test(parts[0])) {
                        parentPath += '\\'; // e.g. D:\
                    }
                }
                return navigateFolder(parentPath);
            } else {
                return navigateFolder('');
            }
        }
        
        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Failed to browse');
        }

        currentBrowsePath = data.current || '';
        renderBreadcrumb(data);
        renderFolderList(data);

    } catch (err) {
        folderList.innerHTML = `<div class="folder-empty">Error: ${err.message}</div>`;
    }
}

function renderBreadcrumb(data) {
    if (data.is_root) {
        modalBreadcrumb.innerHTML = '<span style="color:var(--text-secondary)">My Computer</span>';
        return;
    }

    const path = data.current;
    let html = '';

    // Root / My Computer link
    html += `<span class="breadcrumb-segment" onclick="navigateFolder('')">My Computer</span>`;
    html += `<span class="breadcrumb-sep"> › </span>`;

    // Split path into segments
    // Handle Windows paths like D:\Folder\Subfolder
    const isWindows = path.includes('\\') || /^[A-Z]:/.test(path);
    const sep = isWindows ? '\\' : '/';
    const parts = path.split(/[/\\]/).filter(Boolean);

    let accumulated = '';
    parts.forEach((part, i) => {
        if (isWindows && i === 0) {
            accumulated = part + '\\';
        } else {
            accumulated += (isWindows ? '\\' : '/') + part;
        }
        const fullPath = accumulated;

        if (i < parts.length - 1) {
            html += `<span class="breadcrumb-segment" onclick="navigateFolder('${fullPath.replace(/\\/g, '\\\\')}')">${part}</span>`;
            html += `<span class="breadcrumb-sep"> › </span>`;
        } else {
            html += `<span style="color:var(--text-primary);font-weight:600;">${part}</span>`;
        }
    });

    modalBreadcrumb.innerHTML = html;
}

function renderFolderList(data) {
    let html = '';

    // Parent directory button (if not at root)
    if (!data.is_root && data.parent !== null) {
        const parentPath = data.parent || '';
        html += `
            <div class="folder-item parent-item" onclick="navigateFolder('${parentPath.replace(/\\/g, '\\\\')}')">
                <svg class="folder-item-icon parent-icon" viewBox="0 0 24 24">
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                .. (Parent Folder)
            </div>`;
    }

    if (data.folders.length === 0) {
        html += '<div class="folder-empty">No subfolders found</div>';
    } else {
        data.folders.forEach(folder => {
            const isRoot = data.is_root;
            const fullPath = isRoot ? folder : (data.current + (data.current.endsWith('\\') || data.current.endsWith('/') ? '' : '\\') + folder);
            const iconClass = isRoot ? 'drive-icon' : '';
            const iconSvg = isRoot
                ? `<svg class="folder-item-icon ${iconClass}" viewBox="0 0 24 24"><path d="M20 6H12L10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 12H5c-.55 0-1-.45-1-1V9h16v8c0 .55-.45 1-1 1z"/></svg>`
                : `<svg class="folder-item-icon" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;

            html += `
                <div class="folder-item" onclick="navigateFolder('${fullPath.replace(/\\/g, '\\\\')}')">
                    ${iconSvg}
                    ${folder}
                </div>`;
        });
    }

    folderList.innerHTML = html;
}

function selectFolder() {
    if (currentBrowsePath) {
        outputDir.value = currentBrowsePath;
    }
    closeFolderBrowser();
}

async function createNewFolder() {
    const name = prompt('Enter new folder name:');
    if (!name || !name.trim()) return;

    const safeName = name.trim();
    const basePath = currentBrowsePath || '.';
    const newPath = basePath + (basePath.endsWith('\\') || basePath.endsWith('/') ? '' : '\\') + safeName;

    try {
        // Create via a quick fetch — we'll add this endpoint
        addLog(`Creating folder: ${newPath}`, 'info');
        // For simplicity, just navigate to it (server will see the path)
        // The folder will be created when download starts
        outputDir.value = newPath;
        closeFolderBrowser();
    } catch (err) {
        showError('Failed to create folder: ' + err.message);
    }
}

// ══════════════════════════════════════════════════════════════
// ── ZIP COMPRESSION ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function startZipCompression(outputDirPath) {
    const albumNameText = albumData ? albumData.album_name : 'album';

    addLog('Starting ZIP compression...', 'info');
    zipSection.classList.add('visible');
    zipBarFill.style.width = '0%';
    zipCurrentFile.textContent = 'Preparing...';
    zipCounter.textContent = '0 / 0';

    try {
        const resp = await fetch('/api/create-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                output_dir: outputDirPath,
                album_name: albumNameText,
            }),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Failed to start ZIP');
        }

        // Connect SSE for ZIP progress
        connectZipSSE(data.task_id, data.zip_path);

    } catch (err) {
        addLog(`ZIP Error: ${err.message}`, 'error');
        zipSection.classList.remove('visible');
    }
}

function connectZipSSE(taskId, zipPath) {
    const zipES = new EventSource(`/api/progress/${taskId}`);

    zipES.addEventListener('zip_start', (e) => {
        const data = JSON.parse(e.data);
        addLog(`Compressing ${data.total} files to ZIP...`, 'info');
    });

    zipES.addEventListener('zip_progress', (e) => {
        const data = JSON.parse(e.data);
        zipBarFill.style.width = `${data.percent}%`;
        zipCounter.textContent = `${data.current} / ${data.total}`;
        zipCurrentFile.textContent = data.filename;
    });

    zipES.addEventListener('zip_complete', (e) => {
        const data = JSON.parse(e.data);
        zipFilePath = data.zip_path;
        const originalSize = formatBytes(data.original_size_bytes);
        const zipSize = formatBytes(data.zip_size_bytes);
        const ratio = ((1 - data.zip_size_bytes / data.original_size_bytes) * 100).toFixed(1);

        addLog(`ZIP complete! ${data.file_count} files | ${zipSize} (${ratio}% smaller)`, 'success');

        zipBarFill.style.width = '100%';
        zipCurrentFile.textContent = data.zip_filename;

        // Show download ZIP button
        zipDownloadSection.classList.add('visible');
        zipBtnText.textContent = `Download ZIP (${zipSize})`;
        zipInfo.textContent = `${data.file_count} files • Original: ${originalSize} → ZIP: ${zipSize} (${ratio}% compression)`;

        zipES.close();
    });

    zipES.addEventListener('zip_cancelled', (e) => {
        const data = JSON.parse(e.data);
        addLog(data.message, 'warning');
        zipSection.classList.remove('visible');
        zipES.close();
    });

    zipES.addEventListener('error_event', (e) => {
        const data = JSON.parse(e.data);
        addLog(`ZIP Error: ${data.message}`, 'error');
        zipSection.classList.remove('visible');
        zipES.close();
    });

    zipES.onerror = () => {
        // Normal close
    };
}

function downloadZip() {
    if (!zipFilePath) return;
    window.open(`/api/download-zip?path=${encodeURIComponent(zipFilePath)}`, '_blank');
}

// ── Event Listeners ─────────────────────────────────────────
fetchBtn.addEventListener('click', fetchAlbumInfo);
downloadBtn.addEventListener('click', startDownload);
retryFailedBtn.addEventListener('click', () => {
    // Hide complete section and re-run download
    completeSection.classList.remove('visible');
    retryFailedBtn.classList.remove('visible');
    startDownload();
});
cancelBtn.addEventListener('click', cancelDownload);
newDownloadBtn.addEventListener('click', newDownload);
browseBtn.addEventListener('click', openFolderBrowser);
modalCloseBtn.addEventListener('click', closeFolderBrowser);
selectFolderBtn.addEventListener('click', selectFolder);
newFolderBtn.addEventListener('click', createNewFolder);
downloadZipBtn.addEventListener('click', downloadZip);

// Close modal on overlay click
folderModal.addEventListener('click', (e) => {
    if (e.target === folderModal) closeFolderBrowser();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && folderModal.classList.contains('visible')) {
        closeFolderBrowser();
    }
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchAlbumInfo();
});

// Auto-focus input on load
window.addEventListener('DOMContentLoaded', () => {
    urlInput.focus();
});
