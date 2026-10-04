// -- State --
// Stored in localStorage:
//   tvctl_tvs: [{ip, name}, ...]
//   tvctl_active: "ip"
//   tvctl_chromecasts: [{ip, name}, ...]
//   tvctl_ur: [{ip, name}, ...]   (ip = Unified Remote base URL, e.g. http://192.168.1.111:9510)
//   tvctl_active_ur: "baseUrl"
//   tvctl_ur_series: [{label, url}, ...]

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

// -- Unified Remote state --
// Server entries reuse the generic device helpers; their "ip" holds the base URL.
function getURs() {
  return getDevices("tvctl_ur");
}

function getActiveURBase() {
  return localStorage.getItem("tvctl_active_ur") || "";
}

function setActiveURBase(url) {
  localStorage.setItem("tvctl_active_ur", url);
}

function normalizeURBase(input) {
  let s = (input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    if (!u.port && u.protocol === "http:") u.port = "9510";
    return u.origin; // drops /web/ etc: the API lives at /client/...
  } catch {
    return "";
  }
}

function addUR(url, name) {
  const base = normalizeURBase(url);
  if (!base) return false;
  addDevice("tvctl_ur", base, name);
  if (!getActiveURBase()) setActiveURBase(base);
  return true;
}

function removeUR(url) {
  removeDevice("tvctl_ur", url);
  if (getActiveURBase() === url) {
    const urs = getURs();
    setActiveURBase(urs.length ? urs[0].ip : "");
  }
  renderSavedURs();
  updateMediaButtons();
}

function renameUR(url, newName) {
  renameDevice("tvctl_ur", url, newName);
}

// -- UR series (label + Prime Video URL) --
function getSeries() {
  try {
    return JSON.parse(localStorage.getItem("tvctl_ur_series")) || [];
  } catch {
    return [];
  }
}

function saveSeries(list) {
  localStorage.setItem("tvctl_ur_series", JSON.stringify(list));
}

function addSeries(label, url) {
  const list = getSeries();
  const existing = list.find((x) => x.url === url);
  if (existing) existing.label = label || existing.label;
  else list.push({ label: label || url, url });
  saveSeries(list);
}

