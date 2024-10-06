import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
    unlinkSync,
    writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { compile } from 'nexe';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { homedir } from 'os';
import rcedit from 'rcedit';
import { rollup } from 'rollup';
import semver from 'semver';
import webpack from 'webpack';

/** @typedef {!import('nexe/lib/options').NexePatch} NexePatchFunction */
/** @typedef {!import('webpack').Stats} Stats */

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

const buildDir = import.meta.dirname;

const packageJson = JSON.parse(readFileSync(resolve(buildDir, '../package.json')).toString('utf-8'));
const { version, dependencies } = packageJson;
const iconPath = resolve(buildDir, 'app.ico');

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
const isWin = process.platform === 'win32';

/**
NOTE: This won't work on its own with the current version on nexe, which appears to always
force a release build. To make this work, the nodeSrcBinPath path calculation in compiler.js
was replaced with the following:

```
const isDebug = util_1.isWindows ? this.options.vcBuild.includes('debug') : this.options.configure.includes('--debug');
const outFolder = isDebug ? 'Debug' : 'Release';
this.nodeSrcBinPath = util_1.isWindows
    ? (0, path_1.join)(this.src, outFolder, 'node.exe')
    : (0, path_1.join)(this.src, 'out', outFolder, 'node');
```
*/
const debug = args.includes('debug');

/**
 * Uses rollup to transpile app.js to common-js, as nexe can't consume es6 modules. */
