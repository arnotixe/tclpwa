# TCL tv thing

#

node index.js

+/-/m volume
arrows/enter/esc/bksp navigation
s menu - go to top to get channel list
HDMI2 mac
HDMI3 chromecast
x power

## investigation

[ ] improvements: could store last found TV. Or fix in DNS

grabbed keys from the app called magiconnect (ad app with remote control functionality)

copied out fork of https://github.com/NickCis/node-tcl-remote/tree/master and ran sniffer

saw result
http://192.168.100.55:49152/tvrenderdesc.xml

grabbed that link, manufacturer says TCL, along with other interesting info:

```xml
<serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
…
<SCPDURL>/rcr.xml</SCPDURL>
<controlURL>/rcr_control</controlURL>
<eventSubURL>/rcr_event</eventSubURL>
…
<SCPDURL>/cmr.xml</SCPDURL>
<controlURL>/cmr_control</controlURL>
<eventSubURL>/cmr_event</eventSubURL>
…
<SCPDURL>/avt.xml</SCPDURL>
<controlURL>/avt_control</controlURL>
<eventSubURL>/avt_event</eventSubURL>
```

## Interesting reading

https://wiki.osdev.org/Universal_Plug-n-Play
get the SCPDURL (see cmr.xml) for device info. All of the methods that can be invoked on the service, along with the IN and OUT parameters to each method.

… a "control" URL that is used to send SOAP messages to control the service

from google search

```
POST /upnp/control/AVTransport HTTP/1.1
Host: 192.168.0.10:52323
Connection: keep-alive
Content-Length: 442
Cache-Control: no-cache
Origin: chrome-extension://fhbjgbiflinjbdggehcddcbncdddomop
Content-Type: text/xml;charset="UTF-8"
Soapaction: "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"
User-Agent: Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.116 Safari/537.36
Postman-Token: a8169b28-fb09-7029-60a9-b7e2641dc1d6
Accept: _/_
Accept-Encoding: gzip, deflate
Accept-Language: de-DE,de;q=0.8,en-US;q=0.6,en;q=0.4

<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
<s:Body>
<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
<InstanceID>0</InstanceID>
<CurrentURI>http://192.168.0.102:80/music.php?f=geradeaus</CurrentURI>
<CurrentURIMetaData></CurrentURIMetaData>
</u:SetAVTransportURI>
</s:Body>
</s:Envelope>
```

# Webapp

Claude was kind enough to build a version for us.

## Docker

docker stop tvctl
docker rm tvctl
docker build -t tvctl .
docker run -d --net=host --restart unless-stopped --name tvctl \
 -v /home/arno/jobb/opensource/tvctl/cert.pem:/app/cert.pem:ro \
 -v /home/arno/jobb/opensource/tvctl/key.pem:/app/key.pem:ro \
 tvctl
docker start tvctl

visit http://192.168.1.130:8765/ to run it,
visit https://192.168.1.130:8766/ to allow for PWA installation (see settings page)

### can after that start/stop with

docker start tvctl
docker stop tvctl

### chromecast investigation

