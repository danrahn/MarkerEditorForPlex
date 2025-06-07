import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { isAuthSetting, isFeaturesSetting, isSslSetting, ServerSettings } from '../../Shared/ServerConfig.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

/** @typedef {!import('./MarkerEditorConfig').RawConfig} RawConfig */

const Log = ContextualLog.Create('EditorConfig');

/**
 * Look for the LocalAppDataPath override in the Windows registry.
 * Just use exec instead of importing an entirely new dependency just to grab a single value on Windows. */
function getWin32DataPathFromRegistry() {
    if (process.platform !== 'win32') {
        Log.error('Attempting to access Windows registry on non-Windows system. Don\'t do that!');
        return '';
    }

    try {
        // Valid output should be formatted as follows:
        // HKEY_CURRENT_USER\SOFTWARE\Plex, Inc.\Plex Media Server{\r\n}
        //     LocalAppDataPath    REG_SZ    D:\Path\To\Folder{\r\n}{\r\n}
        const data = execSync('REG QUERY "HKCU\\SOFTWARE\\Plex, Inc.\\Plex Media Server" /v LocalAppDataPath',
            { timeout : 10000 });

        return /REG_SZ\s+(?<dataPath>[^\r\n]+)/.exec(data.toString()).groups.dataPath;
    } catch (_ex) {
        Log.verbose('LocalAppData registry key does not exist or could not be parsed, assuming default location.');
    }

    return '';
}

/**
 * Attempts to retrieve the default Plex data directory for the current platform,
 * returning the empty string if it was not able to.
 * @returns {string} */
export function getDefaultPlexDataPath() {
    const platform = process.platform;
    switch (platform) {
        case 'win32':
        {
            const registryOverride = getWin32DataPathFromRegistry();
            if (registryOverride.length > 0) {
                return join(registryOverride, 'Plex Media Server');
            }

            if (!process.env.LOCALAPPDATA) {
                Log.warn('LOCALAPPDTA could not be found, manual intervention required.');
                return '';
            }

            return join(process.env.LOCALAPPDATA, 'Plex Media Server');
        }
        case 'darwin':
            if (process.env.HOME) {
                return join(process.env.HOME, 'Library/Application Support/Plex Media Server');
            }

            // __fallthrough
        case 'linux':
        case 'aix':
        case 'openbsd':
        case 'sunos':
        {
            if (process.env.PLEX_HOME) {
                return join(process.env.PLEX_HOME, 'Library/Application Support/Plex Media Server');
            }

            // Common Plex data locations
            const testPaths = [
                '/var/lib/plexmediaserver/Library/Application Support',
                '/var/snap/plexmediaserver/common/Library/Application Support',
                '/var/lib/plex',
                '/var/packages/PlexMediaServer/shares/PlexMediaServer/AppData',
                '/volume1/Plex/Library',
            ];

            for (const path of testPaths) {
                const fullPath = join(path, 'Plex Media Server');
                if (existsSync(fullPath)) {
                    return fullPath;
                }
            }

            return '';
        }
        case 'freebsd':
            return '/usr/local/plexdata/Plex Media Server';
        default:
            Log.warn(`Found unexpected platform '${platform}', cannot find default data path.`);
            return '';
    }
}


/**
 * Very basic port validation, ensuring it's an integer between 1 and 65,535.
 * @param {string} port The port as a string */
export function validPort(port) {
    const portInt = parseInt(port);
    return !isNaN(portInt) && portInt > 0 && portInt < 65536 && portInt.toString() === port.toString();
}

/**
 * Verify that the given session timeout is at least 60 seconds.
 * @param {string} timeout The user-supplied timeout. */
export function validSessionTimeout(timeout) {
    const timeoutInt = parseInt(timeout);
    return !isNaN(timeoutInt) && timeoutInt > 59 && timeoutInt.toString() === timeout.toString();
}

/**
 * Ensure all path mappings are valid, setting isValid to false if that's not the case.
 * @param {Setting<PathMapping[]>} setting
 * @param {Setting<PathMapping[]>} existing */
export function validatePathMappings(setting, existing) {
    // Don't verify that the paths exist, just make sure they're in the right format.
    const values = setting.value();
    const invalidRows = [];
    if (!(values instanceof Array)) {
        setting.setValid(false, `Expected an array of path mappings, found ${typeof values}`);
        return setting;
    }

    /** @type {(mapping: PathMapping) => boolean} */
    const mappingExists = mapping => existing.some(map => map.from === mapping.from && map.to === mapping.to);

    let i = 0;
    let anyChangedMappings = existing.length !== values.length;
    for (const mapping of values) {
        anyChangedMappings ||= !mappingExists(mapping);
        let rowInvalid = false;
        const invalidInfo = { row : i++ };
        if (typeof mapping.to === 'string') {
            rowInvalid = !existsSync(mapping.to);
            if (rowInvalid) {
                invalidInfo.toError = `Path does not exist.`;
            }
        } else {
            rowInvalid = true;
            invalidInfo.toError = `Expected 'to' path to be a string, found '${typeof mapping.to}'`;
        }

        if (typeof mapping.from !== 'string') {
            rowInvalid = true;
            invalidInfo.fromError = `Expected 'from' path to be a string, found '${typeof mapping.from}'`;
        }

        if (rowInvalid) {
            invalidRows.push(invalidInfo);
        }
    }

    if (invalidRows.length > 0) {
        setting.setValid(false, JSON.stringify(invalidRows));
    }

    if (anyChangedMappings) {
        setting.setUnchanged(false);
    }

    return setting;
}


/**
 * @template T
 * @param {TypedSetting<T>} setting */
export function settingValue(setting) {
    return (setting.value === null || setting.value === undefined) ? setting.defaultValue : setting.value;
}

/**
 * Maps a flat setting name to a raw setting name.
 * Retrieve the raw config path for the given setting.
 * @param {string} setting */
export function mapNameToRaw(setting) {
    switch (setting) {
        case ServerSettings.UseSsl:
            return 'enabled';
        case ServerSettings.UseAuthentication:
            return 'enabled';
        case ServerSettings.SessionTimeout:
            return 'sessionTimeout';
        default:
            return setting;
    }
}

/**
 * Maps a setting to its location in the raw config.
 * @param {string} setting
 * @param {RawConfig} rawConfig
 * @param {boolean} [create=true] If true, creates any necessary subsections. If false, returns
 *                                undefined if it does not already exist in the raw config. */
export function flatToRaw(setting, rawConfig, create=true) {
    if (isAuthSetting(setting)) {
        return create ? (rawConfig.authentication ??= {}) : rawConfig.authentication;
    }

    if (isSslSetting(setting)) {
        return create ? (rawConfig.ssl ??= {}) : rawConfig.ssl;
    }

    if (isFeaturesSetting(setting)) {
        return create ? (rawConfig.features ??= {}) : rawConfig.features;
    }

    return rawConfig;
}
