import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { ContextualLog } from '../Shared/ConsoleLog.js';
import { testFfmpeg } from './ServerHelpers.js';

/**
 * @typedef {{
 *  autoOpen?: boolean,
 *  extendedMarkerStats?: boolean,
 *  previewThumbnails?: boolean,
 *  preciseThumbnails?: boolean
 * }} RawConfigFeatures
 *
 * @typedef {{
 *  from: string,
 *  to: string
 * }} PathMapping
 *
 * @typedef {{
 *  dataPath?: string,
 *  database?: string,
 *  host?: string,
 *  port?: number,
 *  logLevel?: string,
 *  features?: RawConfigFeatures,
 *  pathMappings?: PathMapping[],
 * }} RawConfig
 */

const Log = new ContextualLog('EditorConfig');

/**
 * The protected fields of ConfigBase that are available to derived classes, but not available externally.
 * @typedef {{json : Object, getOrDefault : Function }} ConfigBaseProtected */

/**
 * Base class for a piece of a configuration file.
 *
 * Note that this is also acting as a bit of an experiment with "protected" members, i.e. members
 * that are only accessible to the base class and those that derive from it. To accomplish this,
 * derived classes pass in an empty object to this base class's constructor, and this class
 * populates it with the "protected" members, bound to this base instance. Derived classes then
 * set their own private #Base member to that object, and use it as a proxy to this classes
 * private members.
 *
 * It's not super clean, and probably much easier to just make the base members public, or
 * duplicate the code between PlexFeatures and MarkerEditorConfig, but where's the fun in that?
 */
class ConfigBase {
    /** The raw configuration file.
     * @type {object} */
    #json;

    /**
     * @param {object} json
     * @param {ConfigBaseProtected} protectedFields Out parameter - contains private members and methods
     * to share with the derived class that called us, making them "protected" */
    constructor(json, protectedFields) {
        this.#json = json || {};
        protectedFields.getOrDefault = this.#getOrDefault.bind(this);
        protectedFields.json = this.#json;
    }

    /**
     * @param {string} key The config property to retrieve.
     * @param {*} [defaultValue=null] The default value if the property doesn't exist.
     * @param {string?} defaultType If defaultValue is a function, defaultType indicates the return value type.
     * @returns The retrieved property value.
     * @throws if `value` is not in the config and `defaultValue` is not set. */
    #getOrDefault(key, defaultValue=null, defaultType=null) {
        if (!Object.prototype.hasOwnProperty.call(this.#json, key)) {
            if (defaultValue === null) {
                throw new Error(`'${key}' not found in config file, and no default is available.`);
            }

            // Some default values are non-trivial to determine, so don't compute it
            // until we know we need it.
            if (typeof defaultValue === 'function')  {
                defaultValue = defaultValue();
            }

            Log.info(`'${key}' not found in config file. Defaulting to '${defaultValue}'.`);
            return defaultValue;
        }

        // If we have a default value and its type doesn't match what's in the config, reset it to default.
        const value = this.#json[key];
        return this.#checkType(key, value, defaultValue, defaultType);
    }

    /**
     * @param {string} key
     * @param {any} value
     * @param {any} defaultValue
     * @param {string?} defaultType */
    #checkType(key, value, defaultValue, defaultType) {
        const vt = typeof value;
        let dt = typeof defaultValue;

        if (dt === 'function') {
            Log.assert(defaultType !== null, '#checkType - Cant have a null defaultType if defaultValue is a function.');
            dt = defaultType;
        }

        if (defaultValue === null || vt === dt) {
            Log.verbose(`Setting ${key} to ${dt === 'object' ? JSON.stringify(value) : value}`);
            return value;
        }

        Log.warn(`Type Mismatch: '${key}' should have a type of '${dt}', found '${vt}'. Attempting to coerce...`);

        const space = '                ';
        // Allow some simple conversions
        switch (dt) {
            case 'boolean':
                // Intentionally don't allow for things like tRuE, just the standard lower- or title-case.
                if (value === 'true' || value === 'True' || value === '1' || value === 1) {
                    Log.warn(`${space}Coerced to boolean value 'true'`);
                    return true;
                }

                if (value === 'false' || value === 'False' || value === '0' || value === 0) {
                    Log.warn(`${space}Coerced to boolean value 'false'`);
                    return false;
                }

                break;
            case 'string':
                switch (vt) {
                    case 'boolean':
                    case 'number':
                        Log.warn(`${space}Coerced to string value '${value.toString()}'`);
                        return value.toString();
                }
                break;
            case 'number': {
                const asNum = +value;
                if (!isNaN(asNum)) {
                    Log.warn(`${space}Coerced to number value '${asNum}'`);
                    return asNum;
                }
                break;
            }
        }

