import {
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync } from 'fs';
import { exec, spawn } from 'child_process';
import { join, resolve } from 'path';
import { rollup } from 'rollup';
import semver from 'semver';
import webpack from 'webpack';

/** @typedef {!import('webpack').Stats} Stats */

import { applyWindowsResources } from './stampWindowsResources.js';
import ReadMeGenerator from './ReadMeGenerator.cjs';

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

/** @typedef {'win32'|'linux'|'darwin'} SupportedPlatform */
/** @typedef {'x64'|'arm64'|'ia32'} SupportedArch */

const buildDir = import.meta.dirname;

const packageJson = JSON.parse(readFileSync(resolve(buildDir, '../package.json')).toString('utf-8'));
const { version, dependencies } = packageJson;
const binaryName = 'MarkerEditor';

const fallbackNodeVersion = '24.15.0'; // Latest v24 as of 2026/05
const nodeMajorMax = 24; // LTS as of 2026/05

const args = process.argv.map(a => a.toLowerCase());
const verbose = args.includes('verbose');
const isWin = process.platform === 'win32';
const debug = args.includes('debug');
const compress = args.includes('compress') || args.includes('brotli');

/**
 * Return whether we should print build help instead of running. */
function showHelp() {
    return args.includes('help') || args.includes('--help') || args.includes('-h') || args.includes('/?');
}

/**
 * Print command line usage/help text. */
function printHelp() {
    console.log(`
Marker Editor build script

Usage:
    node Build/build.js [options] [platform ...] [arch ...]

Options:
    help, --help, -h, /?    Show this help text and exit.
    pack, zip               Create packaged archives for each target.
    compress, brotli        Enable Brotli SEA compression.
    debug                   Pass --debug to pkg.
    version <x.y.z>         Override Node.js version used for pkg target.
    verbose                 Print additional build command output.

Platforms:
    win32, win, windows
    linux
    darwin, macos, mac, osx

Architectures:
    x64, amd64, x86_64
    arm64, aarch64
    x86, ia32

Examples:
    node Build/build.js
    node Build/build.js pack win arm64
    node Build/build.js compress win mac linux x64 arm64 pack
    npm run build -- help
`);
}

/**
 * Uses rollup to transpile app.js to common-js for packaging. */
async function transpile() {
    await rollup({
        input : resolve(buildDir, '../app.js'),
        onwarn : (warn, def) => {
            // Packaging handles runtime resolution for unresolved imports.
            if (warn.code === 'UNRESOLVED_IMPORT') {
                return;
            }

            def(warn);
        }
    }).then((bundle) => {
        bundle.write({
            file : resolve(buildDir, '../dist/built.cjs'),
            format : 'cjs',
        });
    });
}

import { IndexJS as IndexWebpack, LoginJS as LoginWebpack } from '../webpack.config.js';

/**
 * Minify client code and emit production HTML/JS assets. */
async function minifyClient() {
    await Promise.all([
        new Promise(r => { webpack(IndexWebpack).run(compileFn('index', r)); }),
        new Promise(r => { webpack(LoginWebpack).run(compileFn('login', r)); })
    ]);
}

/**
 * Returns a webpack compilation function for a given JS file.
 * @param {'index'|'login'} fileName The top-level JS file to compile
 * @param {(any) => void} resolveFn */
function compileFn (fileName, resolveFn) {
    /**
     * @param {Error?} err
     * @param {Stats} stats */
    const fn = (err, stats) => {
        if (err) {
            console.error(err.stack || err);
            if (err.details) {
                console.error(err.details);
            }

            throw new Error(`Webpack error. Cannot continue.`);
        }

        const info = stats.toJson();

        if (stats.hasErrors()) {
            console.error(info.errors);
            throw new Error(`Webpack error. Cannot continue.`);
        }

        if (stats.hasWarnings()) {
            console.warn(info.warnings);
        }

        let foundBundle = false;
        for (const asset of info.assets) {
            if (new RegExp(`^${fileName}\\.[a-f0-9]+\\.js$`, 'i').test(asset.name)) {
                foundBundle = true;
                break;
            }
        }

        if (!foundBundle) {
            throw new Error(`Unable to find packed js name. Cannot continue.`);
        }

        resolveFn();
    };

    return fn;
}

