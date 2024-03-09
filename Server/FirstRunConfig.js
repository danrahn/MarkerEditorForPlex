import { existsSync, writeFileSync } from 'fs';
import { createInterface as createReadlineInterface } from 'readline/promises';
import { join } from 'path';
/** @typedef {!import('readline/promises').Interface} Interface */

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { MarkerEditorConfig } from './MarkerEditorConfig.js';
import { testFfmpeg } from './ServerHelpers.js';

/** @typedef {!import('./MarkerEditorConfig.js').PathMapping} PathMapping */
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
    console.log('NOTE: the user account running this program must have read access to the database to view');
    console.log('      markers, and write access to add, edit, or delete markers.');
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
        // DataPath isn't needed if a db path is provided and bif preview thumbnails are disabled.
        const defaultPath = MarkerEditorConfig.getDefaultPlexDataPath();
        const dataPath = await askUserPath('Plex data directory path', rl, defaultPath, true /*canSkip*/);
        if (dataPath !== null) {
            config.dataPath = dataPath;
        }

        const defaultDb = join(dataPath ? config.dataPath : defaultPath, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db');
        const database = await askUserPath('Plex database path', rl, defaultDb, dataPath !== null);
        if (database !== null) {
            config.database = database;
        }

        config.host = await askUser('Editor host', 'localhost', rl);
        config.port = parseInt(await askUser('Editor port', '3232', rl, validPort, 'Invalid port number'));
    }

    config.logLevel = await askUser('Server log level (see wiki for available values)', 'Info', rl);
    config.features = {};
    config.features.autoOpen = !isDocker && await askUserYesNo('Do you want the app to open in the browser automatically', true, rl);
    config.features.extendedMarkerStats = await askUserYesNo('Do you want to display extended marker statistics', true, rl);
    await getThumbnailSettings(config, rl);

    // Path mappings are only used for ffmpeg thumbnails, so no need to query otherwise
    if (config.features.preciseThumbnails) {
        const mappings = await getPathMappings(rl);
        if (mappings !== null) {
            config.pathMappings = mappings;
        }
    }

    console.log();
    Log.info('Finished first-run setup, writing config.json and continuing');
    writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n');
    rl.close();
}

/**
 * Determine the type of thumbnails to use, if any.
 * @param {RawConfig} config
 * @param {Interface} rl */
async function getThumbnailSettings(config, rl) {
    config.features.previewThumbnails = await askUserYesNo('Do you want to view preview thumbnails when editing markers', true, rl);
    if (!config.features.previewThumbnails) {
        return;
    }

    // Four possible states:
    // * Ffmpeg on path, and Plex data directory provided: ask what the user wants to use
    // * Ffmpeg on path, Plex data directory not provided: enable precise thumbnails, warn about media location
    // * Ffmpeg not on path, Plex data directory provided: enabled standard thumbnails, warn about accuracy
    // * Ffmpeg not on path, data directory not provided: disable preview thumbnails, warn about why.
    const ffmpegExists = testFfmpeg();
    const canUsePlexThumbs = !!config.dataPath;
    console.log();

    /* eslint-disable require-atomic-updates */ // Something's gone horribly wrong if config is updated while awaiting user input.
    if (canUsePlexThumbs && ffmpegExists) {
        console.log(`Preview thumbnails can use either Plex's generated thumbnails or generate them`);
        console.log(`on-the-fly with ffmpeg. While Plex's thumbnails can be retrieved much faster`);
        console.log(`and use fewer resources, they are far less accurate, and are not available if`);
        console.log(`they are disabled in your library.`);
        const standardThumbs = await askUserYesNo(`Do you want to use Plex's generated thumbnails (y), or ffmpeg (n)`, true, rl);
        config.features.preciseThumbnails = !standardThumbs;
    } else if (ffmpegExists) { // !canUsePlexThumbs
        console.log(`WARN: No data path was provided, so Plex's generated thumbnails cannot be used.`);
        console.log(`      However, because FFmpeg has been detected, precise thumbnails can be enabled.`);
        console.log(`      For this to work, the path to your media must match what's in Plex's, or be`);
        console.log(`      properly mapped via pathMappings.\n`);
        config.features.preciseThumbnails = await askUserYesNo(`Do you want to keep FFmpeg-based thumbnails enabled`, true, rl);
    } else if (canUsePlexThumbs) { // !ffmpegExists
        console.log(`NOTE: Precise thumbnails cannot be enabled - FFmpeg not found on path.`);
        console.log(`      If you want to enable on-the-fly thumbnail generation, make sure FFmpeg`);
        console.log(`      is available.\n`);
        await rl.question('Press Enter to continue: ');
        config.features.preciseThumbnails = false;
    } else { // !ffmpegExists && !canUsePlexThumbs
        console.log('WARN: Cannot enable preview thumbnails - no data path provided, and FFmpeg was');
        console.log('      not found. To enable this feature in the future, provide your Plex data');
        console.log('      path in config.json, or ensure FFmpeg exists on your path.\n');
        await rl.question('Press Enter to continue: ');
        config.features.previewThumbnails = false;
    }
    /* eslint-enable require-atomic-updates */
}

