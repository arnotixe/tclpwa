local script = require("script");
local server = require("server");
local fs = require("fs");
local http = require("http");

local ORIGIN = "https://www.primevideo.com";
local HOME = ORIGIN;
local SEARCH = ORIGIN .. "/search?phrase=";
local STATE_FILE = fs.homedir() .. "/prime-state.json";

-- Last extracted page state, used to resolve list taps.
local current = { kind = "", items = {} };
local state = { seasons = {}, episodes = {}, resume = nil };
local last_json = "{}";

local function urlencode(s)
	s = tostring(s or "");
	return (s:gsub("[^%w%-_%.~]", function(c)
		return string.format("%%%02X", string.byte(c));
	end));
end

-- Prepare JS for embedding in an AppleScript string literal.
local function as_literal(js)
	js = js:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("[\r\n]+", " ");
	return js;
end

-- Find the open Prime Video tab in Chrome (see FIND_TAB usage below).
local FIND_TAB = [[
	set theTab to missing value
	repeat with w in windows
		set i to 0
		repeat with t in tabs of w
			set i to i + 1
			if (URL of t contains "primevideo.com") or (URL of t contains "amazon.com/gp/video") then
				set theTab to t
				set theWindow to w
				set theIndex to i
				exit repeat
			end if
		end repeat
		if theTab is not missing value then exit repeat
	end repeat
]];

-- Navigate an already open Prime Video tab in Chrome (and focus it).
-- If no such tab exists, open the URL in a new one.
local function goto_prime(url)
	script.apple(
		'tell application "Google Chrome"',
		FIND_TAB,
		'if theTab is missing value then',
		'	open location "' .. url .. '"',
		'else',
		'	set URL of theTab to "' .. url .. '"',
		'	set active tab index of theWindow to theIndex',
		'	set index of theWindow to 1',
		'end if',
		'activate',
		'end tell'
	);
end

-- JS run inside the Prime tab. Returns JSON, a marker line, then one TSV
-- line per item: S/E/R <tab> name <tab> url (seasons, episodes, resume).
local READY_JS = [==[
(document.querySelector('[data-testid="dp-season-selector"]') || document.querySelector('[data-testid="episode-list-item"]') || document.querySelector('[data-automation-id="dp-atf-play-button"]')) ? "1" : "0"
]==];

local EXTRACT_JS = [==[
(function () {
  var q = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var abs = function (h) { return h ? new URL(h, location.origin).href : null; };
  var clean = function (s) { return (s || "").replace(/[\t\r\n]+/g, " ").trim(); };
  var rb = document.querySelector('[data-automation-id="dp-atf-play-button"]');
  var rl = rb ? rb.querySelector('span:last-child span') : null;
  var d = {
    title: document.title,
    url: location.href,
    seasons: q('[data-testid="dp-season-selector"] ul a').map(function (a) {
      return { name: clean(a.textContent), url: abs(a.getAttribute('href')) };
    }),
    episodes: q('[data-testid="episode-list-item"]').map(function (li) {
      var t = li.querySelector('[data-automation-id^="ep-title-episode-"]');
      var p = li.querySelector('a[data-testid="episodes-playbutton"]');
      return { title: t ? clean(t.textContent) : null, url: p ? abs(p.getAttribute('href')) : null };
    }),
    resume: rb ? { text: clean((rl || rb).textContent), url: abs(rb.getAttribute('href')) } : null
  };
  var tsv = [];
  d.seasons.forEach(function (s) { tsv.push("S\t" + s.name + "\t" + s.url); });
  d.episodes.forEach(function (e) { tsv.push("E\t" + e.title + "\t" + e.url); });
  if (d.resume) tsv.push("R\t" + d.resume.text + "\t" + d.resume.url);
  return JSON.stringify(d) + "\n@@TSV@@\n" + tsv.join("\n");
})()
]==];

