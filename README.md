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
3. Navigate to `http://localhost:3232` in your browser

## Current Status/TODO

Currently, all the core behavior works, with some caveats:

* The UI is far from perfect. It does the job, but isn't polished.
* JS files are in dire need of some code cleanup/documentation.

## Remarks

* This project will interact directly with your Plex database. Viewing existing markers should be harmless, but manually adding/editing/removing markers is completely unsupported by Plex, and may break your database, especially if Plex ever changes the internals of how intro markers work.