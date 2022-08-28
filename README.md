# Plex Intro Editor

Plex does not let users modify or add intro markers, relying solely on their own audio detection process. This project aims to make it easier to view/edit/add/delete individual intro markers, as well as apply bulk add/edit/delete operations to a season or an entire show. It can also be used to add multiple intro markers, for example to skip credits or a "previously on XYZ" section (as seen in the image below).

![image](https://user-images.githubusercontent.com/7410989/182755772-5aabbfe9-4c25-486c-8798-d7ed09337edb.png)


**NOTE**: While this project has been proven to work for my own individual use cases, it interacts with your Plex database in an unsupported way, and offers no guarantees against breaking your database, neither now or in the future. **_Use at your own risk_**.

## Installation

For detailed instructions, see [Prerequisites and Downloading the Project](https://github.com/danrahn/PlexIntroEditor/wiki/installation).

If running Windows, download the latest [release](https://github.com/danrahn/PlexIntroEditor/releases), extract the contents to a new folder, and double click PlexIntroEditor.exe.

In Docker:

```bash
docker run -p 3233:3232 \
           -v /path/to/config:/Data \
           -v /path/to/PlexData:/PlexDataDirectory \
           -it danrahn/plex-intro-editor:latest
```

For all other platforms (or to run from source):

1. Install [Node.js](https://nodejs.org/en/)
2. [`git clone`](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository) this repository or [Download it as a ZIP](https://github.com/danrahn/PlexIntroEditor/archive/refs/heads/main.zip)
3. Install dependencies by running `npm install` from the root of the project

## Configuration

See [Configuring Plex Intro Editor](https://github.com/danrahn/PlexIntroEditor/wiki/configuration) for details on the various settings within `config.json`.

## Using the Application

For full usage instruction, see [Using Plex Intro Editor](https://github.com/danrahn/PlexIntroEditor/wiki/usage).

0. Back up your Plex database
1. Run `node app.js` from the root of the project