-- Wait for the page to render, then run the extractor in the Prime tab.
local function extract()
	local out = script.apple(
		'tell application "Google Chrome"',
		FIND_TAB,
		'if theTab is missing value then return "ERR: no Prime Video tab open"',
		'repeat 24 times',
		'	if (execute theTab javascript "' .. as_literal(READY_JS) .. '") is "1" then exit repeat',
		'	delay 0.5',
		'end repeat',
		'return execute theTab javascript "' .. as_literal(EXTRACT_JS) .. '"',
		'end tell'
	);
	out = tostring(out or "");
	local json, tsv = out:match("^(.-)\n@@TSV@@\n(.*)$");
	if not json then
		print("PrimeSearch: extract failed: " .. out);
		return false, out;
	end
	last_json = json;
	fs.write(STATE_FILE, json .. "\n");
	state = { seasons = {}, episodes = {}, resume = nil };
	for line in tsv:gmatch("[^\r\n]+") do
		local kind, name, url = line:match("^(%a)\t(.-)\t(.*)$");
		if kind == "S" then
			table.insert(state.seasons, { name = name, url = url });
		elseif kind == "E" then
			table.insert(state.episodes, { name = name, url = url });
		elseif kind == "R" then
			state.resume = { name = name, url = url };
		end
	end
	print("PrimeSearch: " .. #state.seasons .. " seasons, " .. #state.episodes .. " episodes -> " .. STATE_FILE);
	return true;
end

local function show(kind, items)
	current = { kind = kind, items = items };
	local children = {};
	for _, it in ipairs(items) do
		table.insert(children, { type = "item", text = it.name });
	end
	server.update({ id = "list", children = children });
end

-- Prime's page holds several <video> elements (previews, empty placeholders);
-- the real player is the one with a loaded source, so pick the longest.
local PICK_VIDEO = "Array.from(document.querySelectorAll('video'))"
	.. ".filter(function(x){return x.readyState>0&&isFinite(x.duration);})"
	.. ".sort(function(a,b){return b.duration-a.duration;})[0];";

-- Move the playback position of the <video> in the Prime tab by `delta`
-- seconds (negative = back). Works while playing or paused; no focus needed.
local function seek_by(delta)
	delta = tonumber(delta);
	if delta == nil then
		print("PrimeSearch: seek needs a number of seconds");
		return;
	end
	local js = "(function(){var v=" .. PICK_VIDEO
		.. "if(!v)return 'no video';"
		.. "v.currentTime=Math.max(0,v.currentTime+(" .. delta .. "));"
		.. "return 'now at '+Math.round(v.currentTime)+'s of '+Math.round(v.duration)+'s';})()";
	local out = script.apple(
		'tell application "Google Chrome"',
		FIND_TAB,
		'if theTab is missing value then return "ERR: no Prime Video tab open"',
		'return execute theTab javascript "' .. as_literal(js) .. '"',
		'end tell'
	);
	print("PrimeSearch: seek " .. delta .. "s -> " .. tostring(out));
end

--@help Toggle play/pause on the Prime tab's <video> (no key press)
actions.toggle_play = function()
	local js = "(function(){var v=" .. PICK_VIDEO
		.. "if(!v)return 'no video';"
		.. "if(v.paused){v.play();return 'playing';}"
		.. "v.pause();return 'paused';})()";
	local out = script.apple(
		'tell application "Google Chrome"',
		FIND_TAB,
		'if theTab is missing value then return "ERR: no Prime Video tab open"',
		'return execute theTab javascript "' .. as_literal(js) .. '"',
		'end tell'
	);
	print("PrimeSearch: toggle_play -> " .. tostring(out));
end

--@help Skip back 15 seconds
actions.rewind15 = function()
	seek_by(-15);
end

--@help Skip forward 15 seconds
actions.forward15 = function()
	seek_by(15);
end

--@help Seek by a number of seconds (negative = back)
--@param seconds
actions.seek = function(seconds)
	seek_by(seconds);
end

-- Run JS in the Prime tab and return its result as a string.
local function tab_js(js)
	return tostring(script.apple(
		'tell application "Google Chrome"',
		FIND_TAB,
		'if theTab is missing value then return "ERR: no Prime Video tab open"',
		'return execute theTab javascript "' .. as_literal(js) .. '"',
		'end tell'
	) or "");
end

-- Bring Chrome and its Prime tab to the front. Returns the window bounds
-- "x1,y1,x2,y2", or nil if there is no Prime tab.
local function focus_prime()
	local b = tostring(script.apple(
		'tell application "Google Chrome"',
		FIND_TAB,
		'if theTab is missing value then return "ERR"',
		'set active tab index of theWindow to theIndex',
		'set index of theWindow to 1',
		'activate',
		'delay 0.3',
		'set b to bounds of theWindow',
		'return ((item 1 of b) as text) & "," & ((item 2 of b) as text) & "," & ((item 3 of b) as text) & "," & ((item 4 of b) as text)',
		'end tell'
	) or "");
	-- AppleScript may format negative numbers with U+2212 MINUS SIGN
	b = b:gsub("\226\136\146", "-"):gsub("%s+", "");
	-- note: the captures matter, in Lua ",-?" would make "-" a quantifier on ","
	if not b:match("^(-?%d+),(-?%d+),(-?%d+),(-?%d+)$") then
		print("PrimeSearch: no Chrome window with a Prime tab (" .. b .. ")");
		return nil;
	end
	return b;
end

-- Prime only renders its player controls while it sees real mouse movement
-- (synthetic DOM events are ignored), so move the OS cursor over the Chrome
-- window until `probe_js` returns "1". Needs Accessibility for Unified Remote.
local function wake_controls(probe_js)
	local b = focus_prime();
	if not b then return false; end
	local x1, y1, x2, y2 = b:match("^(-?%d+),(-?%d+),(-?%d+),(-?%d+)$");
	local cx = (tonumber(x1) + tonumber(x2)) / 2;
	local cy = (tonumber(y1) + tonumber(y2)) / 2;
	for i = 1, 8 do
		libs.mouse.moveto(cx + (i % 2 == 0 and 12 or -12), cy + i * 3);
		script.apple('delay 0.15');
		if tab_js(probe_js) == "1" then return true; end
	end
	return false;
end

-- Poll the Prime tab until `js` returns "1" (max ~3 s).
local function wait_js(js)
	for i = 1, 15 do
		if tab_js(js) == "1" then return true; end
		script.apple('delay 0.2');
	end
	return false;
end

local function click_js(id)
	return "(function(){var e=document.getElementById('" .. id .. "');if(!e)return '0';e.click();return '1';})()";
end

local function exists_js(sel)
	return "document.querySelector(\"" .. sel .. "\")?'1':'0'";
end

-- Radio inputs of the subtitles / audio menus. Only the subtitle ids are
-- confirmed; audio covers both a separate audio menu and audio radios sitting
-- in a combined "Subtitles and audio" panel.
local SUB_RADIOS = "input[name=subtitle]";
local AUDIO_RADIOS = "#atvwebplayersdk-audio-menu input[type=radio], input[type=radio][name*=audio i]";

-- Reads the radios matching `sel` as "<current index>|<label>=<value>\n..." (0-based).
local function read_radios_js(sel)
	return "(function(){"
		.. "var r=Array.from(document.querySelectorAll('" .. sel .. "'));var cur=-1;"
		.. "var rows=r.map(function(i,n){if(i.checked)cur=n;var l=i.closest('label');"
		.. "return ((l?l.textContent:'').replace(/CC$/,'').replace(/[=\\n]+/g,' ').trim())+'='+i.value;});"
		.. "return cur+'|'+rows.join('\\n');})()";
end

local function click_radio_js(sel, index)
	return "(function(){var r=document.querySelectorAll('" .. sel .. "')[" .. index .. "];if(!r)return '0';r.click();return '1';})()";
end

-- Parse read_radios_js output into { current = index, list = {{label, value}...} }.
local function parse_radios(out)
	local cur, rest = out:match("^(-?%d+)|(.*)$");
	if not cur then return nil; end
	local list = {};
	for line in (rest .. "\n"):gmatch("([^\n]*)\n") do
		local label, value = line:match("^(.*)=(.-)$");
		table.insert(list, { label = label or "", value = value or "" });
	end
	if rest == "" then list = {}; end
	return { current = tonumber(cur), list = list };
end

-- Opens the submenu that holds the radios `sel`: wakes the controls, opens the
-- gear menu, then clicks the submenu button (`open_js`). Returns ok, err.
local function open_track_menu(sel, open_js)
	if not wake_controls(exists_js("#atvwebplayersdk-settings-button")) then
		return false, "player controls did not appear";
	end
	if tab_js(exists_js(sel)) == "1" then return true; end
	-- the gear toggles the menu, so only click it when the menu is closed
	if tab_js(exists_js("#atvwebplayersdk-settings-menu")) ~= "1" then
		tab_js(click_js("atvwebplayersdk-settings-button"));
	end
	if not wait_js(exists_js("#atvwebplayersdk-settings-menu, #atvwebplayersdk-subtitles-button")) then
		return false, "settings menu did not open";
	end
	if tab_js(exists_js(sel)) ~= "1" then tab_js(open_js); end
	if not wait_js(exists_js(sel)) then return false, "no options found"; end
	return true;
end

-- Close any open submenu, then the gear menu, so the controls can hide again.
local function close_track_menus()
	tab_js("(function(){['atvwebplayersdk-subtitles-menu','atvwebplayersdk-audio-menu'].forEach(function(id){"
		.. "var b=document.querySelector('#'+id+' button[aria-label=\"Close\"]');if(b)b.click();});})()");
	script.apple('delay 0.3');
	if tab_js(exists_js("#atvwebplayersdk-settings-menu")) == "1" then
		tab_js(click_js("atvwebplayersdk-settings-button"));
	end
end

-- Language bucket of a subtitle option: off / en / es (nil = ignore).
local function sub_kind(label, value)
	if label:lower() == "off" or value:lower():match("^off") or value == "" then return "off"; end
	local v = value:lower();
	if v:match("^en") then return "en"; end
	if v:match("^es") then return "es"; end
	return nil;
end

--@help Cycle subtitles Off -> English -> Spanish (only languages the title has)
actions.subs = function()
	local ok, err = open_track_menu(SUB_RADIOS, click_js("atvwebplayersdk-subtitles-button"));
	if not ok then
		print("PrimeSearch: subs: " .. err);
		close_track_menus();
		return;
	end
	local out = tab_js(read_radios_js(SUB_RADIOS));
	local menu = parse_radios(out);
	if not menu then
		print("PrimeSearch: subs: unreadable menu: " .. out);
		close_track_menus();
		return;
	end
	local opts, order = {}, { "off", "en", "es" };
	for n, o in ipairs(menu.list) do
		local kind = sub_kind(o.label, o.value);
		if kind and opts[kind] == nil then opts[kind] = n - 1; end
		if n - 1 == menu.current then opts.current = kind; end
	end
	local avail = {};
	for _, k in ipairs(order) do
		if opts[k] ~= nil then table.insert(avail, k); end
	end
	local pos = 1;
	for i, k in ipairs(avail) do
		if k == opts.current then pos = i; end
	end
	local nextk = avail[(pos % #avail) + 1];
	local res = tab_js(click_radio_js(SUB_RADIOS, opts[nextk]));
	print("PrimeSearch: subs " .. tostring(opts.current) .. " -> " .. tostring(nextk) .. " (" .. res .. ")");
	script.apple('delay 0.3');
	close_track_menus();
end

-- Clicks the audio submenu button: #atvwebplayersdk-audio-button, else a gear
-- menu entry mentioning "audio", else the subtitles button (combined panel).
local OPEN_AUDIO_JS = [==[
(function(){
  var b = document.getElementById('atvwebplayersdk-audio-button');
  if (!b) {
    var m = document.getElementById('atvwebplayersdk-settings-menu') || document;
    b = Array.from(m.querySelectorAll('button,[role=button],[role=menuitem]')).filter(function (e) {
      return /audio/i.test(e.textContent + ' ' + (e.getAttribute('aria-label') || ''));
    })[0];
  }
  if (!b) b = document.getElementById('atvwebplayersdk-subtitles-button');
  if (!b) return '0';
  b.click();
  return '1';
})()
]==];

-- Describes the open player menus, logged when the audio options are not found.
local DUMP_MENUS_JS = [==[
(function(){
  var ids = Array.from(document.querySelectorAll('[id^=atvwebplayersdk-][id*=menu], [id^=atvwebplayersdk-][id$=button]')).map(function (e) { return e.id; });
  var radios = Array.from(document.querySelectorAll('input[type=radio]')).map(function (i) { return i.name + '=' + i.value; });
  var m = document.getElementById('atvwebplayersdk-settings-menu');
  var menu = m ? m.innerText.replace(/\s+/g, ' ').slice(0, 300) : '(closed)';
  return 'ids: ' + ids.join(' ') + ' | radios: ' + radios.join(' ') + ' | settings menu: ' + menu;
})()
]==];

-- Audio option -> lang ("en" / "es" / nil) and a score; higher is better:
-- +2 not audio description, +1 US English / Latin American Spanish.
local function audio_kind(label, value)
	local l, v = label:lower(), value:lower():gsub("_", "-");
	local lang;
	if v:match("^en") or l:match("^english") then
		lang = "en";
	elseif v:match("^es") or l:match("^espa") or l:match("^spanish") then
		lang = "es";
	else
		return nil, 0;
	end
	local score = 0;
	if not (l:match("audio description") or l:match("descri") or v:match("descri") or v:match("%-ad$")) then
		score = score + 2;
	end
	if lang == "en" and (v:match("^en%-us") or l:match("united states") or l:match("%(us%)") or l:match("american")) then
		score = score + 1;
	elseif lang == "es" and (v:match("^es%-419") or v:match("^es%-mx") or v:match("^es%-us")
		or l:match("latino") or l:match("latin america") or l:match("xico")) then
		score = score + 1;
	end
	return lang, score;
end

--@help Toggle audio English <-> Spanish (prefers US English / Latin American Spanish)
actions.audio = function()
	local ok, err = open_track_menu(AUDIO_RADIOS, OPEN_AUDIO_JS);
	if not ok then
		print("PrimeSearch: audio: " .. err .. " (" .. tab_js(DUMP_MENUS_JS) .. ")");
		close_track_menus();
		return;
	end
	local out = tab_js(read_radios_js(AUDIO_RADIOS));
	local menu = parse_radios(out);
	if not menu then
		print("PrimeSearch: audio: unreadable menu: " .. out);
		close_track_menus();
		return;
	end
	-- best option (0-based index) per language, and the current language
	local best, score, current = {}, {}, nil;
	for n, o in ipairs(menu.list) do
		local lang, sc = audio_kind(o.label, o.value);
		if lang and (best[lang] == nil or sc > score[lang]) then
			best[lang], score[lang] = n - 1, sc;
		end
		if n - 1 == menu.current then current = lang; end
	end
	local target;
	if current == "en" then
		target = "es";
	elseif current == "es" then
		target = "en";
	else
		target = best.en and "en" or "es";
	end
	if best[target] == nil then
		-- no English/Spanish at all, or only the language already playing
		print("PrimeSearch: audio: nothing to switch to (current " .. tostring(current) .. ")");
	else
		local o = menu.list[best[target] + 1];
		local res = tab_js(click_radio_js(AUDIO_RADIOS, best[target]));
		print("PrimeSearch: audio " .. tostring(current) .. " -> " .. o.label .. " [" .. o.value .. "] (" .. res .. ")");
		script.apple('delay 0.3');
	end
	close_track_menus();
end

--@help Wake the Mac display: focus the Prime window and wiggle the cursor over it
actions.wiggle = function()
	-- declare user activity, which wakes the display even where a synthetic
	-- mouse move alone does not (-t 1: release the assertion after 1 s)
	script.apple('do shell script "caffeinate -u -t 1"');
	local b = focus_prime();
	if not b then return; end
	local x1, y1, x2, y2 = b:match("^(-?%d+),(-?%d+),(-?%d+),(-?%d+)$");
	local cx = (tonumber(x1) + tonumber(x2)) / 2;
	local cy = (tonumber(y1) + tonumber(y2)) / 2;
	for i = 1, 6 do
		libs.mouse.moveto(cx + (i % 2 == 0 and 20 or -20), cy + (i % 3 - 1) * 10);
		script.apple('delay 0.1');
	end
	libs.mouse.moveto(cx, cy);
	print("PrimeSearch: wiggle at " .. cx .. "," .. cy);
end

-- "1"/"0" = muted state of the Prime player's <video>, "" if there is none.
local MUTED_JS = "(function(){var v=" .. PICK_VIDEO .. "return v?(v.muted?'1':'0'):'';})()";

--@help Toggle mute on the Prime player (the page's audio, not the TV)
actions.mute = function()
	local before = tab_js(MUTED_JS);
	if before ~= "0" and before ~= "1" then
		print("PrimeSearch: mute: no video (" .. before .. ")");
		return;
	end
	-- Prime's own "m" shortcut. A real key press counts as a user gesture, so
	-- Chrome's autoplay policy lets the video keep playing when unmuted.
	if focus_prime() then
		libs.keyboard.stroke("m");
		script.apple('delay 0.3');
	end
	local after = tab_js(MUTED_JS);
	local how = "key";
	if after == before then
		-- key press did not reach the player: set the flag directly, and
		-- resume if Chrome paused the video for unmuting without a gesture
		how = "js";
		after = tab_js("(function(){var v=" .. PICK_VIDEO
			.. "if(!v)return '';var p=v.paused;v.muted=!v.muted;"
			.. "if(!p&&v.paused)v.play().catch(function(){});"
			.. "return v.muted?'1':'0';})()");
	end
	print("PrimeSearch: mute (" .. how .. ") -> " .. (after == "1" and "muted" or after == "0" and "unmuted" or after));
end

--@help Go to the Prime Video home page, or to a given Prime Video URL
--@param url (optional)
actions.home = function(url)
	if url == nil or tostring(url) == "" then
		url = HOME;
	end
	print("PrimeSearch: home " .. tostring(url));
	goto_prime(tostring(url));
end

--@help Search Prime Video
--@param text
actions.search = function(text)
	print("PrimeSearch: query=" .. tostring(text));
	goto_prime(SEARCH .. urlencode(text));
end

--@help Open a Prime Video URL in the Prime tab
--@param url
actions.open = function(url)
	print("PrimeSearch: open " .. tostring(url));
	goto_prime(tostring(url));
end

-- Push JSON to an optional callback URL (used by tclpwa: a run call returns no
-- data, so the remote POSTs the extracted page state back to the caller).
local function post_json(callback, json)
	if callback == nil or tostring(callback) == "" then return; end
	http.request({
		method = "POST",
		url = tostring(callback),
		mime = "application/json",
		content = json,
	}, function(err, resp)
		if err then
			print("PrimeSearch: callback failed: " .. tostring(err));
		else
			print("PrimeSearch: callback ok");
		end
	end);
end

local function json_error(msg)
	msg = tostring(msg or "unknown error"):gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("[\r\n]+", " ");
	return '{"error":"' .. msg .. '"}';
end

--@help List seasons of the series on the current page
--@param callback (optional URL to POST the page state to)
actions.seasons = function(callback)
	local ok, err = extract();
	if ok then
		show("seasons", state.seasons);
		post_json(callback, last_json);
	else
		post_json(callback, json_error(err));
	end
end

--@help List episodes on the current page
--@param callback (optional URL to POST the page state to)
actions.episodes = function(callback)
	local ok, err = extract();
	if ok then
		show("episodes", state.episodes);
		post_json(callback, last_json);
	else
		post_json(callback, json_error(err));
	end
end

--@help Resume where you left off (series page)
actions.resume = function()
	if extract() and state.resume then
		print("PrimeSearch: resume -> " .. state.resume.name);
		goto_prime(state.resume.url);
	else
		print("PrimeSearch: no resume button on this page");
	end
end

--@help List tap: open the tapped season or episode
--@param index
actions.tapped = function(index)
	local item = current.items[tonumber(index) + 1];
	print("PrimeSearch: tapped " .. tostring(index) .. " (" .. current.kind .. ") -> " .. tostring(item and item.name));
	if item then goto_prime(item.url); end
end
