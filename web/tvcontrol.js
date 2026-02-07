// -- State --
// Stored in localStorage:
//   tvctl_tvs: [{ip, name}, ...]
//   tvctl_active: "ip"
//   tvctl_chromecasts: [{ip, name}, ...]

const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>';

// -- Generic device storage helpers --
function getDevices(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    return [];
  }
}

function saveDevices(storageKey, devices) {
  localStorage.setItem(storageKey, JSON.stringify(devices));
}

function addDevice(storageKey, ip, name) {
  const devices = getDevices(storageKey);
  const existing = devices.find((d) => d.ip === ip);
  if (existing) {
    if (name) existing.name = name;
  } else {
    devices.push({ ip, name: name || ip });
  }
  saveDevices(storageKey, devices);
}

function removeDevice(storageKey, ip) {
  const devices = getDevices(storageKey).filter((d) => d.ip !== ip);
  saveDevices(storageKey, devices);
}

function renameDevice(storageKey, ip, newName) {
  const devices = getDevices(storageKey);
  const d = devices.find((d) => d.ip === ip);
  if (d) {
    d.name = newName || ip;
    saveDevices(storageKey, devices);
  }
}

// -- TV-specific state --
function getTVs() {
  return getDevices("tvctl_tvs");
}

function getActiveIP() {
  return localStorage.getItem("tvctl_active") || "";
}

function setActiveIP(ip) {
  localStorage.setItem("tvctl_active", ip);
  updateStatus();
}

function getActiveTV() {
  const ip = getActiveIP();
  return getTVs().find((t) => t.ip === ip) || null;
}

function addTV(ip, name) {
  addDevice("tvctl_tvs", ip, name);
  setActiveIP(ip);
}

function removeTV(ip) {
  removeDevice("tvctl_tvs", ip);
  if (getActiveIP() === ip) {
    const tvs = getTVs();
    setActiveIP(tvs.length ? tvs[0].ip : "");
  }
  renderSavedTVs();
}

function renameTV(ip, newName) {
  renameDevice("tvctl_tvs", ip, newName);
  updateStatus();
}

// -- Chromecast state --
function getChromecasts() {
  return getDevices("tvctl_chromecasts");
}

function getActiveChromecastIP() {
  return localStorage.getItem("tvctl_active_cc") || "";
}

function setActiveChromecastIP(ip) {
  localStorage.setItem("tvctl_active_cc", ip);
}

function getActiveChromecast() {
  const ip = getActiveChromecastIP();
  return getChromecasts().find((c) => c.ip === ip) || null;
}

function addChromecast(ip, name) {
  addDevice("tvctl_chromecasts", ip, name);
  if (!getActiveChromecastIP()) setActiveChromecastIP(ip);
}

function removeChromecast(ip) {
  removeDevice("tvctl_chromecasts", ip);
  if (getActiveChromecastIP() === ip) {
    const ccs = getChromecasts();
    setActiveChromecastIP(ccs.length ? ccs[0].ip : "");
  }
  renderSavedChromecasts();
}

function renameChromecast(ip, newName) {
  renameDevice("tvctl_chromecasts", ip, newName);
}

// -- Navigation --
const pageControl = document.getElementById("page-control");
const pageSettings = document.getElementById("page-settings");

document.getElementById("settings-link").addEventListener("click", (e) => {
  e.preventDefault();
  showPage("settings");
});

document.getElementById("back-link").addEventListener("click", (e) => {
  e.preventDefault();
  showPage("control");
});

function showPage(name) {
  pageControl.classList.toggle("active", name === "control");
  pageSettings.classList.toggle("active", name === "settings");
  if (name === "settings") {
    document.getElementById("ip-input").value = "";
    document.getElementById("name-input").value = "";
    document.getElementById("cc-ip-input").value = "";
    document.getElementById("cc-name-input").value = "";
    renderSavedTVs();
    renderSavedChromecasts();
  }
}

// -- Status indicator & title --
const tvIpDisplay = document.getElementById("tv-ip-display");

function updateStatus() {
  const tv = getActiveTV();
  if (tv) {
    tvIpDisplay.textContent = tv.name;
    document.title = tv.name + " - TV Remote";
  } else {
    tvIpDisplay.textContent = "TV Remote";
    document.title = "TV Remote";
  }
}

