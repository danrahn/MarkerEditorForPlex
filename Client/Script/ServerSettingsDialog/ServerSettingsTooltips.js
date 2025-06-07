import { $a, $append, $br, $code, $divHolder, $hr, $li, $span, $ul } from '../HtmlHelpers.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import { ServerSettings } from '/Shared/ServerConfig.js';
import { ThemeColors } from '../ThemeColors.js';

/** @typedef {{ tooltip: HTMLElement, sticky: boolean }} ServerSettingsTooltip */

/** @type {{[key: string]: ServerSettingsTooltip}} */
let SettingTooltips = null;

/**
 * @param {string|HTMLElement} shortDescription
 * @param {string|HTMLElement} longDescription
 * @param {boolean} sticky*/
function createTooltip(shortDescription, longDescription, sticky=false) {
    return {
        tooltip : $divHolder({ class : 'serverSettingTooltip' }, shortDescription, $hr(), longDescription),
        sticky : sticky
    };
}

/**
 * Create a title span for an experimental feature.
 * @param  {...[string|HTMLElement]} titleElements
 * @returns A span with a warning icon prepended. */
function experimentalTitle(...titleElements) {
    return $append(
        $span(),
        getSvgIcon(Icons.Warn,
            ThemeColors.Orange,
            { class : 'warningIcon', height : '1em', width : '1em', style : `vertical-align : text-bottom;` }),
        ` [Experimental] `,
        ...titleElements);
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
            $append($span(),
                `Defaults to `,
                $code('com.plexapp.plugins.library.db'),
                ` within the `,
                $code(`Plug-in Support/Databases`),
                ` folder of the data directory above. Optional if said data path is valid. ` +
                `Providing an explicit path can be useful for testing if you want to run this application on a copy of your ` +
                `database to ensure nothing unexpected happens.`
            )
        ),
        [ServerSettings.Host] : createTooltip(
            `The interface to listen on`,
            `Defaults to localhost, but could be changed to e.g. the machine's LAN IP if you want to modify markers ` +
            `on a different device on your local network, or 0.0.0.0 to listen on any interface. If authentication is ` +
            `not enabled (and even if it is), be careful about how widely you expose the application.`
        ),
        [ServerSettings.Port] : createTooltip(
            `The port the server will listen on`,
            `Must be a number between 1 and 65535, but it's recommended to stay above 1023.`
        ),
        [ServerSettings.BaseUrl] : createTooltip(
            `The root of this application.`,
            `Useful for reverse proxies. E.g. if you're using a proxy that forwards example.com/markerEdit to localhost:3232, ` +
            `this value should be markerEdit.`
        ),
        [ServerSettings.UseSsl] : createTooltip(
            `Create a server that supports SSL communication (HTTPS)`,
            `In order for SSL to be enabled, a valid certificate and private key must be provided. The HTTPS server ` +
            `must also only be accessed via the domain(s) listed in the certificate, otherwise browsers will complain.`
        ),
        [ServerSettings.SslOnly] : createTooltip(
            `Force secure connections`,
            `If enabled, will not launch the HTTP server and will only serve HTTPS requests.`
        ),
        [ServerSettings.SslHost] : createTooltip(
            `The host to listen on for the HTTPS server.`,
            `Defaults to 0.0.0.0, so make sure that if you keep the default, you don't accidentally expose the server ` +
            `more broadly than you intend.`
        ),
        [ServerSettings.SslPort] : createTooltip(
            `The port to listen on for the HTTPS server.`,
            `Must be a number between 1 and 65535, but it's recommended to stay above 1023.`
        ),
        [ServerSettings.CertType] : createTooltip(
            `The type of certificate to use for the HTTPS server.`,
            `PFX (certificate file + string passphrase) and PEM (certificate file + ` +
            `private key file) are supported.`
        ),
        [ServerSettings.PfxPath] : createTooltip(
            `Path to a PKCS#12 certificate file.`,
            $append($span(), `See `, $a('PKCS #12 - Wikipedia', 'https://en.wikipedia.org/wiki/PKCS_12'), ' for more information.'),
            true /*sticky*/
        ),
        [ServerSettings.PfxPassphrase] : createTooltip(
            `Passphrase for the PFX certificate.`,
            ``
        ),
        [ServerSettings.PemCert] : createTooltip(
            `Path to a PEM certificate file`,
            $append($span(),
                `See `,
                $a('Privacy-Enhanced Mail - Wikipedia', 'https://en.wikipedia.org/wiki/Privacy-Enhanced_Mail'),
                ' for more information.'
            ),
            true /*sticky*/
        ),
        [ServerSettings.PemKey] : createTooltip(
            `Path to a PEM private key file.`,
            ``
        ),
        [ServerSettings.UseAuthentication] : createTooltip(
            `Whether to require a password to access Marker Editor`,
            `Note that if this is enabled, you will be immediately send to a login page asking you to set a password. ` +
            `If you previously set a password, that must be entered, unless you manually delete auth.db in the Backup folder.`
        ),
        [ServerSettings.Username] : createTooltip(
            `The username for session authentication`,
            `Must not contain any whitespace, and cannot be more than 256 characters.`
        ),
        [ServerSettings.Password] : createTooltip(
            `The password for session authentication`,
            `Can be any non-blank value. If you don't remember your old password, you will have to manually delete auth.db ` +
            `in the Backup directory, which will also destroy all active sessions.`
        ),
        [ServerSettings.SessionTimeout] : createTooltip(
            `The time (in seconds) before a session expires due to inactivity.`,
            `Must be at least 5 minutes (300 seconds).`
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
            $append($span(),
                'Can only be set if Preview Thumbnails are enabled. If they are, and this setting is:',
                $append($ul(),
                    $append($li(),
                        `Disabled: Use video preview thumbnails that Plex generates. This ` +
                        `won't work if preview thumbnails are disabled, and can be very inaccurate depending on your `,
                        $code('GenerateBIFFrameInterval'),
                        ' and ',
                        $code('GenerateBIFKeyframesOnly'),
                        ' settings.'
                    ),
                    $append($li(),
                        `Enabled: Use FFmpeg to generate thumbnails on-the-fly. These are much more ` +
                            `accurate than Plex-generated thumbnails, but `,
                        $code('ffmpeg'),
                        ` must be on your path, and can take significantly longer to retrieve, ` +
                            `especially for large files.`
                    ),
                ),
            ),
        ),
        [ServerSettings.WriteExtraData] : createTooltip(
            experimentalTitle(`Write extra data to the media part's `, $code('extra_data'), ` field`),
            $append($span(),
                `If enabled, the application will write additional data to the media part's extra_data field, ` +
                `which isn't necessary for Plex to pick them up, but does result in a more consistent database.`,
                $br(),
                `However, it does mean there's another point of failure. If extra_data's schema changes, writing data in the now-old ` +
                `format could result in database corruption.`
            )
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
