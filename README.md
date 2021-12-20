**NOTE**: This is project is still _very much_ a work in progress, and even when completed offers no guarantees against breaking your Plex database. **_Use at your own risk_**.

---

# Plex Intro Editor

Plex does not let users modify or add intro markers, relying solely on their own audio detection process. This project aims to make it easier to view/edit/add/delete intro markers for episodes.

## Usage

1. `node app.js`
2. navigate to `http://localhost:3232` in your browser

## Remarks

This project will interact directly with your Plex database. Viewing existing markers should be harmless, but manually adding/editing/removing markers is completely unsupported by Plex, and may break your database, especially if Plex ever changes the internals of how intro markers work.