function removeSeries(url) {
  saveSeries(getSeries().filter((x) => x.url !== url));
  renderSavedSeries();
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
    document.getElementById("ur-url-input").value = "";
    document.getElementById("ur-name-input").value = "";
    document.getElementById("series-label-input").value = "";
    document.getElementById("series-url-input").value = "";
    renderAll();
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

function renderSavedURs() {
  renderDeviceList("saved-ur", getURs(), {
    activeIP: getActiveURBase(),
    onSelect: (url) => {
      setActiveURBase(url);
      renderSavedURs();
      updateMediaButtons();
    },
    onRemove: removeUR,
    onRename: renameUR,
  });
}

function renderSavedSeries() {
  const container = document.getElementById("saved-series");
  container.innerHTML = "";
  getSeries().forEach((item) => {
    const row = document.createElement("div");
    row.className = "saved-tv";

    const info = document.createElement("div");
    info.className = "tv-info";
    const nameEl = document.createElement("div");
    nameEl.className = "tv-name";
    nameEl.textContent = item.label;
    const urlEl = document.createElement("div");
    urlEl.className = "tv-ip";
    urlEl.textContent = item.url;
    info.appendChild(nameEl);
    info.appendChild(urlEl);

    const delBtn = document.createElement("button");
    delBtn.className = "del-btn";
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", () => removeSeries(item.url));

    row.appendChild(info);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function renderAll() {
  renderSavedTVs();
  renderSavedChromecasts();
  renderSavedURs();
  renderSavedSeries();
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
let mediaMode = "cc"; // "tv", "cc" or "ur"
let ccPlaying = false;
let ccIconUrl = null;
let ccProgress = 0;
let ccTitle = null;
let ccApp = null;
let ccTracks = [];
let ccActiveTrackIds = [];

const mediaToggle = document.getElementById("media-toggle");
const mediaRew = document.getElementById("media-rew");
const mediaPlayPause = document.getElementById("media-playpause");
const mediaFF = document.getElementById("media-ff");
const mediaProgressBar = document.getElementById("media-progress-bar");
const mediaTitleEl = document.getElementById("media-title");
const mediaTracksBtn = document.getElementById("media-tracks-btn");
const tracksDropdown = document.getElementById("tracks-dropdown");
const tracksBackdrop = document.getElementById("tracks-backdrop");
const urPane = document.getElementById("ur-pane");

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
  // Extract tracks
  ccTracks = ms && ms.media && ms.media.tracks ? ms.media.tracks : [];
  ccActiveTrackIds = ms && ms.activeTrackIds ? ms.activeTrackIds : [];
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
  if (mediaMode === "ur") mediaToggle.textContent = "UR";
  urPane.hidden = mediaMode !== "ur";
  const ccDisabled =
    (mediaMode === "cc" && !getActiveChromecastIP()) ||
    (mediaMode === "ur" && !getActiveURBase());
  mediaRew.disabled = ccDisabled;
  mediaPlayPause.disabled = ccDisabled;
  mediaFF.disabled = ccDisabled;
  mediaTracksBtn.disabled = mediaMode !== "cc" || ccTracks.length === 0;
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
  mediaMode = mediaMode === "cc" ? "tv" : mediaMode === "tv" ? "ur" : "cc";
  updateMediaButtons();
});

// -- Tracks dropdown --
function closeTracksDropdown() {
  tracksDropdown.classList.remove("open");
  tracksBackdrop.classList.remove("open");
}

function openTracksDropdown() {
  tracksDropdown.innerHTML = "";

  const audioTracks = ccTracks.filter((t) => t.type === "AUDIO");
  const textTracks = ccTracks.filter((t) => t.type === "TEXT");

  if (audioTracks.length > 0) {
    const label = document.createElement("div");
    label.className = "tracks-group-label";
    label.textContent = "Audio";
    tracksDropdown.appendChild(label);

    const seg = document.createElement("div");
    seg.className = "tracks-segments";
    audioTracks.forEach((t) => {
      const btn = document.createElement("button");
      btn.textContent = (t.language || "?").toUpperCase();
      if (ccActiveTrackIds.includes(t.trackId) || audioTracks.length === 1) btn.classList.add("active");
      btn.addEventListener("click", () => selectTrack("AUDIO", t.trackId));
      seg.appendChild(btn);
    });
    tracksDropdown.appendChild(seg);
  }

  if (textTracks.length > 0) {
    const label = document.createElement("div");
    label.className = "tracks-group-label";
    label.textContent = "Subtitles";
    tracksDropdown.appendChild(label);

    const seg = document.createElement("div");
    seg.className = "tracks-segments";

    // "Off" button for subtitles
    const offBtn = document.createElement("button");
    offBtn.textContent = "OFF";
    const anyTextActive = textTracks.some((t) => ccActiveTrackIds.includes(t.trackId));
    if (!anyTextActive) offBtn.classList.add("active");
    offBtn.addEventListener("click", () => selectTrack("TEXT", null));
    seg.appendChild(offBtn);

    textTracks.forEach((t) => {
      const btn = document.createElement("button");
      btn.textContent = (t.language || "?").toUpperCase();
      if (ccActiveTrackIds.includes(t.trackId)) btn.classList.add("active");
      btn.addEventListener("click", () => selectTrack("TEXT", t.trackId));
      seg.appendChild(btn);
    });
    tracksDropdown.appendChild(seg);
  }

  tracksDropdown.classList.add("open");
  tracksBackdrop.classList.add("open");
}

async function selectTrack(type, trackId) {
  // Build new activeTrackIds: keep tracks of other types, set this type
  const otherIds = ccActiveTrackIds.filter((id) => {
    const track = ccTracks.find((t) => t.trackId === id);
    return track && track.type !== type;
  });
  const newIds = trackId !== null ? [...otherIds, trackId] : otherIds;

  const ip = getActiveChromecastIP();
  if (!ip) return;
  try {
    const res = await fetch("/api/chromecast/tracks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, activeTrackIds: newIds }),
    });
    const data = await res.json();
    console.log("CC tracks:", data);
    if (res.ok && data.ok) {
      ccActiveTrackIds = newIds;
      openTracksDropdown(); // re-render with new state
    }
  } catch (err) {
    console.error("Track selection error:", err);
  }
}

mediaTracksBtn.addEventListener("click", () => {
  if (tracksDropdown.classList.contains("open")) {
    closeTracksDropdown();
  } else {
    openTracksDropdown();
  }
});

tracksBackdrop.addEventListener("click", closeTracksDropdown);

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
    } else if (action === "rew" || action === "ff") {
      setTimeout(fetchChromecastStatus, 500);
    } else {
      // Toggle playing state immediately, then refresh full status
      ccPlaying = !ccPlaying;
      updateMediaButtons();
      setTimeout(fetchChromecastStatus, 1000);
    }
  } catch (err) {
    console.error("Chromecast error:", err);
  }
}

