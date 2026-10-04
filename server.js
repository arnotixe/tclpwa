const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const net = require("net");
const dgram = require("dgram");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const xml2js = require("xml2js");
const { Client, DefaultMediaReceiver } = require("castv2-client");

const PORT = process.env.PORT || 8765;
const HTTPS_PORT = process.env.HTTPS_PORT || 8766;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendKeyToTV(ip, keyCode) {
  return new Promise((resolve, reject) => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?><root><action name="setKey" eventAction="TR_DOWN" keyCode="' +
      keyCode +
      '" /></root>';

    const socket = net.createConnection(4123, ip, () => {
      socket.write(xml, "utf8", () => {
        // Give the TV a moment to respond, then close
        setTimeout(() => {
          socket.destroy();
          resolve({ ok: true });
        }, 200);
      });
    });

    socket.on("error", (err) => {
      reject(err);
    });

    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("Connection timed out"));
    });
  });
}

function discoverTV() {
  return new Promise((resolve) => {
    const found = [];
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const message = Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        'MAN: "ssdp:discover"',
        "MX: 2",
        "ST: upnp:rootdevice",
        "\r\n",
      ].join("\r\n"),
      "ascii"
    );

    const locationRegexp = /^Location: ?(.*)$/im;

    socket.on("message", (msg) => {
      const text = msg.toString();
      const match = text.match(locationRegexp);
      if (!match) return;

      const location = match[1].trim();

      // Fetch the device descriptor to check manufacturer
      fetch(location)
        .then((res) => res.text())
        .then((xml) => {
          xml2js.parseString(xml, (err, result) => {
            if (err) return;
            try {
              const manufacturer =
                result?.root?.device?.[0]?.manufacturer?.[0] || null;
              const friendlyName =
                result?.root?.device?.[0]?.friendlyName?.[0] || null;
              const url = new URL(location);
              const ip = url.hostname;
              if (manufacturer === "TCL") {
                found.push({ ip, manufacturer, friendlyName });
              }
            } catch (e) {
              // ignore
            }
          });
        })
        .catch(() => {});
    });

    socket.bind(() => {
      socket.addMembership("239.255.255.250");
      socket.setMulticastTTL(4);
      socket.send(message, 1900, "239.255.255.250");
    });

    // Wait 3 seconds for responses
    setTimeout(() => {
      socket.close();
      resolve(found);
    }, 3000);
  });
}

function discoverChromecasts() {
  return new Promise((resolve) => {
    const found = [];
    const pending = [];
    const seen = new Set();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const message = Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        'MAN: "ssdp:discover"',
        "MX: 2",
        "ST: urn:dial-multiscreen-org:service:dial:1",
        "\r\n",
      ].join("\r\n"),
      "ascii"
    );

    const locationRegexp = /^Location: ?(.*)$/im;

    socket.on("message", (msg) => {
      const text = msg.toString();
      const match = text.match(locationRegexp);
      if (!match) return;

      const location = match[1].trim();
      let ip;
      try {
        ip = new URL(location).hostname;
      } catch {
        return;
      }
      if (seen.has(ip)) return;
      seen.add(ip);

      // Try to get Chromecast info from its local API
      const p = fetch(
        `http://${ip}:8008/setup/eureka_info?params=name,model_name`,
        { signal: AbortSignal.timeout(2500) }
      )
        .then((res) => res.json())
        .then((info) => {
          found.push({
            ip,
            name: info.name || "Chromecast",
            model: info.model_name || "",
          });
        })
        .catch(() => {
          // DIAL device but not a Chromecast (no eureka_info)
        });
      pending.push(p);
    });

    socket.bind(() => {
      socket.addMembership("239.255.255.250");
      socket.setMulticastTTL(4);
      socket.send(message, 1900, "239.255.255.250");
    });

    // Wait for SSDP responses, then wait for all eureka_info fetches to settle
    setTimeout(async () => {
      socket.close();
      await Promise.allSettled(pending);
      resolve(found);
    }, 3000);
  });
}

