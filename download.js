// Downloads a Drive video in 10 MB pieces. Google serves one long request at about playback speed
// (~0.7 MB/s in testing), but each Range request at full speed (~10 MB/s).
const CHUNK_SIZE = 10 * 1024 * 1024;
const PARALLEL = 4;
const RETRIES = 3;

const params = new URLSearchParams(location.hash.slice(1));
const videoUrl = params.get("url");
const filename = params.get("filename");
const mimeType = params.get("mime") || "video/mp4";

const nameEl = document.getElementById("fileName");
const barEl = document.getElementById("bar");
const progressEl = document.getElementById("progress");
const statusEl = document.getElementById("status");

nameEl.textContent = filename;
document.title = "Downloading: " + filename;

function showStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
}

function formatMB(bytes) {
    return (bytes / 1048576).toFixed(1) + " MB";
}

function showProgress(done, total, startedAt) {
    const seconds = (performance.now() - startedAt) / 1000;
    const speed = done / seconds;
    const remaining = speed > 0 ? Math.ceil((total - done) / speed) : 0;
    barEl.style.width = (done / total * 100).toFixed(1) + "%";
    progressEl.textContent = `${formatMB(done)} / ${formatMB(total)} · ${formatMB(speed)}/s · ${remaining}s left`;
}

async function getTotalSize() {
    const response = await fetch(videoUrl, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
    const total = Number(response.headers.get("content-range")?.split("/")[1]);
    if (response.status !== 206 || !total) throw new Error(`HTTP ${response.status}`);
    return total;
}

async function fetchChunk(start, end) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(videoUrl, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store" });
            if (response.status !== 206) throw new Error(`HTTP ${response.status}`);
            // A Blob (not an ArrayBuffer) lets Chrome keep large videos on disk instead of in memory.
            const blob = await response.blob();
            if (blob.size !== end - start + 1) throw new Error("incomplete piece");
            return blob;
        } catch (e) {
            if (attempt >= RETRIES) throw e;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

function saveFile(url, onSaved) {
    chrome.downloads.download({ url: url, filename: filename }, (downloadId) => {
        if (chrome.runtime.lastError) {
            showStatus(`Can't save: ${chrome.runtime.lastError.message}`, true);
            return;
        }
        const onChanged = (delta) => {
            if (delta.id !== downloadId || !delta.state) return;
            if (delta.state.current === "complete") {
                showStatus("Done! Saved to your Downloads folder. You can close this tab.");
                onSaved?.();
            } else if (delta.state.current === "interrupted") {
                showStatus(`Download failed (${delta.error?.current || "unknown error"}). Reload the Drive page, press play, then try again.`, true);
            } else {
                return;
            }
            chrome.downloads.onChanged.removeListener(onChanged);
        };
        chrome.downloads.onChanged.addListener(onChanged);
    });
}

async function run() {
    let total;
    try {
        total = await getTotalSize();
    } catch (e) {
        // Pieces are not supported for this link: fall back to a normal (slower) Chrome download.
        showStatus("Fast mode is not available for this video, using a normal download (slower)...");
        saveFile(videoUrl);
        return;
    }

    const ranges = [];
    for (let start = 0; start < total; start += CHUNK_SIZE) {
        ranges.push([start, Math.min(start + CHUNK_SIZE, total) - 1]);
    }
    const parts = new Array(ranges.length);
    const startedAt = performance.now();
    let next = 0;
    let done = 0;
    let failed = false;

    const worker = async () => {
        while (next < ranges.length && !failed) {
            const index = next++;
            parts[index] = await fetchChunk(...ranges[index]);
            done += parts[index].size;
            showProgress(done, total, startedAt);
        }
    };

    showStatus("Downloading... keep this tab open.");
    try {
        await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));
    } catch (e) {
        failed = true;
        showStatus(`Download failed (${e.message}). Reload the Drive page, press play, then try again.`, true);
        return;
    }

    showStatus("Saving file...");
    const blobUrl = URL.createObjectURL(new Blob(parts, { type: mimeType }));
    saveFile(blobUrl, () => URL.revokeObjectURL(blobUrl));
}

run();