{"domain": "media_player",
"services":
{
"clear_playlist": {"description": "Send the media player the command to clear players playlist.", "fields": {"entity_id": {"description": "Name(s) of entities to change source on.", "example": "media_player.living_room_chromecast"}}},
"media_next_track": {"description": "Send the media player the command for next track.", "fields": {"entity_id": {"description": "Name(s) of entities to send next track command to.", "example": "media_player.living_room_sonos"}}},
"media_pause": {"description": "Send the media player the command for pause.", "fields": {"entity_id": {"description": "Name(s) of entities to pause on.", "example": "media_player.living_room_sonos"}}},
"media_play": {"description": "Send the media player the command for play.", "fields": {"entity_id": {"description": "Name(s) of entities to play on.", "example": "media_player.living_room_sonos"}}},
"media_play_pause": {"description": "Toggle media player play/pause state.", "fields": {"entity_id": {"description": "Name(s) of entities to toggle play/pause state on.", "example": "media_player.living_room_sonos"}}},
"media_previous_track": {"description": "Send the media player the command for previous track.", "fields": {"entity_id": {"description": "Name(s) of entities to send previous track command to.", "example": "media_player.living_room_sonos"}}},
"media_seek": {"description": "Send the media player the command to seek in current playing media.", "fields": {"entity_id": {"description": "Name(s) of entities to seek media on.", "example": "media_player.living_room_chromecast"}, "seek_position": {"description": "Position to seek to. The format is platform dependent.", "example": 100}}},
"media_stop": {"description": "Send the media player the stop command.", "fields": {"entity_id": {"description": "Name(s) of entities to stop on.", "example": "media_player.living_room_sonos"}}},
"play_media": {"description": "Send the media player the command for playing media.", "fields": {"entity_id": {"description": "Name(s) of entities to seek media on", "example": "media_player.living_room_chromecast"}, "media_content_id": {"description": "The ID of the content to play. Platform dependent.", "example": "https://home-assistant.io/images/cast/splash.png"}, "media_content_type": {"description": "The type of the content to play. Must be one of image, music, tvshow, video, episode, channel or playlist", "example": "music"}}},
"select_sound_mode": {"description": "Send the media player the command to change sound mode.", "fields": {"entity_id": {"description": "Name(s) of entities to change sound mode on.", "example": "media_player.marantz"}, "sound_mode": {"description": "Name of the sound mode to switch to.", "example": "Music"}}},
"select_source": {"description": "Send the media player the command to change input source.", "fields": {"entity_id": {"description": "Name(s) of entities to change source on.", "example": "media_player.txnr535_0009b0d81f82"}, "source": {"description": "Name of the source to switch to. Platform dependent.", "example": "video1"}}},
"shuffle_set": {"description": "Set shuffling state.", "fields": {"entity_id": {"description": "Name(s) of entities to set.", "example": "media_player.spotify"}, "shuffle": {"description": "True/false for enabling/disabling shuffle.", "example": true}}},
"toggle": {"description": "Toggles a media player power state.", "fields": {"entity_id": {"description": "Name(s) of entities to toggle.", "example": "media_player.living_room_chromecast"}}},
"turn_off": {"description": "Turn a media player power off.", "fields": {"entity_id": {"description": "Name(s) of entities to turn off.", "example": "media_player.living_room_chromecast"}}},
"turn_on": {"description": "Turn a media player power on.", "fields": {"entity_id": {"description": "Name(s) of entities to turn on.", "example": "media_player.living_room_chromecast"}}},
"volume_down": {"description": "Turn a media player volume down.", "fields": {"entity_id": {"description": "Name(s) of entities to turn volume down on.", "example": "media_player.living_room_sonos"}}},
"volume_mute": {"description": "Mute a media player's volume.", "fields": {"entity_id": {"description": "Name(s) of entities to mute.", "example": "media_player.living_room_sonos"}, "is_volume_muted": {"description": "True/false for mute/unmute.", "example": true}}},
"volume_set": {"description": "Set a media player's volume level.", "fields": {"entity_id": {"description": "Name(s) of entities to set volume level on.", "example": "media_player.living_room_sonos"}, "volume_level": {"description": "Volume level to set as float.", "example": 0.6}}},
"volume_up": {"description": "Turn a media player volume up.", "fields": {"entity_id": {"description": "Name(s) of entities to turn volume up on.", "example": "media_player.living_room_sonos"}}}}},

### google cast SDK supportedMediaCommands

In the context of the Google Cast SDK, supported media commands are typically represented by a bitwise integer. The value 4303 represents a specific, commonly used combination of supported actions, often referred to as ALL_BASIC_MEDIA plus additional functionality, typically encompassing the following:
1 (PAUSE): Pause the media playback.
2 (SEEK): Seek to a specific time position.
4 (STREAM_VOLUME): Change the stream volume.
8 (STREAM_MUTE): Mute the stream.
64 (QUEUE_NEXT): Skip to the next item in the queue.
128 (QUEUE_PREV): Skip to the previous item in the queue.
512 (SKIP_AD): Skip ads.
4096 (EDIT_TRACKS): Edit media tracks (subtitles, etc.).
These combined values enable a rich set of transport controls on the sender app (iOS/Android) and the receiver.
Overview of Media Command Codes
The Chromecast uses bitwise flags to determine which UI controls (play, pause, seek, etc.) to enable on the controller app.
1 - Pause
2 - Seek
4 - Stream Volume
8 - Stream Mute
16 - Skip Forward
32 - Skip Backward
64 - Queue Next
128 - Queue Prev
256 - Queue Shuffle
512 - Skip Ad
1024 - Queue Repeat All
2048 - Queue Repeat One
4096 - Edit Tracks
8192 - Playback Rate
16384 - Like
32768 - Dislike
65536 - Follow
131072 - Unfollow

### cert

sudo apt install -y mkcert  
 mkcert -install  
 cd ~/tvctl  
 mkcert -cert-file cert.pem -key-file key.pem 192.168.1.130 localhost

Then restart npm run dev and open https://192.168.1.130:8766 — it should show a green  
 lock and offer PWA install.

For your phone, copy the root CA to it:
ls ~/.local/share/mkcert/rootCA.pem
Transfer that file to your phone and install it under Settings > Security > Encryption
& credentials > Install a certificate > CA certificate.
