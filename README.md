# TubeMusic

An unofficial, open-source desktop client for YouTube Music built with Electron, featuring seamless Discord Rich Presence integration and native Windows taskbar controls.

## Features

* **Discord Rich Presence:** Automatically displays the currently playing track, artist, and elapsed time on your Discord profile. Includes background auto-reconnection logic if Discord is launched after the client.
* **Native Taskbar Controls (Thumbar):** Direct media control (Play/Pause, Previous, Next) from the Windows taskbar thumbnail.
* **Dynamic Like Synchronization:** The "Like" button in the taskbar dynamically syncs its visual state (filled/outline) by reading the YouTube Music web player DOM.

## Installation

1. Navigate to the [Releases](https://github.com/Danurchik/TubeMusic/releases) page.
2. Download the latest `TubeMusic Setup X.X.X.exe`.
3. Run the installer (available in English and Russian).

## Development

To run this project locally or build it from source, ensure you have Node.js installed.

### Setup
```bash
git clone [https://github.com/Danurchik/TubeMusic.git](https://github.com/Danurchik/TubeMusic.git)
cd TubeMusic
npm install
