import { resolve } from 'path';

const cd = import.meta.dirname;

/**
 * @param {string} js The JS file to pack
 * @returns {import('webpack').Configuration} */
function webpackConfig(js) {
    return {
        mode : 'production',
        entry : resolve(cd, `./Client/Script/${js}.js`),
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
            filename : `${js}.[contenthash].js`,
            path : resolve(cd),
        }
    };
}

export const IndexJS = webpackConfig('index');
export const LoginJS = webpackConfig('login');
