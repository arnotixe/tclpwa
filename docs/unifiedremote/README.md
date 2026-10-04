# unified remote

unifiedremote.com

Notes on driving Amazon Prime Video through a Unified Remote server's Web API. Used by the UR mode of this app (see `../../CLAUDE.md`). The custom remote lives in `../../ur-remote/` (installable from the Settings page as `/PrimeSearch.zip`).

Folder contents:

- `USE-ARNOREMOTE.md`: copy-paste walkthrough (series -> season -> episode -> seek).
- `fixtures/`: Prime Video DOM samples (`seasonselector.html`, `episodes.html`, `resumebutton.html`) that the extractor selectors in `ur-remote/remote.lua` were written against. Re-check them if Prime changes its markup.
- `reference/amazon-prime-video-bundled/`: the stock `Unified.AmazonPrimeVideo` remote (keystroke based), kept for its action names.

## amazon prime integration

The server dashboard is at http://192.168.1.111:9510/web/ . That is a static HTML page only; POSTing commands to it does nothing (it just returns the same HTML).

Commands go through the Web API at `/client/...` and need a connection id first.

### Setup

Do this on the machine that runs the Unified Remote server (the one that controls Chrome).

1. **Install the custom remote.** Copy the `ur-remote/` folder (rename it `PrimeSearch`; the Settings page zip does this for you) (`remote.lua`, `layout.xml`, `meta.prop`) to the server's custom remotes folder, e.g. on macOS `~/Library/Application Support/Unified Remote/Remotes/Custom/PrimeSearch/`. It is not installed anywhere automatically: copying it to one machine does not install it on another. The server watches the folder, or call `GET /system/reload`. It then shows up as remote id `Arno.PrimeSearch`.
2. **Allow JavaScript from Apple Events in Chrome.** In Chrome's menu bar choose **View > Developer > Allow JavaScript from Apple Events** and make sure it is ticked. Without it, listing seasons/episodes and resume fail with: "Executing JavaScript through AppleScript is turned off."
3. **Allow Automation.** The first time, macOS may ask whether Unified Remote may control Google Chrome. Allow it (System Settings > Privacy & Security > Automation).
4. **Leave one Prime Video tab open in Chrome and logged in.** The remote reuses that tab instead of opening new ones. Resume/watch progress only exists in the logged-in tab.
5. Requires `jq` and `uuidgen` for the curl examples below.

### 1. Connect (get a connection id)

```bash
SERVERURL="http://192.168.1.111:9510"
UREMOTEID=`curl -s -X POST "$SERVERURL/client/connect" \
    -H "Content-Type: application/json" \
    -d '{}'|jq -r '.id'`
echo "$UREMOTEID"
# -> a5df0b26-c009-11f1-8289-a8206655c3b3
```

(The raw response is `{"id": "a5df0b26-..."}`; `jq` extracts the id. Requires `jq`.)

### 2. Handshake, then run an action (works)

Each connection must do a handshake (Action 0) and declare capabilities (Action 1) before a run (Action 7). All three share one `Source` guid (`web-<uuid>`). The remote id goes in the top-level `"ID"`; `Run` only holds the action `Name`.

```bash
SERVERURL="http://192.168.1.111:9510"
UREMOTEID=$(curl -s "$SERVERURL/client/connect" | jq -r '.id')
SRC="web-$(uuidgen | tr A-Z a-z)"
PW=$(uuidgen | tr A-Z a-z)
echo "SERVERURL $SERVERURL"
echo "UREMOTEID $UREMOTEID"
echo "SRC $SRC"
echo "PW $PW"



ur() { curl -s -X POST "$SERVERURL/client/request" \
    -H "Content-Type: application/json" \
    -H "UR-Connection-ID: $UREMOTEID" -d "$1" | jq -c .; }

# handshake
ur '{"Action":0,"Request":0,"Version":10,"Password":"'$PW'","Platform":"web","Source":"'$SRC'"}'
# capabilities
ur '{"Capabilities":{"Actions":true,"Sync":true,"Grid":true,"Fast":false,"Loading":true,"Encryption2":true},"Action":1,"Request":1,"Source":"'$SRC'"}'
# run play_pause (toggles; run again to resume)
ur '{"ID":"Unified.AmazonPrimeVideo","Action":7,"Request":7,"Run":{"Name":"play_pause"},"Source":"'$SRC'"}'
# -> {"Error":"No response from connection"}  is normal: runs get no reply, but the action fires

# fullscreen toggle
SERVERURL="http://localhost:9510/web/"
ur '{"ID":"Unified.AmazonPrimeVideo","Action":7,"Request":7,"Run":{"Name":"fullscreen"},"Source":"'$SRC'"}'

```

Other actions (from `reference/amazon-prime-video-bundled/remote.lua`): `fullscreen`, `volume_up`, `volume_down`, `volume_mute`, `forward`, `rewind`, `launch`. There is no subtitles action.

