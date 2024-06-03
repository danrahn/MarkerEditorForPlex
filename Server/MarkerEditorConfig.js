import { dirname, join } from 'path';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { allServerSettings, isFeatureSetting, ServerConfigState, ServerSettings, Setting } from '../Shared/ServerConfig.js';
import { BaseLog, ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';
import { GetServerState, ServerState } from './ServerState.js';
import { PlexQueries, PlexQueryManager } from './PlexQueryManager.js';
import { ServerEvents, waitForServerEvent } from './ServerEvents.js';
import { testFfmpeg, testHostPort } from './ServerHelpers.js';
import ServerError from './ServerError.js';

/** @typedef {!import('/Shared/ServerConfig').PathMapping} PathMapping */
/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */

/**
 * @template T
 * @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T> */


/**
 * @typedef {{
 *  autoOpen?: boolean,
 *  extendedMarkerStats?: boolean,
 *  previewThumbnails?: boolean,
 *  preciseThumbnails?: boolean
 * }} RawConfigFeatures
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
 * @typedef {<T>(key: string, defaultValue?: T, defaultType?: string) => Setting<T>} GetOrDefault
 */

/**
 * The protected fields of ConfigBase that are available to derived classes, but not available externally.
 * @typedef {{json : Object, getOrDefault : <T>(key: string, defaultValue?: T, defaultType?: string) => Setting<T> }} ConfigBaseProtected */

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
     * @template T
     * @param {string} key The config property to retrieve.
     * @param {T?} [defaultValue] The default value if the property doesn't exist.
     * @param {string?} defaultType If defaultValue is a function, defaultType indicates the return value type.
     * @returns {Setting<T>} The retrieved property value.
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
            return new Setting(null, defaultValue);
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
            return new Setting(value, defaultValue);
        }

        Log.warn(`Type Mismatch: '${key}' should have a type of '${dt}', found '${vt}'. Attempting to coerce...`);

        const space = '                ';
        // Allow some simple conversions
        switch (dt) {
            case 'boolean':
                // Intentionally don't allow for things like tRuE, just the standard lower- or title-case.
                if (value === 'true' || value === 'True' || value === '1' || value === 1) {
                    Log.warn(`${space}Coerced to boolean value 'true'`);
                    return new Setting(true, defaultValue);
                }

                if (value === 'false' || value === 'False' || value === '0' || value === 0) {
                    Log.warn(`${space}Coerced to boolean value 'false'`);
                    return new Setting(false, defaultValue);
                }

                break;
            case 'string':
                switch (vt) {
                    case 'boolean':
                    case 'number':
                        Log.warn(`${space}Coerced to string value '${value.toString()}'`);
                        return new Setting(value.toString(), defaultValue);
                }
                break;
            case 'number': {
                const asNum = +value;
                if (!isNaN(asNum)) {
                    Log.warn(`${space}Coerced to number value '${asNum}'`);
                    return new Setting(asNum, defaultValue);
                }
                break;
            }
        }

        const ret = (typeof defaultValue === 'function') ? defaultValue() : defaultValue;
        Log.error(`${space}Could not coerce. Ignoring value '${value}' and setting to '${ret}'`);
        return new Setting(null, ret);
    }
}

/**
 * Captures the 'features' portion of the configuration file.
 */
class PlexFeatures extends ConfigBase {
    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
    #Base = {};

    /**
     * Setting for opening the UI in the browser on launch
     * @type {Setting<boolean>} */
    autoOpen;

    /**
     * Setting for gathering all markers before launch to compile additional statistics.
     * @type {Setting<boolean>} */
    extendedMarkerStats;

    /** Setting for displaying timestamped preview thumbnails when editing or adding markers.
     * @type {Setting<boolean>} */
    previewThumbnails;

    /** Setting for displaying precise ffmpeg-based preview thumbnails opposed to the pre-generated Plex BIF files.
     * @type {Setting<boolean>} */
    preciseThumbnails;

    /** Sets the application features based on the given json.
     * @param {RawConfigFeatures} json */
    constructor(json) {
        const baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Features not found in config, setting defaults');
        }

        this.autoOpen = this.#getOrDefault('autoOpen', true);
        this.extendedMarkerStats = this.#getOrDefault('extendedMarkerStats', true);
        this.previewThumbnails = this.#getOrDefault('previewThumbnails', true);
        this.preciseThumbnails = this.#getOrDefault('preciseThumbnails', false);