function chromecastControl(ip, action) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error("Chromecast connection timed out"));
    }, 5000);

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });

    client.connect(ip, () => {
      client.getStatus((err, status) => {
        if (err) {
          clearTimeout(timeout);
          client.close();
          return reject(err);
        }

        console.log("CC receiver status:", JSON.stringify(status, null, 2));

        const session = status.applications && status.applications[0];
        if (!session) {
          clearTimeout(timeout);
          client.close();
          return resolve({ ok: false, reason: "no_active_app", receiverStatus: status });
        }

        client.join(session, DefaultMediaReceiver, (err, player) => {
          if (err) {
            clearTimeout(timeout);
            client.close();
            return reject(err);
          }

          // Must fetch media status first to populate currentSession
          player.getStatus((err, mediaStatus) => {
            console.log("CC media status:", JSON.stringify(mediaStatus, null, 2));

            if (err) {
              clearTimeout(timeout);
              client.close();
              return reject(err);
            }
            if (!player.media.currentSession) {
              clearTimeout(timeout);
              client.close();
              return resolve({ ok: false, reason: "no_media_session", app: session.displayName, mediaStatus });
            }

            console.log("CC currentSession:", JSON.stringify(player.media.currentSession, null, 2));
            console.log("CC sending action:", action);

            const done = (err, status) => {
              console.log("CC action result:", err ? "ERROR: " + err.message : "OK", status ? JSON.stringify(status, null, 2) : "");
              clearTimeout(timeout);
              client.close();
              if (err) reject(err);
              else resolve({ ok: true, app: session.displayName, mediaStatus, actionResult: status });
            };

            switch (action) {
              case "play":
                player.play(done);
                break;
              case "pause":
                player.pause(done);
                break;
              case "stop":
                player.stop(done);
                break;
              case "rew":
              case "ff": {
                const delta = action === "ff" ? 10 : -10;
                const cur = (mediaStatus && mediaStatus.currentTime) || 0;
                const dur = player.media.currentSession && mediaStatus && mediaStatus.media && mediaStatus.media.duration;
                let target = Math.max(0, cur + delta);
                if (dur > 0) target = Math.min(target, dur);
                player.seek(target, done);
                break;
              }
              default:
                done(new Error("Unknown action: " + action));
            }
          });
        });
      });
    });
  });
}

function chromecastEditTracks(ip, activeTrackIds) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error("Chromecast connection timed out"));
    }, 5000);

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });

    client.connect(ip, () => {
      client.getStatus((err, status) => {
        if (err) {
          clearTimeout(timeout);
          client.close();
          return reject(err);
        }

        const session = status.applications && status.applications[0];
        if (!session) {
          clearTimeout(timeout);
          client.close();
          return resolve({ ok: false, reason: "no_active_app" });
        }

        client.join(session, DefaultMediaReceiver, (err, player) => {
          if (err) {
            clearTimeout(timeout);
            client.close();
            return reject(err);
          }

          player.getStatus((err) => {
            if (err || !player.media.currentSession) {
              clearTimeout(timeout);
              client.close();
              return resolve({ ok: false, reason: "no_media_session" });
            }

            player.media.sessionRequest(
              { type: "EDIT_TRACKS_INFO", activeTrackIds },
              (err, response) => {
                clearTimeout(timeout);
                client.close();
                if (err) reject(err);
                else resolve({ ok: true, response });
              }
            );
          });
        });
      });
    });
  });
}

function chromecastStatus(ip) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error("Chromecast connection timed out"));
    }, 5000);

    client.on("error", (err) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });

    client.connect(ip, () => {
      client.getStatus((err, status) => {
        if (err) {
          clearTimeout(timeout);
          client.close();
          return reject(err);
        }

        console.log("CC status receiver:", JSON.stringify(status, null, 2));

        const session = status.applications && status.applications[0];
        if (!session) {
          clearTimeout(timeout);
          client.close();
          return resolve({ app: null, media: null, receiverStatus: status });
        }

        client.join(session, DefaultMediaReceiver, (err, player) => {
          if (err) {
            clearTimeout(timeout);
            client.close();
            return resolve({ app: session.displayName, media: null });
          }

          player.getStatus((err, mediaStatus) => {
            clearTimeout(timeout);
            client.close();

            console.log("CC status media:", JSON.stringify(mediaStatus, null, 2));

            if (err || !mediaStatus) {
              return resolve({ app: session.displayName, media: null });
            }
            resolve({
              app: session.displayName,
              media: {
                playerState: mediaStatus.playerState,
                title: mediaStatus.media && mediaStatus.media.metadata && mediaStatus.media.metadata.title,
              },
              mediaStatus,
            });
          });
        });
      });
    });
  });
}