/**
 * Get all target platforms requested by input arguments.
 * Defaults to the host platform if no explicit platform argument is provided. */
function getTargetPlatforms() {
    /** @type {('win32'|'darwin'|'linux')[]} */
    const targetPlatforms = [];
    if (args.includes('win32') || args.includes('windows') || args.includes('win')) {
        targetPlatforms.push('win32');
    }

    if (args.includes('darwin') || args.includes('macos') || args.includes('mac') || args.includes('osx')) {
        targetPlatforms.push('darwin');
    }

    if (args.includes('linux')) {
        targetPlatforms.push('linux');
    }

    if (targetPlatforms.length === 0) {
        targetPlatforms.push(process.platform);
    }

    return targetPlatforms;
}

/**
 * Get all target architectures requested by input arguments.
 * Defaults to the host architecture if no explicit architecture argument is provided. */
function getTargetArchitectures() {
    /** @type {(SupportedArch)[]} */
    const targetArchitectures = [];
    if (args.includes('x64') || args.includes('amd64') || args.includes('x86_64')) {
        targetArchitectures.push('x64');
    }

    if (args.includes('arm64') || args.includes('aarch64')) {
        targetArchitectures.push('arm64');
    }

    if (args.includes('x86') || args.includes('ia32')) {
        targetArchitectures.push('ia32');
    }

    if (targetArchitectures.length === 0) {
        const supportedArchitectures = new Set(['x64', 'arm64', 'ia32']);
        if (!supportedArchitectures.has(process.arch)) {
            throw new Error(`Unsupported build architecture "${process.arch}", exiting...`);
        }

        targetArchitectures.push(process.arch);
    }

    return targetArchitectures;
}

/**
 * Get the platform value expected by pkg SEA targets. */
function getPkgPlatform(platform=process.platform) {
    switch (platform) {
        case 'win32':
            return 'win';
        case 'linux':
            return 'linux';
        case 'darwin':
            return 'macos';
        default:
            throw new Error(`Unsupported build platform "${platform}", exiting...`);
    }
}

/**
 * Get the version of Node we should use when building Marker Editor. */
async function getNodeVersion() {
    if (args.includes('version')) {
        const idx = args.indexOf('version');
        if (idx < args.length - 1) {
            return args[idx + 1];
        }
    } else {
        // Find the latest LTS version
        try {
            /** @type {NodeVersionInfo[]} */
            const versions = await (await fetch('https://nodejs.org/download/release/index.json')).json();
            versions.sort((a, b) => (!!a.lts === !!b.lts) ? (semver.lt(a.version, b.version) ? 1 : -1) : (a.lts ? -1 : 1));

            let idx = 0;
            // Just let OOB fall into the catch.
            while (semver.major(versions[idx].version) > nodeMajorMax) {
                ++idx;
            }

            const nodeVersion = versions[idx].version.substring(1);
            console.log(`Found latest v${nodeMajorMax}: ${nodeVersion}`);
            return nodeVersion;
        } catch (_ex) {
            console.warn(`Unable to find latest v${nodeMajorMax} version of Node.js, falling back to ${fallbackNodeVersion}`);
        }
    }

    // Something went wrong.
    return fallbackNodeVersion;
}

/**
 * Build a stock-Node single executable with pkg's SEA mode. */
