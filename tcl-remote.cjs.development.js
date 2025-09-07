// copied fram tcl-remote (https://github.com/NickCis/node-tcl-remote/tree/master)
"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

function _interopDefault(ex) {
  return ex && typeof ex === "object" && "default" in ex ? ex["default"] : ex;
}

var dgram = _interopDefault(require("dgram"));
var events = require("events");
var http = _interopDefault(require("http"));
var net = _interopDefault(require("net"));

function _inheritsLoose(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype);
  subClass.prototype.constructor = subClass;
  subClass.__proto__ = superClass;
}

var Deferred = /*#__PURE__*/ (function () {
  function Deferred() {
    var _this = this;

    this.promise = new Promise(function (rs, rj) {
      _this.rs = rs;
      _this.rj = rj;
      if (_this.v) rs(_this.v);
      if (_this.e) rj(_this.e);
    });
  }

  var _proto = Deferred.prototype;

  _proto.resolve = function resolve(data) {
    if (this.rs) this.rs(data);
    else this.v = data;
  };

  _proto.reject = function reject(err) {
    if (this.rj) this.rj(err);
    else this.e = err;
  };

  return Deferred;
})();

var Ssdp = {
  ip: "239.255.255.250",
  port: 1900,
  delimiter: "\r\n",
};
var LocationRegexp = /^Location: ?(.*)$/i;

