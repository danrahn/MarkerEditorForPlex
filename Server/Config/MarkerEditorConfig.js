import { dirname, join } from 'path';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { createServer as createHttpsServer } from 'https';
import { fileURLToPath } from 'url';

import {
    allServerSettings,
    isSslSetting,
    ServerConfigState,
    ServerSettings,
    Setting,
    SslState } from '../../Shared/ServerConfig.js';
import { BaseLog, ConsoleLog, ContextualLog } from '../../Shared/ConsoleLog.js';
import { ExtraData, PlexQueries, PlexQueryManager } from '../PlexQueryManager.js';
import {
    flatToRaw,
    getDefaultPlexDataPath,
    mapNameToRaw,
    settingValue,
    validatePathMappings,
    validAutoSuspendTimeout,
    validPort,
    validSessionTimeout } from './ConfigHelpers.js';
import { GetServerState, ServerState } from '../ServerState.js';
import { isBinary, testFfmpeg, testHostPort } from '../ServerHelpers.js';
import { ServerEvents, waitForServerEvent } from '../ServerEvents.js';
import AuthenticationConfig from './AuthenticationConfig.js';
import ConfigBase from './ConfigBase.js';
import PlexFeatures from './FeaturesConfig.js';
import ServerError from '../ServerError.js';
import SslConfig from './SslConfig.js';
import { User } from '../Authentication/Authentication.js';

/** @typedef {!import('./AuthenticationConfig').RawAuthConfig} RawAuthConfig */
/** @typedef {!import('./FeaturesConfig').RawConfigFeatures} RawConfigFeatures */
/** @typedef {!import('./SslConfig').RawSslConfig} RawSslConfig */
/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */
/** @typedef {!import('/Shared/ServerConfig').PathMapping} PathMapping */
/** @typedef {!import('/Shared/ServerConfig').RawSerializedConfig} RawSerializedConfig */

/**
 * @template T
 * @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T> */


/**
 * @typedef {{
 *  dataPath?: string,
 *  database?: string,
 *  host?: string,
 *  port?: number,
 *  logLevel?: string,
 *  ssl?: RawSslConfig,
 *  authentication?: RawAuthConfig,
 *  features?: RawConfigFeatures,
 *  pathMappings?: PathMapping[],
 * }} RawConfig
 */

