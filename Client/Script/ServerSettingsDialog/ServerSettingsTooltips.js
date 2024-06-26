import { appendChildren, buildNode, buildText } from '../Common.js';
import { ServerSettings } from '/Shared/ServerConfig.js';

/** @type {{[key: string]: HTMLElement}} */
let SettingTooltips = null;

/**
 * @param {string|HTMLElement} shortDescription
 * @param {string|HTMLElement} longDescription */
function createTooltip(shortDescription, longDescription) {
    const short = (shortDescription instanceof Element) ? shortDescription : buildText(shortDescription);
    const long = (longDescription instanceof Element) ? longDescription : buildText(longDescription);
    return appendChildren(buildNode('div', { class : 'serverSettingTooltip' }),
        short,
        buildNode('hr'),
        long
    );
}

/**
 * Ensures all tooltip have been created */
function initializeServerSettingsTooltips() {
    if (SettingTooltips) {
        return;
    }

    SettingTooltips = {
        [ServerSettings.DataPath] : createTooltip(
            `Path to the Plex data directory`,
            `This is only necessary if the application can't find the data directory automatically, ` +
            `or you want to override the default location. It's also optional if Plex-generated ` +
            `preview thumbnails are disabled.`
        ),
        [ServerSettings.Database] : createTooltip(
            `Full path to the Plex database`,
            appendChildren(buildNode('span'),
                buildText(`Defaults to `),
                buildNode('code', {}, 'com.plexapp.plugins.library.db'),
                buildText(` within the `),
                buildNode('code', {}, `Plug-in Support/Databases`),
                buildText(` folder of the data directory above. Optional if said data path is valid. ` +
                `Providing an explicit path can be useful for testing if you want to run this application on a copy of your ` +
                `database to ensure nothing unexpected happens.`)
            )
        ),
        [ServerSettings.Host] : createTooltip(
            `The interface to listen on`,
            `Defaults to localhost, but could be changed to e.g. the machine's LAN IP if you want to modify markers ` +
            `on a different device on your local network, or 0.0.0.0 to listen on any interface. Note that this ` +
            `this application has no authentication, so be careful about how widely you expose the application.`
        ),
        [ServerSettings.Port] : createTooltip(
            `The port the server will listen on`,
            `Must be a number between 1 and 65535, but it's recommended to stay above 1023`
        ),
        [ServerSettings.LogLevel] : createTooltip(
            `Server-side logging level`,
            `Determines what log events to write out. On consoles that support color output, 'Dark' determines ` +
            `whether dark- or light-themed colors are used.`
        ),
        [ServerSettings.AutoOpen] : createTooltip(
            `Launch browser after boot`,
            `Determines whether a browser tab is launched when the server boots.`
        ),
        [ServerSettings.ExtendedStats] : createTooltip(
            `Display extended marker statistics`,
            `If enabled, calculates additional statistics per library/show/season. It's recommended to keep this ` +
            `enabled unless you run into issues with it enabled.`
        ),
        [ServerSettings.PreviewThumbnails] : createTooltip(
            `Enable preview thumbnails`,
            `Determines whether the application should retrieve preview thumbnails when adding/editing markers ` +
            `to give a visual guide of where you are in a video. If enabled, the retrieval method depends on ` +
            `precise thumbnails below.`
        ),
        [ServerSettings.FFmpegThumbnails] : createTooltip(
            `Determines how to retrieve preview thumbnails`,
            appendChildren(buildNode('span'),
                buildText('Can only be set if Preview Thumbnails are enabled. If they are, and this setting is:'),
                appendChildren(buildNode('ul'),
                    appendChildren(buildNode('li'),
                        buildText(`Disabled: Use video preview thumbnails that Plex generates. This ` +
                        `won't work if preview thumbnails are disabled, and can be very inaccurate depending on your `),
                        buildNode('code', {}, 'GenerateBIFFrameInterval'),
                        buildText(' and '),
                        buildNode('code', {}, 'GenerateBIFKeyframesOnly'),
                        buildText(' settings.')
                    ),
                    appendChildren(buildNode('li'),
                        buildText(`Enabled: Use FFmpeg to generate thumbnails on-the-fly. These are much more ` +
                            `accurate than Plex-generated thumbnails, but `),
                        buildNode('code', {}, 'ffmpeg'),
                        buildText(` must be on your path, and can take significantly longer to retrieve, ` +
                            `especially for large files.`)
                    ),
                ),
            ),
        ),
        [ServerSettings.PathMappings] : createTooltip(
            `Map paths first FFmpeg-based thumbnails`,
            `A list of "from" and "to" mappings that can map paths in your database to paths to local paths. This ` +
            `can be helpful if you're running Marker Editor on a different device than Plex itself.`
        ),
    };
}

/**
 * Retrieve the help tooltip for the given setting.
 * @param {string} setting A value of ServerSettings */
export function GetTooltip(setting) {
    initializeServerSettingsTooltips();
    return SettingTooltips[setting];
}
