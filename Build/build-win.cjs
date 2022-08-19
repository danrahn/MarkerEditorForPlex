const fs = require('fs');
const { compile } = require('nexe');
const { resolve } = require('path');
const rcedit = require('rcedit');

let { version, description } = require('../package.json');
const iconPath = resolve('./Build/app.ico');

const appName = 'Plex Intro Editor';
const rc = {
    CompanyName : appName,
    ProductName : appName,
    FileDescription : description,
    FileVersion : version,
    ProductVersion : version,
    InternalappName: appName + 'exe',
    LegalCopyright: "PlexIntroEditor.exe copyright Daniel Rahn. MIT license. node.exe copyright Node.js contributors. MIT license."
};

compile({
    input: './dist/built.js',
    output: './dist/PlexIntroEditor.exe',
    build: true,
    ico: iconPath,
    rc: Object.assign({
        'PRODUCTVERSION' : version,
        'FILEVERSION' : version
    }, rc),
    resources: [
        './node_modules/sqlite3/**'
    ],
    patches: [
        async (compiler, next) => {
            const exePath = compiler.getNodeExecutableLocation();
            try {
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
}).catch(console.error);
