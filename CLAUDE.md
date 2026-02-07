# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js-based TCL TV remote control. Communicates with TCL smart TVs over the local network via raw TCP and UPnP/SSDP discovery. Based on a fork of [node-tcl-remote](https://github.com/NickCis/node-tcl-remote/tree/master).

## Running

### CLI (interactive keyboard remote)
```bash
node cli.js
```
Keyboard mappings: `+/-` volume, arrows/enter/esc navigation, `s` Smart TV menu, `m` mute, `o` power, `n` play/pause, `g` guide, `x` test key cycle.

### Web app (browser-based remote)
```bash
node server.js              # Runs on port 8765 (override with PORT env var)
```

### Docker (requires --net=host for SSDP multicast and raw TCP to TV)
```bash
docker build -t tvctl .
docker run --net=host tvctl
```

### Shell scripts
```bash
./send.sh TR_KEY_POWER                    # Send single command (default host 192.168.100.55)
./send.sh TR_KEY_VOL_UP 192.168.1.100     # Send to specific IP
./hdmi2.sh                                # Navigate to HDMI2 via Smart TV menu sequence
./hdmi3.sh                                # Navigate to HDMI3
./off.sh                                  # Power off
```

## Architecture

There are two interfaces to the same TV protocol: a CLI (`cli.js`) and a web app (`server.js` + `web/`).

### Communication Protocol

1. **TV Discovery**: SSDP M-SEARCH multicast on `239.255.255.250:1900`. Responses contain a `Location` header pointing to a UPnP XML descriptor (e.g. `http://TV_IP:49152/tvrenderdesc.xml`). The descriptor's `<manufacturer>` field is checked for "TCL".

2. **Key Commands**: XML payloads sent over raw TCP to TV port **4123**:
   ```xml
   <?xml version="1.0" encoding="utf-8"?><root><action name="setKey" eventAction="TR_DOWN" keyCode="TR_KEY_POWER" /></root>
   ```
   All key codes follow the `TR_KEY_*` convention. Full list in `cli.js:keydefs` array and `keylist_from_extracting_magiconnect.txt`.

### Core Files

- **`tcl-remote.cjs.development.js`**: Library copied from node-tcl-remote. Exports `Finder` (SSDP discovery via dgram/UDP), `Remote` (TCP socket to port 4123, `press(keyCode)` method), and `Device` (fetches UPnP descriptor). Uses Node `net`, `dgram`, `http`, `xml2js`.

- **`cli.js`**: Terminal-based remote. Uses `Finder`/`Remote` from the library. Reads raw stdin keypresses and maps them to `TR_KEY_*` codes. TV IP can be hardcoded in `main()` or auto-discovered.

- **`server.js`**: HTTP server (no framework, Node built-in `http`). Serves static files from `web/` and provides two API endpoints:
  - `POST /api/send` `{ip, key}` → opens TCP connection to TV, sends XML command
  - `POST /api/discover` → runs SSDP discovery, returns array of `{ip, manufacturer, friendlyName}`

- **`web/index.html`**: Single-page app with two views (control page and settings page), styled as a dark mobile remote control.

- **`web/tvcontrol.js`**: Browser-side logic. Stores TV IP in `localStorage`, sends keys via `fetch('/api/send')`, handles discovery via `fetch('/api/discover')`.

### Why the server proxy exists

Browsers cannot open raw TCP sockets or UDP multicast. The Node server acts as a thin proxy between the browser's HTTP requests and the TV's TCP/UDP protocols. `--net=host` is required in Docker so the container has direct access to the LAN for both SSDP multicast and TCP connections to the TV.

## Dependencies

Single runtime dependency: `xml2js` (for parsing UPnP XML descriptors). No build step, no transpilation, no test framework.

## Key Behavior Notes

- Many `TR_KEY_*` codes are context-dependent and only work in specific TV states (e.g. `TR_KEY_LIST` only works in TV/antenna mode). The commented-out test results in `cli.js` document which keys were tested and their behavior.
- The `Remote` class maintains a persistent TCP socket with a 30-second ping interval. The web server creates a fresh TCP connection per request instead.
- HDMI switching scripts (`hdmi2.sh`, `hdmi3.sh`) work by navigating the Smart TV menu with timed key sequences since there's no direct HDMI input key.