async function toExe(targetPlatform, targetArch, nodeVersionOverride=null) {
    const nodeVersion = nodeVersionOverride ?? await getNodeVersion();
    const target = `node${semver.major(nodeVersion)}-${getPkgPlatform(targetPlatform)}-${targetArch}`;
    const outPath = resolve(buildDir, `../dist/${binaryName}` + (targetPlatform === 'win32' ? '.exe' : ''));
    const npxArgs = ['-y', '@yao-pkg/pkg', '.', '--sea', '--targets', target, '--output', outPath];
    if (compress) {
        npxArgs.push('--compress', 'Brotli');
    }

    if (debug) {
        npxArgs.push('--debug');
    }

    const childEnv = { ...process.env };
    delete childEnv.NODE_OPTIONS;
    delete childEnv.VSCODE_INSPECTOR_OPTIONS;

    console.log(`Attempting to build ${target} with yao-pkg`);
    await new Promise((resolveFn, rejectFn) => {
        const child = spawn('npx', npxArgs, {
            cwd : resolve(buildDir, '..'),
            env : childEnv,
            shell : isWin,
            stdio : 'inherit',
        });

        child.on('error', err => {
            rejectFn(new Error(`yao-pkg build failed: ${err.message}`));
        });

        child.on('close', code => {
            if (code !== 0) {
                rejectFn(new Error(`yao-pkg build failed with exit code ${code}.`));
                return;
            }

            resolveFn();
        });
    });

    return nodeVersion;
}

/**
 * Download a target-specific native module binary and cache it for future builds.
 * @param {string} moduleName
 * @param {string} moduleVersion
 * @param {string} moduleBinaryName
 * @param {string} targetPlatform
 * @param {string} targetArch
 * @param {string} nodeVersion
 * @param {string} cachePath */
async function populateNativeModuleCache(moduleName, moduleVersion, moduleBinaryName, targetPlatform, targetArch, nodeVersion, cachePath) {
    const nodeMajor = semver.major(nodeVersion);
    if (!Number.isFinite(nodeMajor)) {
        throw new Error(`Unable to determine Node major version from "${nodeVersion}".`);
    }

    const fetchRoot = resolve(buildDir, '../dist/.nativeFetch');
    const fetchDir = resolve(fetchRoot, `${moduleName}-${moduleVersion}-${targetPlatform}-${targetArch}-node${nodeMajor}`);
    const fetchBinary = resolve(fetchDir, `node_modules/${moduleName}/build/Release/${moduleBinaryName}`);
    const cachedBinary = join(cachePath, moduleBinaryName);

    rmSync(fetchDir, { recursive : true, force : true });
    mkdirSync(fetchDir, { recursive : true });

    writeFileSync(
        resolve(fetchDir, 'package.json'),
        JSON.stringify({
            name : 'marker-editor-native-fetch',
            version : '1.0.0',
            private : true,
        }, null, 2),
        { encoding : 'utf-8' }
    );

    const npmArgs = [
        'install',
        `${moduleName}@${moduleVersion}`,
        '--no-save',
        '--no-package-lock',
    ];

    const childEnv = { ...process.env };
    delete childEnv.NODE_OPTIONS;
    delete childEnv.VSCODE_INSPECTOR_OPTIONS;
    childEnv.npm_config_platform = targetPlatform;
    childEnv.npm_config_arch = targetArch;
    childEnv.npm_config_target = nodeVersion;
    childEnv.npm_config_runtime = 'node';

    console.log(`Attempting to auto-fetch ${moduleName} for ${targetPlatform}-${targetArch} (Node ${nodeVersion})...`);
    try {
        await new Promise((resolveFn, rejectFn) => {
            const child = spawn('npm', npmArgs, {
                cwd : fetchDir,
                env : childEnv,
                shell : isWin,
                stdio : 'inherit',
            });

            child.on('error', err => {
                rejectFn(new Error(`Native module download failed: ${err.message}`));
            });

            child.on('close', code => {
                if (code !== 0) {
                    rejectFn(new Error(`Native module download failed with exit code ${code}.`));
                    return;
                }

                resolveFn();
            });
        });

        if (!existsSync(fetchBinary)) {
            throw new Error(`Downloaded package did not include "${moduleBinaryName}" at "${fetchBinary}".`);
        }

        mkdirSync(cachePath, { recursive : true });
        copyFileSync(fetchBinary, cachedBinary);
        if (verbose) {
            console.log(`Cached ${moduleName} native binary at "${cachedBinary}".`);
        }
    } finally {
        rmSync(fetchDir, { recursive : true, force : true });
    }
}

