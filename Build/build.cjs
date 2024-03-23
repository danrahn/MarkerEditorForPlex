const fs = require('fs');
const { copySync } = require('fs-extra');
const { compile : exeCompile } = require('nexe');
const { homedir } = require('os');
const { resolve, join } = require('path');
const rcedit = require('rcedit');
const { rollup } = require('rollup');
const { exec } = require('child_process');
const semver = require('semver');

const ReadMeGenerator = require('./ReadMeGenerator.cjs');

/**
 * @typedef {{
 *  version: string,
 *  date: string,
 *  files: string[],
 *  lts: string|false,
 *  security: boolean,
 *  npm?: string,
 *  v8?: string,
 *  uv?: string,
 *  zlib?: string,
 *  openssl?: string,
 *  modules?: string,
 * }} NodeVersionInfo
 * */

const { version, dependencies } = require('../package.json');
const iconPath = resolve(__dirname, 'app.ico');

const appName = 'Marker Editor for Plex';
const binaryName = 'MarkerEditor';

// Can't have -beta/-rc/etc in version name for Windows FILEVERSION
const rcVersion = version.replace(/-(?:alpha|beta|rc)(?:\.\d+)?$/, '');

const rc = {
    CompanyName : appName,
    ProductName : appName,
    FileDescription : appName,
    FileVersion : rcVersion,
    ProductVersion : rcVersion,
    InternalappName : appName + 'exe',
    LegalCopyright : 'MarkerEditor.exe copyright Daniel Rahn. MIT license. node.exe copyright Node.js contributors. MIT license.'
};

const fallbackNodeVersion = '20.11.1'; // LTS as of 2024/03/07

const args = process.argv.map(a => a.toLowerCase());
const verbose = args.includes('verbose');

/**
 * Uses rollup to transpile app.js to common-js, as nexe can't consume es6 modules. */
async function transpile() {
    await rollup({
        input : resolve(__dirname, '../app.js'),
        onwarn : (warn, def) => {
            // We don't care about unresolved imports, nexe takes care of that.
            if (warn.code === 'UNRESOLVED_IMPORT') {
                return;
            }

            def(warn);
        }
    }).then((bundle) => {
        bundle.write({
            file : resolve(__dirname, '../dist/built.cjs'),
            format : 'cjs',
        });
    });
}

/**
 * Get the architecture to build for. In general uses the system architecture,
 * but Windows can be overridden to compile for a specific target based on input parameters. */
function getArch() {

    if (args.includes('x64') || args.includes('amd64') || args.includes('x86_64')) {
        return 'x64';
    }

    if (args.includes('x86') || args.includes('ia32')) {
        return 'ia32';
    }

    if (args.includes('arm64') || args.includes('aarch64')) {
        return 'arm64';
    }

    switch (process.arch) {
        case 'arm64':
        case 'ia32':
        case 'x64':
            return process.arch;
        default:
            throw new Error(`Unsupported build architecture "${process.arch}, exiting...`);
    }
}

/**
 * Takes rollup's cjs output and writes the exe. */