mediaRew.addEventListener("click", () => {
  if (mediaMode === "tv") {
    sendKey("TR_KEY_REW");
  } else if (mediaMode === "ur") {
    urCall(UR_PRIME_SEARCH, "rewind15");
  } else {
    sendChromecastCommand("rew");
  }
});

mediaPlayPause.addEventListener("click", () => {
  mediaPlayPause.blur();
  if (mediaMode === "tv") {
    sendKey("TR_KEY_PLAYPAUSE");
  } else if (mediaMode === "ur") {
    urCall(UR_PRIME_SEARCH, "toggle_play");
  } else {
    const action = ccPlaying ? "pause" : "play";
    sendChromecastCommand(action);
    ccPlaying = !ccPlaying;
  }
});

mediaFF.addEventListener("click", () => {
  if (mediaMode === "tv") {
    sendKey("TR_KEY_FF");
  } else if (mediaMode === "ur") {
    urCall(UR_PRIME_SEARCH, "forward15");
  } else {
    sendChromecastCommand("ff");
  }
});

// -- Unified Remote commands --
// Arno.PrimeSearch is the custom remote in prime-search/ (copy it to the UR
// server); Unified.AmazonPrimeVideo ships with Unified Remote.
const UR_PRIME_SEARCH = "Arno.PrimeSearch";
const UR_PRIME_VIDEO = "Unified.AmazonPrimeVideo";

async function urCall(id, name, values) {
  const baseUrl = getActiveURBase();
  if (!baseUrl) {
    alert("No Unified Remote server configured. Go to Settings to add one.");
    return;
  }
  try {
    const res = await fetch("/api/ur/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, id, name, values }),
    });
    const data = await res.json();
    if (!res.ok) console.error("UR command failed:", data.error);
  } catch (err) {
    console.error("UR error:", err);
  }
}

document
  .getElementById("ur-home")
  .addEventListener("click", () => urCall(UR_PRIME_SEARCH, "home"));
document
  .getElementById("ur-resume")
  .addEventListener("click", () => urCall(UR_PRIME_SEARCH, "resume"));
document
  .getElementById("ur-fullscreen")
  .addEventListener("click", () => urCall(UR_PRIME_VIDEO, "fullscreen"));

const urSearchInput = document.getElementById("ur-search-input");
function urSearch() {
  const text = urSearchInput.value.trim();
  if (text) urCall(UR_PRIME_SEARCH, "search", [text]);
}
document.getElementById("ur-search-btn").addEventListener("click", urSearch);
urSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") urSearch();
});

// -- Picker (Series / Seasons / Episodes) --
// Items are {label, url}; tapping one opens the url in the Prime tab.
const seriesDropdown = document.getElementById("series-dropdown");
const seriesBackdrop = document.getElementById("series-backdrop");

function closeSeriesDropdown() {
  seriesDropdown.classList.remove("open");
  seriesBackdrop.classList.remove("open");
}

function showPicker(items, message) {
  seriesDropdown.innerHTML = "";
  if (message || items.length === 0) {
    const note = document.createElement("div");
    note.className = "series-empty";
    note.textContent = message || "Nothing to show.";
    seriesDropdown.appendChild(note);
  }
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "series-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      urCall(UR_PRIME_SEARCH, "home", [item.url]);
      closeSeriesDropdown();
    });
    seriesDropdown.appendChild(btn);
  });
  seriesDropdown.classList.add("open");
  seriesBackdrop.classList.add("open");
}

document.getElementById("ur-series").addEventListener("click", () => {
  const list = getSeries().map((x) => ({ label: x.label, url: x.url }));
  showPicker(list, list.length ? "" : "No series saved. Add some in Settings.");
});