/**
 * @param {string} moduleName */
function getNativeModuleVersion(moduleName) {
    let nativeModuleVersion = dependencies[moduleName];
    if (!nativeModuleVersion) {
        throw new Error(`Unable to determine ${moduleName} version from package.json dependencies.`);
    }

    if (/^[~^]/.test(nativeModuleVersion)) {
        // Always use the exact version listed
        nativeModuleVersion = nativeModuleVersion.substring(1);
    }

    return nativeModuleVersion;
}

/**
 * @param {string} path */
function isDirectory(path) {
    return existsSync(path) && statSync(path).isDirectory();
}

/**
 * Resolve the source binary for a native module, auto-fetching into archCache when needed.
 * @param {string} moduleName
 * @param {string} moduleVersion
 * @param {string} moduleBinaryName
 * @param {string} targetPlatform
 * @param {string} targetArch
 * @param {string} nodeVersion */
async function resolveNativeBinarySource(moduleName, moduleVersion, moduleBinaryName, targetPlatform, targetArch, nodeVersion) {
    const localBinary = resolve(buildDir, `../node_modules/${moduleName}/build/Release/${moduleBinaryName}`);
    if (process.arch === targetArch && process.platform === targetPlatform) {
        return localBinary;
    }

    const cacheDir = resolve(buildDir, '../dist/archCache');
    if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir);
    }

    const nodeMajor = semver.major(nodeVersion);
    if (!Number.isFinite(nodeMajor)) {
        throw new Error(`Unable to determine Node major version from "${nodeVersion}" for native module cache.`);
    }

    const cacheVersion = join(cacheDir, `${moduleName}-${moduleVersion}-${targetPlatform}-${targetArch}-node${nodeMajor}`);
    if (!isDirectory(cacheVersion)) {
        try {
            await populateNativeModuleCache(
                moduleName,
                moduleVersion,
                moduleBinaryName,
                targetPlatform,
                targetArch,
                nodeVersion,
                cacheVersion);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(
                `Unable to auto-fetch native module ${moduleName} for ${targetPlatform}-${targetArch} (Node ${nodeVersion}). ` +
                `Populate "${cacheVersion}" manually if no prebuild exists. ${message}`, { cause : err });
        }
    }

    const sourceBinary = join(cacheVersion, moduleBinaryName);
    if (!existsSync(sourceBinary)) {
        throw new Error(`Unable to copy native module ${moduleName}, binary "${sourceBinary}" does not exist.`);
    }

    return sourceBinary;
}

/**
 * @param {{ name: string, sidecarPaths?: string[], sidecarDependencies?: string[] }} nativeModule */
function copyNativeSidecars(nativeModule) {
    const nativeModuleName = nativeModule.name;
    for (const sidecarPath of nativeModule.sidecarPaths ?? []) {
        const sidecarSource = resolve(buildDir, `../node_modules/${nativeModuleName}/${sidecarPath}`);
        if (!existsSync(sidecarSource)) {
            throw new Error(`Unable to copy sidecar path for ${nativeModuleName}, source "${sidecarSource}" does not exist.`);
        }

        cpSync(
            sidecarSource,
            resolve(buildDir, `../dist/node_modules/${nativeModuleName}/${sidecarPath}`),
            { force : true, recursive : true }
        );
    }

    for (const dependency of nativeModule.sidecarDependencies ?? []) {
        const depSource = resolve(buildDir, `../node_modules/${dependency}`);
        if (!existsSync(depSource)) {
            throw new Error(`Unable to copy sidecar dependency "${dependency}", source "${depSource}" does not exist.`);
        }

        cpSync(
            depSource,
            resolve(buildDir, `../dist/node_modules/${dependency}`),
            { force : true, recursive : true }
        );
    }
}

/**
 * @param {SupportedPlatform} targetPlatform */