const Log = ContextualLog.Create('EditorConfig');

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

    /**
     * The base URL to use for this instance. Useful for reverse proxy setups that e.g.
     * forward http://example.com:80/markerEditor to http://localhost:3232
     * @type {Setting<string>}*/
    #baseUrl;

    /** @type {Setting<string>} */
    #logLevel;

    /** @type {SslConfig} */
    #ssl;

    /** @type {AuthenticationConfig} */
    #auth;

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
        const isDocker = process.env.IS_DOCKER;
        if (isDocker) {
            // Config _should_ have the right values in Docker, but "help" the user out
            // by forcing it in case they were altered afterwards.
            this.#dataPath = new Setting('/PlexDataDirectory', '/PlexDataDirectory');
            const dbPath = join(this.#dataPath.value(), 'Plug-in Support/Databases/com.plexapp.plugins.library.db');
            this.#dbPath = new Setting(dbPath, dbPath);
        } else {
            this.#dataPath = this.#getOrDefault('dataPath', getDefaultPlexDataPath());
            this.#dbPath = this.#getOrDefault(
                'database',
                join(this.#dataPath.value(), 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db'));
        }

        this.#host = this.#getOrDefault('host', isDocker ? '0.0.0.0' : 'localhost');
        this.#port = this.#getOrDefault('port', 3232);
        if (!validPort(this.#port.value())) {
            this.#configState = ServerConfigState.Invalid;
            this.#port.setValid(false, `Invalid port`);
        }

        this.#baseUrl = this.#getOrDefault('baseUrl', '/');
        this.#fixupBaseUrl(this.#baseUrl, false /*setUnchanged*/);
        await this.#validateDatabasePath(this.#dbPath, true /*setInvalid*/);
        this.#ssl = new SslConfig(this.#Base.json.ssl);
        this.#auth = new AuthenticationConfig(this.#Base.json.authentication);
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
            } catch (_err) {
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

    /** Forwards to {@link ConfigBase}s `#getOrDefault`}
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null, defaultType=null) {
        return this.#Base.getOrDefault(key, defaultValue, defaultType);
    }

    /**
     * Verify the database format to ensure we don't try to write old data to a new schema. */
    async validateDbSettings() {
        await this.#features.validateDbSettings();
    }

    databasePath() { return this.#dbPath.value(); }
    host() { return this.#host.value(); }
    port() { return this.#port.value(); }
    baseUrl() { return this.#baseUrl.value(); }
    useSsl() { return this.#ssl.enabled.value(); }
    sslHost() { return this.#ssl.sslHost.value(); }
    sslPort() { return this.#ssl.sslPort.value(); }
    sslOpts() { return this.#ssl.sslKeys(); }
    sslOnly() { return this.#ssl.sslOnly.value(); }
    sslState() { return this.useSsl() ? (this.sslOnly() ? SslState.Forced : SslState.Enabled) : SslState.Disabled; }
    useAuth() { return this.#auth.enabled.value(); }
    authSessionTimeout() { return this.#auth.sessionTimeout.value(); }
    trustProxy() { return this.#auth.trustProxy.value(); }
    autoOpen() { return this.#features.autoOpen.value(); }
    useThumbnails() { return this.#features.previewThumbnails.value(); }
    usePreciseThumbnails() { return this.#features.preciseThumbnails.value(); }
    metadataPath() { return this.#dataPath.value(); }
    extendedMarkerStats() { return this.#features.extendedMarkerStats.value(); }
    disableExtendedMarkerStats() { this.#features.extendedMarkerStats = false; }
    writeExtraData() { return this.#features.writeExtraData.value(); }
    autoSuspend() { return this.#features.autoSuspend.value(); }
    autoSuspendTimeout() { return this.#features.autoSuspendTimeout.value(); }
    appVersion() { return this.#version.value(); }
    pathMappings() { return this.#mappings.value(); }
    getValid() { return this.#configState; }

    /**
     * Serializes the current config as a flat list (e.g. no Features or Authentication subbranches)
     * @returns {SerializedConfig} */
    serialize() {
        return {
            dataPath : this.#dataPath.serialize(),
            database : this.#dbPath.serialize(),
            host : this.#host.serialize(),
            port : this.#port.serialize(),
            baseUrl : this.#baseUrl.serialize(),
            logLevel : this.#logLevel.serialize(),
            sslEnabled : this.#ssl.enabled.serialize(),
            sslHost : this.#ssl.sslHost.serialize(),
            sslPort : this.#ssl.sslPort.serialize(),
            certType : this.#ssl.certType.serialize(),
            pfxPath : this.#ssl.pfxPath.serialize(),
            // Don't pass the plaintext value to the client. Allow setting, not viewing.
            pfxPassphrase : this.#pseudoSetting(''),
            pemCert : this.#ssl.pemCert.serialize(),
            pemKey : this.#ssl.pemKey.serialize(),
            sslOnly : this.#ssl.sslOnly.serialize(),
            authEnabled : this.#auth.enabled.serialize(),
            authSessionTimeout : this.#auth.sessionTimeout.serialize(),
            trustProxy : this.#auth.trustProxy.serialize(),
            autoOpen : this.#features.autoOpen.serialize(),
            extendedMarkerStats : this.#features.extendedMarkerStats.serialize(),
            previewThumbnails : this.#features.previewThumbnails.serialize(),
            preciseThumbnails : this.#features.preciseThumbnails.serialize(),
            writeExtraData : this.#features.writeExtraData.serialize(),
            autoSuspend : this.#features.autoSuspend.serialize(),
            autoSuspendTimeout : this.#features.autoSuspendTimeout.serialize(),
            pathMappings : this.#mappings.serialize(),
            version : this.#version.serialize(),
            authUsername : this.#pseudoSetting(User.username()),
            authPassword : this.#pseudoSetting(User.passwordSet() ? '' : null),
            state : this.#configState,
            isDocker : !!process.env.IS_DOCKER,
        };
    }

    /**
     * @template T
     *
     * Create a pseudo config value for a plain value type that isn't really a setting.
     * @param {T} value
     * @returns {TypedSetting<T>} */
    #pseudoSetting(value) {
        return {
            value :  value,
            defaultValue : undefined,
            isValid : true,
        };
    }

    /**
     * @param {SerializedConfig} config */
    async trySetConfig(config) {
        const newConfig = await this.validateConfig(config, true /*forWrite*/);
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

        const explicitVal = s => s.value !== undefined && s.value !== null;
        const invalidOkay = s => {
            if (isSslSetting(s)) {
                // SSL settings don't matter if SSL isn't enabled.
                return s !== ServerSettings.UseSsl && !settingValue(newConfig.sslEnabled);
            }

            switch (s) {
                default:
                    return false;
                case ServerSettings.DataPath:
                    return newConfig.database.value && (
                        !settingValue(newConfig.previewThumbnails)
                        || settingValue(newConfig.preciseThumbnails));
                case ServerSettings.FFmpegThumbnails:
                    return !settingValue(newConfig.previewThumbnails);
            }
        };

        /** @type {Set<string>} */
        const changedKeys = new Set();
        /** @type {(k: string, s: TypedSetting<T>) => void} */
        const setVal = (k, s, r) => {
            flatToRaw(k, r)[mapNameToRaw(k)] = settingValue(s);
            if (!s.unchanged) {
                changedKeys.add(k);
            }
        };

        for (const settingKey of allServerSettings()) {
            /** @type {TypedSetting<T>} */
            const setting = newConfig[settingKey];
            if (!setting.isValid && !invalidOkay(settingKey)) {
                result.message = `Invalid setting for "${settingKey}", cannot save settings.`;
                result.config.state = ServerConfigState.Invalid;
                return result;
            }

            if (explicitVal(setting)) {
                // An explicit value always overrides whatever's in the previous config.
                setVal(settingKey, setting, newJson);
            } else {
                // Default value used. If previous JSON had the value, overwrite it, otherwise
                // leave it out of the config.
                const jsonSetting = flatToRaw(settingKey, newJson, false /*create*/)?.[mapNameToRaw(settingKey)];
                if (jsonSetting) {
                    setVal(settingKey, setting, newJson);
                }
            }
        }

        Log.info(newJson, 'Setting new Config');

        // Sensitive fields aren't passed back to the client
        newConfig.pfxPassphrase = this.#pseudoSetting('');

        // Try to change the internal state first, that way we don't write the config to disk if
        // we failed to update things internally for whatever reason.
        result.config.state = await this.#updateInternalConfig(newJson, changedKeys);

        // Make sure any pseudo-settings aren't saved to the actual config.
        delete newJson[ServerSettings.Username];

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
    // eslint-disable-next-line complexity
    async #updateInternalConfig(newConfig, changedKeys) {

        // Some settings require a full server reboot (or aren't worth implementing
        // in-place updates for), so skip update attempts.
        if (changedKeys.has(ServerSettings.Host)
            || changedKeys.has(ServerSettings.Port)
            || changedKeys.has(ServerSettings.BaseUrl)
            || changedKeys.has(ServerSettings.UseAuthentication)
            || changedKeys.has(ServerSettings.SessionTimeout)
            || changedKeys.has(ServerSettings.UseSsl)
            || changedKeys.has(ServerSettings.SslOnly)
            || changedKeys.has(ServerSettings.SslHost)
            || changedKeys.has(ServerSettings.SslPort)
            || changedKeys.has(ServerSettings.CertType)
            || changedKeys.has(ServerSettings.PfxPath)
            || changedKeys.has(ServerSettings.PfxPassphrase)
            || changedKeys.has(ServerSettings.PemCert)
            || changedKeys.has(ServerSettings.PemKey)) {
            return ServerConfigState.FullReloadNeeded;
        }

        // It's easier to do a soft restart with most settings,
        // or if we had an unset/invalid config previously.
        if (GetServerState() === ServerState.RunningWithoutConfig
            || changedKeys.has(ServerSettings.DataPath)
            || changedKeys.has(ServerSettings.Database)
            || changedKeys.has(ServerSettings.ExtendedStats)
            || changedKeys.has(ServerSettings.SessionTimeout)) {
            return ServerConfigState.ReloadNeeded;
        }

        const waitForThumbsReset = () =>
            waitForServerEvent(ServerEvents.ReloadThumbnailManager, PlexQueries.database());

        for (const key of changedKeys) {
            const newValue = flatToRaw(key, newConfig, false /*create*/)?.[mapNameToRaw(key)];
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
                case ServerSettings.Username:
                    await User.changeUsername(newValue);
                    break;
                case ServerSettings.PathMappings:
                    this.#getPathMappingsCore(newValue);
                    await waitForThumbsReset();
                    break;
                case ServerSettings.WriteExtraData:
                    this.#features.writeExtraData.setValue(newValue);
                    await this.#features.validateDbSettings();
                    break;
                case ServerSettings.AutoSuspend:
                    this.#features.autoSuspend.setValue(newValue);
                    await waitForServerEvent(ServerEvents.AutoSuspendChanged);
                    break;
                case ServerSettings.AutoSuspendTimeout:
                    this.#features.autoSuspendTimeout.setValue(newValue);
                    await waitForServerEvent(ServerEvents.AutoSuspendChanged);
                    break;
                default:
                    break;
            }
        }

        return ServerConfigState.Valid;
    }

    /* eslint-disable require-atomic-updates */
    /**
     * Validate a serialized config.
     * @param {SerializedConfig} config
     * @param {boolean} [forWrite=false] Whether we're planning on writing out the resulting config. This
     *                                   determines whether sensitive settings are added to the response.
     * @returns {Promise<SerializedConfig>} The config with isValid details. */
    async validateConfig(config, forWrite=false) {
        /** @type {SerializedConfig} */
        const newConfig = { };

        await this.#validateHostsAndPorts(config, newConfig);

        /**
         * @param {string} serverSetting */
        const updateSingle = async (serverSetting) => {
            /** @type {TypedSetting<T>} */
            const setting = config[serverSetting];
            if (!setting) {
                throw new ServerError(`Unexpected server setting "${serverSetting}". Cannot validate.`, 400);
            }

            const newSetting = (await this.validateField(serverSetting, setting)).serialize(true);
            newConfig[serverSetting] = newSetting;
        };

        // Independent settings
        for (const serverSetting of [
            ServerSettings.DataPath,
            ServerSettings.Database,
            ServerSettings.Port,
            ServerSettings.BaseUrl,
            ServerSettings.LogLevel,
            ServerSettings.PathMappings,
            ServerSettings.UseSsl,
            ServerSettings.UseAuthentication,
            ServerSettings.AutoOpen,
            ServerSettings.ExtendedStats,
            ServerSettings.PreviewThumbnails,
            ServerSettings.FFmpegThumbnails,
            ServerSettings.WriteExtraData,
            ServerSettings.AutoSuspend,
            ServerSettings.TrustProxy,
        ]) {
            await updateSingle(serverSetting);
        }

        const copyExisting = (...settings) => {
            for (const setting of settings) {
                newConfig[setting] = { ...config[setting] };
                newConfig[setting].unchanged = true;
            }
        };

        // Sub-settings that depend on the values above
        if (settingValue(newConfig[ServerSettings.UseAuthentication])) {
            // Ignore any changes to username/session timeout if auth has been disabled.
            for (const authSetting of [
                ServerSettings.Username,
                ServerSettings.SessionTimeout,
            ]) {
                await updateSingle(authSetting);
            }
        } else {
            // Just keep the values the same.
            copyExisting(ServerSettings.Username, ServerSettings.SessionTimeout);
        }

        const pfxPass = forWrite ? this.#ssl.pfxPassphrase.serialize(true) : this.#pseudoSetting('');
        if (settingValue(newConfig[ServerSettings.UseSsl])) {
            for (const sslSetting of [
                ServerSettings.UseSsl,
                ServerSettings.SslPort,
                ServerSettings.CertType,
                ServerSettings.SslOnly,
            ]) {
                await updateSingle(sslSetting);
            }

            if (settingValue(newConfig[ServerSettings.CertType]) === 'pfx') {
                await updateSingle(ServerSettings.PfxPath);

                let passphrase = config[ServerSettings.PfxPassphrase].value;
                if (passphrase) {
                    // Explicitly changed
                    await updateSingle(ServerSettings.PfxPassphrase);
                } else {
                    passphrase = this.#ssl.pfxPassphrase.value();
                    newConfig[ServerSettings.PfxPassphrase] = this.#ssl.pfxPassphrase.serialize(true);
                }

                if (newConfig[ServerSettings.PfxPath].isValid && newConfig[ServerSettings.PfxPassphrase].isValid) {
                    const validCombo = await this.validateField(ServerSettings.Pfx, {
                        value : JSON.stringify({
                            pfx : newConfig[ServerSettings.PfxPath].value,
                            passphrase : passphrase
                        }),
                        defaultValue : '',
                        isValid : true
                    });

                    if (!validCombo.valid()) {
                        newConfig[ServerSettings.PfxPassphrase].isValid = false;
                        newConfig[ServerSettings.PfxPassphrase].invalidMessage = validCombo.message();
                    }
                }

                copyExisting(ServerSettings.PemCert, ServerSettings.PemKey);
            } else {
                await Promise.all([updateSingle(ServerSettings.PemCert), updateSingle(ServerSettings.PemKey)]);
                if (newConfig[ServerSettings.PemCert].isValid && newConfig[ServerSettings.PemKey].isValid) {
                    const validCombo = await this.validateField(ServerSettings.Pem, {
                        value : JSON.stringify({
                            cert : newConfig[ServerSettings.PemCert].value,
                            key : newConfig[ServerSettings.PemKey].value
                        }),
                        defaultValue : '',
                        isValid : true
                    });

                    if (!validCombo.valid()) {
                        newConfig[ServerSettings.PemKey].isValid = false;
                        newConfig[ServerSettings.PemKey].invalidMessage = validCombo.message();
                    }
                }

                copyExisting(ServerSettings.PfxPath);
                newConfig[ServerSettings.PfxPassphrase] = pfxPass;
            }
        } else {
            // Just keep the values the same. Keep the existing PfxPassphrase, since that was
            // never passed to the client, so we don't have its potentially updated value.
            copyExisting(...allServerSettings().filter(
                setting => isSslSetting(setting)
                    && !(setting in [ServerSettings.UseSsl, ServerSettings.PfxPassphrase])));
            newConfig[ServerSettings.PfxPassphrase] = pfxPass;
        }

        if (settingValue(newConfig[ServerSettings.AutoSuspend])) {
            await updateSingle(ServerSettings.AutoSuspendTimeout);
        } else {
            // Just keep the value the same.
            copyExisting(ServerSettings.AutoSuspendTimeout);
        }

        return newConfig;
    }
    /* eslint-enable require-atomic-updates */

    /**
     * @param {SerializedConfig} config
     * @param {SerializedConfig} newConfig */
    async #validateHostsAndPorts(config, newConfig) {
        // Host:Port is (currently) the only odd one out.
        const newHost = config.host.value || config.host.defaultValue;
        const newState = settingValue(config.sslEnabled) ? (settingValue(config.sslOnly) ? 2 : 1) : 0;
        const hostAndPortValid = (await this.validateField(ServerSettings.HostPort, {
            value : JSON.stringify({
                host : newHost,
                port : settingValue(config.port),
                sslHost : settingValue(config.sslHost),
                sslPort : settingValue(config.sslPort),
                sslState : newState,
            }),
            defaultValue : ``,
            isValid : true,
        })).serialize(true);

        newConfig[ServerSettings.Host] = {
            value : (newState === 2 ? this.host() : config.host.value) || undefined,
            defaultValue : config.host.defaultValue,
            isValid : newState === 2 || hostAndPortValid.isValid,
            invalidMessage : newState === 2 ? '' : hostAndPortValid.invalidMessage,
            unchanged : newState === 2 || newHost === this.host(),
        };

        newConfig[ServerSettings.SslHost] = {
            value : (newState === 0 ? this.sslHost() : config.sslHost.value) || undefined,
            defaultValue : config.sslHost.defaultValue,
            isValid : newState === 0 || hostAndPortValid.isValid,
            invalidMessage : newState === 0 ? '' : hostAndPortValid.invalidMessage,
            unchanged : newState === 0 || settingValue(config.sslHost) === this.sslHost()
        };
    }

    /**
     * Validate a single configuration field of type T
     * @template T
     * @param {string} field
     * @param {TypedSetting<T>} value */
    // eslint-disable-next-line complexity
    async validateField(field, value) {
        const setting = new Setting();
        setting.setFromSerialized(value);
        setting.setValid(true);

        /**
         * @param {Setting<boolean>} boolSetting */
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
                return setting.setUnchanged(setting.value() === this.host());
            case ServerSettings.Port:
                setting.setValid(validPort(setting.value()), `Port must be between 1 and 65535`);
                return setting.setUnchanged(setting.value() === this.port());
            case ServerSettings.HostPort:
                return this.#validateHostPort(setting);
            case ServerSettings.BaseUrl:
                return this.#fixupBaseUrl(setting);
            case ServerSettings.LogLevel:
            {
                const parsed = Log.getFromString(setting.value());
                setting.setValid(parsed.level !== ConsoleLog.Level.Invalid, `Unexpected LogLevel string "${setting.value()}"`);
                return setting.setUnchanged(
                    parsed.level === BaseLog.getLevel()
                    && parsed.trace === !!BaseLog.getTrace()
                    && parsed.dark === !!BaseLog.getDarkConsole());
            }
            case ServerSettings.UseSsl:
                setting.setUnchanged(setting.value() === this.useSsl());
                return setValidBoolean(setting);
            case ServerSettings.SslHost:
                // See comment in SeverSettings.Host case
                return setting.setUnchanged(setting.value() === this.sslHost());
            case ServerSettings.SslPort:
                setting.setValid(validPort(setting.value()), `Port must be between 1 and 65535`);
                return setting.setUnchanged(setting.value() === this.sslPort());
            case ServerSettings.CertType:
                setting.setValue(setting.value().toLowerCase());
                setting.setValid(['pfx', 'pem'].includes(setting.value()), `Only PFX and PEM certificates are supported.`);
                return setting.setUnchanged(setting.value() === this.#ssl.certType.value());
            case ServerSettings.PfxPath:
                setting.setValid(existsSync(setting.value()), `Pfx path does not exist`);
                return setting.setUnchanged(setting.value() === this.#ssl.pfxPath.value());
            case ServerSettings.PfxPassphrase:
                setting.setValid(setting.value()?.length > 0);
                return setting;
            case ServerSettings.PemCert:
                setting.setValid(existsSync(setting.value()), `Pem path does not exist`);
                return setting.setUnchanged(setting.value() === this.#ssl.pemCert.value());
            case ServerSettings.PemKey:
                setting.setValid(existsSync(setting.value()), `Pem key path does not exist`);
                return setting.setUnchanged(setting.value() === this.#ssl.pemKey.value());
            case ServerSettings.Pfx:
                setting.setValid(this.#validateCertificates(setting.value(), true), `PFX validation failed`);
                setting.setValue(''); // Unused by client, and we shouldn't send back the passphrase
                return setting;
            case ServerSettings.Pem:
                setting.setValid(this.#validateCertificates(setting.value(), false), `PEM validation failed`);
                return setting;
            case ServerSettings.SslOnly:
                setting.setUnchanged(setting.value() === this.sslOnly());
                return setValidBoolean(setting);
            case ServerSettings.UseAuthentication:
                setting.setUnchanged(setting.value() === this.useAuth());
                return setValidBoolean(setting);
            case ServerSettings.SessionTimeout:
                setting.setUnchanged(setting.value() === this.authSessionTimeout());
                return setting.setValid(
                    validSessionTimeout(setting.value()), `Session timeout must be at least 60 seconds.`);
            case ServerSettings.TrustProxy:
                setting.setUnchanged(setting.value() === this.trustProxy());
                if (setting.value() === undefined || setting.value() === '') {
                    setting.setValue(undefined);
                }

                setting.setValid(true);
                return setting;
            case ServerSettings.Username:
            {
                const val = setting.value();
                setting.setUnchanged(val === User.username());
                return setting.setValid(val && val.length <= 256 && val.length === val.replace(/\s/g, '').length,
                    val ? val.length > 256 ?
                        'Usernames are limited to 256 characters' :
                        'Username cannot contain whitespace' :
                        'Username cannot be empty');
            }
            case ServerSettings.Password:
            {
                // This is a pseudo-setting that is here so there's a single spot for configuration related
                // validation, but since we don't store the password in config.json (or in plaintext), it
                // doesn't really belong here. Valid in this case means the correct password was entered,
                // or no password is set (i.e. enabling auth for the first time).
                const valid = await this.#isPasswordValid(setting);
                setting.setUnchanged(valid);
                return setting.setValid(valid, `Password is incorrect.`);
            }
            case ServerSettings.AutoOpen:
                setting.setUnchanged(setting.value() === this.autoOpen());
                return setValidBoolean(setting);
            case ServerSettings.ExtendedStats:
                setting.setUnchanged(setting.value() === this.extendedMarkerStats());
                return setValidBoolean(setting);
            case ServerSettings.PreviewThumbnails:
                setting.setUnchanged(setting.value() === this.useThumbnails());
                return setValidBoolean(setting);
            case ServerSettings.FFmpegThumbnails:
                setting.setUnchanged(setting.value() === this.usePreciseThumbnails());
                setValidBoolean(setting);
                if (setting.valid() && setting.value()) {
                    setting.setValid(testFfmpeg(), `FFmpeg could not be found on your path, so FFmpeg thumbnails cannot be enabled.`);
                }

                return setting;
            case ServerSettings.WriteExtraData:
                setting.setUnchanged(setting.value() === this.writeExtraData());
                // Always valid, but might be disabled.
                setting.setValid(true);
                return setting.setDisabled(!setting.value() || !ExtraData.isLegacy,
                    `Extra data can only be written for PMS >=1.40.`);
            case ServerSettings.AutoSuspend:
                setting.setUnchanged(setting.value() === this.autoSuspend());
                return setValidBoolean(setting);
            case ServerSettings.AutoSuspendTimeout:
                setting.setUnchanged(setting.value() === this.autoSuspendTimeout());
                return setting.setValid(
                    validAutoSuspendTimeout(setting.value()), `Auto-suspend timeout must be between 60 and 2,147,483 seconds.`);
            case ServerSettings.PathMappings:
                return validatePathMappings(setting, this.pathMappings());
            default:
                throw new ServerError(`Unknown server setting '${field}'`, 400);

        }
    }

    /**
     * Return whether the given password is valid (or no password is set).
     * @param {Setting<string>} setting */
    async #isPasswordValid(setting) {
        return !User.passwordSet() || await User.loginInternal(setting.value());
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
                // TODO: If an invalid value is entered, reverted, and then never committed, we'll be stuck in
                // an invalid state even though it _is_ valid.
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
    // eslint-disable-next-line complexity
    async #validateHostPort(setting) {
        /** @type {{ host: string, port: number, sslHost: string, sslPort: number, sslState: number }} */
        const state = JSON.parse(setting.value());
        const nou = v => v === null || v === undefined;
        if (nou(state.host) || nou(state.port) || nou(state.sslHost) || nou(state.sslPort) || nou(state.sslState)) {
            setting.setValid(false, `Unexpected input. Not all required fields available.`);
            return setting;
        }

        // Assume valid initially.
        setting.setValid(true);

        const sameHostPort = (h1, h2, p1, p2) =>
            h1.localeCompare(h2, undefined, { sensitivity : 'accent' }) === 0 && p1 === p2;

        const checkHttp = () => {
            if (sameHostPort(state.host, this.host(), state.port, this.port())) {
                return false; // host and port are the same as our current host/port, so it's valid
            }

            if (!validPort(state.port)) {
                setting.setValid(false, `Port must be between 1 and 65535`);
                return false;
            }

            return true;
        };

        const checkHttps = () => {
            if (sameHostPort(state.sslHost, this.sslHost(), state.sslPort, this.sslPort())) {
                return false; // host and port are the same as our current host/port, so it's valid
            }

            if (!validPort(state.port)) {
                setting.setValid(false, `Port must be between 1 and 65535`);
                return false;
            }

            return true;
        };

        const toTest = [];
        const currentState = this.sslState();
        const httpIsOldHttps = sameHostPort(state.host, this.sslHost(), state.port, this.sslPort());
        const httpsIsOldHttp = sameHostPort(state.sslHost, this.host(), state.sslPort, this.sslPort());

        switch (state.sslState) {
            case SslState.Disabled:
                if (!checkHttp() || (currentState !== 0 && httpIsOldHttps)) {
                    return setting;
                }

                toTest.push(state.host, state.port);
                break;
            case SslState.Enabled:
            {
                const httpChanged = checkHttp();
                const httpsChanged = checkHttps();
                if ((!httpChanged && !httpsChanged) || !setting.valid()) {
                    return setting;
                }

                if (sameHostPort(state.host, state.sslHost, state.port, state.sslPort)) {
                    setting.setValid(false, 'HTTP host/port cannot equal HTTPS host/port');
                    return setting;
                }

                switch (currentState) {
                    case SslState.Disabled:
                        if (httpChanged) toTest.push(state.host, state.port);
                        if (!httpsIsOldHttp) toTest.push(state.sslHost, state.sslPort);
                        break;
                    case SslState.Enabled:
                        if (httpChanged && !httpIsOldHttps) toTest.push(state.host, state.port);
                        if (httpsChanged && !httpsIsOldHttp) toTest.push(state.sslHost, state.sslPort);
                        break;
                    case SslState.Forced:
                        if (!httpIsOldHttps) toTest.push(state.host, state.port);
                        if (httpsChanged) toTest.push(state.sslHost, state.sslPort);
                        break;
                }

                break;
            }
            case SslState.Forced:
                if (!checkHttps()) {
                    return setting;
                }

                if (currentState !== 2 && httpsIsOldHttp) {
                    return setting;
                }

                toTest.push(state.sslHost, state.sslPort);
                break;
            default:
                setting.setValid(false, `Unexpected SSL state '${state.sslState}', expected 0-2`);
                return setting;
        }

        // Harder case. Try spinning up a server with the given host/port. If it succeeds, it's valid.
        const serverTest = await testHostPort(...toTest);
        if (!serverTest.valid) {
            switch (serverTest.errorCode) {
                case 'ENOTFOUND':
                    setting.setValid(false, `Hostname could not be found`);
                    break;
                case 'EADDRNOTAVAIL':
                    setting.setValid(false, `Address not available - host is likely invalid.`);
                    break;
                case 'EADDRINUSE':
                    setting.setValid(false, `${serverTest.failedConnection} is already in use.`);
                    break;
                default:
                    setting.setValid(false, `Unable to bind to ${serverTest.failedConnection}: ${serverTest.errorCode}`);
                    break;
            }
        }

        return setting;
    }

    /**
     * Do some behind-the-scenes cleanup to add '/' to the beginning and end of the url
     * to make our lives easier, but don't annoy the user by forcing it. Don't do any validation
     * outside of that. Always assume a valid value - it's on the user if they screw up.
     * @param {Setting<string>} setting */
    #fixupBaseUrl(setting, setUnchanged=true) {
        const originalVal = setting.value();
        let newVal = originalVal;
        if (originalVal.length === 0) {
            newVal = '/';
        } else if (originalVal.length === 1 && originalVal !== '/') {
            newVal = `/${originalVal}/`;
        } else {
            if (originalVal[0] !== '/') newVal = '/' + newVal;
            if (originalVal[originalVal.length - 1] !== '/') newVal += '/';
        }

        if (originalVal !== newVal) {
            setting.setValue(newVal);
        }

        return setUnchanged ? setting.setUnchanged(setting.value() === this.baseUrl()) : setting;
    }

    /**
     * @param {string} json
     * @param {boolean} pfx */
    #validateCertificates(json, pfx) {
        try {
            const opts = JSON.parse(json);
            if (pfx) {
                opts.pfx = readFileSync(opts.pfx);
                opts.passphrase ||= this.#ssl.pfxPassphrase.value();
            } else {
                opts.cert = readFileSync(opts.cert);
                opts.key = readFileSync(opts.key);
            }

            createHttpsServer(opts, () => {}).close();
            return true;
        } catch (_err) {
            return false;
        }
    }
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
const ProjectRoot = () => (globalProjectRoot ??= isBinary() ?
    dirname(dirname(fileURLToPath(import.meta.url))) :
    dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

export { MarkerEditorConfig, Instance as Config, ProjectRoot };
