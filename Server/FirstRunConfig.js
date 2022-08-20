import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface as createReadlineInterface } from 'readline';
/** @typedef {!import('readline').Interface} Interface */

import { Log } from '../Shared/ConsoleLog.js';

/**
 * Checks whether config.json exists. If it doesn't, asks the user
 * to go through first-run config setup.
 * @param {string} projectRoot */
async function FirstRunConfig(projectRoot) {
    const configPath = join(projectRoot, 'config.json');
    if (existsSync(configPath)) {
        Log.verbose('config.json exists, skipping first run config.');
        return;
    }

    const rl = createReadlineInterface({
        input: process.stdin,
        output: process.stdout });
    console.log();
    if (!await askUserYesNo('Welcome to Plex Intro Editor! It looks like this is your first run, as config.json\n' +
                            'could not be found. Would you like to go through the first-time setup', true, rl)) {
        if (await askUserYesNo('Would you like to skip this check in the future', false, rl)) {
            writeFileSync(configPath, "{}\n");
            console.log('Wrote default configuration file to avoid subsequent checks.');
        } else {
            Log.warn('Not going through first-time setup, attempting to use defaults for everything.');
        }

        return;
    }

    console.log();
    console.log(`During this initial setup, you'll be asked a series of configuration questions. If a default`);
    console.log(`is available, it will be provided in parentheses, and pressing 'Enter' will select that value.`);
    console.log();
    console.log('If you are asked to provide a path, provide it without quotes or other escaped characters.');
    console.log();
    console.log('For more information about what these settings control, see https://github.com/danrahn/PlexIntroEditor/wiki/Configuration');
    console.log();
    await askUserCore('Press Enter to continue to configuration (Ctrl+C to cancel at any point): ', rl);
    console.log();

    let config = {};
    let dataPath = await askUser('Plex data directory path', 'auto', rl, existsSync, 'Path does not exist');
    if (dataPath != 'auto') { config.dataPath = dataPath; }
    let database = await askUser('Plex database path', 'auto', rl, existsSync, 'File does not exist');
    if (database != 'auto') { config.database = database; }
    config.host = await askUser('Plex Intro Editor host', 'localhost', rl);
    config.port = await askUser('Plex Intro Editor port', '3232', rl, validPort, 'Invalid port number');
    config.logLevel = await askUser('Server log level (see wiki for available values)', 'Info', rl);
    config.features = {};
    config.features.autoOpen = await askUserYesNo('Do you want the app to open in the browser automatically', true, rl);
    config.features.extendedMarkerStats = await askUserYesNo('Do you want to display extended marker statistics', true, rl);
    config.features.backupActions = await askUserYesNo('Do you want to track/backup custom marker actions', true, rl);
    config.features.previewThumbnails = await askUserYesNo('Do you want to view preview thumbnails when editing markers', true, rl);
    config.features.pureMode = await askUserYesNo('Do you want to enable pureMode (see wiki)', false, rl);
    console.log();
    Log.info('Finished first-run setup, writing config.json and continuing');
    writeFileSync(configPath, JSON.stringify(config, null, 4) + "\n");
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
    question = question + ` (default: ${defaultValue}): `;
    while (true) {
        let answer = await askUserCore(question, rl);
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
    question = question + ` [y/n]? (default: ${defaultValue ? 'y' : 'n'}): `;
    while (true) {
        let answer = await askUserCore(question, rl);
        if (answer.length == 0) {
            return defaultValue;
        }

        let firstLetter = answer[0].toLowerCase();
        if (firstLetter == 'y') {
            return true;
        }

        if (firstLetter == 'n') {
            return false;
        }
    }
}

/**
 * Base method to ask the user a question and return a response. Wraps the callback-based
 * ReadLine interface with a Promise.
 * Note: Promise-based interface is directly available in Node 17, but since as of
 * this function's creation, LTS is still on 16.x, so best to avoid it for now.
 * @param {string} question The question to ask the user.
 * @param {Interface} rl The console interface.
 * @returns {Promise<string>} */
async function askUserCore(question, rl) {
    return new Promise((resolve, _) => {
        rl.question(question, (response) => {
            resolve(response);
        });
    });
}

/**
 * Very basic port validation, ensuring it's an integer between 1 and 65,535.
 * @param {string} port The port as a string */
function validPort(port) {
    const portInt = parseInt(port);
    return !isNaN(portInt) && portInt > 0 && portInt < 65536 && portInt.toString() == port;
}

export default FirstRunConfig;
