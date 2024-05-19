import HtmlWebpackPlugin from 'html-webpack-plugin';
import { resolve } from 'path';

const cd = import.meta.dirname;

/** @type {import('webpack').Configuration} */
export default {
    mode : 'production',
    entry : resolve(cd, './Client/Script/index.js'),
    resolve : {
        alias : {
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
    plugins : [
        new HtmlWebpackPlugin({
            template : resolve(cd, 'index.html')
        })
    ],
    output : {
        filename : 'index.[contenthash].js',
        path : resolve(cd, 'dist'),
    }
};
