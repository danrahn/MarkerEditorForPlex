# Marker Editor for Plex

Plex does not let users modify or manually add markers, relying solely on their own detection processes. This project aims to make it easier to view/edit/add/delete individual markers, as well as apply bulk add/edit/delete operations to a season or an entire show. It can also be used to add multiple markers, for example a "previously on XYZ" section (as seen in the image below).

![image](https://user-images.githubusercontent.com/7410989/182755772-5aabbfe9-4c25-486c-8798-d7ed09337edb.png)


**NOTE**: While this project has been proven to work for my own individual use cases, it interacts with your Plex database in an unsupported way, and offers no guarantees against breaking your database, neither now or in the future. **_Use at your own risk_**.

## Installation

For detailed instructions, see [Prerequisites and Downloading the Project](https://github.com/danrahn/IntroEditorForPlex/wiki/installation).

If running Windows, download the latest [release](https://github.com/danrahn/IntroEditorForPlex/releases), extract the contents to a new folder, and double click MarkerEditorForPlex.exe.

In Docker:

```bash
docker run -p 3233:3232 \
           -v /path/to/config:/Data \
           -v /path/to/PlexData:/PlexDataDirectory \
           -it danrahn/intro-editor-for-plex:latest
```

For all other platforms (or to run from source):

1. Install [Node.js](https://nodejs.org/en/)
2. [`git clone`](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository) this repository or [Download it as a ZIP](https://github.com/danrahn/IntroEditorForPlex/archive/refs/heads/main.zip)
3. Install dependencies by running `npm install` from the root of the project

## Configuration

See [Configuring Marker Editor for Plex](https://github.com/danrahn/IntroEditorForPlex/wiki/configuration) for details on the various settings within `config.json`.

## Using the Application

For full usage instruction, see [Using Marker Editor for Plex](https://github.com/danrahn/IntroEditorForPlex/wiki/usage).

0. (Strongly encouraged, required on some systems) Shut down PMS
1. Back up your Plex database
2. Run `node app.js` from the root of the project
