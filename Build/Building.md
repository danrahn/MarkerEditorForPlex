# Building the Marker Editor Package

> **NOTE**: Building isn't necessary outside of preparing packages for release. Consumers should only need to download the latest pre-built [release](https://github.com/danrahn/MarkerEditorForPlex/releases), and even if a binary isn't available for a specific platform, the ["From Source"](https://github.com/danrahn/MarkerEditorForPlex/releases) instructions should allow this program to run without any manual building.

The build process uses [@yao-pkg/pkg](https://www.npmjs.com/package/@yao-pkg/pkg) (SEA mode) to create binaries for various platforms. The simplest way to start a build is to run

```bash
npm run build
```

Which will attempt to create a package based on the current system architecture and latest LTS version of Node.js. Other options are outlined below.

## Usage

```
npm run build -- [platform] [arch] [compress] [pack] [version [VERSION]] [verbose] [debug]

    platform           Target platform. Defaults to host platform.
                       You can provide multiple values to build for multiple platforms.
                       Valid options are
                         Windows: win32, win, windows
                         Linux:   linux
                         macOS:   darwin, macos, mac, osx

    arch               The architecture to build for. Defaults to system architecture.
                       You can provide multiple values to build multiple architectures.
                       Valid options are
                         Intel 64-bit: x64, amd64, x86_64
                         Intel 32-bit: x86, ia32 (only tested on Windows)
                         ARM 64-bit:   arm64, aarch64

    pack               Create a zip/tgz of the required files for distribution.

    version [VERSION]  Override the baseline version of Node.js to build. Defaults to
                       latest LTS version.
    
    verbose            Print more verbose output during the build process.

    debug              Pass --debug through to pkg when building the executable.
```

## Packaging Notes

On Windows, icon/version resource edits are applied automatically during build using `resedit` (resedit-js).

One thing that can't be packaged directly into the binary are native packages like `better-sqlite3`. Because of that, a minimal node_modules folder is packaged alongside the main binary, containing native addons that will be loaded by the OS.

Webpack emits cache-busted browser bundles (`dist/index.<hash>.js` / `dist/login.<hash>.js`) and generated HTML (`dist/index.html` / `dist/login.html`). The pkg asset list includes these `dist/*` outputs (plus hashed CSS/SVG assets under `dist/Client/Style` and `dist/SVG`) so packaged binaries can serve them from the bundled snapshot.

Direct flag usage is also supported:

```bash
node Build/build.js [platform] [arch] [compress] [debug]
```

- `compress` enables Brotli compression for SEA content.
- `debug` passes `--debug` to pkg for executable generation.
- Cross-platform targets are supported via platform arguments.

Because the binaries aren't signed, macOS probably won't allow the binary to run out-of-the-box, so an extra script, `start.command`, is bundled. It's a first-run helper that:

1. Removes quarantine attributes from the extracted folder.
2. Applies ad-hoc signatures to `MarkerEditor` and bundled `.node` files.
3. Launches `MarkerEditor`.

All-in-one release matrix example (build + pack for win/mac/linux x64+arm64):

```bash
node Build/build.js compress win mac linux x64 arm64 pack
```

or,

```bash
npm run build-all
```

## Cross-Compiling

Cross-compiling (e.g. building an ARM64 package from an AMD64 machine) is supported, including native module sidecars used by this project (`better-sqlite3`).

When the build target differs from the host target, the build script attempts to auto-fetch matching prebuilt native modules (currently only `better_sqlite3.node`) and caches it in:

`dist/archCache/{module}-{version}-{platform}-{arch}-node{major}/{module_binary}.node`

For example:

`dist/archCache/better-sqlite3-12.10.0-win32-arm64-node24/better_sqlite3.node`

If no upstream prebuild exists for a target, manually place the compiled `*.node` file in that cache folder and rerun the build.