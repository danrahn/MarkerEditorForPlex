const fs = require('fs');
const { copySync } = require('fs-extra');
const { compile : exeCompile } = require('nexe');
const { resolve, join } = require('path');
const rcedit = require('rcedit');
const { rollup } = require('rollup');
const { exec } = require('child_process');

const { version } = require('../package.json');
const iconPath = resolve(__dirname, 'app.ico');

const appName = 'Marker Editor for Plex';
const binaryName = 'MarkerEditorForPlex';
const rc = {
    CompanyName : appName,
    ProductName : appName,
    FileDescription : appName,
    FileVersion : version,
    ProductVersion : version,
    InternalappName : appName + 'exe',
    LegalCopyright : 'MarkerEditorForPlex.exe copyright Daniel Rahn. MIT license. node.exe copyright Node.js contributors. MIT license.'
};

const defaultNodeVersion = '18.17.1';

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
        default:
            throw new Error(`Unsupported build platform "${process.platform}", exiting...`);
    }

    let arch = '';
    switch (process.arch) {
        case 'arm64':
            arch = 'arm64';
            break;
        case 'ia32':
            arch = 'ia32';
            break;
        case 'x64':
            arch = ('x86' in args || 'ia32' in args) ? 'ia32' : 'x64';
            break;
        default:
            throw new Error(`Unsupported build architecture "${process.arch}, exiting...`);
    }

    let nodeVersion = defaultNodeVersion;
    if (args.includes('version')) {
        const idx = args.indexOf('version');
        if (idx < args.length - 1) {
            nodeVersion = args[idx + 1];
        }
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
                if (process.platform !== 'win32') {
                    return next();
                }

                const exePath = compiler.getNodeExecutableLocation();
                try {
                    // RC overrides are only applied if we're doing a clean build,
                    // hack around it by using rcedit on the binary to ensure they're added.
                    if (fs.statSync(exePath).size > 0) {
                        await rcedit(exePath, {
                            'version-string' : rc,
                            'file-version' : version,
                            'product-version' : version,
                            icon : iconPath,
                        });
                    }
                } catch {
                    console.log('Unable to modify exe resources with rcedit.');
                }

                return next();
            }
        ]
    }); // Don't catch, interrupt on failure.
}

/**
 * Full pipeline to create MarkerEditorForPlex. */
async function build() {
    const msg = (m) => console.log(`\n${m}...`);
    msg('Removing Previous build output');
    const dist = resolve(__dirname, '../dist');
    for (const file of fs.readdirSync(dist)) {
        // Don't remove zip files
        if (file.endsWith('.zip')) {
            continue;
        }

        const fullPath = join(dist, file);
        if (fs.statSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive : true, force : true });
        } else {
            fs.unlinkSync(fullPath);
        }
    }

    // fs.rmSync(resolve(__dirname, '../dist'), { recursive : true, force : true });

    msg('Transpiling to cjs');
    await transpile();

    msg('Building exe');
    await toExe();

    msg('Copying native modules');

    // We don't actually need most of the files under node_modules/sqlite3 but
    // keep them anyway, except for sqlite-autoconf-***-tar.gz, as it's 3MB of unnecessary bloat.
    copySync(
        resolve(__dirname, '../node_modules/sqlite3'),
        resolve(__dirname, '../dist/node_modules/sqlite3'),
        { overwrite : true, recursive : true });

    const tarGzPath = resolve(__dirname, '../dist/node_modules/sqlite3/deps');
    if (fs.existsSync(tarGzPath)) {
        for (const file of fs.readdirSync(tarGzPath)) {
            const fullPath = join(tarGzPath, file);
            if (/sqlite-autoconf-\d+\.tar\.gz/.test(file)) {
                if (verbose) {
                    console.log(`Deleting ${file} from sqlite3 module to reduce bloat`);
                }

                fs.unlinkSync(fullPath);
            }
        }
    }

    msg('Removing transpiled output');
    fs.unlinkSync(resolve(__dirname, '../dist/built.cjs'));

    if (args.includes('zip') || args.includes('pack')) {
        msg('Zipping everything up');
        const zipName = `${binaryName}.v${version}-${process.platform}-${process.arch}`;
        let cmd;
        if (process.platform === 'win32') {
            cmd = `powershell Compress-Archive "${dist}/node_modules", "${dist}/${binaryName}.exe" "${dist}/${zipName}.zip" -Force`;
        } else {
            cmd = `tar -C '${dist}' -czvf '${dist}/${zipName}.tar.gz' node_modules '${binaryName}'`;
        }

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