        if (this.previewThumbnails.value() && this.preciseThumbnails.value()) {
            const canEnable = testFfmpeg();
            if (!canEnable) {
                this.preciseThumbnails.setValue(false);
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
    static async Create(testData, dataRoot) {
        if (Instance) {
            Log.warn(`Singleton MarkerEditorConfig already exists, we shouldn't be creating it again!`);
        }

        Instance = new MarkerEditorConfig(testData, dataRoot);
        await Instance.#init();
        return Instance;
    }

    static Close() { Instance = null; }

    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
    #Base = {};

    /** The path to the root of Plex's data directory.
     * https://support.plex.tv/articles/202915258-where-is-the-plex-media-server-data-directory-located/
     * @type {Setting<string>} */
    #dataPath;

    /** The file path to the Plex database
     * @type {Setting<string>} */
    #dbPath;

    /** The host to bind the application to.
     * @type {Setting<string>} */
    #host;

    /** The port to bind the application to.
     * @type {Setting<number>} */
    #port;

    /** @type {Setting<string>} */
    #logLevel;

    /** Configurable features that can be enabled/disabled in this application.
     * @type {PlexFeatures} */
    #features;

    /** Prefix path mappings used to adjust file paths for FFmpeg-generated thumbnails.
     * @type {Setting<PathMapping[]>} */
    #mappings = [];

    /** Current app version, retrieved from package.json
     * @type {Setting<string>} */
    #version;

    /** @type {number} */
    #configState;

    /** @type {boolean} */
    #allowInvalid = true;

    /** @type {string} */
    #configPath;

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
        let configExists = true;
        /** @type {RawConfig} */
        let config = {};
        if (testData.isTest || existsSync(configPath)) {
            config = JSON.parse(readFileSync(configPath, { encoding : 'utf-8' }));
        } else {
            Log.warn('Unable to find config.json, attempting to use default values for everything.');
            configExists = false;
        }

        super(config, baseClass);
        this.#Base = baseClass;

        if (testData.isTest) {
            this.#allowInvalid = false;
        }

        this.#configPath = configPath;
        this.#configState = configExists ? ServerConfigState.Valid : ServerConfigState.DoesNotExist;
    }

    async #init() {
        const configExists = this.#configState !== ServerConfigState.DoesNotExist;
        this.#logLevel = this.#getOrDefault('logLevel', 'Info');
        Log.setFromString(this.#logLevel.value());
        if (process.env.IS_DOCKER) {
            // Config _should_ have the right values in Docker, but "help" the user out
            // by forcing it in case they were altered afterwards.
            this.#dataPath = new Setting('/PlexDataDirectory', '/PlexDataDirectory');
            const dbPath = join(this.#dataPath.value(), 'Plug-in Support/Databases/com.plexapp.plugins.library.db');
            this.#dbPath = new Setting(dbPath, dbPath);
            this.#host = new Setting('0.0.0.0', '0.0.0.0');
            this.#port = new Setting(3232, 3232);
        } else {
            this.#dataPath = this.#getOrDefault('dataPath', MarkerEditorConfig.getDefaultPlexDataPath());
            this.#dbPath = this.#getOrDefault(
                'database',
                join(this.#dataPath.value(), 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db'));

            this.#host = this.#getOrDefault('host', 'localhost');
            this.#port = this.#getOrDefault('port', 3232);
            if (!MarkerEditorConfig.ValidPort(this.#port.value())) {
                this.#configState = ServerConfigState.Invalid;
                this.#port.setValid(false, `Invalid port`);
            }
        }

        await this.#validateDatabasePath(this.#dbPath, true /*setInvalid*/);
        this.#features = new PlexFeatures(this.#Base.json.features);

        this.#getPathMappings();

        // We only need the data path if BIF-based preview thumbnails are enabled,
        // so don't fail if we're not using them.
        if (this.#features.previewThumbnails && !this.#features.preciseThumbnails) {
            this.#validateDataPath(this.#dataPath);
        }

        const packagePath = join(ProjectRoot(), 'package.json');
        this.#version = new Setting(null, '0.0.0');
        if (existsSync(packagePath)) {
            try {
                this.#version = new Setting(JSON.parse(readFileSync(packagePath).toString()).version, '0.0.0');
            } catch (err) {
                Log.warn(`Unable to parse package.json for version, can't check for updates.`);
            }
        } else {
            Log.warn(`Unable to find package.json, can't check for new version.`);
        }

        // Always override configState if we didn't have a config file.
        if (!configExists) {
            this.#configState = ServerConfigState.DoesNotExist;
        }
    }

    /**
     * Retrieve and validate any path mappings from the config file. */
    #getPathMappings() {
        this.#getPathMappingsCore(this.#getOrDefault('pathMappings', []).value());
    }

    /**
     * @param {PathMapping[]} mappings */
    #getPathMappingsCore(mappings) {
        const validMappings = [];

        for (const mapping of mappings) {
            if (!mapping.from || !mapping.to) {
                Log.warn(mapping, `Malformed mapping. Could not find both 'from' and 'to' field, skipping`);
                continue;
            }

            const fromType = typeof mapping.from;
            const toType = typeof mapping.to;
            if (fromType !== 'string' || toType !== 'string') {
                Log.warn(mapping, `Malformed mapping. 'from' and 'to' must be strings, found [${fromType}, ${toType}]'`);
                continue;
            }

            // Pass from/to directly instead of just pushing the mapping to get rid of any
            // extra fields that might be in the config file.
            validMappings.push({ from : mapping.from, to : mapping.to });
        }

        this.#mappings = new Setting(mappings.length === 0 ? null : validMappings, []);
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
    static ValidPort(port) {
        const portInt = parseInt(port);
        return !isNaN(portInt) && portInt > 0 && portInt < 65536 && portInt.toString() === port.toString();
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`}
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null, defaultType=null) {
        return this.#Base.getOrDefault(key, defaultValue, defaultType);
    }

    databasePath() { return this.#dbPath.value(); }
    host() { return this.#host.value(); }
    port() { return this.#port.value(); }
    autoOpen() { return this.#features.autoOpen.value(); }
    useThumbnails() { return this.#features.previewThumbnails.value(); }
    usePreciseThumbnails() { return this.#features.preciseThumbnails.value(); }
    metadataPath() { return this.#dataPath.value(); }
    extendedMarkerStats() { return this.#features.extendedMarkerStats.value(); }
    disableExtendedMarkerStats() { this.#features.extendedMarkerStats = false; }
    appVersion() { return this.#version.value(); }
    pathMappings() { return this.#mappings.value(); }
    getValid() { return this.#configState; }
    /** @returns {SerializedConfig} */
    serialize() {
        return {
            dataPath : this.#dataPath.serialize(),
            database : this.#dbPath.serialize(),
            host : this.#host.serialize(),
            port : this.#port.serialize(),
            logLevel : this.#logLevel.serialize(),
            features : {
                autoOpen : this.#features.autoOpen.serialize(),
                extendedMarkerStats : this.#features.extendedMarkerStats.serialize(),
                previewThumbnails : this.#features.previewThumbnails.serialize(),
                preciseThumbnails : this.#features.preciseThumbnails.serialize(),
            },
            pathMappings : this.#mappings.serialize(),
            version : this.#version.serialize(),
            state : this.#configState,
        };
    }

    /**
     * @param {SerializedConfig} config */
    async trySetConfig(config) {
        const newConfig = await this.validateConfig(config);
        const result = {
            success : false,
            message : '',
            config : newConfig,
        };

        /** @type {RawConfig} */
        let newJson = {};
        if (this.#Base.json) {
            newJson = JSON.parse(JSON.stringify(this.#Base.json));
        }

        const val = s => (s.value === undefined || s.value === null) ? s.defaultValue : s.value;
        const explicitVal = s => s.value !== undefined && s.value !== null;
        const invalidOkay = s => {
            switch (s) {
                default:
                    return false;
                case ServerSettings.DataPath:
                    return newConfig.database.value && (
                        !val(newConfig.features.previewThumbnails)
                        || val(newConfig.features.preciseThumbnails));
                case ServerSettings.FFmpegThumbnails:
                    return !val(newConfig.features.previewThumbnails);
            }
        };

        /** @type {Set<string>} */
        const changedKeys = new Set();
        /** @type {(k: string, s: TypedSetting<T>) => void} */
        const setVal = (k, s) => {
            if (isFeatureSetting(k)) {
                (newJson.features ??= {})[k] = val(s);
            } else {
                newJson[k] = val(s);
            }

            if (!s.unchanged) {
                changedKeys.add(k);
            }
        };

        for (const settingKey of allServerSettings()) {
            const isFeature = isFeatureSetting(settingKey);
            /** @type {TypedSetting<T>} */
            const setting = isFeature ? newConfig.features[settingKey] : newConfig[settingKey];
            if (!setting.isValid && !invalidOkay(settingKey)) {
                result.message = `Invalid setting for "${settingKey}", cannot save settings.`;
                result.config.state = ServerConfigState.Invalid;
                return result;
            }

            if (explicitVal(setting)) {
                // An explicit value always overrides whatever's in the previous config.
                setVal(settingKey, setting);
            } else {
                // Default value used. If previous JSON had the value, overwrite it, otherwise
                // leave it out of the config.
                const jsonSetting = isFeature ? newJson.features?.[settingKey] : newJson[settingKey];
                if (jsonSetting) {
                    setVal(settingKey, setting);
                }
            }
        }

        Log.info(newJson, 'Setting new Config');

        // Try to change the internal state first, that way we don't write the config to disk if
        // we failed to update things internally for whatever reason.
        result.config.state = await this.#updateInternalConfig(newJson, changedKeys);

        // Overwrite existing contents. Using the original JSON should ensure that any extra
        // fields still remain, though order isn't guaranteed.
        writeFileSync(this.#configPath, JSON.stringify(newJson, null, 4) + '\n', { encoding : 'utf-8' });
        result.success = true;
        this.#configState = result.config.state;
        return result;
    }

    /**
     * @param {RawConfig} newConfig
     * @param {Set<string>} changedKeys */
    async #updateInternalConfig(newConfig, changedKeys) {

        if (changedKeys.has(ServerSettings.Host) || changedKeys.has(ServerSettings.Port)) {
            // Need to do a full update anyway, so no need to try in-place updates.
            return ServerConfigState.FullReloadNeeded;
        }

        // It's easier to do a soft restart with most settings,
        // or if we had an unset/invalid config previously.
        if (GetServerState() === ServerState.RunningWithoutConfig
            || changedKeys.has(ServerSettings.DataPath)
            || changedKeys.has(ServerSettings.Database)
            || changedKeys.has(ServerSettings.ExtendedStats)) {
            return ServerConfigState.ReloadNeeded;
        }

        const waitForThumbsReset = () =>
            waitForServerEvent(ServerEvents.ReloadThumbnailManager, PlexQueries.database());

        for (const key of changedKeys) {
            const newValue = isFeatureSetting(key) ? newConfig.features[key] : newConfig[key];
            switch (key) {
                case ServerSettings.LogLevel:
                {
                    this.#logLevel.setValue(newValue);
                    const parsed = Log.getFromString(newValue);
                    BaseLog.setLevel(parsed.level);
                    BaseLog.setDarkConsole(parsed.dark);
                    BaseLog.setTrace(parsed.trace);
                    break;
                }
                case ServerSettings.AutoOpen:
                    this.#features.autoOpen.setValue(newValue);
                    break;
                case ServerSettings.ExtendedStats:
                {
                    this.#features.extendedMarkerStats.value(newValue);
                    const promises = [];
                    promises.push(
                        waitForServerEvent(ServerEvents.ReloadMarkerStats, newValue, PlexQueries.database(), PlexQueries.markerTagId()));

                    if (newValue) {
                        promises.push(waitForServerEvent(ServerEvents.RebuildPurgedCache));
                    }

                    await Promise.all(promises);
                    break;
                }
                case ServerSettings.PreviewThumbnails:
                    this.#features.previewThumbnails.setValue(newValue);
                    if (!newValue) {
                        this.#features.preciseThumbnails.setValue(false);
                    }

                    await waitForThumbsReset();
                    break;
                case ServerSettings.FFmpegThumbnails:
                    this.#features.preciseThumbnails.setValue(newValue);
                    await waitForThumbsReset();
                    break;
                case ServerSettings.PathMappings:
                    this.#getPathMappingsCore(newValue);
                    await waitForThumbsReset();
                    break;
                default:
                    break;
            }
        }

        return ServerConfigState.Valid;
    }

    /**
     * Validate a serialized config.
     * @param {SerializedConfig} config
     * @returns {Promise<SerializedConfig>} The config with isValid details. */
    async validateConfig(config) {
        /** @type {SerializedConfig} */
        const newConfig = { features : {} };

        // Host:Port is (currently) the only odd one out.
        const newHost = config.host.value || config.host.defaultValue;
        const hostAndPort = `${newHost}:${config.port.value || config.port.defaultValue}`;
        const hostAndPortValid = (await this.validateField(ServerSettings.HostPort, {
            value : hostAndPort,
            defaultValue : `localhost:3232`,
            isValid : true,
        })).serialize(true);

        newConfig[ServerSettings.Host] = {
            value : config.host.value || undefined,
            defaultValue : config.host.defaultValue,
            isValid : hostAndPortValid.isValid,
            invalidMessage : hostAndPortValid.invalidMessage,
            unchanged : newHost === this.host(),
        };

        for (const serverSetting of [
            ServerSettings.DataPath,
            ServerSettings.Database,
            ServerSettings.Port,
            ServerSettings.LogLevel,
            ServerSettings.PathMappings,
            // Feature settings
            ServerSettings.AutoOpen,
            ServerSettings.ExtendedStats,
            ServerSettings.PreviewThumbnails,
            ServerSettings.FFmpegThumbnails
        ]) {
            const isFeature = isFeatureSetting(serverSetting);
            /** @type {TypedSetting<T>} */
            const setting = isFeature ? config.features[serverSetting] : config[serverSetting];
            if (!setting) {
                throw new ServerError(`Unexpected server setting "${serverSetting}". Cannot validate.`, 400);
            }

            const newSetting = (await this.validateField(serverSetting, setting)).serialize(true);
            if (isFeature) {
                newConfig.features[serverSetting] = newSetting;
            } else {
                newConfig[serverSetting] = newSetting;
            }
        }

        return newConfig;
    }

    /**
     * Validate a single configuration field of type T
     * @template T
     * @param {string} field
     * @param {TypedSetting<T>} value
     * @returns {Promise<Setting<T>>} */
    validateField(field, value) {
        const setting = new Setting();
        setting.setFromSerialized(value);
        setting.setValid(true);

        const setValidBoolean = boolSetting =>
            boolSetting.setValid(
                typeof boolSetting.value() === 'boolean',
                `Expected a boolean value for this setting, found ${boolSetting.value()}`);

        switch (field) {
            case ServerSettings.DataPath:
                return this.#validateDataPath(setting);
            case ServerSettings.Database:
                return this.#validateDatabasePath(setting);
            case ServerSettings.Host:
                // We really need host+port to validate the host, so skip it here,
                // but use the not-really-a-setting HostPort value to validate this.
                setting.setUnchanged(setting.value() === this.host());
                return setting;
            case ServerSettings.Port:
                setting.setValid(MarkerEditorConfig.ValidPort(setting.value()), `Port must be between 1 and 65535`);
                setting.setUnchanged(setting.value() === this.port());
                return setting;
            case ServerSettings.HostPort:
                return this.#validateHostPort(setting);
            case ServerSettings.LogLevel:
            {
                const parsed = Log.getFromString(setting.value());
                setting.setValid(parsed.level !== ConsoleLog.Level.Invalid, `Unexpected LogLevel string "${setting.value()}"`);
                setting.setUnchanged(
                    parsed.level === BaseLog.getLevel()
                    && parsed.trace === !!BaseLog.getTrace()
                    && parsed.dark === !!BaseLog.getDarkConsole());
                return setting;
            }
            case ServerSettings.AutoOpen:
                setting.setUnchanged(setting.value() === this.autoOpen());
                setValidBoolean(setting);
                return setting;
            case ServerSettings.ExtendedStats:
                setting.setUnchanged(setting.value() === this.extendedMarkerStats());
                setValidBoolean(setting);
                return setting;
            case ServerSettings.PreviewThumbnails:
                setting.setUnchanged(setting.value() === this.useThumbnails());
                setValidBoolean(setting);
                return setting;
            case ServerSettings.FFmpegThumbnails:
                setting.setUnchanged(setting.value() === this.usePreciseThumbnails());
                setValidBoolean(setting);
                if (setting.valid() && setting.value()) {
                    setting.setValid(testFfmpeg(), `FFmpeg could not be found on your path, so FFmpeg thumbnails cannot be enabled.`);
                }

                return setting;
            case ServerSettings.PathMappings:
            {
                return this.#validatePathMappings(setting);
            }
            default:
                throw new ServerError(`Unknown server setting '${field}'`, 400);

        }
    }

    /**
     * Ensure the given data path exists and looks like the Plex data directory.
     * @param {Setting<string>} setting */
    #validateDataPath(setting) {
        // In addition to the folder itself existing, make sure it also looks like
        // the data directory.
        setting.setUnchanged(setting.value() === this.metadataPath());
        const stats = statSync(setting.value(), { throwIfNoEntry : false });
        if (!stats || !stats.isDirectory()) {
            if (this.#allowInvalid) {
                setting.setValid(false, `Given path is not a directory.`);
                this.#configState = ServerConfigState.Invalid;
                return setting;
            }

            throw new ServerError(`Given data path does not exist`, 400);
        }

        if (!existsSync(join(setting.value(), 'Media', 'localhost'))
            && !existsSync(join(setting.value(), 'Plug-in Support', 'Databases'))) {
            if (this.#allowInvalid) {
                setting.setValid(false, `Found a directory, but it doesn't look like the Plex data directory`);
                this.#configState = ServerConfigState.Invalid;
                return setting;
            }

            throw new ServerError(`Found a directory, but it doesn't look like the Plex data directory`, 400);
        }

        return setting;
    }

    /**
     * Ensure the given database path exists and looks like the Plex database.
     * @param {Setting<string>} setting */
    async #validateDatabasePath(setting, setInvalid=false) {
        setting.setUnchanged(setting.value() === this.databasePath());
        const stats = statSync(setting.value(), { throwIfNoEntry : false });
        if (stats && stats.isFile()) {
            if (await PlexQueryManager.SmellsLikePlexDB(setting.value())) {
                return setting;
            }

            setting.setValid(false, `File exists, but it doesn't look like the Plex database.`);
        } else if (stats) {
            setting.setValid(false, `Database path is not a file`);
        } else {
            setting.setValid(false, `File does not exist`);
        }

        if (setInvalid) {
            this.#configState = ServerConfigState.Invalid;
        }

        return setting;
    }

