**NOTE**: This is project is still _very much_ a work in progress, and even when completed offers no guarantees against breaking your Plex database. **_Use at your own risk_**.

---

# Plex Intro Editor

Plex does not let users modify or add intro markers, relying solely on their own audio detection process. This project aims to make it easier to view/edit/add/delete intro markers for episodes.

Some clients also support multiple intros, despite Plex not generating multiple markers themselves (web, desktop, and AndroidTV apps tested), so this project can also be used to add credit skips to episodes.

## Known Issues

It appears that after adding a new episode to a season and Plex's intro detection runs again, it will wipe out any existing markers. Work is planned to address this in as smooth of a way as possible.

## Usage

### First Run Steps
1. Install [Node.js](https://nodejs.org/en/). This may take awhile.
2. `git clone` this repository or [Download it as a ZIP](https://github.com/danrahn/PlexIntroEditor/archive/refs/heads/main.zip)
3. Enter your db path in config.json
4. `cd /path/to/app.js`
5. `npm install`

### After initial setup
0. **Back up your Plex database**
1. `node app.js`

## Configuration file

### Main Settings
| Key | Description | Possible Values
---|---|---
`database` | Full path to the Plex database. | A valid file path. Note that backslashes in Windows paths will have to be escaped (`"C:\\path\\to\\database.db"`)
`host`     | The hostname Node will listen on. Defaults to `localhost`, but could be changed to a local IP (e.g. `192.168.1.2`) if you want to modify markers on a different device on your local network. | A valid IP/hostname
`port`     | The port the server will listen on. Defaults to `3232` | A valid port number.
`logLevel` | Determines the initial logging verbosity in the console (which can be overridden by the client). Can be prefixed with `Dark` to use dark-themed colors. | `"(Dark)?(TMI\|Verbose\|Info\|Warn\|Error)"`
`features` | A dictionary of toggleable features for the application | [Feature Settings](#feature-settings)

### Feature Settings

Settings inside the `features` dictionary:

| Key | Description | Possible Values
---|---|---
`autoOpen` | Whether to automatically open the server in the browser on launch. | `true` or `false`
`extendedMarkerStats` | Whether to gather all markers in the database to compile per library/show/season marker data. Potentially compute and memory expensive for very large libraries, as it keeps a record for every episode/marker in the database. | `true` or `false`
`previewThumbnails` | Controls preview thumbnail retrieval | [Preview Thumbnails Settings](#preview-thumbnails-settings)

#### Preview Thumbnails Settings

Settings inside the `previewThumbnails` dictionary:
| Key | Description | Possible Values
---|---|---
`enabled` | Determines whether the app should attempt to retrieve preview thumbnails associated with marker timestamps | `true` or `false`
`metadataPath` | Root path to Plex's [data directory](https://support.plex.tv/articles/202915258-where-is-the-plex-media-server-data-directory-located/) | A full path (e.g. `C:\\Users\\username\\AppData\\Local\\Plex Media Server`). Only required if `enabled` is `true`.


## Remarks

* This project will interact directly with your Plex database. Viewing existing markers should be harmless, but manually adding/editing/removing markers is completely unsupported by Plex, and may break your database, especially if Plex ever changes the internals of how intro markers work.