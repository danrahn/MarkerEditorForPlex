# Marker Editor for Plex

Plex does not let users modify or manually add markers, relying solely on their own detection processes. This project aims to make it easier to view/edit/add/delete individual markers, as well as apply bulk add/edit/delete operations to a season or an entire show. It can also be used to add multiple markers, for example a "previously on XYZ" section (as seen in the image below).

![Application Overview](https://user-images.githubusercontent.com/7410989/221294954-1a303cd1-48de-4b5e-9230-4aa735678d68.png)



**NOTE**: While this project has been proven to work for my own individual use cases, it interacts with your Plex database in an unsupported way, and offers no guarantees against breaking your database, neither now or in the future. **_Use at your own risk_**.

## Installation

For detailed instructions, see [Prerequisites and Downloading the Project](https://github.com/danrahn/MarkerEditorForPlex/wiki/installation).

If available, download the latest [release](https://github.com/danrahn/MarkerEditorForPlex/releases) that matches your system, extract the contents to a new folder, and run MarkerEditorForPlex.

In Docker:

```bash
docker run -p 3233:3232 \
           -v /path/to/config:/Data \
           -v /path/to/PlexData:/PlexDataDirectory \
           -it danrahn/intro-editor-for-plex:latest
```

For platforms that don't have a binary release available (or to run from source):

1. Install [Node.js](https://nodejs.org/en/)
2. [`git clone`](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository) this repository or [Download it as a ZIP](https://github.com/danrahn/MarkerEditorForPlex/archive/refs/heads/main.zip)
3. Install dependencies by running `npm install` from the root of the project
4. Run `node app.js` from the root of the project

## Configuration

See [Configuring Marker Editor for Plex](https://github.com/danrahn/MarkerEditorForPlex/wiki/configuration) for details on the various settings within `config.json`.

## Using Marker Editor

Before using Marker Editor, it's _strongly_ encouraged to shut down PMS. On some systems, this is required. It's also strongly encouraged to make sure you have a recent database backup available in case something goes wrong. While core functionality been tested fairly extensively, there are no guarantees that something won't go wrong, or that an update to PMS will break this applications.

For more information on how to use Marker Editor, see [Using Marker Editor for Plex](https://github.com/danrahn/MarkerEditorForPlex/wiki/usage).

## Notes

Due to how Plex generates and stores markers, reanalyzing items in Plex (potentially indirectly by adding a new episode to an existing season) will result in any marker customizations being wiped out and set back to values based on Plex's analyzed data. This application has [a system to detect and restore manual edits](https://github.com/danrahn/MarkerEditorForPlex/wiki/usage#purged-markers), but it's not an automated process.
