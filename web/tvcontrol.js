// -- State --
// Stored in localStorage:
//   tvctl_tvs: [{ip, name}, ...]
//   tvctl_active: "ip"

function getTVs() {
  try { return JSON.parse(localStorage.getItem("tvctl_tvs")) || []; }
  catch { return []; }
}

function saveTVs(tvs) {
  localStorage.setItem("tvctl_tvs", JSON.stringify(tvs));
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
  const tvs = getTVs();
  const existing = tvs.find((t) => t.ip === ip);
  if (existing) {
    if (name) existing.name = name;
  } else {
    tvs.push({ ip, name: name || ip });
  }
  saveTVs(tvs);
  setActiveIP(ip);
}

function removeTV(ip) {
  const tvs = getTVs().filter((t) => t.ip !== ip);
  saveTVs(tvs);
  if (getActiveIP() === ip) {
    setActiveIP(tvs.length ? tvs[0].ip : "");
  }
  renderSavedTVs();
}

function renameTV(ip, newName) {
  const tvs = getTVs();
  const tv = tvs.find((t) => t.ip === ip);
  if (tv) {
    tv.name = newName || ip;
    saveTVs(tvs);
    updateStatus();
  }
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
    renderSavedTVs();
  }
}

// -- Status indicator & title --
const statusDot = document.getElementById("status-dot");
const tvIpDisplay = document.getElementById("tv-ip-display");

function updateStatus() {
  const tv = getActiveTV();
  if (tv) {
    statusDot.classList.add("connected");
    tvIpDisplay.textContent = tv.name + " (" + tv.ip + ")";
    document.title = tv.name + " - TV Remote";
  } else {
    statusDot.classList.remove("connected");
    tvIpDisplay.textContent = "No TV configured";
    document.title = "TV Remote";
  }
}

// -- Saved TVs list --
function renderSavedTVs() {
  const container = document.getElementById("saved-tvs");
  const tvs = getTVs();
  const activeIP = getActiveIP();
  container.innerHTML = "";

  tvs.forEach((tv) => {
    const row = document.createElement("div");
    row.className = "saved-tv" + (tv.ip === activeIP ? " active" : "");

    const info = document.createElement("div");
    info.className = "tv-info";

    const nameEl = document.createElement("div");
    nameEl.className = "tv-name";
    nameEl.textContent = tv.name;
    nameEl.addEventListener("click", () => {
      // Inline rename
      const input = document.createElement("input");
      input.type = "text";
      input.className = "saved-tv-name-edit";
      input.value = tv.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const finish = () => {
        const val = input.value.trim();
        if (val) renameTV(tv.ip, val);
        renderSavedTVs();
      };
      input.addEventListener("blur", finish);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") { input.value = tv.name; input.blur(); }
      });
    });

    const ipEl = document.createElement("div");
    ipEl.className = "tv-ip";
    ipEl.textContent = tv.ip;

    info.appendChild(nameEl);
    info.appendChild(ipEl);

    const selectBtn = document.createElement("button");
    selectBtn.textContent = tv.ip === activeIP ? "Active" : "Select";
    selectBtn.disabled = tv.ip === activeIP;
    selectBtn.addEventListener("click", () => {
      setActiveIP(tv.ip);
      renderSavedTVs();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "del-btn";
    delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>';
    delBtn.addEventListener("click", () => removeTV(tv.ip));

    row.appendChild(info);
    row.appendChild(selectBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
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

// -- Settings: Add TV manually --
document.getElementById("save-ip-btn").addEventListener("click", () => {
  const ip = document.getElementById("ip-input").value.trim();
  const name = document.getElementById("name-input").value.trim();
  if (ip) {
    addTV(ip, name);
    showPage("control");
  }
});

// -- Settings: Discover --
document.getElementById("discover-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("discover-status");
  const resultsEl = document.getElementById("discover-results");
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

// -- Migrate old single-IP format --
const oldIP = localStorage.getItem("tvctl_ip");
if (oldIP && getTVs().length === 0) {
  addTV(oldIP, oldIP);
  localStorage.removeItem("tvctl_ip");
}

// -- Init --
updateStatus();
