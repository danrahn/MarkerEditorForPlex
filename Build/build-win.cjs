const fs = require('fs');
const { copySync } = require('fs-extra');
const { compile: exeCompile } = require('nexe');
const { resolve } = require('path');
const rcedit = require('rcedit');
const { rollup } = require('rollup');
const { exec } = require('child_process');

let { version } = require('../package.json');
const iconPath = resolve(__dirname, 'app.ico');

const appName = 'Marker Editor for Plex';
const rc = {
    CompanyName : appName,
    ProductName : appName,
    FileDescription : appName,
    FileVersion : version,
    ProductVersion : version,
    InternalappName: appName + 'exe',
    LegalCopyright: "MarkerEditorForPlex.exe copyright Daniel Rahn. MIT license. node.exe copyright Node.js contributors. MIT license."
};

/**
 * Uses rollup to transpile app.js to common-js, as nexe can't consume es6 modules. */
async function transpile() {
    await rollup({
        input : resolve(__dirname, '../app.js'),
        onwarn : (warn, def) => {
            // We don't care about unresolved imports, nexe takes care of that.
            if (warn.code == 'UNRESOLVED_IMPORT') {
                return;
            }

            def(warn);
        }
    }).then((bundle) => {
        bundle.write({
            file: resolve(__dirname, '../dist/built.js'),
            format: 'cjs',
        });
    });
}

/**
 * Takes rollup's cjs output and writes the exe. */
async function toExe() {
    await exeCompile({
        input: resolve(__dirname, '../dist/built.js'),
        output: resolve(__dirname, '../dist/MarkerEditorForPlex.exe'),
        build: true,
        ico: iconPath,
        rc: Object.assign({
            'PRODUCTVERSION' : version,
            'FILEVERSION' : version
        }, rc),
        resources: [
            resolve(__dirname, '../package.json'),
            resolve(__dirname, '../index.html'),
            resolve(__dirname, '../SVG/*svg'),
            resolve(__dirname, '../Shared/**'),
            resolve(__dirname, '../Client/**'),
            resolve(__dirname, '../dist/built.js'),
        ],
        patches: [
            async (compiler, next) => {
                const exePath = compiler.getNodeExecutableLocation();
                try {
                    // RC overrides are only applied if we're doing a clean build,
                    // hack around it by using rcedit on the binary to ensure they're added.
                    if (fs.statSync(exePath).size > 0) {
                        await rcedit(exePath, {
                            'version-string': rc,
                            'file-version': version,
                            'product-version': version,
                            icon: iconPath,
                        });
                    }
                } catch {}
                return next();
            }
        ]
    }); // Don't catch, interrupt on failure.
}

/**
 * Full pipeline to create IntroEditorForPlex.exe. */
async function buildWin() {
    const msg = (m) => console.log(`\n${m}...`);
    msg('Removing Previous dist folder');
    fs.rmSync(resolve(__dirname, '../dist'), { recursive: true, force : true });

    msg('Transpiling to cjs');
    await transpile();

    msg('Building exe');
    await toExe();

    msg('Copying native modules');
    copySync(
        resolve(__dirname, '../node_modules/sqlite3'),
        resolve(__dirname, '../dist/node_modules/sqlite3'),
        { overwrite: true, recursive: true });
    
    msg('Removing transpiled output');
    fs.unlinkSync(resolve(__dirname, '../dist/built.js'));

    if (process.argv.indexOf('--zip') != -1) {
        msg('Zipping everything up');
        exec(`powershell Compress-Archive ${resolve(__dirname, '../dist')}/* ${resolve(__dirname, '../dist')}/MarkerEditorForPlex.v${version}-win64.zip`, (err) => {
            if (err) { console.error(err.message); } else { console.log('Done!'); }
        });
    } else {
        console.log('Done!');
    }
}

buildWin();