function targetBinaryName(targetPlatform) {
    return `${binaryName}${targetPlatform === 'win32' ? '.exe' : ''}`;
}

function macLauncherName() {
    return 'start.command';
}

/**
 * @param {string} dist
 * @param {SupportedPlatform} targetPlatform
 * @param {string} zipName */
function getPackCommand(dist, targetPlatform, zipName) {
    const targetBinary = targetBinaryName(targetPlatform);
    const quote = isWin ? '"' : '\'';
    const q = value => `${quote}${value}${quote}`;
    if (targetPlatform === 'win32') {
        if (isWin) {
            return `powershell Compress-Archive "${dist}/node_modules", "${dist}/README.txt", ` +
                `"${dist}/${targetBinary}" "${dist}/${zipName}.zip" -Force`;
        }

        return `zip -r ${q(`${dist}/${zipName}.zip`)} ${q(`${dist}/node_modules`)} ` +
            `${q(`${dist}/README.txt`)} ${q(`${dist}/${targetBinary}`)}`;
    }

    if (targetPlatform === 'darwin') {
        return `tar -C ${q(dist)} -czvf ${q(`${dist}/${zipName}.tar.gz`)} node_modules README.txt ` +
            `${q(macLauncherName())} ${q(targetBinary)}`;
    }

    return `tar -C ${q(dist)} -czvf ${q(`${dist}/${zipName}.tar.gz`)} node_modules start.sh README.txt ${q(targetBinary)}`;
}

/**
 * Write a small README to include in the package. On Windows/Mac, simply
 * direct users to the wiki. Add a bit more information about launching
 * on Linux, as it's not "double-clickable" on all variants. */
function writeReadme(targetPlatform) {
    const recipeHeader = `~\n!\n-:-MARKER EDITOR ${version}\n!\n~\n!\n`;

    const recipeFooter = `
!\n${targetPlatform === 'linux' ? '' : '-:-'}For complete usage instructions,
||visit the wiki at https://github.com/danrahn/MarkerEditorForPlex/wiki\n!\n~`;

    let recipe;
    switch (targetPlatform) {
        default:
            console.warn(`WARN: Unknown platform '${targetPlatform}'. How did we get here?`);
            // __fallthrough
        case 'win32':
            recipe = `-:-Welcome to Marker Editor for Plex!`;
            break;
        case 'darwin':
            recipe = `Welcome to Marker Editor for Plex! On macOS, run ${macLauncherName()} on first launch.
||It will remove quarantine metadata and apply ad-hoc signatures before starting MarkerEditor:
!
   ~ $ chmod +x ./${macLauncherName()}
   MarkerEditorForPlex $ ./${macLauncherName()}`;
            break;
        case 'linux':
            recipe = `Welcome to Marker Editor for Plex! If double-clicking MarkerEditor doesn't start
||the program, there are a couple ways to launch the editor:
!
1. Via start.sh. Depending on your system, you may have to right-click the file and "Run as a Program",
||or choose to "Execute in Terminal."!!3
2. Open a new terminal window, navigate to the folder with MarkerEditor, and execute it from there:!!3
!
   ~ $ cd /path/to/MarkerEditorForPlex
   MarkerEditorForPlex $ ./MarkerEditor`;
            break;
    }

    writeFileSync(resolve(buildDir, '../dist/README.txt'), new ReadMeGenerator(80).parse(recipeHeader + recipe + recipeFooter));
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

    writeFileSync(resolve(buildDir, '../dist/start.sh'), startSh, { mode : 0o755 });
}

/**
 * On macOS, launching an unsigned binary may fail until quarantine attributes are removed
 * and ad-hoc signatures are applied. Include a helper launcher to do that first. */
