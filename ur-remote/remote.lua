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

-- Prime only renders its player controls while it sees real mouse movement
-- (synthetic DOM events are ignored), so move the OS cursor over the Chrome
-- window until `probe_js` returns "1". Needs Accessibility for Unified Remote.
local function wake_controls(probe_js)
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
	local x1, y1, x2, y2 = b:match("^(-?%d+),(-?%d+),(-?%d+),(-?%d+)$");
	if not x1 then
		print("PrimeSearch: wake: no Chrome window (" .. b .. ")");
		return false;
	end
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

-- Reads the open subtitles menu as "<current index>|<label>=<value>\n..." (0-based).
local READ_SUBS_JS = [==[
(function(){
  var r = Array.from(document.querySelectorAll('input[name="subtitle"]'));
  var cur = -1;
  var rows = r.map(function (i, n) {
    if (i.checked) cur = n;
    var l = i.closest('label');
    return ((l ? l.textContent : '').replace(/CC$/, '').trim()) + '=' + i.value;
  });
  return cur + '|' + rows.join('\n');
})()
]==];

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
	if not wake_controls("document.getElementById('atvwebplayersdk-settings-button')?'1':'0'") then
		print("PrimeSearch: subs: player controls did not appear");
		return;
	end
	-- the gear toggles the menu, so only click it when the menu is closed
	if tab_js(exists_js("#atvwebplayersdk-settings-menu")) ~= "1" then
		tab_js(click_js("atvwebplayersdk-settings-button"));
	end
	if not wait_js(exists_js("#atvwebplayersdk-subtitles-button, #atvwebplayersdk-subtitles-menu")) then
		print("PrimeSearch: subs: settings menu did not open");
		return;
	end
	if tab_js(exists_js("#atvwebplayersdk-subtitles-menu")) ~= "1" then
		tab_js(click_js("atvwebplayersdk-subtitles-button"));
	end
	if not wait_js(exists_js("input[name='subtitle']")) then
		print("PrimeSearch: subs: no subtitle options");
		return;
	end
	local out = tab_js(READ_SUBS_JS);
	local cur, rest = out:match("^(-?%d+)|(.*)$");
	cur = tonumber(cur);
	if not cur then
		print("PrimeSearch: subs: unreadable menu: " .. out);
		return;
	end
	local opts, order, n = {}, { "off", "en", "es" }, 0;
	for line in rest:gmatch("[^\n]+") do
		local label, value = line:match("^(.*)=(.-)$");
		if label then
			local kind = sub_kind(label, value);
			if kind and not opts[kind] then opts[kind] = n; end
			if n == cur then opts.current = kind; end
		end
		n = n + 1;
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
	local res = tab_js("(function(){var r=document.querySelectorAll('input[name=\"subtitle\"]')[" .. opts[nextk] .. "];if(!r)return '0';r.click();return '1';})()");
	print("PrimeSearch: subs " .. tostring(opts.current) .. " -> " .. tostring(nextk) .. " (" .. res .. ")");
	script.apple('delay 0.3');
	-- close the menu so the controls can hide again
	tab_js("(function(){var b=document.querySelector('#atvwebplayersdk-subtitles-menu button[aria-label=\"Close\"]');if(b)b.click();})()");
	script.apple('delay 0.3');
	if tab_js(exists_js("#atvwebplayersdk-settings-menu")) == "1" then
		tab_js(click_js("atvwebplayersdk-settings-button"));
	end
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