// -- Unified Remote (UR) --------------------------------------------------
// The UR server's Web API needs, per connection: connect -> handshake (Action 0)
// -> capabilities (Action 1) -> run (Action 7). We do all four on every call
// (it is fast) so the browser never has to hold a connection id.
const UR_PORT = 9510;

function normalizeUrBase(input) {
  let s = String(input || "").trim();
  if (!s) throw new Error("UR base URL is required");
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  const u = new URL(s);
  if (!u.port && u.protocol === "http:") u.port = String(UR_PORT);
  return u.origin; // drops any /web/ path: the API lives at /client/...
}

async function urRun(baseUrl, remoteId, name, values) {
  const base = normalizeUrBase(baseUrl);
  const post = async (urlPath, body, cid) => {
    const res = await fetch(base + urlPath, {
      method: "POST",
      headers: { "Content-Type": "application/json", "UR-Connection-ID": cid },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.json().catch(() => ({}));
  };

  const conn = await fetch(base + "/client/connect", {
    signal: AbortSignal.timeout(4000),
  }).then((r) => r.json());
  const cid = conn.id;
  if (!cid) throw new Error("UR connect returned no id");
  const source = "web-" + crypto.randomUUID();

  await post(
    "/client/request",
    {
      Action: 0,
      Request: 0,
      Version: 10,
      Password: crypto.randomUUID(),
      Platform: "web",
      Source: source,
    },
    cid
  );
  await post(
    "/client/request",
    {
      Capabilities: {
        Actions: true,
        Sync: true,
        Grid: true,
        Fast: false,
        Loading: true,
        Encryption2: true,
      },
      Action: 1,
      Request: 1,
      Source: source,
    },
    cid
  );
  const run = { Name: name };
  if (Array.isArray(values) && values.length) {
    run.Extras = { Values: values.map((v) => ({ Value: String(v) })) };
  }
  // A run gets {"Error":"No response from connection"} even when it worked,
  // so that reply is expected and not treated as a failure.
  const reply = await post(
    "/client/request",
    { ID: remoteId, Action: 7, Request: 7, Run: run, Source: source },
    cid
  );
  return { ok: true, reply };
}

// A run returns no data, so lists (seasons/episodes) come back by callback:
// we pass the remote a one-time URL, it POSTs the page state there, and we
// hand that to the waiting browser request.
const urPending = new Map(); // token -> { resolve, reject, timer }

// Address of this server as the UR machine can reach it: the local interface
// on the same /24 as the UR server (so it works when the UI is opened as
// "localhost" or through a proxy), else the host the browser used.
function callbackHostFor(baseUrl, reqHost) {
  const urHost = new URL(normalizeUrBase(baseUrl)).hostname;
  if (urHost === "localhost" || urHost === "127.0.0.1") return "127.0.0.1";
  const prefix = urHost.split(".").slice(0, 3).join(".");
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (
        ni.family === "IPv4" &&
        !ni.internal &&
        ni.address.startsWith(prefix + ".")
      ) {
        return ni.address;
      }
    }
  }
  return String(reqHost || "").replace(/:\d+$/, "") || "127.0.0.1";
}

function urList(baseUrl, kind, reqHost) {
  return new Promise((resolve, reject) => {
    const token = crypto.randomUUID();
    const done = (fn, arg) => {
      const p = urPending.get(token);
      if (!p) return;
      clearTimeout(p.timer);
      urPending.delete(token);
      fn(arg);
    };
    const timer = setTimeout(
      () =>
        done(
          reject,
          new Error(
            "Timed out waiting for the UR server. Is a Prime Video series page open in Chrome?"
          )
        ),
      30000
    );
    urPending.set(token, {
      timer,
      resolve: (data) => done(resolve, data),
      reject: (err) => done(reject, err),
    });
    const callback = `http://${callbackHostFor(baseUrl, reqHost)}:${PORT}/api/ur/state/${token}`;
    urRun(baseUrl, "Arno.PrimeSearch", kind, [callback]).catch((err) =>
      done(reject, err)
    );
  });
}

