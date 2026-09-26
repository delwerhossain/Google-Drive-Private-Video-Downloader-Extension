document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector('.header');
    const notDriveMessage = document.getElementById('notDriveMessage');
    const downloadContainer = document.getElementById('downloadContainer');
    const statusMessage = document.getElementById('statusMessage');
    const btnOn = document.getElementById('btnOn');
    const btnOff = document.getElementById('btnOff');
    const reloadBtn = document.querySelector('.reload-btn');
    const folderRow = document.getElementById('folderRow');
    const folderInput = document.getElementById('folderInput');
    const downloadAllBtn = document.getElementById('downloadAllBtn');

    let renderedKey = null;
    let currentVideos = [];

    function showStatus(text, isError = false) {
        statusMessage.textContent = text;
        statusMessage.classList.toggle("error", isError);
    }

    function updateUI(isEnabled) {
    btnOn.disabled = isEnabled;
    btnOff.disabled = !isEnabled;
    reloadBtn.classList.toggle('active', isEnabled);
	}

    function handleStateChange(newState) {
        chrome.storage.local.set({ extensionEnabled: newState }, () => {
            updateUI(newState);
            
            if (!newState) {
                downloadContainer.innerHTML = '';
                renderedKey = null;
                showStatus("Extension stopped.");
                setTimeout(() => {
                    showStatus("Click ON to start extension.");
                }, 2000);
            }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return;

                chrome.runtime.sendMessage({ 
                    type: "setEnabled", 
                    enabled: newState,
                    tabId: tab.id,
                    url: tab.url
                }, (response) => {
                    if (newState && response?.success) {
                        chrome.tabs.reload(tab.id);
                    }
                });
            });
        });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url.startsWith('https://drive.google.com/')) {
            header.classList.add('hidden');
            downloadContainer.classList.add('hidden');
            statusMessage.classList.add('hidden');
            notDriveMessage.classList.remove('hidden');
            return;
        }

        header.classList.remove('hidden');
        folderRow.classList.remove('hidden');
        downloadContainer.classList.remove('hidden');
        statusMessage.classList.remove('hidden');
        notDriveMessage.classList.add('hidden');

		chrome.storage.local.get(['extensionEnabled'], (result) => {
			const isEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : false;
			updateUI(isEnabled);
		});

        btnOn.addEventListener('click', () => handleStateChange(true));
        btnOff.addEventListener('click', () => handleStateChange(false));

        reloadBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    chrome.tabs.reload(tabs[0].id);
                }
            });
        });

        const activeTabId = tab.id;
        const waitingText = "Waiting for video. Press play on the video; if nothing shows, reload the page.";

        chrome.storage.local.get(['downloadFolder'], (result) => {
            folderInput.value = result.downloadFolder || "";
        });
        folderInput.addEventListener('input', () => {
            chrome.storage.local.set({ downloadFolder: folderInput.value });
        });
        downloadAllBtn.addEventListener('click', () => downloadVideos(currentVideos));

        // The download page fetches videos in pieces (much faster than a normal Chrome download),
        // one video after another.
        function downloadVideos(videos) {
            if (videos.length === 0) return;
            const folder = buildFolderPath(folderInput.value);
            const jobs = videos.map(req => {
                const filename = buildDownloadFilename(req.videoTitle, req.mimeType);
                return {
                    url: req.lastItagUrl,
                    filename: folder ? `${folder}/${filename}` : filename,
                    mime: req.mimeType || "video/mp4"
                };
            });
            const query = new URLSearchParams({ jobs: JSON.stringify(jobs) });
            chrome.tabs.create({ url: chrome.runtime.getURL("download.html") + "#" + query });
        }

        function downloadVideo(req) {
            downloadVideos([req]);
        }

        // Rebuild the list only when it changes, so clicks are not lost and messages stay visible.
        function renderVideos(videos) {
            currentVideos = videos;
            downloadAllBtn.disabled = videos.length === 0;
            downloadAllBtn.textContent = videos.length > 0 ? `⬇ All (${videos.length})` : "⬇ All";
            const key = JSON.stringify(videos.map(req => [req.videoTitle, req.lastItagUrl]));
            if (key === renderedKey) return;
            renderedKey = key;
            downloadContainer.innerHTML = "";
            videos.forEach((req) => {
                const item = document.createElement("div");
                item.classList.add("video-item");

                const titleSpan = document.createElement("span");
                titleSpan.classList.add("video-title");
                titleSpan.textContent = req.videoTitle.length > 35
                    ? req.videoTitle.substring(0, 35) + "..."
                    : req.videoTitle;

                const btn = document.createElement("button");
                btn.classList.add("download-btn");
                btn.innerHTML = "⬇";
                btn.addEventListener("click", () => downloadVideo(req));

                item.appendChild(titleSpan);
                item.appendChild(btn);
                downloadContainer.appendChild(item);
            });
        }

        setInterval(() => {
            chrome.runtime.sendMessage({ type: "getRequests" }, (response) => {
                if (response && response.requests) {
                    const matchingRequests = Object.values(response.requests).filter(req =>
                        req.tabId === activeTabId && req.lastItagUrl && req.videoTitle
                    );
                    if (matchingRequests.length > 0) {
                        if (statusMessage.textContent === waitingText) showStatus("");
                        renderVideos(matchingRequests);
                    } else {
                        if (renderedKey !== null) {
                            downloadContainer.innerHTML = "";
                            renderedKey = null;
                        }
                        currentVideos = [];
                        downloadAllBtn.disabled = true;
                        downloadAllBtn.textContent = "⬇ All";
                        chrome.storage.local.get(['extensionEnabled'], (result) => {
                            if (result.extensionEnabled) {
                                showStatus(waitingText);
                            }
                        });
                    }
                }
            });
        }, 1000);
    });
});