// -- Generic device list renderer --
function renderDeviceList(
  containerId,
  devices,
  { activeIP, onSelect, onRemove, onRename }
) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  devices.forEach((device) => {
    const row = document.createElement("div");
    row.className =
      "saved-tv" + (activeIP && device.ip === activeIP ? " active" : "");

    const info = document.createElement("div");
    info.className = "tv-info";

    const nameEl = document.createElement("div");
    nameEl.className = "tv-name";
    nameEl.textContent = device.name;
    nameEl.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "saved-tv-name-edit";
      input.value = device.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const finish = () => {
        const val = input.value.trim();
        if (val) onRename(device.ip, val);
        renderAll();
      };
      input.addEventListener("blur", finish);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          input.value = device.name;
          input.blur();
        }
      });
    });

    const ipEl = document.createElement("div");
    ipEl.className = "tv-ip";
    ipEl.textContent = device.ip;

    info.appendChild(nameEl);
    info.appendChild(ipEl);

    if (onSelect) {
      const selectBtn = document.createElement("button");
      selectBtn.textContent =
        activeIP && device.ip === activeIP ? "Active" : "Select";
      selectBtn.disabled = activeIP && device.ip === activeIP;
      selectBtn.addEventListener("click", () => {
        onSelect(device.ip);
        renderAll();
      });
      row.appendChild(info);
      row.appendChild(selectBtn);
    } else {
      row.appendChild(info);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "del-btn";
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", () => onRemove(device.ip));

    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function renderSavedTVs() {
  renderDeviceList("saved-tvs", getTVs(), {
    activeIP: getActiveIP(),
    onSelect: (ip) => setActiveIP(ip),
    onRemove: removeTV,
    onRename: renameTV,
  });
}

function renderSavedChromecasts() {
  renderDeviceList("saved-chromecasts", getChromecasts(), {
    activeIP: getActiveChromecastIP(),
    onSelect: (ip) => {
      setActiveChromecastIP(ip);
      renderSavedChromecasts();
      fetchChromecastStatus();
    },
    onRemove: removeChromecast,
    onRename: renameChromecast,
  });
}

function renderAll() {
  renderSavedTVs();
  renderSavedChromecasts();
}

// -- Send key command --
async function sendKey(key) {
  const ip = getActiveIP();
  if (!ip) {
    alert("No TV configured. Go to Settings to add one.");
    return;
  }
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, key }),
    });
    if (!res.ok) {
      const data = await res.json();
      console.error("Send failed:", data.error);
    }
  } catch (err) {
    console.error("Send error:", err);
  }
}

// -- Bind all remote buttons --
document.querySelectorAll("[data-key]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    if (key) sendKey(key);
  });
});

// -- Media controls: TV/CC toggle --
let mediaMode = "cc"; // "tv" or "cc"
let ccPlaying = false;
let ccIconUrl = null;
let ccProgress = 0;
let ccTitle = null;
let ccApp = null;

const mediaToggle = document.getElementById("media-toggle");
const mediaRew = document.getElementById("media-rew");
const mediaPlayPause = document.getElementById("media-playpause");
const mediaFF = document.getElementById("media-ff");
const mediaProgressBar = document.getElementById("media-progress-bar");
const mediaTitleEl = document.getElementById("media-title");

function updateCCState(data) {
  const ms = data && data.mediaStatus;
  ccApp = data && data.app;
  // Playing state
  ccPlaying = ms && ms.playerState === "PLAYING";
  // Extract icon from mediaStatus.media.metadata.images
  const images = ms && ms.media && ms.media.metadata && ms.media.metadata.images;
  ccIconUrl = images && images.length ? images[0].url : null;
  // Extract title
  const title = ms && ms.media && ms.media.metadata && ms.media.metadata.title;
  ccTitle = title && title !== ccApp ? title : null;
  // Extract progress
  if (ms && ms.currentTime > 0 && ms.media && ms.media.duration > 0) {
    ccProgress = ms.currentTime / ms.media.duration;
  } else {
    ccProgress = 0;
  }
}

async function fetchChromecastStatus() {
  const ip = getActiveChromecastIP();
  if (!ip) {
    ccIconUrl = null;
    ccProgress = 0;
    updateMediaButtons();
    return;
  }
  try {
    const res = await fetch("/api/chromecast/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    const status = await res.json();
    console.log("CC status:", status);
    updateCCState(status);
  } catch (err) {
    console.error("Chromecast status error:", err);
  }
  updateMediaButtons();
}

function updateMediaButtons() {
  // Toggle button: show icon or text
  if (mediaMode === "cc" && ccIconUrl) {
    mediaToggle.innerHTML = "";
    const img = document.createElement("img");
    img.src = ccIconUrl;
    img.alt = "CC";
    mediaToggle.appendChild(img);
  } else {
    mediaToggle.innerHTML = "";
    mediaToggle.textContent = mediaMode === "cc" ? "CC" : "TV";
  }
  const ccDisabled = mediaMode === "cc" && !getActiveChromecastIP();
  mediaRew.disabled = ccDisabled;
  mediaPlayPause.disabled = ccDisabled;
  mediaFF.disabled = ccDisabled;
  // Media title
  mediaTitleEl.textContent = mediaMode === "cc" && ccTitle ? ccTitle : "";
  // Progress bar
  if (mediaMode === "cc" && ccProgress > 0) {
    mediaProgressBar.style.width = (ccProgress * 100).toFixed(1) + "%";
  } else {
    mediaProgressBar.style.width = "0%";
  }
}

mediaToggle.addEventListener("click", () => {
  mediaMode = mediaMode === "cc" ? "tv" : "cc";
  updateMediaButtons();
});

async function sendChromecastCommand(action) {
  const ip = getActiveChromecastIP();
  if (!ip) return;
  try {
    const res = await fetch("/api/chromecast/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, action }),
    });
    const data = await res.json();
    console.log("CC control:", data);
    if (!res.ok) {
      console.error("Chromecast command failed:", data.error);
    } else if (data.reason) {
      await fetchChromecastStatus();
    } else {
      updateCCState(data);
      updateMediaButtons();
    }
  } catch (err) {
    console.error("Chromecast error:", err);
  }
}

