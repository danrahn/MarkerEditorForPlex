import { readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';

import HtmlWebpackPlugin from 'html-webpack-plugin';
import webpack from 'webpack';

import Icons from './Client/Script/Icons.js';
import StyleSheets from './Client/Script/StyleSheets.js';

const cd = import.meta.dirname;

function md5(contents) {
    return createHash('md5').update(contents).digest('hex');
}

/**
 * Create maps for base assets that are bundled with hashes (stylesheets/icons).
 * @param {Record<string, string>} sourceMap The baseline map from asset key to base filenames.
 * @param {string} sourceRoot
 * @param {string} extension
 * @param {string} outputRoot */
function buildHashedAssetMaps(sourceMap, sourceRoot, extension, outputRoot) {
    /** @type {Record<string, string>} Map key to new hashed filename */
    const byKey = {};
    /** @type {Record<string, string>} Map base filename to hashed filename */
    const byBase = {};
    /** @type {{ outputPath: string, contents: Buffer }[]} The actual assets emitted. */
    const emitted = [];

    for (const [assetKey, baseName] of Object.entries(sourceMap)) {
        if (!byBase[baseName]) {
            const sourcePath = resolve(sourceRoot, `${baseName}${extension}`);
            const contents = readFileSync(sourcePath);
            const hashedBaseName = `${baseName}.${md5(contents)}`;
            byBase[baseName] = hashedBaseName;
            emitted.push({
                outputPath : `${outputRoot}/${hashedBaseName}${extension}`,
                contents : contents,
            });
        }

        byKey[assetKey] = byBase[baseName];
    }

    return { byKey, byBase, emitted };
}

/**
 * Emit non-hashed static assets into dist as-is.
 * @param {string} sourceRoot
 * @param {string} extension
 * @param {string} outputRoot */
function buildStaticAssets(sourceRoot, extension, outputRoot) {
    /** @type {{ outputPath: string, contents: Buffer }[]} */
    const emitted = [];
    for (const file of readdirSync(sourceRoot).sort()) {
        if (!file.toLowerCase().endsWith(extension.toLowerCase())) {
            continue;
        }

        emitted.push({
            outputPath : `${outputRoot}/${file}`,
            contents : readFileSync(resolve(sourceRoot, file)),
        });
    }

    return emitted;
}

/**
 * Emits pre-hashed static assets (icons/styles) into dist during compilation.
 *
 * These files are referenced indirectly through runtime maps (`__HASHED_ICONS__` / `__HASHED_STYLES__`)
 * and HTML preload/link rewrites, so webpack does not discover them through the normal module graph.
 * This plugin ensures they are still packaged as first-class build outputs.
 */
class EmitHashedAssetsPlugin {
    /** @param {{ outputPath: string, contents: Buffer }[]} assets */
    constructor(assets) {
        this.assets = assets;
    }

    /** @param {import('webpack').Compiler} compiler */
    apply(compiler) {
        const pluginName = 'EmitHashedAssetsPlugin';
        compiler.hooks.thisCompilation.tap(pluginName, compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name : pluginName,
                    stage : compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                () => {
                    for (const asset of this.assets) {
                        if (!compilation.getAsset(asset.outputPath)) {
                            compilation.emitAsset(asset.outputPath, new compiler.webpack.sources.RawSource(asset.contents));
                        }
                    }
                }
            );
        });
    }
}

const hashedStyles = buildHashedAssetMaps(StyleSheets, resolve(cd, 'Client/Style'), '.css', 'Client/Style');
const hashedIcons = buildHashedAssetMaps(Icons, resolve(cd, 'SVG'), '.svg', 'SVG');
const staticSvgs = buildStaticAssets(resolve(cd, 'SVG'), '.svg', 'SVG');

/**
 * Injects hashed asset references and bundles the given JS file into an HTML page.
 * @param {string} entry */
function templateFor(entry) {
    const templatePath = entry === 'index' ? resolve(cd, 'index.html') : resolve(cd, 'Client/login.html');
    const scriptRegex = new RegExp(`<script\\s+src="Client/Script/${entry}\\.js"\\s+type="module"><\\/script>\\s*`, 'i');
    let templateText = readFileSync(templatePath, 'utf-8').replace(scriptRegex, '');

    /** @type {(str: string) => string} */
    const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [baseName, hashedName] of Object.entries(hashedStyles.byBase)) {
        templateText = templateText.replace(
            new RegExp(`Client/Style/${escapeRegex(baseName)}\\.css`, 'g'),
            `Client/Style/${hashedName}.css`
        );
    }

    return ({ htmlWebpackPlugin }) => {
        const scripts = (htmlWebpackPlugin.files.js || [])
            .map(src => `<script src="${src}"></script>`)
            .join('');
        return templateText.replace('</body>', `${scripts}</body>`);
    };
}

/**
 * @param {string} js The JS file to pack
 * @returns {import('webpack').Configuration} */
function webpackConfig(js) {
    return {
        mode : 'production',
        entry : {
            [js] : resolve(cd, `./Client/Script/${js}.js`),
        },
        resolve : {
            alias : {
                MarkerTable : resolve(cd, 'Client/Script/MarkerTable/index.js'),
                ResultRow : resolve(cd, 'Client/Script/ResultRow/index.js'),
                StickySettings : resolve(cd, 'Client/Script/StickySettings/index.js'),
                ServerSettingsDialog : resolve(cd, 'Client/Script/ServerSettingsDialog/index.js'),
                '/Shared/PlexTypes.js' : resolve(cd, 'Shared/PlexTypes.js'),
                '/Shared/MarkerBreakdown.js' : resolve(cd, 'Shared/MarkerBreakdown.js'),
                '/Shared/ServerConfig.js' : resolve(cd, 'Shared/ServerConfig.js'),
                '/Shared/ConsoleLog.js' : resolve(cd, 'Shared/ConsoleLog.js'),
                '/Shared/MarkerType.js' : resolve(cd, 'Shared/MarkerType.js'),
                '/Shared/PostCommands.js' : resolve(cd, 'Shared/PostCommands.js'),
            }
        },
        output : {
            filename : '[name].[contenthash].js',
            path : resolve(cd, 'dist'),
            publicPath : '[[BASE_URL]]dist/',
        },
        plugins : [
            new webpack.DefinePlugin({
                __HASHED_ICONS__ : JSON.stringify(hashedIcons.byKey),
                __HASHED_STYLES__ : JSON.stringify(hashedStyles.byKey),
            }),
            new EmitHashedAssetsPlugin([...hashedStyles.emitted, ...hashedIcons.emitted, ...staticSvgs]),
            new HtmlWebpackPlugin({
                inject : false,
                filename : `${js}.html`,
                chunks : [js],
                scriptLoading : 'blocking',
                templateContent : templateFor(js),
            }),
        ],
        // This is a single-page app that would load any separate chunks immediately anyway,
        // so it's okay to have bigger assets.
        performance : {
            maxAssetSize : 512 * 1024,
            maxEntrypointSize : 512 * 1024,
        },
    };
}

export const IndexJS = webpackConfig('index');
export const LoginJS = webpackConfig('login');