/**
 * Retrieve mapped paths from the user, if any.
 * @param {Interface} rl */
async function getPathMappings(rl) {
    /** @type {PathMapping[]} */
    const mappings = [];
    console.log();
    console.log('Path Mappings:');
    console.log(`If you're running Marker Editor and Plex Media Server on different devices, file paths`);
    console.log(`may be different between this machine and what's in Plex's database. If so, FFmpeg`);
    console.log(`generated thumbnails won't work. However, you can specify path mappings below to replace`);
    console.log(`path prefixes (e.g. replace 'Z:\\Media\\Movies' with '/mnt/Media/Movies').\n`);
    console.log(`NOTE: Path mappings are case-sensitive.\n`);

    const endsWithSep = /[/\\]$/;

    let msg = 'Do you want to add a path mapping';
    while (await askUserYesNo(msg, false, rl)) {
        const from = await askUser(`Map from: `, null, rl);
        const to = await askUser(`Map to: `, null, rl);

        // If one path ends with a separator but the other doesn't, print a warning since that's likely not
        // what the user intended (e.g. if replacing 'Z:\Movies' with '/mnt/data/Movies', the user probably doesn't
        // want to replace 'Z:\Movies\Some Movie' with '/mnt/data/MoviesSome Movie').
        const fromEndsWithSep = endsWithSep.test(from);
        if (fromEndsWithSep !== endsWithSep.test(to)) {
            console.log(`WARN: 'from' path ${fromEndsWithSep ? 'ends with' : 'does not end with' } a path separator, but`);
            console.log(`      'to' path does${fromEndsWithSep ? ' not' : ''}. Is that intentional?`);
        }

        const confirm = await askUserYesNo(`Confirm mapping from '${from}' to '${to}'`, true, rl);
        if (confirm) {
            mappings.push({ from, to });
            console.log('Mapping added!');
        } else {
            console.log('Mapping not added.');
        }

        msg = 'Do you want to add another path mapping';
    }

    return mappings.length === 0 ? null : mappings;
}

/**
 * Asks the user to provide a path. If the default path provided exists,
 * return that if the users enters 'auto', otherwise continue asking until
 * a valid path is provided.
 * @param {string} question
 * @param {Interface} rl
 * @param {string} defaultPath */
async function askUserPath(question, rl, defaultPath, canSkip=false) {
    const defaultExists = defaultPath.length !== 0 && existsSync(defaultPath);
    const validate = path => {
        if (canSkip && path === '-1') {
            return true;
        }

        return existsSync(path.trim());
    };

    for (;;) {
        const defaultText = 'auto' + (canSkip ? ', -1 to skip' : '');
        const answer = await askUser(question, defaultText, rl, validate, 'Path does not exist');
        if (answer === '-1') {
            return null;
        }

        if (answer !== defaultText) {
            return answer.trim();
        }

        if (defaultExists) {
            return defaultPath;
        }

        console.log('Sorry, default path could not be found, please enter the full path.');
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
    if (defaultValue) {
        question += ` (default: ${defaultValue}): `;
    }

    for (;;) {
        const answer = await rl.question(question);
        if (answer.length === 0 || !validateFunc || validateFunc(answer)) {
            return answer.length === 0 ? defaultValue : answer;
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
        if (answer.length === 0) {
            return defaultValue;
        }

        const firstLetter = answer[0].toLowerCase();
        if (firstLetter === 'y') {
            return true;
        }

        if (firstLetter === 'n') {
            return false;
        }
    }
}

/**
 * Very basic port validation, ensuring it's an integer between 1 and 65,535.
 * @param {string} port The port as a string */
function validPort(port) {
    const portInt = parseInt(port);
    return !isNaN(portInt) && portInt > 0 && portInt < 65536 && portInt.toString() === port;
}

export default FirstRunConfig;