        const ret = (typeof defaultValue === 'function') ? defaultValue() : defaultValue;
        Log.error(`${space}Could not coerce. Ignoring value '${value}' and setting to '${ret}'`);
        return ret;
    }
}

/**
 * Captures the 'features' portion of the configuration file.
 */
class PlexFeatures extends ConfigBase {
    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
    #Base = {};

    /** Setting for opening the UI in the browser on launch */
    autoOpen = true;

    /** Setting for gathering all markers before launch to compile additional statistics. */
    extendedMarkerStats = true;

    /** Setting for displaying timestamped preview thumbnails when editing or adding markers.
     * @type {boolean} */
    previewThumbnails = true;

    /** Setting for displaying precise ffmpeg-based preview thumbnails opposed to the pre-generated Plex BIF files.
     * @type {boolean} */
    preciseThumbnails = false;

    /** Sets the application features based on the given json.
     * @param {RawConfigFeatures} json */
    constructor(json) {
        const baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Features not found in config, setting defaults');
            return;
        }

        this.autoOpen = this.#getOrDefault('autoOpen', true);
        this.extendedMarkerStats = this.#getOrDefault('extendedMarkerStats', true);
        this.previewThumbnails = this.#getOrDefault('previewThumbnails', true);
        this.preciseThumbnails = this.#getOrDefault('preciseThumbnails', false);

        if (this.previewThumbnails && this.preciseThumbnails) {
            this.preciseThumbnails = testFfmpeg();
            if (!this.preciseThumbnails) {
                Log.warn(`Precise thumbnails enabled, but ffmpeg wasn't found in your path! Falling back to BIF`);
            }
        }
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault(key, defaultValue);
    }
}

/**
 * Singleton editor config instance.
 * @type {MarkerEditorConfig}
 * @readonly */ // Externally readonly
let Instance;

/**
 * Provides read-only access to the users application configuration.
 */
class MarkerEditorConfig extends ConfigBase {
    /**
     * Create the singleton config instance.
     * @param {*} testData
     * @param {string} dataRoot The root of the config file, which isn't the same as the project root in Docker. */
    static Create(testData, dataRoot) {
        if (Instance) {
            Log.warn(`Singleton MarkerEditorConfig already exists, we shouldn't be creating it again!`);
        }

        Instance = new MarkerEditorConfig(testData, dataRoot);
        return Instance;
    }

    static Close() { Instance = null; }

    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
    #Base = {};

    /** The path to the root of Plex's data directory.
     * https://support.plex.tv/articles/202915258-where-is-the-plex-media-server-data-directory-located/
     * @type {String} */
    #dataPath;

    /** The file path to the Plex database
     * @type {string} */
    #dbPath;

    /** The host to bind the application to.
     * @type {string} */
    #host;

    /** The port to bind the application to.
     * @type {number} */
    #port;

    /** Configurable features that can be enabled/disabled in this application.
     * @type {PlexFeatures} */
    #features;

    /** Prefix path mappings used to adjust file paths for FFmpeg-generated thumbnails.
     * @type {PathMapping[]} */
    #mappings = [];

    /** Current app version, retrieved from package.json
     * @type {string} */
    #version;

