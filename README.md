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
