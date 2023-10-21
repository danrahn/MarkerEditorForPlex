import { existsSync, writeFileSync } from 'fs';
import { createInterface as createReadlineInterface } from 'readline/promises';
import { join } from 'path';
/** @typedef {!import('readline').Interface} Interface */

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { MarkerEditorConfig } from './MarkerEditorConfig.js';
import { testFfmpeg } from './ServerHelpers.js';

/** @typedef {!import('./MarkerEditorConfig.js').RawConfigFeatures} RawConfigFeatures */
/** @typedef {!import('./MarkerEditorConfig.js').RawConfig} RawConfig */

const Log = new ContextualLog('FirstRun');

/**
 * Checks whether config.json exists. If it doesn't, asks the user
 * to go through first-run config setup.
 * @param {string} dataRoot */
async function FirstRunConfig(dataRoot) {
    const configPath = join(dataRoot, 'config.json');

    if (existsSync(configPath)) {
        Log.verbose('config.json exists, skipping first run config.');
        return;
    }

    const rl = createReadlineInterface({
        input : process.stdin,
        output : process.stdout });
    console.log();
    if (!await askUserYesNo('Welcome to Marker Editor for Plex! It looks like this is your first run, as config.json\n' +
                            'could not be found. Would you like to go through the first-time setup', true, rl)) {
        if (await askUserYesNo('Would you like to skip this check in the future', false, rl)) {
            writeFileSync(configPath, '{}\n');
            console.log('Wrote default configuration file to avoid subsequent checks.');
        } else {
            Log.warn('Not going through first-time setup, attempting to use defaults for everything.');
        }

        rl.close();
        return;
    }

    console.log();
    console.log(`During this initial setup, you'll be asked a series of configuration questions. If a default`);
    console.log(`is available, it will be provided in parentheses, and pressing 'Enter' will select that value.`);
    console.log();
    console.log('If you are asked to provide a path, provide it without quotes or other escaped characters.');
    console.log();
    /* eslint-disable-next-line max-len */
    console.log('For more information about what these settings control, see https://github.com/danrahn/MarkerEditorForPlex/wiki/Configuration');
    console.log();
    await rl.question('Press Enter to continue to configuration (Ctrl+C to cancel at any point): ');
    console.log();

    /** @type {RawConfig} */
    const config = {};

    const isDocker = process.env.IS_DOCKER;
    if (isDocker) {
        // In Docker, file paths are static, provided by the user during docker run
        config.dataPath = '/PlexDataDirectory';
        config.database = join(config.dataPath, 'Plug-in Support/Databases/com.plexapp.plugins.library.db');
        config.host = '0.0.0.0';
        config.port = 3232;
    } else {
        const defaultPath = MarkerEditorConfig.getDefaultPlexDataPath();
        config.dataPath = await askUserPath('Plex data directory path', rl, defaultPath);
        const defaultDb = join(config.dataPath, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db');
        config.database = await askUserPath('Plex database path', rl, defaultDb);
        config.host = await askUser('Editor host', 'localhost', rl);
        config.port = parseInt(await askUser('Editor port', '3232', rl, validPort, 'Invalid port number'));
    }

    config.logLevel = await askUser('Server log level (see wiki for available values)', 'Info', rl);
    config.features = {};
    config.features.autoOpen = !isDocker && await askUserYesNo('Do you want the app to open in the browser automatically', true, rl);
    config.features.extendedMarkerStats = await askUserYesNo('Do you want to display extended marker statistics', true, rl);
    config.features.previewThumbnails = await askUserYesNo('Do you want to view preview thumbnails when editing markers', true, rl);
    if (config.features.previewThumbnails && testFfmpeg()) {
        console.log();
        console.log(`Preview thumbnails can use either Plex's generated thumbnails or generate them`);
        console.log(`on-the-fly with ffmpeg. While Plex's thumbnails can be retrieved much faster`);
        console.log(`and use fewer resources, they are far less accurate, and are not available if`);
        console.log(`they are disabled in your library.`);
        config.features.preciseThumbnails =
            !await askUserYesNo(`Do you want to use Plex's generated thumbnails (y), or ffmpeg (n)`, true, rl);
    }

    console.log();
    Log.info('Finished first-run setup, writing config.json and continuing');
    writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n');
    rl.close();
}

/**
 * Asks the user to provide a path. If the default path provided exists,
 * return that if the users enters 'auto', otherwise continue asking until
 * a valid path is provided.
 * @param {string} question
 * @param {Interface} rl
 * @param {string} defaultPath */
async function askUserPath(question, rl, defaultPath) {
    const defaultExists = defaultPath.length != 0 && existsSync(defaultPath);
    for (;;) {
        const answer = await askUser(question, 'auto', rl, existsSync, 'Path does not exist');
        if (answer != 'auto') {
            return answer;
        }

        if (defaultExists) {
            return defaultPath;
        }

        console.log('Sorry, default path could not be found, please enter the full path to your Plex data directory.');
    }
}

/**
 * Ask the user an open-ended question (i.e. not yes/no).
 * @param {string} question The question to ask the user.
 * @param {string} defaultValue The default value if one is not provided.
 * @param {Interface} rl Console interface.
 * @param {(string) => boolean} [validateFunc=null] Function to validate the user's input, if any.
 * @param {string} validateMsg The message to display if validation fails.
 * @returns {Promise<string>} */
async function askUser(question, defaultValue, rl, validateFunc=null, validateMsg=null) {
    question += ` (default: ${defaultValue}): `;
    for (;;) {
        const answer = await rl.question(question);
        if (answer.length == 0 || !validateFunc || validateFunc(answer)) {
            return answer.length == 0 ? defaultValue : answer;
        }

        if (validateMsg) {
            console.log(validateMsg);
        }
    }
}

/**
 * Ask the user a yes/no question, returning whether 'yes' was chosen.
 * @param {string} question The yes/no question.
 * @param {boolean} defaultValue The default response.
 * @param {Interface} rl The console interface.
 * @returns {Promise<boolean>} */
async function askUserYesNo(question, defaultValue, rl) {
    question += ` [y/n]? (default: ${defaultValue ? 'y' : 'n'}): `;
    for (;;) {
        const answer = await rl.question(question);
        if (answer.length == 0) {
            return defaultValue;
        }

        const firstLetter = answer[0].toLowerCase();
        if (firstLetter == 'y') {
            return true;
        }

        if (firstLetter == 'n') {
            return false;
        }
    }
}

/**
 * Very basic port validation, ensuring it's an integer between 1 and 65,535.
 * @param {string} port The port as a string */
function validPort(port) {
    const portInt = parseInt(port);
    return !isNaN(portInt) && portInt > 0 && portInt < 65536 && portInt.toString() == port;
}

export default FirstRunConfig;