// Seasons / episodes are read from the open Prime tab by the UR remote and
// come back through the server (see /api/ur/list).
async function showUrList(kind) {
  const baseUrl = getActiveURBase();
  if (!baseUrl) {
    alert("No Unified Remote server configured. Go to Settings to add one.");
    return;
  }
  showPicker([], "Loading " + kind + "...");
  try {
    const res = await fetch("/api/ur/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      showPicker([], data.error || "Failed to load " + kind);
      return;
    }
    const items =
      kind === "seasons"
        ? (data.seasons || []).map((x) => ({ label: x.name, url: x.url }))
        : (data.episodes || []).map((x) => ({ label: x.title, url: x.url }));
    const hint = items.length
      ? ""
      : kind === "seasons"
        ? "No seasons found. Open a series page first."
        : "No episodes found. Open a season page first.";
    showPicker(items.filter((x) => x.url), hint);
  } catch (err) {
    showPicker([], "Error: " + err.message);
  }
}

document
  .getElementById("ur-seasons")
  .addEventListener("click", () => showUrList("seasons"));
document
  .getElementById("ur-episodes")
  .addEventListener("click", () => showUrList("episodes"));
seriesBackdrop.addEventListener("click", closeSeriesDropdown);

updateMediaButtons();

// -- Settings: Add Unified Remote server manually --
document.getElementById("save-ur-btn").addEventListener("click", () => {
  const url = document.getElementById("ur-url-input").value.trim();
  const name = document.getElementById("ur-name-input").value.trim();
  if (addUR(url, name)) {
    renderSavedURs();
    updateMediaButtons();
    document.getElementById("ur-url-input").value = "";
    document.getElementById("ur-name-input").value = "";
  } else {
    alert("Enter a valid URL, e.g. http://192.168.1.111:9510");
  }
});

// -- Settings: Add series --
document.getElementById("save-series-btn").addEventListener("click", () => {
  const label = document.getElementById("series-label-input").value.trim();
  const url = document.getElementById("series-url-input").value.trim();
  if (!url) return;
  addSeries(label, url);
  renderSavedSeries();
  document.getElementById("series-label-input").value = "";
  document.getElementById("series-url-input").value = "";
});

// -- Settings: Discover Unified Remote servers --
document
  .getElementById("discover-ur-btn")
  .addEventListener("click", async () => {
    const statusEl = document.getElementById("discover-ur-status");
    const resultsEl = document.getElementById("discover-ur-results");
    statusEl.textContent = "Searching...";
    resultsEl.innerHTML = "";

    try {
      const res = await fetch("/api/ur/discover", { method: "POST" });
      const servers = await res.json();

      if (servers.length === 0) {
        statusEl.textContent = "No Unified Remote servers found.";
        return;
      }

      statusEl.textContent = `Found ${servers.length} server(s):`;
      servers.forEach((srv) => {
        const btn = document.createElement("button");
        btn.textContent = `${srv.name} - ${srv.baseUrl}`;
        btn.style.marginTop = "8px";
        btn.style.width = "100%";
        btn.addEventListener("click", () => {
          addUR(srv.baseUrl, srv.name);
          renderSavedURs();
          updateMediaButtons();
          resultsEl.innerHTML = "";
          statusEl.textContent = "";
        });
        resultsEl.appendChild(btn);
      });
    } catch (err) {
      statusEl.textContent = "Discovery failed: " + err.message;
    }
  });

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
// Show HTTPS origin for PWA install instructions
const httpsOrigin = "https://" + location.hostname + ":8766";
document.getElementById("pwa-origin").textContent = httpsOrigin;

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

// -- PWA Service Worker --
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    // Check for updates on load
    reg.update();

    let newWorker;

    reg.addEventListener("updatefound", () => {
      newWorker = reg.installing;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New version available — show update banner
          const banner = document.getElementById("update-banner");
          banner.classList.add("show");

          document.getElementById("update-btn-ok").addEventListener("click", () => {
            newWorker.postMessage({ type: "SKIP_WAITING" });
            banner.classList.remove("show");
          });

          document.getElementById("update-btn-later").addEventListener("click", () => {
            banner.classList.remove("show");
          });
        }
      });
    });

    // Reload when new SW takes over
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        location.reload();
      }
    });
  });
}