mediaRew.addEventListener("click", () => {
  if (mediaMode === "tv") {
    sendKey("TR_KEY_REW");
  }
  // CC rewind not supported yet
});

mediaPlayPause.addEventListener("click", () => {
  if (mediaMode === "tv") {
    sendKey("TR_KEY_PLAYPAUSE");
  } else {
    const action = ccPlaying ? "pause" : "play";
    sendChromecastCommand(action);
    ccPlaying = !ccPlaying;
  }
});

mediaFF.addEventListener("click", () => {
  if (mediaMode === "tv") {
    sendKey("TR_KEY_FF");
  }
  // CC forward not supported yet
});

updateMediaButtons();

// -- Settings: Add TV manually --
document.getElementById("save-ip-btn").addEventListener("click", () => {
  const ip = document.getElementById("ip-input").value.trim();
  const name = document.getElementById("name-input").value.trim();
  if (ip) {
    addTV(ip, name);
    showPage("control");
  }
});

// -- Settings: Add Chromecast manually --
document.getElementById("save-cc-btn").addEventListener("click", () => {
  const ip = document.getElementById("cc-ip-input").value.trim();
  const name = document.getElementById("cc-name-input").value.trim();
  if (ip) {
    addChromecast(ip, name);
    renderSavedChromecasts();
    document.getElementById("cc-ip-input").value = "";
    document.getElementById("cc-name-input").value = "";
  }
});

// -- Settings: Discover TVs --
document
  .getElementById("discover-tv-btn")
  .addEventListener("click", async () => {
    const statusEl = document.getElementById("discover-tv-status");
    const resultsEl = document.getElementById("discover-tv-results");
    statusEl.textContent = "Searching...";
    resultsEl.innerHTML = "";

    try {
      const res = await fetch("/api/discover", { method: "POST" });
      const tvs = await res.json();

      if (tvs.length === 0) {
        statusEl.textContent = "No TCL TVs found.";
        return;
      }

      statusEl.textContent = `Found ${tvs.length} TV(s):`;
      tvs.forEach((tv) => {
        const btn = document.createElement("button");
        btn.textContent = `${tv.friendlyName || "TCL TV"} (${tv.ip})`;
        btn.style.marginTop = "8px";
        btn.style.width = "100%";
        btn.addEventListener("click", () => {
          addTV(tv.ip, tv.friendlyName || "TCL TV");
          renderSavedTVs();
          resultsEl.innerHTML = "";
          statusEl.textContent = "";
        });
        resultsEl.appendChild(btn);
      });
    } catch (err) {
      statusEl.textContent = "Discovery failed: " + err.message;
    }
  });

// -- Settings: Discover Chromecasts --
document
  .getElementById("discover-cc-btn")
  .addEventListener("click", async () => {
    const statusEl = document.getElementById("discover-cc-status");
    const resultsEl = document.getElementById("discover-cc-results");
    statusEl.textContent = "Searching...";
    resultsEl.innerHTML = "";

    try {
      const res = await fetch("/api/discover-chromecast", { method: "POST" });
      const ccs = await res.json();

      if (ccs.length === 0) {
        statusEl.textContent = "No Chromecasts found.";
        return;
      }

      statusEl.textContent = `Found ${ccs.length} Chromecast(s):`;
      ccs.forEach((cc) => {
        const btn = document.createElement("button");
        btn.textContent = `${cc.name}${cc.model ? " (" + cc.model + ")" : ""} - ${cc.ip}`;
        btn.style.marginTop = "8px";
        btn.style.width = "100%";
        btn.addEventListener("click", () => {
          addChromecast(cc.ip, cc.name);
          renderSavedChromecasts();
          resultsEl.innerHTML = "";
          statusEl.textContent = "";
        });
        resultsEl.appendChild(btn);
      });
    } catch (err) {
      statusEl.textContent = "Discovery failed: " + err.message;
    }
  });

// -- Migrate old single-IP format --
const oldIP = localStorage.getItem("tvctl_ip");
if (oldIP && getTVs().length === 0) {
  addTV(oldIP, oldIP);
  localStorage.removeItem("tvctl_ip");
}

// -- Init --
updateStatus();
fetchChromecastStatus();

// -- Periodic Chromecast status polling --
let ccPollTimer = null;

function startCCPoll() {
  stopCCPoll();
  ccPollTimer = setInterval(() => {
    if (getActiveChromecastIP()) fetchChromecastStatus();
  }, 15000);
}

function stopCCPoll() {
  if (ccPollTimer) {
    clearInterval(ccPollTimer);
    ccPollTimer = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopCCPoll();
  } else {
    fetchChromecastStatus();
    startCCPoll();
  }
});

startCCPoll();
