const Config = require('./config.json');
const ConsoleLog = require('./inc/script/ConsoleLog.js');

/**
 * Provides read-only access to the users application configuration.
 */
class PlexIntroEditorConfig {

    /**
     * ConsoleLog instance from the main application.
     * @type {ConsoleLog}
     */
    #Log;

    /**
     * The raw configuration file.
     * @type {Object} */
    #json;

    /**
     * The file path to the Plex database
     * @type {string} */
    #dbPath;

    /**
     * The host to bind the application to.
     * @type {string} */
    #host;

    /**
     * The port to bind the application to.
     * @type {number} */
    #port;

    /**
     * Indicates whether the application should be opened in the browser on launch.
     * @type {boolean} */
    #autoOpen;

    /**
     * The default server log level for the application, as a string.
     * @type {string} */
    #logLevel;

    /**
     * Indicates whether the application should try to grab preview thumbnails for episodes.
     * @type {boolean} */
    #useThumbnails;

    /**
     * If preview thumbnails are enabled, contains the path to Plex data directory.
     * @type {string} */
    #metadataPath;

    /**
     * Creates a new PlexIntroEditorConfig.
     * @param {ConsoleLog} log
     * @throws Error if `log` is not present.
     */
    constructor(log) {
        if (!log) {
            throw new Error('Log not set before using PlexIntroEditorConfig!');
        }

        this.#Log = log;
        this.#json = Config;
        this.#logLevel = this.#getOrDefault('logLevel', "Info");
        this.#setLogLevel();
        this.#dbPath = this.#getOrDefault('database');
        this.#host = this.#getOrDefault('host', 'localhost');
        this.#port = this.#getOrDefault('port', 3232);
        this.#autoOpen = this.#getOrDefault('autoOpen', true);
        this.#useThumbnails = this.#getOrDefault('useThumbnails', false);
        this.#metadataPath = this.#getOrDefault('metadataPath', this.#useThumbnails ? null : '<none>');
    }

    databasePath() { return this.#dbPath; }
    host() { return this.#host; }
    port() { return this.#port; }
    autoOpen() { return this.#autoOpen; }
    logLevel() { return this.#logLevel; }
    useThumbnails() { return this.#useThumbnails; }
    metadataPath() { return this.#metadataPath; }

    /**
     * @param {string} value The config property to retrieve.
     * @param {*} [defaultValue=null] The default value if the property doesn't exist.
     * @returns The retrieved property value.
     * @throws if `value` is not in the config and `defaultValue` is not set.
     */
    #getOrDefault(value, defaultValue=null) {
        if (!this.#json.hasOwnProperty(value)) {
            if (defaultValue == null) {
                throw new Error(`'${value}' not found in config file, and no default is available.`);
            }

            this.#Log.warn(`'${value}' not found in config file. Defaulting to '${defaultValue}'.`);
            return defaultValue;
        }

        return this.#json[value];
    }

    /** Sets the server side log level taken from the config file */
    #setLogLevel() {
        this.#Log.setLevel(this.#convertLogLevel());
    }

    /**
     * Converts the string log level from the config into the ConsoleLog.Level enum value.
     * @returns {this.#Log.Level}
     */
    #convertLogLevel() {
        switch(this.#logLevel.toLowerCase()) {
            case "tmi":
                return this.#Log.Level.Tmi;
            case "verbose":
                return this.#Log.Level.Verbose;
            case "info":
                return this.#Log.Level.Info;
            case "warn":
                return this.#Log.Level.Warn;
            case "error":
                return this.#Log.Level.Error;
            default:
                this.#Log.warn(`Invalid log level detected: ${this.#logLevel}. Defaulting to 'Info'`);
                return this.#Log.Level.Info;
        }
    }
}

module.exports = PlexIntroEditorConfig;