function writeMacFirstRunCommand() {
    const targetBinary = targetBinaryName('darwin');
    const macLauncher =
`#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BIN="$SCRIPT_DIR/${targetBinary}"

if [[ ! -x "$BIN" ]]; then
    chmod +x "$BIN"
fi

if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true
fi

if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - --timestamp=none "$BIN" 2>/dev/null || true
    if [[ -d "$SCRIPT_DIR/node_modules" ]]; then
        find "$SCRIPT_DIR/node_modules" -name '*.node' -print0 2>/dev/null | while IFS= read -r -d '' addon; do
            codesign --force --sign - --timestamp=none "$addon" 2>/dev/null || true
        done
    fi
fi

exec "$BIN" "$@"
`;

    writeFileSync(resolve(buildDir, `../dist/${macLauncherName()}`), macLauncher, { mode : 0o755 });
}


/**
 * Remove per-target runtime output before building the next target in a matrix.
 * @param {string} dist */
function clearTargetRuntimeOutput(dist) {
    for (const outputName of ['node_modules', 'README.txt', 'start.sh', macLauncherName(), binaryName, `${binaryName}.exe`]) {
        const outputPath = resolve(dist, outputName);
        if (!existsSync(outputPath)) {
            continue;
        }

        if (statSync(outputPath).isDirectory()) {
            rmSync(outputPath, { recursive : true, force : true });
        } else {
            unlinkSync(outputPath);
        }
    }
}

/**
 * Copy current output files into a target-specific folder for matrix builds without packing.
 * @param {string} dist
 * @param {SupportedPlatform} targetPlatform
 * @param {SupportedArch} targetArch */
function persistTargetOutput(dist, targetPlatform, targetArch) {
    const targetBinary = targetBinaryName(targetPlatform);
    const targetDir = resolve(dist, `targets/${targetPlatform}-${targetArch}`);
    rmSync(targetDir, { recursive : true, force : true });
    mkdirSync(targetDir, { recursive : true });

    cpSync(resolve(dist, 'node_modules'), resolve(targetDir, 'node_modules'), { recursive : true, force : true });
    copyFileSync(resolve(dist, 'README.txt'), resolve(targetDir, 'README.txt'));
    copyFileSync(resolve(dist, targetBinary), resolve(targetDir, targetBinary));

    for (const helperScript of ['start.sh', macLauncherName()]) {
        const helperPath = resolve(dist, helperScript);
        if (existsSync(helperPath)) {
            copyFileSync(helperPath, resolve(targetDir, helperScript));
        }
    }
}

/**
 * Run the package/archive command for a target and wait for completion.
 * @param {string} dist
 * @param {SupportedPlatform} targetPlatform
 * @param {SupportedArch} targetArch */
async function packTarget(dist, targetPlatform, targetArch) {
    const zipName = `${binaryName}.v${version}-${targetPlatform}-${targetArch}`;
    const cmd = getPackCommand(dist, targetPlatform, zipName);

    if (verbose) {
        console.log(`Running "${cmd}"`);
    }

    await new Promise((resolveFn, rejectFn) => {
        exec(cmd, { maxBuffer : 100 * 1024 * 1024 }, (err) => {
            if (err) {
                rejectFn(err);
                return;
            }

            resolveFn();
        });
    });
}


/**
 * Build executable artifacts.
 * @param {(message: string) => void} msg
 * @param {SupportedPlatform} targetPlatform
 * @param {SupportedArch} targetArch
 * @param {string?} nodeVersionOverride */
async function buildExecutable(msg, targetPlatform, targetArch, nodeVersionOverride=null) {
    msg('Building exe');
    const targetNodeVersion = await toExe(targetPlatform, targetArch, nodeVersionOverride);

    msg('Copying native modules');
    await copyNativeModules(targetArch, targetPlatform, targetNodeVersion);

    if (targetPlatform === 'win32') {
        msg('Applying Windows icon/version');
        if (isWin) {
            applyWindowsResources(resolve(buildDir, `../dist/${targetBinaryName(targetPlatform)}`), { verbose, });
        } else {
            console.warn('Skipping Windows resource stamping because host is not Windows.');
        }
    }
}

/**
 * Copy required native modules for the target platform/architecture.
 * @param {SupportedArch} arch
 * @param {SupportedPlatform} targetPlatform
 * @param {string} nodeVersion */
