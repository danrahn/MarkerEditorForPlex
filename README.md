**NOTE**: This is project is still _very much_ a work in progress, and even when completed offers no guarantees against breaking your Plex database. **_Use at your own risk_**.

---

# Plex Intro Editor

Plex does not let users modify or add intro markers, relying solely on their own audio detection process. This project aims to make it easier to view/edit/add/delete intro markers for episodes.

Some clients also support multiple intros, despite Plex not generating multiple markers themselves (web and desktop apps tested), so this project can also be used to add credit skips to episodes.

## Usage

### First Run Steps
1. Install [Node.js](https://nodejs.org/en/). This may take awhile.
2. `git clone` this repository or [Download it as a ZIP](https://github.com/danrahn/PlexIntroEditor/archive/refs/heads/main.zip)
3. Enter your db path in config.json
4. `cd /path/to/app.js`
5. `npm install`

### After initial setup
0. **Back up your Plex database**
2. `node app.js`

## Configuration file
| Key | Description | Possible Values
---|---|---
`database` | Full path to the Plex database. | A valid file path. Note that backslashes in Windows paths will have to be escaped (`"C:\\path\\to\\database.db"`)
`host`     | The hostname Node will listen on. Defaults to `localhost`, but could be changed to a local IP (e.g. `192.168.1.2`) if you want to modify markers on a different device on your local network. | A valid IP/hostname
`port`     | The port the server will listen on. Defaults to `3232` | A valid port number.
`autoOpen` | Whether to automatically open the server in the browser on launch. | `true` or `false`
`logLevel` | Determines logging verbosity in the console. | `"TMI"`, `"Verbose"`, `"Info"`, `"Warn"`, `"Error"`
`useThumbnails` | Determines whether the app should attempt to retrieve preview thumbnails associated with marker timestamps | `true` or `false`
`metadataPath` | Root path to Plex's [data directory](https://support.plex.tv/articles/202915258-where-is-the-plex-media-server-data-directory-located/) | A full path (e.g. `C:\\Users\\username\\AppData\\Local\\Plex Media Server`). Only required if `useThumbnails` is `true`.

## Current Status/TODO

Currently, all the core behavior works, with some caveats:

* The UI is far from perfect. It does the job, but isn't polished.
* JS files are in dire need of some code cleanup/documentation.

## Remarks

* This project will interact directly with your Plex database. Viewing existing markers should be harmless, but manually adding/editing/removing markers is completely unsupported by Plex, and may break your database, especially if Plex ever changes the internals of how intro markers work.