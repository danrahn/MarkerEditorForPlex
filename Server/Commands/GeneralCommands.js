import { ConsoleLog, Log } from "../../Shared/ConsoleLog.js";

import { Config } from "../PlexIntroEditor.js";
import ServerError from "../ServerError.js";

/**
 * Classification of commands that don't fit in any of the other buckets
 */
class GeneralCommands {
    constructor() {
        Log.tmi(`Setting up general commands.`);
    }

    /**
     * Retrieve a subset of the app configuration that the frontend needs access to.
     * This is only async to conform with the command handler signature. */
    static async getConfig() {
        return Promise.resolve({
            useThumbnails : Config.useThumbnails(),
            extendedMarkerStats : Config.extendedMarkerStats(),
            backupActions : Config.backupActions()
        });
    }

    /**
     * Set the server log properties, inherited from the client.
     * @param {number} newLevel The new log level.
     * @param {number} darkConsole Whether to adjust log colors for a dark background.
     * @param {number} traceLogging Whether to also print a stack trace for each log entry.*/
    static async setLogSettings(newLevel, darkConsole, traceLogging) {
        const logLevelString = Object.keys(ConsoleLog.Level).find(l => ConsoleLog.Level[l] == newLevel);
        if (logLevelString === undefined) {
            Log.warn(newLevel, 'Attempting to set an invalid log level, ignoring');
            // If the level is invalid, don't adjust anything else either.
            throw new ServerError(`Invalid Log level: ${newLevel}`, 400);
        }

        if (newLevel != Log.getLevel() || darkConsole != Log.getDarkConsole() || traceLogging != Log.getTrace()) {
            // Force the message.
            Log.setLevel(ConsoleLog.Level.Info);
            const newSettings = { Level : newLevel, Dark : darkConsole, Trace : traceLogging };
            Log.info(newSettings, 'Changing log settings due to client request');
            Log.setLevel(newLevel);
            Log.setDarkConsole(darkConsole);
            Log.setTrace(traceLogging);
        }
    }
}

export default GeneralCommands;
