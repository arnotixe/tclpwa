const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const net = require("net");
const dgram = require("dgram");
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
