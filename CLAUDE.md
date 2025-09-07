# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js-based TCL TV remote control application that communicates with TCL smart TVs over the local network. The project is based on a fork of [node-tcl-remote](https://github.com/NickCis/node-tcl-remote/tree/master) and implements a keyboard-to-remote-control interface.

## Architecture

### Core Components

- **index.js**: Main application entry point containing the interactive keyboard interface and TCL TV remote control logic
- **tcl-remote.cjs.development.js**: Core TCL remote control library (copied from node-tcl-remote) containing `Finder` and `Remote` classes
- **keylist_from_extracting_magiconnect.txt**: Reference list of available TCL remote keys extracted from the MagiConnect app

### Communication Protocol

The application uses two communication methods:
1. **UPnP Discovery**: TV discovery via UPnP/SSDP on port 1900 using XML descriptor at `http://TV_IP:49152/tvrenderdesc.xml`
2. **Direct TCP Communication**: Key commands sent as XML payloads to TV on port 4123

Key command format:
```xml
<?xml version="1.0" encoding="utf-8"?>
<root>
  <action name="setKey" eventAction="TR_DOWN" keyCode="TR_KEY_POWER" />
</root>
```

### Key Mapping System

The application maps keyboard inputs to TCL remote keys:
- Number keys (0-9) → `TR_KEY_0` to `TR_KEY_9`
- Arrow keys → `TR_KEY_UP`, `TR_KEY_DOWN`, `TR_KEY_LEFT`, `TR_KEY_RIGHT` 
- Enter → `TR_KEY_OK`
- +/- → Volume up/down
- m → Mute
- s → Smart TV menu
- x → Power (and debug key testing)

## Running the Application

### Main Application
```bash
node index.js
```

This starts an interactive keyboard interface for controlling the TV. The application will:
1. Auto-discover TCL TVs on the network using UPnP
2. Accept keyboard input and translate to remote commands
3. Send commands directly to the TV via TCP

### Utility Scripts

**Send individual commands:**
```bash
./send.sh TR_KEY_POWER                    # Send power key
./send.sh TR_KEY_VOL_UP 192.168.1.100     # Send to specific IP
```

**Automated HDMI switching:**
```bash
./hdmi1.sh  # Navigate to HDMI input via Smart TV menu
```

## Development Notes

### TV Discovery Process

The `Finder` class handles UPnP/SSDP discovery:
1. Broadcasts SSDP M-SEARCH on multicast 239.255.255.250:1900
2. Parses UPnP responses for TCL device descriptors
3. Returns TV URL for `Remote` class initialization

### Key Command Protocol

All remote commands follow the TR_KEY_* naming convention. Commands are sent as XML over raw TCP socket to port 4123. The TV responds with XML confirmation or error messages.

### Hardware Specs

The `specs/` directory contains UPnP service descriptors for specific TV models:
- **M6586_LA/**: Contains XML specs for TV model M6586_LA
  - `avt.xml`: AV Transport service
  - `cmr.xml`: Connection Manager service  
  - `rcr.xml`: Rendering Control service
  - `tcltv-announced.xml`: Device announcement descriptor

### Key Testing and Discovery

The 'x' key in the main application triggers a test mode that cycles through various TR_KEY_* commands to test TV responsiveness. Many keys are context-dependent (only work in specific TV modes/apps).

## Network Configuration

Default TV discovery assumes local network 192.168.100.x. The application auto-discovers but can be hardcoded by setting the `tv` variable in `main()` function of index.js.