// Find UR servers by probing every host of the local /24 subnet(s) on the UR
// port. /system/status is a read-only endpoint that identifies a UR server.
function discoverUR() {
  const prefixes = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) {
        prefixes.add(ni.address.split(".").slice(0, 3).join("."));
      }
    }
  }
  const probes = [];
  for (const prefix of prefixes) {
    for (let i = 1; i < 255; i++) {
      const ip = prefix + "." + i;
      probes.push(
        fetch(`http://${ip}:${UR_PORT}/system/status`, {
          signal: AbortSignal.timeout(1500),
        })
          .then((r) => r.json())
          .then((st) => ({
            ip,
            baseUrl: `http://${ip}:${UR_PORT}`,
            name: st.machine || st.product || "Unified Remote",
          }))
          .catch(() => null)
      );
    }
  }
  return Promise.all(probes).then((r) => r.filter(Boolean));
}

// -- PrimeSearch remote download ------------------------------------------
// The Unified Remote server needs the custom remote in ur-remote/. We zip it on
// request (no dependency) so the download always matches the repo's files.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{name, data: Buffer}] -> zip Buffer (deflate)
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = f.data;
    const comp = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // utf-8 names
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0x21, 12); // date 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function primeSearchZip() {
  const dir = path.join(__dirname, "ur-remote");
  const files = ["meta.prop", "layout.xml", "remote.lua"].map((n) => ({
    name: "PrimeSearch/" + n, // unzips to Custom/PrimeSearch/
    data: fs.readFileSync(path.join(dir, n)),
  }));
  return buildZip(files);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  // API routes
  if (req.method === "POST" && req.url === "/api/send") {
    const body = JSON.parse(await readBody(req));
    const { ip, key } = body;
    if (!ip || !key) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ip and key are required" }));
      return;
    }
    try {
      await sendKeyToTV(ip, key);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/discover") {
    try {
      const tvs = await discoverTV();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tvs));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/discover-chromecast") {
    try {
      const ccs = await discoverChromecasts();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ccs));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/chromecast/control") {
    const body = JSON.parse(await readBody(req));
    const { ip, action } = body;
    if (!ip || !action) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ip and action are required" }));
      return;
    }
    try {
      await chromecastControl(ip, action);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/chromecast/status") {
    const body = JSON.parse(await readBody(req));
    const { ip } = body;
    if (!ip) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ip is required" }));
      return;
    }
    try {
      const status = await chromecastStatus(ip);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/chromecast/tracks") {
    const body = JSON.parse(await readBody(req));
    const { ip, activeTrackIds } = body;
    if (!ip || !Array.isArray(activeTrackIds)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ip and activeTrackIds are required" }));
      return;
    }
    try {
      const result = await chromecastEditTracks(ip, activeTrackIds);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/ur/run") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    const { baseUrl, id, name, values } = body;
    if (!baseUrl || !id || !name) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "baseUrl, id and name are required" }));
      return;
    }
    try {
      const result = await urRun(baseUrl, id, name, values);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const stateMatch = req.method === "POST" && req.url.match(/^\/api\/ur\/state\/([0-9a-f-]{36})$/);
  if (stateMatch) {
    const pending = urPending.get(stateMatch[1]);
    if (!pending) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unknown or expired token" }));
      return;
    }
    try {
      const data = JSON.parse(await readBody(req));
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/ur/list") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    const { baseUrl, kind } = body;
    if (!baseUrl || !["seasons", "episodes"].includes(kind)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "baseUrl and kind (seasons|episodes) are required" })
      );
      return;
    }
    try {
      const data = await urList(baseUrl, kind, req.headers.host);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/ur/discover") {
    try {
      const servers = await discoverUR();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(servers));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/PrimeSearch.zip") {
    try {
      const zip = primeSearchZip();
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=PrimeSearch.zip",
        "Content-Length": zip.length,
      });
      res.end(zip);
    } catch (err) {
      res.writeHead(500);
      res.end("Could not build zip: " + err.message);
    }
    return;
  }

  // Serve mkcert root CA for phone installation
  if (req.method === "GET" && req.url === "/rootCA.pem") {
    const caPath = path.join(__dirname, "rootCA.pem");
    try {
      const content = fs.readFileSync(caPath);
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": "attachment; filename=rootCA.pem",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("rootCA.pem not found");
    }
    return;
  }

  // Static file serving from web/
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, "web", filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`TV remote webapp running at http://localhost:${PORT}`);
});

// HTTPS server for PWA support
const certPath = path.join(__dirname, "cert.pem");
const keyPath = path.join(__dirname, "key.pem");
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsServer = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    server.listeners("request")[0]
  );
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`TV remote webapp (HTTPS) running at https://localhost:${HTTPS_PORT}`);
  });
}