    /** Creates a new MarkerEditorConfig. */
    constructor(testData, dataRoot) {
        Log.info('Reading configuration...');
        const baseClass = {};

        let configFile = 'config.json';
        // If we're in a test environment, check for an override config file
        if (testData.isTest && testData.configOverride) {
            configFile = join('Test', testData.configOverride);
        }

        const configPath = join(dataRoot, configFile);
        /** @type {RawConfig} */
        let config = {};
        if (testData.isTest || existsSync(configPath)) {
            config = JSON.parse(readFileSync(configPath, { encoding : 'utf-8' }));
        } else {
            Log.warn('Unable to find config.json, attempting to use default values for everything.');
        }

        super(config, baseClass);
        this.#Base = baseClass;

        Log.setFromString(this.#getOrDefault('logLevel', 'Info'));
        if (process.env.IS_DOCKER) {
            // Config _should_ have the right values in Docker, but "help" the user out
            // by forcing it in case they were altered afterwards.
            this.#dataPath = '/PlexDataDirectory';
            this.#dbPath = join(this.#dataPath, 'Plug-in Support/Databases/com.plexapp.plugins.library.db');
            this.#host = '0.0.0.0';
            this.#port = 3232;
        } else {
            this.#dataPath = this.#getOrDefault('dataPath', MarkerEditorConfig.getDefaultPlexDataPath, 'string');
            this.#dbPath = this.#getOrDefault(
                'database',
                join(this.#dataPath, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db'));

            this.#host = this.#getOrDefault('host', 'localhost');
            this.#port = this.#getOrDefault('port', 3232);
        }

        this.#verifyPathExists(this.#dbPath, 'database');
        this.#features = new PlexFeatures(this.#Base.json.features);

        this.#getPathMappings();

        // We only need the data path if BIF-based preview thumbnails are enabled,
        // so don't fail if we're not using them.
        if (this.#features.previewThumbnails && !this.#features.preciseThumbnails) {
            this.#verifyPathExists(this.#dataPath, 'dataPath');
        }

        const packagePath = join(ProjectRoot(), 'package.json');
        if (existsSync(packagePath)) {
            try {
                this.#version = JSON.parse(readFileSync(packagePath).toString()).version;
            } catch (err) {
                Log.warn(`Unable to parse package.json for version, can't check for updates.`);
                this.#version = '0.0.0';
            }
        } else {
            Log.warn(`Unable to find package.json, can't check for new version.`);
            this.#version = '0.0.0';
        }
    }

    /**
     * Ensures the given file/path exists, throwing an error if it doesn't.
     * @param {PathLike} file
     * @param {string} key The setting the path is associated with. */
    #verifyPathExists(file, key) {
        if (!existsSync(file)) {
            throw new Error(`Path for ${key} ('${file}') does not exist, cannot continue.`);
        }
    }

    /**
     * Retrieve and validate any path mappings from the config file. */
    #getPathMappings() {
        const mappings = this.#getOrDefault('pathMappings', []);

        for (const mapping of mappings) {
            if (!mapping.from || !mapping.to) {
                Log.warn(mapping, `Malformed mapping. Could not find both 'from' and 'to' field, skipping`);
                continue;
            }

            const fromType = typeof mapping.from;
            const toType = typeof mapping.to;
            if (fromType !== 'string' || toType !== 'string') {
                Log.warn(mapping, `Malformed mapping. 'from' and 'to' must be strings, found [${fromType}, ${toType}]'`);
            }

            // Pass from/to directly instead of just pushing the mapping to get rid of any
            // extra fields that might be in the config file.
            this.#mappings.push({ from : mapping.from, to : mapping.to });
        }
    }

    /**
     * Attempts to retrieve the default Plex data directory for the current platform,
     * returning the empty string if it was not able to.
     * @returns {string} */
    static getDefaultPlexDataPath() {
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
                return '~/Library/Application Support/Plex Media Server';
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

    /** Forwards to {@link ConfigBase}s `#getOrDefault`} */
    #getOrDefault(key, defaultValue=null, defaultType=null) {
        return this.#Base.getOrDefault(key, defaultValue, defaultType);
    }

    databasePath() { return this.#dbPath; }
    host() { return this.#host; }
    port() { return this.#port; }
    autoOpen() { return this.#features.autoOpen; }
    useThumbnails() { return this.#features.previewThumbnails; }
    usePreciseThumbnails() { return this.#features.preciseThumbnails; }
    metadataPath() { return this.#dataPath; }
    extendedMarkerStats() { return this.#features.extendedMarkerStats; }
    disableExtendedMarkerStats() { this.#features.extendedMarkerStats = false; }
    appVersion() { return this.#version; }
    pathMappings() { return this.#mappings; }
}

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
 * Cached root directory.
 * @type {string} */
let globalProjectRoot = undefined;

/**
 * Retrieve the root path of this application.
 *
 * Doesn't live in MarkerEditorConfig directly because it occasionally needs to be
 * accessed before MarkerEditorConfig is completely set up. */
const ProjectRoot = () => (globalProjectRoot ??= dirname(dirname(fileURLToPath(import.meta.url))));

export { MarkerEditorConfig, Instance as Config, ProjectRoot };
