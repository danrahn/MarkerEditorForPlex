**NOTE**: This is project is still _very much_ a work in progress, and even when completed offers no guarantees against breaking your Plex database. **_Use at your own risk_**.

---

# Plex Intro Editor

Plex does not let users modify or add intro markers, relying solely on their own audio detection process. This project aims to make it easier to view/edit/add/delete intro markers for episodes.

## Usage

### First Run Steps
1. Install [Node.js](https://nodejs.org/en/)
1. Enter your host/port/token/db path in config.json
2. `cd /path/to/app.js`
3. `npm install`

### After initial setup
0. **Back up your Plex database**
2. `node app.js`
3. Navigate to `http://localhost:3232` in your browser

## Current Status/TODO

Currently, all the core behavior works, with some caveats:

* The UI is purely meant to be good enough to make testing easy for the person who wrote it (me). It can be very unintuitive, and while it might change eventually, don't expect any miracles.
  * The initial search process is terrible. After searching for a show, you must click on the text that doesn't give any indication that it's clickable, and that same design is followed for clicking on the seasons of a show.
  * 'Delete' deletes the marker immediately. There is no confirmation dialog and it cannot be undone.
  * The way operations are canceled/committed is inconsistent. For adding a marker, the confirmation button is added to the 'Options' column, and the 'Add Marker' turns into a cancel button. For editing a marker, the 'Add Marker' turns into a confirmation button, and a cancel button is added alongside it.
  * Most errors are silent. If nothing happens when an operation is attempted, there might be an error in the browser console.
* If multiple markers are added to a single episode, there are no guarantees that the assigned `index` will match the actual order of the markers in the timeline. I haven't tested whether this is actually an issue.
* When deleting a marker, `index`es are not readjusted. E.g. if I had two markers with indexes `0` and `1`, and deleted the marker at index `0`, the marker at index `1` would stay at `1`, and if an additional marker is added, it will be assigned index `2`.
* JS files are in dire need of some code cleanup/documentation.

## Remarks

* This project will interact directly with your Plex database. Viewing existing markers should be harmless, but manually adding/editing/removing markers is completely unsupported by Plex, and may break your database, especially if Plex ever changes the internals of how intro markers work.