async function toExe() {
    let platform;
    let output = `../dist/${binaryName}`;
    switch (process.platform) {
        case 'win32':
            platform = 'windows';
            output += '.exe';
            break;
        case 'linux':
            platform = 'linux';
            break;
        case 'darwin':
            platform = 'mac';
            break;
        default:
            throw new Error(`Unsupported build platform "${process.platform}", exiting...`);
    }

    const arch = getArch();

    let nodeVersion = fallbackNodeVersion;

    // nexe doesn't appear to take into account that the currently cached build output is a different
    // target architecture. To get around that, ignore the standard 'out' folder and check for
    // architecture-specific output folders. If it doesn't exist, do a full build and rename the
    // output to an architecture-specific folder, and link that to the standard 'out' folder. This
    // relies on internal nexe behavior, but since it's dev-only, nothing user-facing should break if
    // nexe changes, this section will just have to be updated.
    const temp = process.env.NEXE_TEMP || join(homedir(), '.nexe');
    const oldOut = join(temp, nodeVersion, 'out');

    if (args.includes('version')) {
        const idx = args.indexOf('version');
        if (idx < args.length - 1) {
            nodeVersion = args[idx + 1];
        }
    } else if (args.includes('clean')) {
        const tryRm = out => {
            try {
                fs.rmSync(out, { recursive : true, force : true });
            } catch (ex) {
                console.warn(`\tUnable to clear output ${out}`);
            }
        };

        console.log('\nCleaning existing cached output');
        if (fs.existsSync(oldOut)) {
            console.log('\tClearing old output directory');
            tryRm(oldOut);
        }

        for (const cachedOut of ['arm64', 'ia32', 'x64']) {
            if (fs.existsSync(oldOut + cachedOut)) {
                console.log(`\tClearing out ${cachedOut} cache`);
                tryRm(oldOut + cachedOut);
            }
        }
    } else {
        // Find the latest LTS version
        try {
            /** @type {NodeVersionInfo[]} */
            const versions = await (await fetch('https://nodejs.org/download/release/index.json')).json();
            versions.sort((a, b) => (!!a.lts === !!b.lts) ? (semver.lt(a.version, b.version) ? 1 : -1) : (a.lts ? -1 : 1));

            nodeVersion = versions[0].version.substring(1);
            console.log(`Found latest LTS: ${nodeVersion}`);
        } catch (ex) {
            console.warn(`Unable to find latest LTS version of Node.js, falling back to ${fallbackNodeVersion}`);
        }
    }

    console.log(`Attempting to build ${platform}-${arch}-${nodeVersion}`);

    const archOut = oldOut + arch;
    const hadCache = fs.existsSync(archOut);
    if (hadCache) {
        console.log(`Found cached output for ${arch}-${nodeVersion}, using that.`);

        // Wipe out any existing out link and replace with cached out{arch} link
        if (fs.existsSync(oldOut)) {
            console.log(`Removing old link to 'out'`);
            fs.rmSync(oldOut, { recursive : true, force : true });
        }

        fs.symlinkSync(archOut, oldOut, 'junction');
    } else {
        // Always clear out the build directory if we don't have the
        // target architecture cached.
        fs.rmSync(oldOut, { recursive : true, force : true });
    }

    await exeCompile({
        input : resolve(__dirname, '../dist/built.cjs'),
        output : resolve(__dirname, output),
        build : true,
        targets : [ `${platform}-${arch}-${nodeVersion}` ],
        loglevel : verbose ? 'verbose' : 'info',
        ico : iconPath,
        rc : {
            PRODUCTVERSION : version,
            FILEVERSION : version,
            ...rc
        },
        resources : [
            resolve(__dirname, '../package.json'),
            resolve(__dirname, '../index.html'),
            resolve(__dirname, '../SVG/*svg'),
            resolve(__dirname, '../Shared/**'),
            resolve(__dirname, '../Client/**'),
            resolve(__dirname, '../dist/built.cjs'),
        ],
        patches : [
            async (compiler, next) => {
                const isWin = process.platform === 'win32';
                const bin = isWin ? '.\\\\MarkerEditor.exe' : './MarkerEditor';
                await compiler.replaceInFileAsync(
                    'src/node.cc',
                    /\bNODE_VERSION\b/,
                    `"Marker Editor: v${version}\\n` +
                     `Node.js:       " NODE_VERSION ` +
                    `"\\n\\nUse '--' to pass arguments directly to Marker Editor (e.g. ${bin} -- -v)\\n"`
                );

                await compiler.replaceInFileAsync(
                    'lib/internal/main/print_help.js',
                    /^ {4}'Usage: node/,
                    `    'NOTE: Printing Node help use \\'--\\' to pass arguments directly to Marker Editor\\n` +
                    `           e.g. ${bin} -- --help\\n\\n' +\n    'Usage: node`
                );

                return next();
            },
            async (compiler, next) => {
                if (process.platform !== 'win32') {
                    return next();
                }

                const binaryPath = compiler.getNodeExecutableLocation();
                try {
                    // RC overrides are only applied if we're doing a clean build,
                    // hack around it by using rcedit on the binary to ensure they're added.
                    if (fs.statSync(binaryPath).size > 0) {
                        await rcedit(binaryPath, {
                            'version-string' : rc,
                            'file-version' : rcVersion,
                            'product-version' : rcVersion,
                            icon : iconPath,
                        });
                    }
                } catch {
                    console.log('\nUnable to modify exe resources with rcedit. This is expected if we\'re doing a clean build');
                }

                return next();
            }
        ]
    }); // Don't catch, interrupt on failure.

    // After everything is compiled, cache the output directory if needed.
    if (!hadCache) {
        fs.renameSync(oldOut, archOut);
        fs.symlinkSync(archOut, oldOut, 'junction');
    }
}

/**
 * Write a small README to include in the package. On Windows/Mac, simply
 * direct users to the wiki. Add a bit more information about launching
 * on Linux, as it's not "double-clickable" on all variants. */
function writeReadme() {
    const recipeHeader = `~\n!\n-:-MARKER EDITOR ${version}\n!\n~\n!\n`;

    const recipeFooter = `
!\n${process.platform === 'linux' ? '' : '-:-'}For complete usage instructions,
||visit the wiki at https://github.com/danrahn/MarkerEditorForPlex/wiki\n!\n~`;

    let recipe;
    switch (process.platform) {
        default:
            console.warn(`WARN: Unknown platform '${process.platform}'. How did we get here?`);
            // __fallthrough
        case 'win32':
        case 'darwin':
            recipe = `-:-Welcome to Marker Editor for Plex!`;
            break;
        case 'linux':
            recipe = `Welcome to Marker Editor for Plex! If double-clicking MarkerEditor doesn't start
||the program, there are a couple ways to launch the editor:
!
1. Via start.sh. Depending on your system, you may have to rich-click the file and "Run as a Program",
||or choose to "Execute in Terminal."!!3
2. Open a new terminal window, navigate to the folder with MarkerEditor, and execute it from there:!!3
!
   ~ $ cd /path/to/MarkerEditorForPlex
   MarkerEditorForPlex $ ./MarkerEditor`;
            break;
    }

    fs.writeFileSync(resolve(__dirname, '../dist/README.txt'), new ReadMeGenerator(80).parse(recipeHeader + recipe + recipeFooter));
}

