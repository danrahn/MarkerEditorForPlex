const Config = require('./config.json');
const ConsoleLog = require('./inc/script/ConsoleLog.js');

/**
 * ConsoleLog instance from the main application.
 * @type {ConsoleLog}
 */
let Log;

/**
 * Provides read-only access to the users application configuration.
 */
class PlexIntroEditorConfig {

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
     * Set the server side logger.
     * @param {ConsoleLog} log 
     */
    static SetLog(log) { Log = log; }

    constructor() {
        if (!Log) {
            console.warn('Log should be set before using PlexIntroEditorConfig!');
        }

        this.#json = Config;
        this.#dbPath = this.#getOrDefault('database');
        this.#host = this.#getOrDefault('host', 'localhost');
        this.#port = this.#getOrDefault('port', 3232);
        this.#autoOpen = this.#getOrDefault('autoOpen', true);
        this.#logLevel = this.#getOrDefault('logLevel', "Info");
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

    #getOrDefault(value, defaultValue=null) {
        if (!this.#json.hasOwnProperty(value)) {
            if (defaultValue == null) {
                throw new Error(`${value} not found in config file, and no default is available.`);
            }

            Log && Log.warn(`'${value}' not found in config file. Defaulting to '${defaultValue}'.`);
            return defaultValue;
        }

        return this.#json[value];
    }
}

module.exports = PlexIntroEditorConfig;