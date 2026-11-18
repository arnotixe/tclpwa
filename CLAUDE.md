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
./ur-deploy.sh                            # Install ur-remote/ on the UR Mac over SSH (see UR section)
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

### Unified Remote (UR) mode

A third mode (TV -> CC -> UR) on the media-row toggle controls a Unified Remote server driving Amazon Prime Video in Chrome (walkthrough and notes in `docs/unifiedremote/`). In UR mode the rew / play-pause / ff buttons send `rewind15` / `play_pause` / `forward15`, and a pane adds Series, Prime (home), Resume, Full (fullscreen) and a search box.

- `server.js`: `POST /api/ur/run` `{baseUrl, id, name, values?}` does connect -> handshake -> capabilities -> run on every call (the UR Web API rejects a run without them); `POST /api/ur/discover` probes port 9510 on the local /24(s) via `/system/status`.
- Lists: the Seasons / Episodes buttons call `POST /api/ur/list` `{baseUrl, kind}`. A run returns no data, so the server passes the remote a one-time callback URL (`http://<this host>:8765/api/ur/state/<token>`, host = local interface on the UR server's /24); the remote extracts the page from Chrome and POSTs the JSON there, and the server returns it to the browser (30 s timeout). Needs a series/season page open in the Prime tab.
- Browser: localStorage `tvctl_ur` (servers, `ip` field holds the base URL), `tvctl_active_ur`, `tvctl_ur_series` (`[{label, url}]`, shown by the Series button).
- `GET /PrimeSearch.zip` builds a zip (no dependency, see `buildZip` in `server.js`) of `ur-remote/` for the Settings page download. `ur-remote/` is the source of truth for the custom remote (`meta.prop`, `layout.xml`, `remote.lua`).
- Subs (the media-row tracks button, enabled in UR mode): `subs` action cycles subtitles Off -> English -> Spanish (skipping missing languages). Prime only renders player controls on real mouse movement, so `wake_controls` in `remote.lua` raises Chrome and moves the OS cursor via `libs.mouse` (UR needs macOS Accessibility permission), then clicks `#atvwebplayersdk-settings-button` -> `#atvwebplayersdk-subtitles-button` -> the `input[name=subtitle]` radio.
- Audio (music-note button between tracks and mute, UR mode only): `audio` action toggles the audio track English <-> Spanish, picking per language a non audio-description track, preferring US English / Latin American Spanish. If nothing other than the current language is available it just closes the menu. Shares `open_track_menu` / `close_track_menus` with `subs`. Only the subtitle DOM ids are confirmed; the audio radios are looked up by `#atvwebplayersdk-audio-menu` or `input[name*=audio]`, and on failure the remote logs the player menu ids and radio names.
- Wiggle (Zz button next to Episodes): `wiggle` action wakes the Mac display: `caffeinate -u -t 1` (declares user activity), then focuses the Prime window via `focus_prime` and wiggles the cursor over it with `libs.mouse`.
- Mute (button next to the tracks button, shown only in UR mode): `mute` action toggles the Prime player's audio, not the TV. It focuses the Prime tab and presses Prime's `m` shortcut via `libs.keyboard` (a real key press, so Chrome's autoplay policy does not pause the video on unmute); if the muted state did not change it falls back to toggling `video.muted` in JS.
- Dev loop: `./ur-deploy.sh` installs `ur-remote/` on the UR Mac over SSH (default `arno@192.168.1.111`) and reloads the server; `./ur-deploy.sh run <action>` runs an action via the local tvctl server and prints the UR log lines; `./ur-deploy.sh log` shows the log (`GET :9510/system/log/60/8/`). Use this to test remote changes instead of the zip.
- Prime player DOM (seen in the log dump): `atvwebplayersdk-{settings,captions-toggle,mute-toggle,play-pause,skip-backward,skip-forward,fullscreen-toggle,speed-control,next-episode,close-player}-button`. Audio radio values look like `en-us_dialog_0`, `es-419_dialog_0`.
- The UR server needs the custom `Arno.PrimeSearch` remote installed (`ur-remote/`, installed from the Settings page zip) and Chrome's View > Developer > Allow JavaScript from Apple Events.

### Why the server proxy exists

Browsers cannot open raw TCP sockets or UDP multicast. The Node server acts as a thin proxy between the browser's HTTP requests and the TV's TCP/UDP protocols. `--net=host` is required in Docker so the container has direct access to the LAN for both SSDP multicast and TCP connections to the TV.

## Dependencies

Single runtime dependency: `xml2js` (for parsing UPnP XML descriptors). No build step, no transpilation, no test framework.

## Key Behavior Notes

- Many `TR_KEY_*` codes are context-dependent and only work in specific TV states (e.g. `TR_KEY_LIST` only works in TV/antenna mode). The commented-out test results in `cli.js` document which keys were tested and their behavior.
- The `Remote` class maintains a persistent TCP socket with a 30-second ping interval. The web server creates a fresh TCP connection per request instead.
- HDMI switching scripts (`hdmi2.sh`, `hdmi3.sh`) work by navigating the Smart TV menu with timed key sequences since there's no direct HDMI input key.