/**
 * On Linux, launching MarkerEditor might not be as simple as double-clicking the binary.
 * Include a simple launch script in addition to the main binary. */
function writeStartSh() {
    const startSh =
`#!/usr/bin/env bash
cd "\`dirname "$0"\`"
./MarkerEditor
`;

    fs.writeFileSync(resolve(__dirname, '../dist/start.sh'), startSh, { mode : 0o755 });
}

/**
 * Full pipeline to create MarkerEditor. */
async function build() {
    const msg = (m) => console.log(`\n${m}...`);
    msg('Removing Previous build output');
    const dist = resolve(__dirname, '../dist');
    if (!fs.existsSync(dist)) {
        fs.mkdirSync(dist);
    }

    for (const file of fs.readdirSync(dist)) {
        // Don't remove zip files
        if (file.endsWith('.zip')) {
            continue;
        }

        const fullPath = join(dist, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'archCache') {
                fs.rmSync(fullPath, { recursive : true, force : true });
            }
        } else {
            fs.unlinkSync(fullPath);
        }
    }

    msg('Transpiling to cjs');
    await transpile();

    msg('Building exe');
    await toExe();

    msg('Copying native modules');

    let sqlite3Version = dependencies.sqlite3;
    if (/^[^~]/.test(sqlite3Version)) {
        // Always use the exact version listed
        sqlite3Version = sqlite3Version.substring(1);
    }

    const cacheDir = resolve(__dirname, '../dist/archCache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir);
    }

    const arch = getArch();

    if (process.arch === arch) {
        // destination arch is the same as the system arch. Just copy the existing node_modules dir

        copySync(
            resolve(__dirname, '../node_modules/sqlite3/build/Release/node_sqlite3.node'),
            resolve(__dirname, '../dist/node_modules/sqlite3/build/Release/node_sqlite3.node'),
            { overwrite : true, recursive : true });
    } else {
        const cacheVersion = join(cacheDir, `sqlite3-${sqlite3Version}-${arch}`);

        // Cross-compilation (e.g. --dest-cpu=ia32 on a 64-bit OS).
        // Instead of creating the infra to support downloading and un-taring sqlite3
        // binaries, it's required to manually build the dist/archCache structure using self/pre-built
        // binaries, using the naming outlined above in cacheVersion.
        if (!fs.existsSync(cacheVersion) || !fs.statSync(cacheVersion).isDirectory()) {
            throw new Error(`Unable to copy native sqlite3 module, archCache folder "${cacheVersion}" does not exist.`);
        }

        copySync(
            join(cacheVersion, 'node_sqlite3.node'),
            resolve(__dirname, '../dist/node_modules/sqlite3/build/Release/node_sqlite3.node'),
            { overwrite : true, recursive : true }
        );
    }

    copySync(
        resolve(__dirname, '../node_modules/sqlite3/package.json'),
        resolve(__dirname, '../dist/node_modules/sqlite3/package.json'),
        { overwrite : true }
    );

    msg('Writing README');
    writeReadme();

    if (process.platform !== 'win32' && process.platform !== 'darwin') {
        msg(`Writing Linux Start script`);
        writeStartSh();
    }

    msg('Removing transpiled output');
    fs.unlinkSync(resolve(__dirname, '../dist/built.cjs'));

    if (args.includes('zip') || args.includes('pack')) {
        msg('Zipping everything up');
        const zipName = `${binaryName}.v${version}-${process.platform}-${arch}`;
        let cmd;
        /* eslint-disable max-len */
        if (process.platform === 'win32') {
            cmd = `powershell Compress-Archive "${dist}/node_modules", "${dist}/README.txt", "${dist}/${binaryName}.exe" "${dist}/${zipName}.zip" -Force`;
        } else if (process.platform === 'darwin') {
            cmd = `tar -C '${dist}' -czvf '${dist}/${zipName}.tar.gz' node_modules README.txt '${binaryName}'`;
        } else {
            cmd = `tar -C '${dist}' -czvf '${dist}/${zipName}.tar.gz' node_modules start.sh README.txt '${binaryName}'`;
        }
        /* eslint-enable max-len */

        if (verbose) {
            console.log(`Running "${cmd}"`);
        }

        exec(cmd, (err) => {
            if (err) { console.error(err.message); } else { console.log('Done!'); }
        });
    } else {
        console.log('Done!');
    }
}

build();