async function copyNativeModules(arch, targetPlatform, nodeVersion) {
    const nativeModules = [{
        name : 'better-sqlite3',
        binary : 'better_sqlite3.node',
        sidecarPaths : ['lib'],
        sidecarDependencies : ['bindings', 'file-uri-to-path'],
    }];

    for (const nativeModule of nativeModules) {
        const nativeModuleName = nativeModule.name;
        const nativeBinaryName = nativeModule.binary;
        const nativeModuleVersion = getNativeModuleVersion(nativeModuleName);
        const sourceBinary = await resolveNativeBinarySource(
            nativeModuleName,
            nativeModuleVersion,
            nativeBinaryName,
            targetPlatform,
            arch,
            nodeVersion);

        mkdirSync(resolve(buildDir, `../dist/node_modules/${nativeModuleName}/build/Release`), { recursive : true });
        copyFileSync(
            sourceBinary,
            resolve(buildDir, `../dist/node_modules/${nativeModuleName}/build/Release/${nativeBinaryName}`)
        );

        copyFileSync(
            resolve(buildDir, `../node_modules/${nativeModuleName}/package.json`),
            resolve(buildDir, `../dist/node_modules/${nativeModuleName}/package.json`)
        );

        copyNativeSidecars(nativeModule);
    }
}

/**
 * Full pipeline to create MarkerEditor. */
async function build() {
    if (showHelp()) {
        printHelp();
        return;
    }

    const msg = (m) => console.log(`\n${m}...`);
    const targetPlatforms = getTargetPlatforms();
    const targetArchitectures = getTargetArchitectures();
    const packRequested = args.includes('zip') || args.includes('pack');
    /** @type {{ targetPlatform: SupportedPlatform, targetArch: SupportedArch }[]} */
    const buildTargets = [];
    for (const targetPlatform of targetPlatforms) {
        for (const targetArch of targetArchitectures) {
            buildTargets.push({ targetPlatform, targetArch });
        }
    }

    msg('Removing Previous build output');
    const dist = resolve(buildDir, '../dist');
    if (!existsSync(dist)) {
        mkdirSync(dist);
    }

    for (const file of readdirSync(dist)) {
        // Don't remove previously packaged archives.
        if (file.endsWith('.zip') || file.endsWith('.tar.gz')) {
            continue;
        }

        const fullPath = join(dist, file);
        if (statSync(fullPath).isDirectory()) {
            if (file !== 'archCache') {
                rmSync(fullPath, { recursive : true, force : true });
            }
        } else {
            unlinkSync(fullPath);
        }
    }

    msg('Transpiling to cjs');
    await transpile();

    msg('Minifying client code with webpack');
    await minifyClient();

    const nodeVersion = await getNodeVersion();
    for (const [index, buildTarget] of buildTargets.entries()) {
        const { targetPlatform, targetArch } = buildTarget;
        if (buildTargets.length > 1) {
            msg(`Building target ${index + 1}/${buildTargets.length}: ${targetPlatform}-${targetArch}`);
        }

        clearTargetRuntimeOutput(dist);
        await buildExecutable(msg, targetPlatform, targetArch, nodeVersion);

        msg('Writing README');
        writeReadme(targetPlatform);

        if (targetPlatform === 'linux') {
            msg('Writing Linux Start script');
            writeStartSh();
        } else if (targetPlatform === 'darwin') {
            msg('Writing macOS first-run launcher');
            writeMacFirstRunCommand();
        }

        if (packRequested) {
            msg(`Packing ${targetPlatform}-${targetArch}`);
            await packTarget(dist, targetPlatform, targetArch);
        } else if (buildTargets.length > 1) {
            msg(`Saving ${targetPlatform}-${targetArch} output`);
            persistTargetOutput(dist, targetPlatform, targetArch);
        }
    }

    msg('Removing transpiled output');
    unlinkSync(resolve(buildDir, '../dist/built.cjs'));
    console.log('Done!');
}

build();
