import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ConsoleLog, Log } from '../Shared/ConsoleLog.js';

/** @typedef {{enabled : boolean, metadataPath : string}} PreviewThumbnails */

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
 * duplicate the code between PlexFeatures and PlexIntroEditorConfig, but where's the fun in that?
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

            Log.warn(`'${key}' not found in config file. Defaulting to '${defaultValue}'.`);
            return defaultValue;
        }

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
    backupActions = false;

    /** Setting for displaying timestamped preview thumbnails when editing or adding markers.
     * @type {PreviewThumbnails} */
    previewThumbnails = {};

    /** Sets the application features based on the given json.
     * @param {object} json */
    constructor(json) {
        let baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Features not found in config, setting defaults');
            this.previewThumbnails = { enabled : false, metadataPath : '' };
            return;
        }

        this.autoOpen = this.#getOrDefault('autoOpen', true);
        this.extendedMarkerStats = this.#getOrDefault('extendedMarkerStats', true);
        this.backupActions = this.#getOrDefault('backupActions', false); // Disabled by default pending further testing.
        this.previewThumbnails = this.#getOrDefault('previewThumbnails', { enabled : false, metadataPath : '' });
        if (this.previewThumbnails.enabled && !this.previewThumbnails.metadataPath || !existsSync(this.previewThumbnails.metadataPath)) {
            throw new Error(`Preview thumbnails are enabled, but the metadata path '${this.previewThumbnails.metadataPath}' does not exist.`);
        }
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault.bind(this.#Base.baseInstance)(key, defaultValue);
    }
}

/**
 * Provides read-only access to the users application configuration.
 */
class PlexIntroEditorConfig extends ConfigBase {

    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
     #Base = {}

    /** The file path to the Plex database
     * @type {string} */
    #dbPath;

    /** The host to bind the application to.
     * @type {string} */
    #host;

    /** The port to bind the application to.
     * @type {number} */
    #port;

    /** The default server log level for the application, as a string.
     * @type {string} */
    #logLevel;

    /** Configurable features that can be enabled/disabled in this application.
     * @type {PlexFeatures} */
    #features;

    /** Creates a new PlexIntroEditorConfig. */
    constructor(projectRoot) {
        Log.info('Reading configuration...');
        let baseClass = {};
        const config = JSON.parse(readFileSync(join(projectRoot, 'config.json')));
        super(config, baseClass);
        this.#Base = baseClass;

        this.#logLevel = this.#getOrDefault('logLevel', "Info");
        this.#setLogLevel();
        this.#dbPath = this.#getOrDefault('database');
        this.#host = this.#getOrDefault('host', 'localhost');
        this.#port = this.#getOrDefault('port', 3232);
        this.#features = new PlexFeatures(this.#Base.json.features);
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault.bind(this.#Base.baseInstance)(key, defaultValue);
    }

    databasePath() { return this.#dbPath; }
    host() { return this.#host; }
    port() { return this.#port; }
    autoOpen() { return this.#features.autoOpen; }
    useThumbnails() { return this.#features.previewThumbnails.enabled; }
    metadataPath() { return this.#features.previewThumbnails.metadataPath; }
    extendedMarkerStats() { return this.#features.extendedMarkerStats; }
    disableExtendedMarkerStats() { this.#features.extendedMarkerStats = false; }
    backupActions() { return this.#features.backupActions; }

    /** Sets the server side log level taken from the config file */
    #setLogLevel() {
        const logSettings = this.#convertLogString();
        Log.setLevel(logSettings.level);
        Log.setDarkConsole(logSettings.dark);
    }

    /**
     * Converts the string log level from the config into actual log settings.
     * If the string starts with 'dark', intialize the console to be dark and parse
     * the rest of the string as the actual log level.
     * @returns {{dark: number, level: [ConsoleLog.Level]}}
     */
    #convertLogString() {
        let dark = 0;
        let level = this.#logLevel.toLowerCase();
        if (level.startsWith('dark')) {
            dark = 1;
            level = level.substring(4);
        }

        return {
            dark : dark,
            level : this.#convertLogLevel(level)
        }
    }

    /**
     * Converts the string log level from the config into the ConsoleLog.Level enum value.
     * @param {string} logString The string to parse.
     * @returns {ConsoleLog.Level} */
    #convertLogLevel(logString) {
        switch(logString) {
            case 'tmi':
                return ConsoleLog.Level.Tmi;
            case 'verbose':
                return ConsoleLog.Level.Verbose;
            case 'info':
                return ConsoleLog.Level.Info;
            case 'warn':
                return ConsoleLog.Level.Warn;
            case 'error':
                return ConsoleLog.Level.Error;
            default:
                Log.warn(`Invalid log level detected: ${this.#logLevel}. Defaulting to 'Info'`);
                return ConsoleLog.Level.Info;
        }
    }
}

export default PlexIntroEditorConfig;