async function transpile() {
    await rollup({
        input : resolve(buildDir, '../app.js'),
        onwarn : (warn, def) => {
            // We don't care about unresolved imports, nexe takes care of that.
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

/** List of HTML files that need to be injected with cache-bustable JS/CSS */
const htmlFiles = {
    index : { path : resolve(buildDir, '../index.html'), js : '' },
    login : { path : resolve(buildDir, '../Client/login.html'), js : '' }
};

import StyleSheets from '../Client/Script/StyleSheets.js';
const hashedStyles = [];

import Icons from '../Client/Script/Icons.js';
const hashedSVGs = [];

/**
 * Runs the given function and swallows any exceptions that are thrown.
 * @param {(...any) => any} fn */
function ignoreError (fn) {
    try {
        fn();
    } catch (innerErr) {
        // Swallow inner exceptions to try and clean up as much as possible.
        // TODO: Copy all project files to a temporary directory so we don't need all these hacks.
        console.error(`Exception thrown during cleanup. Project directory may be broken.`);
        console.error(innerErr);
        // console.error(innerErr.message);
        // console.error(innerErr.stack || 'Callstack not available.');
        console.log();
    }
}

/**
 * Minify client code and inject minified source into html. */
async function minifyClient() {
    // Before minifying, replace SVG icons with cache-bustable versions. This is ~similar to the process
    // used to modify index.html to point to the cache-bustable index.[contenthash].js. I'm sure there's
    // a vetted library for this, but it's not too bad to do this ourselves.
    const newIcons = {};
    for (const [key, icon] of Object.entries(Icons)) {
        const svgOriginal = resolve(buildDir, `../SVG/${icon}.svg`);
        const svg = readFileSync(svgOriginal).toString('utf-8');
        const hash = createHash('md5').update(svg).digest('hex');
        const newSvgIcon = `${icon}.${hash}`;
        const newSvg = join(buildDir, `../SVG/${newSvgIcon}.svg`);
        copyFileSync(svgOriginal, newSvg);
        hashedSVGs.push(resolve(newSvg));
        newIcons[key] = newSvgIcon;
    }

    const iconsFile = resolve(buildDir, '../Client/Script/Icons.js');
    const iconsFileT = join(buildDir, '../Client/Script/Icons.jsT');
    renameSync(iconsFile, iconsFileT);
    const newIconText = `const Icons = ${JSON.stringify(newIcons)};export default Icons;`;
    writeFileSync(iconsFile, newIconText, { encoding : 'utf-8' });

    // Like icons, we also want cache-bustable CSS.
    const newCSS = {};
    const styleSheetMap = {};
    for (const [key, style] of Object.entries(StyleSheets)) {
        const styleOriginal = resolve(buildDir, `../Client/Style/${style}.css`);
        const styleContent = readFileSync(styleOriginal).toString('utf-8');
        const hash = createHash('md5').update(styleContent).digest('hex');
        const newStyle = `${style}.${hash}`;
        const newStyleFile = join(buildDir, `../Client/Style/${newStyle}.css`);
        copyFileSync(styleOriginal, newStyleFile);
        hashedStyles.push(resolve(newStyleFile));
        newCSS[key] = newStyle;
        styleSheetMap[`${style}.css`] = `${newStyle}.css`;
    }

    const styleFile = resolve(buildDir, '../Client/Script/StyleSheets.js');
    const styleFileT = resolve(buildDir, '../Client/Script/StyleSheets.jsT');
    renameSync(styleFile, styleFileT);
    const newStyleText = `const StyleSheets = ${JSON.stringify(newCSS)};export default StyleSheets;`;
    writeFileSync(styleFile, newStyleText, { encoding : 'utf-8' });

    try {
        await Promise.all([
            new Promise(r => { webpack(IndexWebpack).run(compileFn('index', r)); }),
            new Promise(r => { webpack(LoginWebpack).run(compileFn('login', r)); })
        ]);

        // Now back up our original html files so we can replace "dev" JS and
        // CSS imports with production cache-busting CSS. Note that we don't
        // restore these until they're bundled into the exe.
        for (const htmlFile of Object.values(htmlFiles)) {
            copyFileSync(htmlFile.path, htmlFile.path + '_T');
        }

        for (const [htmlName, htmlInfo] of Object.entries(htmlFiles)) {

            let html = readFileSync(htmlInfo.path).toString('utf-8').replace(
                new RegExp(`(<script.*").*${htmlName}\\.js(".*?<\\/script>)`), `$1${htmlInfo.js}$2`);
            for (const [baseStyle, newStyle] of Object.entries(styleSheetMap)) {
                html = html.replace(new RegExp(`/${baseStyle}`), `/${newStyle}`);
            }

            writeFileSync(htmlInfo.path, html, { encoding : 'utf-8' });
        }
    } catch (err) {
        // On error, we won't continue attempting to bundle, so remove all hashed files and
        // restore HTML
        for (const icon of hashedSVGs) {
            ignoreError(() => rmSync(icon));
        }

        for (const style of hashedStyles) {
            ignoreError(() => rmSync(style));
        }

        for (const htmlInfo of Object.values(htmlFiles)) {
            ignoreError(() => {
                rmSync(htmlInfo.path);
                renameSync(htmlInfo.path + '_T', htmlInfo.path);
                rmSync(resolve(buildDir, `../${htmlInfo.js}`));
            });
        }

        throw err;
    } finally {
        rmSync(iconsFile);
        renameSync(iconsFileT, iconsFile);

        rmSync(styleFile);
        renameSync(styleFileT, styleFile);

        // Can't delete hashed files until they'be been bundled with nexe.
    }
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

        for (const asset of info.assets) {
            if (new RegExp(`^${fileName}\\.[a-f0-9]+\\.js$`, 'i').test(asset.name)) {
                htmlFiles[fileName].js = asset.name;
                break;
            }
        }

        if (!htmlFiles[fileName].js) {
            throw new Error(`Unable to find packed js name. Cannot continue.`);
        }

        resolveFn();
    };

    return fn;
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
 * Get the current platform as a more user-friendly value. */
function getPlatform() {
    switch (process.platform) {
        case 'win32':
            return 'windows';
        case 'linux':
            return 'linux';
        case 'darwin':
            return 'mac';
        default:
            throw new Error(`Unsupported build platform "${process.platform}", exiting...`);
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

            const nodeVersion = versions[0].version.substring(1);
            console.log(`Found latest LTS: ${nodeVersion}`);
            return nodeVersion;
        } catch (ex) {
            console.warn(`Unable to find latest LTS version of Node.js, falling back to ${fallbackNodeVersion}`);
        }
    }

    // Something went wrong.
    return fallbackNodeVersion;
}

/**
 * Clears out all old output directories to allow for a full rebuild.
 * @param {string} oldOut */
function cleanBuild(oldOut) {
    const tryRm = out => {
        try {
            rmSync(out, { recursive : true, force : true });
        } catch (ex) {
            console.warn(`\tUnable to clear output ${out}`);
        }
    };

    console.log('\nCleaning existing cached output');
    if (existsSync(oldOut)) {
        console.log('\tClearing old output directory');
        tryRm(oldOut);
    }

    for (const cachedOut of ['arm64', 'ia32', 'x64', 'arm64d', 'ia32d', 'x64d']) {
        if (existsSync(oldOut + cachedOut)) {
            console.log(`\tClearing out ${cachedOut} cache`);
            tryRm(oldOut + cachedOut);
        }
    }
}

/**
 * Delete the existing build node binary if 'rebuild' was passed to this script.
 * @type {NexePatchFunction} */
function deleteNodeBinaryIfRebuilding(compiler, next) {
    if (!args.includes('rebuild')) {
        return next();
    }

    // If we don't delete the node binary, nexe won't rebuild anything even if
    // the source has changed (e.g. due to new patches).
    if (verbose) console.log(`Attempting to delete node binary due to 'rebuild' parameter`);
    const binaryPath = compiler.getNodeExecutableLocation();
    if (existsSync(binaryPath)) {
        unlinkSync(binaryPath);
        console.log(`\nDeleted "${binaryPath}" due to rebuild parameter.`);
    }

    return next();
}

/**
 * Inject custom CLI parsing logic to node source.
 * @type {NexePatchFunction} */
async function injectCliOptions(compiler, next) {
    // Add marker editor version to NODE_VERSION
    await compiler.replaceInFileAsync(
        'src/node.cc',
        /\bNODE_VERSION\b/,
        `"Marker Editor: v${version}\\n` +
            `Node:          " NODE_VERSION`
    );

    // Custom command line arguments. Otherwise Node will exit early
    // if these arguments are provided as node options.
    await compiler.replaceInFileAsync(
        'src/node_options.h',
        '  bool print_version = false;',
        '  bool print_version = false;\n' +
        '  bool cli_setup = false;'
    );
    await compiler.replaceInFileAsync(
        'src/node_options.cc',
        '  AddAlias("-v", "--version");',
        '  AddAlias("-v", "--version");\n' +
        '  AddOption("--cli-setup",\n' +
        '            "Use CLI setup for Marker Editor",\n' +
        '            &PerProcessOptions::cli_setup);'
    );

    // Since we're really just running a slightly modified version of node, we have to
    // use `--` to pass arguments to the actual program. Since we only ever want to run
    // MarkerEditor though, forward node args to the script.
    const hackyArgv = `    auto& argv = const_cast<std::vector<std::string>&>(env->argv());\n`;
    const forwardArg = (variable, arg) =>
        `    if (per_process::cli_options->${variable}) {\n` +
        `      argv.push_back("${arg}");\n` +
        `    }\n\n`;

    await compiler.replaceInFileAsync(
        'src/node.cc',
        'return StartExecution(env, "internal/main/run_main_module"); }',
        hackyArgv +
        forwardArg('print_help', '--help') +
        forwardArg('cli_setup', '--cli-setup') +
        forwardArg('print_version', '--version') +
        `    return StartExecution(env, "internal/main/run_main_module");\n  }`);

    return next();
}

/**
 * On Windows, use RCEdit to add the version and icon to the binary.
 * @type {NexePatchFunction} */
async function editWinResources(compiler, next) {
    if (!isWin) {
        return next();
    }

    const binaryPath = compiler.getNodeExecutableLocation();
    try {
        // RC overrides are only applied if we're doing a clean build,
        // hack around it by using rcedit on the binary to ensure they're added.
        if (statSync(binaryPath).size > 0) {
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

/**
 * Takes rollup's cjs output and writes the exe. */
async function toExe() {
    const platform = getPlatform();
    const output = `../dist/${binaryName}` + (isWin ? '.exe' : '');
    const arch = getArch();
    const nodeVersion = await getNodeVersion();

    // nexe doesn't appear to take into account that the currently cached build output is a different
    // target architecture. To get around that, ignore the standard 'out' folder and check for
    // architecture-specific output folders. If it doesn't exist, do a full build and rename the
    // output to an architecture-specific folder, and link that to the standard 'out' folder. This
    // relies on internal nexe behavior, but since it's dev-only, nothing user-facing should break if
    // nexe changes, this section will just have to be updated.
    const temp = process.env.NEXE_TEMP || join(homedir(), '.nexe');

    const oldOut = join(temp, nodeVersion, 'out');

    if (args.includes('clean')) {
        cleanBuild();
    }

    console.log(`Attempting to build ${platform}-${arch}-${nodeVersion}`);

    const archOut = oldOut + arch + (debug ? 'd' : '');
    const hadCache = existsSync(archOut);
    if (hadCache) {
        console.log(`Found cached output for ${arch}-${nodeVersion}, using that.`);

        // Wipe out any existing out link and replace with cached out{arch} link
        if (existsSync(oldOut)) {
            console.log(`Removing old link to 'out'`);
            rmSync(oldOut, { recursive : true, force : true });
        }

        symlinkSync(archOut, oldOut, 'junction');
    } else {
        // Always clear out the build directory if we don't have the
        // target architecture cached.
        rmSync(oldOut, { recursive : true, force : true });
    }

    try {
        await compile({
            input : resolve(buildDir, '../dist/built.cjs'),
            output : resolve(buildDir, output),
            build : true,
            configure : (isWin || !debug) ? [] : ['--debug'], // non-Win
            vcBuild : isWin ? ['nosign', debug ? 'debug' : 'release'] : [], // Win-only
            make : ['-j4'], // 4 concurrent jobs
            targets : [ `${platform}-${arch}-${nodeVersion}` ],
            loglevel : verbose ? 'verbose' : 'info',
            ico : iconPath,
            rc : {
                PRODUCTVERSION : rcVersion,
                FILEVERSION : rcVersion,
                ...rc
            },
            resources : [
                resolve(buildDir, '../package.json'),
                resolve(buildDir, '../index.html'),
                resolve(buildDir, '../Client/login.html'),
                resolve(buildDir, '../SVG/favicon.svg'),
                resolve(buildDir, '../index.*.js'),
                resolve(buildDir, '../login.*.js'),
                resolve(buildDir, '../dist/built.cjs'),
                ...hashedSVGs,
                ...hashedStyles,
            ],
            patches : [
                deleteNodeBinaryIfRebuilding,
                injectCliOptions,
                editWinResources,
            ]
        }); // Don't catch, interrupt on failure.
    } finally {
        // Only delete hashed/temp files once we've bundled them, not after webpack.
        for (const htmlInfo of Object.values(htmlFiles)) {
            ignoreError(() => {
                rmSync(htmlInfo.path);
                renameSync(htmlInfo.path + '_T', htmlInfo.path);
                rmSync(resolve(buildDir, `../${htmlInfo.js}`));
            });
        }

        for (const icon of hashedSVGs) {
            ignoreError(() => rmSync(icon));
        }

        for (const style of hashedStyles) {
            ignoreError(() => rmSync(style));
        }
    }

    // After everything is compiled, cache the output directory if needed.
    if (!hadCache) {
        renameSync(oldOut, archOut);
        symlinkSync(archOut, oldOut, 'junction');
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
 * Full pipeline to create MarkerEditor. */
async function build() {
    const msg = (m) => console.log(`\n${m}...`);
    msg('Removing Previous build output');
    const dist = resolve(buildDir, '../dist');
    if (!existsSync(dist)) {
        mkdirSync(dist);
    }

    for (const file of readdirSync(dist)) {
        // Don't remove zip files
        if (file.endsWith('.zip')) {
            continue;
        }

        // Don't remove webpack TODO
        if (file.startsWith('index')) {
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

    msg('Building exe');
    await toExe();

    msg('Copying native modules');

    let sqlite3Version = dependencies.sqlite3;
    if (/^[^~]/.test(sqlite3Version)) {
        // Always use the exact version listed
        sqlite3Version = sqlite3Version.substring(1);
    }

    const cacheDir = resolve(buildDir, '../dist/archCache');
    if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir);
    }

    const arch = getArch();

    mkdirSync(resolve(buildDir, '../dist/node_modules/sqlite3/build/Release'), { recursive : true });
    if (process.arch === arch) {
        // destination arch is the same as the system arch. Just copy the existing node_modules dir

        copyFileSync(
            resolve(buildDir, '../node_modules/sqlite3/build/Release/node_sqlite3.node'),
            resolve(buildDir, '../dist/node_modules/sqlite3/build/Release/node_sqlite3.node'));
    } else {
        const cacheVersion = join(cacheDir, `sqlite3-${sqlite3Version}-${arch}`);

        // Cross-compilation (e.g. --dest-cpu=ia32 on a 64-bit OS).
        // Instead of creating the infra to support downloading and un-taring sqlite3
        // binaries, it's required to manually build the dist/archCache structure using self/pre-built
        // binaries, using the naming outlined above in cacheVersion.
        if (!existsSync(cacheVersion) || !statSync(cacheVersion).isDirectory()) {
            throw new Error(`Unable to copy native sqlite3 module, archCache folder "${cacheVersion}" does not exist.`);
        }

        copyFileSync(
            join(cacheVersion, 'node_sqlite3.node'),
            resolve(buildDir, '../dist/node_modules/sqlite3/build/Release/node_sqlite3.node')
        );
    }

    copyFileSync(
        resolve(buildDir, '../node_modules/sqlite3/package.json'),
        resolve(buildDir, '../dist/node_modules/sqlite3/package.json')
    );

    msg('Writing README');
    writeReadme();

    if (!isWin && process.platform !== 'darwin') {
        msg(`Writing Linux Start script`);
        writeStartSh();
    }

    msg('Removing transpiled output');
    unlinkSync(resolve(buildDir, '../dist/built.cjs'));

    if (args.includes('zip') || args.includes('pack')) {
        msg('Zipping everything up');
        const zipName = `${binaryName}.v${version}-${process.platform}-${arch}`;
        let cmd;
        /* eslint-disable max-len */
        if (isWin) {
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
