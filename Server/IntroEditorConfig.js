import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { Log } from '../Shared/ConsoleLog.js';

/**
 * The protected fields of ConfigBase that are available to derived classes, but not available externally.
 * @typedef {{json : Object, getOrDefault : Function, baseInstance : ConfigBase}} ConfigBaseProtected */

/**
 * Base class for a piece of a configuration file.
 *
 * Note that this is also acting as a bit of an experiment with "protected" members, i.e. members
 * that are only accessible to the base class and those that derive from it. To accomplish this,
 * derived classes pass in an empty object to this base class's constructor, and this class
 * populates it with the "protected" members, in addition to the base class itself as
 * 'baseInstance'. Derived classes then set their own private #Base member to that object, and use
 * it as a proxy to this classes private members, binding functions to #Base.baseInstance if
 * required (i.e. the private method itself uses private members of the base class).
 *
 * It's not super clean, and probably much easier to just make the base members public, or
 * duplicate the code between PlexFeatures and IntroEditorConfig, but where's the fun in that?
 */
class ConfigBase {
    /** The raw configuration file.
     * @type {Object} */
    #json;

    /**
     * @param {Object} json
     * @param {ConfigBaseProtected} protectedFields Out parameter - contains private members and methods
     * to share with the derived class that called us, making them "protected" */
    constructor(json, protectedFields) {
        this.#json = json;
        protectedFields['getOrDefault'] = this.#getOrDefault;
        protectedFields['json'] = this.#json;
        protectedFields['baseInstance'] = this;
    }

    /**
     * @param {string} key The config property to retrieve.
     * @param {*} [defaultValue=null] The default value if the property doesn't exist.
     * @returns The retrieved property value.
     * @throws if `value` is not in the config and `defaultValue` is not set. */
    #getOrDefault(key, defaultValue=null) {
        if (!this.#json.hasOwnProperty(key)) {
            if (defaultValue == null) {
                throw new Error(`'${key}' not found in config file, and no default is available.`);
            }

            Log.info(`'${key}' not found in config file. Defaulting to '${defaultValue}'.`);
            return defaultValue;
        }

        Log.verbose(`Setting ${key} to ${this.#json[key]}`);
        return this.#json[key];
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

    /** Setting for logging all marker actions, for future use in restoring and/or purging user edited markers. */
    backupActions = true;

    /** Setting for displaying timestamped preview thumbnails when editing or adding markers.
     * @type {boolean} */
    previewThumbnails = true;

    /** Setting to control whether we use the unused thumb_url column of the Plex database to store
     *  additional information about markers that are added/edited. */
    pureMode = false;

    /** Sets the application features based on the given json.
     * @param {object} json */
    constructor(json) {
        let baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Features not found in config, setting defaults');
            return;
        }

        this.autoOpen = this.#getOrDefault('autoOpen', true);
        this.extendedMarkerStats = this.#getOrDefault('extendedMarkerStats', true);
        this.backupActions = this.#getOrDefault('backupActions', true);
        this.previewThumbnails = this.#getOrDefault('previewThumbnails', true);
        this.pureMode = this.#getOrDefault('pureMode', false);
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault.bind(this.#Base.baseInstance)(key, defaultValue);
    }
}

/**
 * Singleton editor config instance.
 * @type {IntroEditorConfig}
 * @readonly */ // Externally readonly
let Instance;

/**
 * Provides read-only access to the users application configuration.
 */
class IntroEditorConfig extends ConfigBase {
    /**
     * Create the singleton config instance.
     * @param {string} projectRoot
     * @param {*} testData
     * @param {string} dataRoot The root of the config file, which isn't the same as the project root in Docker. */
    static Create(projectRoot, testData, dataRoot) {
        if (Instance != null) {
            Log.warn(`Singleton IntroEditorConfig already exists, we shouldn't be creating it again!`);
        }

        Instance = new IntroEditorConfig(projectRoot, testData, dataRoot);
        return Instance;
    }

    static Close() { Instance = null; }

    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
     #Base = {}

     /**
      * The directory root of the project.
      * @type {string} */
     #root;

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

    /** Creates a new IntroEditorConfig. */
    constructor(projectRoot, testData, dataRoot) {
        Log.info('Reading configuration...');
        let baseClass = {};

        let configFile = 'config.json';
        // If we're in a test environment, check for an override config file
        if (testData.isTest && testData.configOverride) {
            configFile = join('Test', testData.configOverride);
        }

        const configPath = join(dataRoot, configFile);
        let config = {};
        if (testData.isTest || existsSync(configPath)) {
            config = JSON.parse(readFileSync(configPath));
        } else {
            Log.warn('Unable to find config.json, attempting to use default values for everything.');
        }

        super(config, baseClass);
        this.#Base = baseClass;
        this.#root = projectRoot;

        Log.setFromString(this.#getOrDefault('logLevel', 'Info'));
        if (process.env.IS_DOCKER) {
            // Config _should_ have the right values in Docker, but "help" the user out
            // by forcing it in case they were altered afterwards.
            this.#dataPath = '/PlexDataDirectory';
            this.#dbPath = join(config.dataPath, 'Plug-in Support/Databases/com.plexapp.plugins.library.db');
            this.#host = '0.0.0.0';
            this.#port = 3232;
        } else {
            this.#dataPath = this.#getOrDefault('dataPath', IntroEditorConfig.getDefaultPlexDataPath());
            this.#dbPath = this.#getOrDefault('database', join(this.#dataPath, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db'));
            this.#host = this.#getOrDefault('host', 'localhost');
            this.#port = this.#getOrDefault('port', 3232);
            }

        this.#verifyPathExists(this.#dbPath, 'database');
        this.#features = new PlexFeatures(this.#Base.json.features);

        // We only need the data path if preview thumbnails are enabled, so don't
        // fail if we're not using them.
        if (this.#features.previewThumbnails) {
            this.#verifyPathExists(this.#dataPath, 'dataPath');
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
     * Attempts to retrieve the default Plex data directory for the current platform,
     * returning the empty string if it was not able to.
     * @returns {string} */
    static getDefaultPlexDataPath() {
        const platform = process.platform;
        switch (platform) {
            case 'win32':
                if (!process.env['LOCALAPPDATA']) {
                    return '';
                }

                return join(process.env['LOCALAPPDATA'], 'Plex Media Server');
            case 'darwin':
                return '~/Library/Application Support/Plex Media Server';
            case 'linux':
            case 'aix':
            case 'openbsd':
            case 'sunos':
                if (!process.env['PLEX_HOME']) {
                    return '';
                }

                return join(process.env['PLEX_HOME'], 'Library/Application Support/Plex Media Server');
            case 'freebsd':
                return '/usr/local/plexdata/Plex Media Server';
            default:
                Log.warn(`Found unexpected platform '${platform}', cannot find default data path.`);
                return '';
        }
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault.bind(this.#Base.baseInstance)(key, defaultValue);
    }

    databasePath() { return this.#dbPath; }
    host() { return this.#host; }
    port() { return this.#port; }
    autoOpen() { return this.#features.autoOpen; }
    useThumbnails() { return this.#features.previewThumbnails; }
    metadataPath() { return this.#dataPath; }
    extendedMarkerStats() { return this.#features.extendedMarkerStats; }
    disableExtendedMarkerStats() { this.#features.extendedMarkerStats = false; }
    backupActions() { return this.#features.backupActions; }
    pureMode() { return this.#features.pureMode; }
    projectRoot() { return this.#root; }
}

export { IntroEditorConfig, Instance as Config };