var Finder = /*#__PURE__*/ (function (_EventEmitter) {
  _inheritsLoose(Finder, _EventEmitter);

  function Finder() {
    return _EventEmitter.apply(this, arguments) || this;
  }

  var _proto = Finder.prototype;

  _proto.init = function init() {
    var _this = this;

    if (!this.ready) {
      this.ready = new Promise(function (rs, rj) {
        try {
          var socket = (_this.socket = dgram.createSocket({
            type: "udp4",
            reuseAddr: true,
          }));
          socket.on("message", function (msg) {
            return _this.handleMessage(msg);
          });
          socket.bind(Ssdp.port, function () {
            console.log("socket bound");
            socket.addMembership(Ssdp.ip);
            socket.setMulticastTTL(4);
            rs(_this);
          });
        } catch (error) {
          rj(error);
        }
      });
    }

    return this.ready;
  };

  _proto.getFinder = function getFinder() {
    if (!this.finder) this.finder = new Deferred();
    return this.finder;
  };

  _proto.find = function find() {
    try {
      var _this3 = this;

      return Promise.resolve(_this3.init()).then(function () {
        var finder = _this3.getFinder(); // const message = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST:239.255.255.250:1900\r\nST:upnp:rootdevice\r\nMAN:ssdp:discover\r\nMX:2\r\n\r\n', 'utf-8');

        const payload = [
          "M-SEARCH * HTTP/1.1",
          "HOST: " + Ssdp.ip + ":" + Ssdp.port,
          'MAN: "ssdp:discover"',
          "MX: 2",
          "ST: upnp:rootdevice",
          Ssdp.delimiter,
        ];
        var message = Buffer.from(payload.join(Ssdp.delimiter), "ascii");

        console.log("send discovery message", payload);
        _this3.socket.send(message, Ssdp.port, Ssdp.ip);

        return finder.promise;
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };

  _proto.close = function close() {
    var _this4 = this;

    var finder = this.getFinder();
    finder.reject(new Error("Finder being closed"));
    return new Promise(function (rs, rj) {
      if (!_this4.socket) {
        rj();
        return;
      }

      _this4.socket.close(rs);
    });
  };

  _proto.handleMessage = function handleMessage(msg) {
    var text = msg.toString();
    // console.log("incomingMessage", text);

    var _text$split = text.split(Ssdp.delimiter),
      rest = _text$split.slice(1);

    var location;

    for (
      var _iterator = rest,
        _isArray = Array.isArray(_iterator),
        _i = 0,
        _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();
      ;

    ) {
      var _ref;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref = _i.value;
      }

      var str = _ref;
      var match = str.match(LocationRegexp);
      if (match) {
        // console.log("match", typeof match, match, "incomingMessage", text);

        console.log("match[1]", match[1]);
        location = match[1];
        break;
      }
    }

    if (!location) {
      return;
    }
    if (location.endsWith("/tvrenderdesc.xml")) {
      console.log("FOUND tvrenderdesc.xml", location);
      var finder = this.getFinder();
      this.emit("found", location);
      finder.resolve(location);
      return;
    }
    if (!location.endsWith("/mstar")) {
      // console.log("no mstar", location);
      return;
    }
    var finder = this.getFinder();
    this.emit("found", location);
    finder.resolve(location);
  };

  return Finder;
})(events.EventEmitter);

var Props = {
  friendlyName: /<friendlyName>([^<]+)<\/friendlyName>/i,
  manufacturer: /<manufacturer>([^<]+)<\/manufacturer>/i,
  modelName: /<modelName>([^<]+)<\/modelName>/i,
};

var Device = /*#__PURE__*/ (function () {
  function Device(location) {
    this.location = location;
  }

  var _proto = Device.prototype;

  _proto.fetch = function fetch() {
    try {
      var _this2 = this;

      if (!_this2.fetching) {
        _this2.fetching = new Promise(function (rs, rj) {
          http.get(_this2.location, function (res) {
            var statusCode = res.statusCode;

            if (statusCode !== 200) {
              res.resume();
              rj(new Error("Failed to get location: " + _this2.location));
              return;
            }

            res.setEncoding("utf-8");
            var data = "";
            res.on("data", function (chunk) {
              data += chunk;
            });
            res.on("end", function () {
              var props = {
                location: _this2.location,
              };

              for (
                var _i = 0, _Object$entries = Object.entries(Props);
                _i < _Object$entries.length;
                _i++
              ) {
                var _Object$entries$_i = _Object$entries[_i],
                  key = _Object$entries$_i[0],
                  regexp = _Object$entries$_i[1];
                var match = data.match(regexp);
                if (match) props[key] = match[1];
              }

              rs(props);
            });
          });
        });
      }

      return Promise.resolve(_this2.fetching);
    } catch (e) {
      return Promise.reject(e);
    }
  };

  return Device;
})();

var Keys;

(function (Keys) {
  Keys["Red"] = "TR_KEY_RED";
  Keys["Green"] = "TR_KEY_GREEN";
  Keys["Yellow"] = "TR_KEY_YELLOW";
  Keys["Blue"] = "TR_KEY_BLUE";
  Keys["Input"] = "TR_KEY_INPUT";
  Keys["Tuner"] = "TR_KEY_TUNER";
  Keys["VolumeUp"] = "TR_KEY_VOL_UP";
  Keys["ChannelUp"] = "TR_KEY_CH_UP";
  Keys["Mute"] = "TR_KEY_MUTE";
  Keys["VolumeDown"] = "TR_KEY_VOL_DOWN";
  Keys["ChannelDown"] = "TR_KEY_CH_DOWN";
  Keys["ChannelList"] = "TR_KEY_LIST";
  Keys["SmartTV"] = "TR_KEY_SMARTTV";
  Keys["Guide"] = "TR_KEY_GUIDE";
  Keys["MainMenu"] = "TR_KEY_MAINMENU";
  Keys["Up"] = "TR_KEY_UP";
  Keys["InfoWindow"] = "TR_KEY_INFOWINDOW";
  Keys["Left"] = "TR_KEY_LEFT";
  Keys["Ok"] = "TR_KEY_OK";
  Keys["Right"] = "TR_KEY_RIGHT";
  Keys["Back"] = "TR_KEY_BACK";
  Keys["Down"] = "TR_KEY_DOWN";
  Keys["Exit"] = "TR_KEY_EXIT";
  Keys["One"] = "TR_KEY_1";
  Keys["Two"] = "TR_KEY_2";
  Keys["Three"] = "TR_KEY_3";
  Keys["Four"] = "TR_KEY_4";
  Keys["Five"] = "TR_KEY_5";
  Keys["Six"] = "TR_KEY_6";
  Keys["Seven"] = "TR_KEY_7";
  Keys["Eight"] = "TR_KEY_8";
  Keys["Nine"] = "TR_KEY_9";
  Keys["Zero"] = "TR_KEY_0";
  Keys["Favorite"] = "TR_KEY_FAVORITE";
  Keys["Youtube"] = "TR_KEY_YOUTUBE";
  Keys["Netflix"] = "TR_KEY_APP";
  Keys["AT"] = "TR_KEY_AT";
  Keys["App"] = "TR_KEY_APP";
  Keys["Picture"] = "TR_KEY_PICTURE";
  Keys["Sound"] = "TR_KEY_SOUND";
  Keys["Mts"] = "TR_KEY_MTS";
  Keys["CC"] = "TR_KEY_CC";
  Keys["Usb"] = "TR_KEY_USB";
  Keys["Option"] = "TR_KEY_OPTION";
  Keys["Sleep"] = "TR_KEY_SLEEP";
  Keys["ThreeD"] = "TR_KEY_3D";
  Keys["Rew"] = "TR_KEY_REW";
  Keys["PlayPause"] = "TR_KEY_PLAYPAUSE";
  Keys["FF"] = "TR_KEY_FF";
  Keys["Previous"] = "TR_KEY_PREVIOUS";
  Keys["Suspend"] = "TR_KEY_SUSPEND";
  Keys["Next"] = "TR_KEY_NEXT";
  Keys["Aircable"] = "TR_KEY_AIRCABLE";
  Keys["Home"] = "TR_KEY_HOME";
  Keys["Search"] = "TR_KEY_SEARCH";
  Keys["I"] = "TR_KEY_I";
  Keys["REC"] = "TR_KEY_REC";
  Keys["TV"] = "TR_KEY_TV";
  Keys["Amazon"] = "TR_KEY_AMAZON";
  Keys["Vudu"] = "TR_KEY_VUDU";
  Keys["MGO"] = "TR_KEY_MGO";
  Keys["ZoomDown"] = "TR_KEY_ZOOM_DOWN";
  Keys["ZoomUp"] = "TR_KEY_ZOOM_UP";
  Keys["SleepDown"] = "TR_KEY_SLEEP_DOWN";
  Keys["SleepUp"] = "TR_KEY_SLEEP_UP";
  Keys["Media"] = "TR_KEY_MEDIA";
  Keys["Source"] = "TR_KEY_SOURCE";
  Keys["TextTV"] = "TR_KEY_TEXT";
  Keys["Play"] = "TR_KEY_PLAY";
  Keys["Pause"] = "TR_KEY_PAUSE";
  Keys["Format"] = "TR_KEY_FORMAT";
  Keys["Scale"] = "TR_KEY_SCALE";
  Keys["PreviousChannel"] = "TR_KEY_PRE_CH";
  Keys["Freeze"] = "TR_KEY_FREEZE";
  Keys["EPG"] = "TR_KEY_EPG";
  Keys["Subtitle"] = "TR_KEY_SUBTITLE";
  Keys["Display"] = "TR_KEY_DISPLAY";
  Keys["Language"] = "TR_KEY_LANG";
  Keys["Appstore"] = "TR_KEY_APPSTORE";
  Keys["All"] = "TR_KEY_ALLAPP";
  Keys["EnergySaving"] = "TR_KEY_ECO";
  Keys["Power"] = "TR_KEY_POWER";
})(Keys || (Keys = {}));

var Remote = /*#__PURE__*/ (function () {
  function Remote(host, port) {
    this.port = 4123;
    this.host = host;
    if (port) this.port = port;
  }

  var _proto = Remote.prototype;

  _proto.init = function init() {
    var _this = this;

    if (!this.ready) {
      this.ready = new Promise(function (rs, rj) {
        try {
          _this.socket = net.createConnection(
            _this.port,
            _this.host,
            function () {
              _this.interval = setInterval(function () {
                return _this.ping();
              }, 30000);
              rs(_this);
            }
          );
        } catch (error) {
          rj(error);
        }
      });
    }

    return this.ready;
  };

  _proto.write = function write(data) {
    try {
      var _this3 = this;

      return Promise.resolve(_this3.init()).then(function () {
        return new Promise(function (resolve) {
          _this3.socket.write(data, "utf8", function () {
            resolve();
          });
        });
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };

  _proto.ping = function ping() {
    try {
      var _this5 = this;

      return Promise.resolve(_this5.write("noop"));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  _proto.send = function send(code) {
    var data =
      '<?xml version="1.0" encoding="utf-8"?><root><action name="setKey" eventAction="TR_DOWN" keyCode="' +
      code +
      '" /></root>';
    return this.write(data);
  };

  _proto.press = function press(key) {
    console.log("SEND", key);
    return this.send(key);
  };

  _proto.close = function close() {
    if (this.interval) clearInterval(this.interval);
    if (this.socket) this.socket.destroy();
  };

  return Remote;
})();

exports.Device = Device;
exports.Finder = Finder;
exports.Remote = Remote;
//# sourceMappingURL=tcl-remote.cjs.development.js.map
