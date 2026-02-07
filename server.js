const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const dgram = require("dgram");
const xml2js = require("xml2js");

const PORT = process.env.PORT || 8765;

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