    /**
     * Ensure the given host:port is valid and not currently in use.
     * @param {Setting<string>} setting */
    async #validateHostPort(setting) {
        /** @type {string[]} */
        const split = setting.value().split(':');
        if (split.length !== 2) {
            setting.setValid(false, `Unexpected host:port input: "${setting.value()}"`);
            return setting;
        }

        const host = split[0];
        const port = +split[1];

        setting.setUnchanged(host === this.host() && port === this.port());

        if (host.localeCompare(this.host(), undefined, { sensitivity : 'accent' }) === 0
            && port === this.port()) {
            return setting; // host and port are the same as our current host/port, so it's valid
        }

        if (!MarkerEditorConfig.ValidPort(port)) {
            setting.setValid(false, `Port must be between 1 and 65535`);
            return setting;
        }

        // Harder case. Try spinning up a server with the given host/port. If it succeeds, it's valid.
        const serverTest = await testHostPort(split[0], +split[1]);
        if (!serverTest.valid) {
            switch (serverTest.errorCode) {
                case 'ENOTFOUND':
                    setting.setValid(false, `Hostname could not be found`);
                    break;
                case 'EADDRNOTAVAIL':
                    setting.setValid(false, `Address not available - host is likely invalid.`);
                    break;
                case 'EADDRINUSE':
                    setting.setValid(false, `${setting.value()} is already in use.`);
                    break;
                default:
                    setting.setValid(false, `Unable to bind to ${setting.value()}: ${serverTest.errorCode}`);
                    break;
            }
        }

        return setting;
    }

    /**
     * Ensure all path mappings are valid, setting isValid to false if that's not the case.
     * @param {Setting<PathMapping[]>} setting */
    #validatePathMappings(setting) {
        // Don't verify that the paths exist, just make sure they're in the right format.
        const values = setting.value();
        const invalidRows = [];
        if (!(values instanceof Array)) {
            setting.setValid(false, `Expected an array of path mappings, found ${typeof values}`);
            return setting;
        }

        const existing = this.pathMappings();
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
