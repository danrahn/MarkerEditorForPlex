# Building the Marker Editor Package

> **NOTE**: Building isn't necessary outside of preparing packages for release. Consumers should only need to download the latest pre-built [release](https://github.com/danrahn/MarkerEditorForPlex/releases), and even if a binary isn't available for a specific platform, the ["From Source"](https://github.com/danrahn/MarkerEditorForPlex/releases) instructions should allow this program to run without any manual building.

The build process uses [nexe](https://github.com/nexe/nexe) to create binaries for various platforms. The simplest way to start a build is to run

```bash
npm run build
```

Which will attempt to create a package based on the current system architecture and latest LTS version of Node.js. Other options are outlined below.

## Usage

```
npm run build [arch] [pack] [version [VERSION]] [verbose]

    arch               The architecture to build for. Defaults to system architecture.
                       Valid options are
                         Intel 64-bit: x64, amd64, x86_64
                         Intel 32-bit: x86, ia32 (only tested on Windows)
                         ARM 64-bit:   arm64, aarch64

    pack               Create a zip/tgz of the required files for distribution.

    version [VERSION]  Override the baseline version of Node.js to build. Defaults to
                       latest LTS version.
    
    verbose            Print more verbose output during the build process.
```

## Cross-Compiling

Cross-compiling (e.g. building an ARM64 package from an AMD64 machine) is possible, but does require some manual setup. Because this project relies on native modules (sqlite3), those modules must also target the correct architecture, in addition to building the node binary itself that target. To get around this, the compiled `*.node` file should be placed in an `archCache` directory inside of `dist`, following the structure, `dist/archCache/{module}-{version}-{arch}/node_{module}.node`, e.g. `dist/archCache/sqlite3-5.1.7-arm64/node_sqlite3.node`. There are several ways to potentially obtain the right `*.node` files:

1. Pre-built binaries from the module maintainer.
2. Install the module on a system running the target architecture, and copying the binary to your build system.
3. Explicitly install the "wrong" version on the current system, and copy that output to the `archCache` folder.

It's likely possible to make things work without this manual setup by reinstalling sqlite3 using different `--target_arch` flags and `--build-from-source`, and copying that build output, but the above process is good enough for me, so probably won't change any time soon.