Debugging: `curl -s "$SERVERURL/system/log/40/8/" | jq -r '.data[]' | head` shows the server log (`[ERRFMT] unexpected request` means a malformed request).

- Testing against a local server: use `SERVERURL="http://localhost:9510"` (no `/web/` suffix). `/web/` is only the dashboard page, so `$SERVERURL/client/...` would 404 under it. Verified on a second Mac.
- Handshake and capabilities are both required on every connection (omitting either gives `[ERRFMT] unexpected request` in the log), so keep all three calls inline.
- Remote id: `Unified.AmazonPrimeVideo` (confirmed via `GET /system/remotes`).
- Protocol reference: [Home Assistant community thread](https://community.home-assistant.io/t/solved-unified-remote-integration-possible/35927).

### Search (custom remote `Arno.PrimeSearch`)

Source in `ur-remote/` (repo root). Install by copying it to the server's custom remotes folder (`~/Library/Application Support/Unified Remote/Remotes/Custom/PrimeSearch/`); the server picks it up automatically (or `GET /system/reload`). It appears as remote id `Arno.PrimeSearch`.

It finds an already open Prime Video tab in Google Chrome (AppleScript, URL contains `primevideo.com`), navigates that tab and focuses it. If no such tab exists it opens a new one. Leave one Prime Video tab open as initial setup. macOS may ask to allow Unified Remote to control Chrome (Automation permission).

Actions: `home` (optional `url` parameter, defaults to `https://www.primevideo.com`), and `search` with a text parameter. Parameters go in `Run.Extras.Values`:

```bash
# same handshake + capabilities as above, then:
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"home"},"Source":"'$SRC'"}'
# home with a url, e.g. a series page
SERIESHOME="https://www.primevideo.com/detail/0M0GF2NPWND7J6HXY5Y09FLA5O"
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"home","Extras":{"Values":[{"Value":"'$SERIESHOME'"}]}},"Source":"'$SRC'"}'
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":8,"Run":{"Name":"search","Extras":{"Values":[{"Value":"the boys"}]}},"Source":"'$SRC'"}'
```

More actions (all take no parameter unless noted):

- `seasons` / `episodes`: read the current Prime tab, write `~/prime-state.json` (title, seasons, episodes, resume; all URLs absolute) and fill the list in the Unified Remote app. Tapping a list item opens that season or episode in the Prime tab.
- `seasons` / `episodes` take an optional `callback` URL parameter: after extracting, the remote also POSTs the JSON (same content as `~/prime-state.json`, or `{"error": "..."}`) to it. This is how a caller on another machine (e.g. `tclpwa`) gets the lists, since a run returns no data.
- `resume`: go to the "Resume Sx Ey" link (`autoplay=1&t=<offset>`) of the current series page.
- `rewind15` / `forward15`: skip 15 seconds back/forward. `seek` with a `seconds` parameter (negative = back) does any amount. These set `currentTime` on the page's `<video>` via Chrome JavaScript, so no key focus is needed and it works while paused. (The bundled `Unified.AmazonPrimeVideo` `rewind`/`forward` only press the arrow keys, which seek in Prime's default 10 s steps.)
- `open` with a `url` parameter: navigate the Prime tab to any URL (`"Extras":{"Values":[{"Value":"https://www.primevideo.com/detail/..."}]}`).

```bash
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":9,"Run":{"Name":"episodes"},"Source":"'$SRC'"}'
cat ~/prime-state.json | jq '.seasons[], .resume'
```

Verified on a test Mac: with a different tab selected, Chrome switched to the open Prime Video tab and navigated it to `https://www.primevideo.com/search?phrase=the%20boys`. The server log shows `PrimeSearch: query=the boys`.

### Status / TODO

- [x] Found the correct endpoints (`/client/connect`, `/client/request`)
- [x] Real action names found in `reference/amazon-prime-video-bundled/remote.lua` (`play_pause`, `fullscreen`, ...)
- [x] `play_pause` verified to pause Prime Video via handshake -> capabilities -> run
- [ ] Verify the other actions (`fullscreen`, `forward`, `rewind`, volume)
- [x] Search: `Arno.PrimeSearch` custom remote navigates the open Prime tab to a search (verified).
- [x] Seasons / episodes: the `seasons` / `episodes` actions push the page state to a callback URL; the Seasons and Episodes buttons in this app use it (done, see `../../CLAUDE.md`).
- [ ] Still open: pick a search result by name. Background findings: the official docs (github.com/unifiedremote/Docs) describe the Lua remote libraries but have no Web API, search or media-library section. The Prime Video remote only sends keystrokes (and `os.open` of primevideo.com). Search would need a custom remote (e.g. `os.open("https://www.primevideo.com/search?phrase=...")` or typing via `libs.keyboard`).

### Useful read-only endpoints

- `GET /system/status`
- `GET /system/remotes` - list installed remotes and ids
- `GET /system/config`
