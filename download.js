// Downloads Drive videos in 10 MB pieces. Google serves one long request at about playback speed
// (~0.7 MB/s in testing), but each Range request at full speed (~10 MB/s).
// Videos are downloaded one after another, so several large videos never sit in memory at once.
const CHUNK_SIZE = 10 * 1024 * 1024;
const PARALLEL = 4;
const RETRIES = 3;

const params = new URLSearchParams(location.hash.slice(1));
const jobs = JSON.parse(params.get("jobs") || "[]");

const headingEl = document.getElementById("heading");
const nameEl = document.getElementById("fileName");
const barEl = document.getElementById("bar");
const progressEl = document.getElementById("progress");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("jobList");

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

async function getTotalSize(url) {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
    const total = Number(response.headers.get("content-range")?.split("/")[1]);
    if (response.status !== 206 || !total) throw new Error(`HTTP ${response.status}`);
    return total;
}

async function fetchChunk(url, start, end) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store" });
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

// Resolves when Chrome has written the file, rejects with the reason if it could not.
function saveFile(url, filename) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download({ url: url, filename: filename }, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            const onChanged = (delta) => {
                if (delta.id !== downloadId || !delta.state) return;
                if (delta.state.current === "complete") {
                    resolve();
                } else if (delta.state.current === "interrupted") {
                    reject(new Error(delta.error?.current || "unknown error"));
                } else {
                    return;
                }
                chrome.downloads.onChanged.removeListener(onChanged);
            };
            chrome.downloads.onChanged.addListener(onChanged);
        });
    });
}

async function downloadJob(job) {
    let total;
    try {
        total = await getTotalSize(job.url);
    } catch (e) {
        // Pieces are not supported for this link: fall back to a normal (slower) Chrome download.
        showStatus("Fast mode is not available for this video, using a normal download (slower)...");
        await saveFile(job.url, job.filename);
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
            parts[index] = await fetchChunk(job.url, ...ranges[index]);
            done += parts[index].size;
            showProgress(done, total, startedAt);
        }
    };

    showStatus("Downloading... keep this tab open.");
    try {
        await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));
    } catch (e) {
        failed = true;
        throw e;
    }

    showStatus("Saving file...");
    const blobUrl = URL.createObjectURL(new Blob(parts, { type: job.mime || "video/mp4" }));
    try {
        await saveFile(blobUrl, job.filename);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

async function run() {
    const items = jobs.map(job => {
        const li = document.createElement("li");
        li.textContent = "⏳ " + job.filename;
        listEl.appendChild(li);
        return li;
    });

    let failures = 0;
    for (let i = 0; i < jobs.length; i++) {
        headingEl.textContent = jobs.length > 1 ? `Video ${i + 1} of ${jobs.length}` : "Video Downloader";
        nameEl.textContent = jobs[i].filename;
        document.title = `Downloading ${i + 1}/${jobs.length}: ${jobs[i].filename}`;
        barEl.style.width = "0";
        progressEl.textContent = "";
        items[i].textContent = "⬇ " + jobs[i].filename;
        try {
            await downloadJob(jobs[i]);
            items[i].textContent = "✅ " + jobs[i].filename;
        } catch (e) {
            failures++;
            items[i].textContent = `❌ ${jobs[i].filename} (${e.message})`;
            items[i].classList.add("error");
        }
    }

    document.title = failures ? `Finished with ${failures} failed` : "All downloads finished";
    if (failures) {
        showStatus(`${failures} video(s) failed. Reload those Drive pages, press play, then try them again.`, true);
    } else {
        showStatus("Done! Saved to your Downloads folder. You can close this tab.");
    }
}

run();
