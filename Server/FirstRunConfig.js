import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createServer as createHttpsServer } from 'https';
import { join } from 'path';
import { read } from 'read';

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { testFfmpeg, testHostPort } from './ServerHelpers.js';
import { MarkerEditorConfig } from './MarkerEditorConfig.js';
import { User } from './Authentication/Authentication.js';

/** @typedef {!import('./MarkerEditorConfig.js').PathMapping} PathMapping */
/** @typedef {!import('./MarkerEditorConfig.js').RawConfigFeatures} RawConfigFeatures */
/** @typedef {!import('./MarkerEditorConfig.js').RawConfig} RawConfig */

const Log = new ContextualLog('FirstRun');

/**
 * Checks whether config.json exists. If it doesn't, asks the user
 * to go through first-run config setup.
 * @param {string} dataRoot
 * @param {boolean} forceCli */
async function FirstRunConfig(dataRoot, forceCli) {
    const configPath = join(dataRoot, 'config.json');

    const configExists = existsSync(configPath);

    if (configExists) {
        if (forceCli) {
            console.log('Welcome to Marker Editor for Plex!');
            console.log('The editor was launched with --cli-setup, but a config file was already found.');
            if (await askUserYesNo(`Do you want to exit configuration and start the app (Y), or continue with the \n` +
                `configuration (N), overwriting your current config`, true)) {
                return;
            }
        } else {
            Log.verbose('config.json exists, skipping first run config.');
            return;
        }
    }

    if (!forceCli) {
        // The following has mostly been replaced with the new client-side configuration,
        // but the once time we'll still use this is if our default host:port is already in use,
        // so use the CLI to get values instead of trying to find an open port.
        const serverTest = await testHostPort('localhost', 3232);
        if (serverTest.valid) {
            return;
        }

        console.log();
        console.log(`[WARN]: Default host and port already in use, falling back to command line setup.`);
        console.log();
    }

    console.log();

    if (!configExists) {
        if (!await askUserYesNo('Welcome to Marker Editor for Plex! It looks like this is your first run, as config.json\n' +
                                'could not be found. Would you like to go through the first-time setup', true)) {
            if (await askUserYesNo('Would you like to skip this check in the future', false)) {
                writeFileSync(configPath, '{}\n');
                console.log('Wrote default configuration file to avoid subsequent checks.');
            } else {
                Log.warn('Not going through first-time setup, attempting to use defaults for everything.');
            }

            return;
        }
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
    await read({ prompt : 'Press Enter to continue to configuration (Ctrl+C to cancel at any point): ' });
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
        const dataPath = await askUserPath('Plex data directory path', defaultPath, true /*canSkip*/);
        if (dataPath !== null) {
            config.dataPath = dataPath;
        }

        const defaultDb = join(dataPath ? config.dataPath : defaultPath, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db');
        const database = await askUserPath('Plex database file (full path)', defaultDb, dataPath !== null);
        if (database !== null) {
            config.database = database;
        }

        config.host = await askUser('Editor host', 'localhost');
        config.port = parseInt(await askUser('Editor port', '3232', validPort, 'Invalid port number'));
    }

    config.logLevel = await askUser('Server log level (see wiki for available values)', 'Info');

    config.ssl = {};
    config.ssl.enabled = await askUserYesNo('Do you want to enable secure (HTTPS) connections (note\n' +
                                            'that this requires a valid PFX or PEM certificate)', false);
    if (config.ssl.enabled) {
        await setupSsl(config);
    }


    config.authentication = {};
    config.authentication.enabled = await askUserYesNo('Do you want to require a username/password to access this application', false);
    if (config.authentication.enabled) {
        config.authentication.sessionTimeout = await askUser(
            'Session timeout', 86400, validTimeout, 'Timeout must be a number greater than 300');
        if (!await setupUserPass()) {
            config.authentication.enabled = false;
            console.log('Auth setup canceled, disabling.');
        }
    }

    config.features = {};
    config.features.autoOpen = !isDocker && await askUserYesNo('Do you want the app to open in the browser automatically', true);
    config.features.extendedMarkerStats = await askUserYesNo('Do you want to display extended marker statistics', true);
    await getThumbnailSettings(config);

    // Path mappings are only used for ffmpeg thumbnails, so no need to query otherwise
    if (config.features.preciseThumbnails) {
        const mappings = await getPathMappings();
        if (mappings !== null) {
            config.pathMappings = mappings;
        }
    }

    console.log();
    Log.info('Finished first-run setup, writing config.json and continuing');
    writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n');
}

/**
 * @param {RawConfig} config */
async function setupSsl(config) {
    const ssl = config.ssl;
    ssl.sslOnly = await askUserYesNo('Force secure connections');

    if (ssl.sslOnly) {
        ssl.host = config.host;
        ssl.port = config.port;
    } else if (process.env.IS_DOCKER) {
        ssl.host = '0.0.0.0';
        ssl.port = 3233;
    } else {
        ssl.host = await askUser('HTTPS host', '0.0.0.0');
        ssl.port = parseInt(await askUser('HTTPS port', '3233', validPort, 'Invalid port number'));
    }

    ssl.certType = (await askUser(
        'Certificate type (PFX or PEM)', 'PFX',
        value => ['pfx', 'pem'].includes(value.trim().toLowerCase()),
        'Must enter "pfx" or "pem" (no quotes)')).trim().toLowerCase();

    const validSSL = opts => {
        try {
            createHttpsServer(opts, () => {}).close();
            return true;
        } catch {
            return false;
        }
    };

    if (ssl.certType === 'pfx') {
        ssl.pfxPath = await askUserPath('Path to PKCS#12 certificate file');
        ssl.pfxPassphrase = await askUserPrivate('Certificate passphrase');
    } else {
        ssl.pemCert = await askUserPath('Path to PEM certificate');
        ssl.pemKey = await askUserPath('Path to PEM private key');
    }

    if (!validSSL(ssl.certType === 'pfx' ?
        { pfx : readFileSync(ssl.pfxPath), passphrase : ssl.pfxPassphrase } :
        { cert : readFileSync(ssl.pemCert), key : readFileSync(ssl.pemKey) })) {
        Log.warn('Failed to initialize HTTPS server with given credentials. SSL will likely be disabled.\n');
    }
}

/**
 * Set up authentication related settings. */
async function setupUserPass() {
    let existingPass = '';
    if (User.passwordSet()) {
        console.log(`\n!!! Existing username/password detected !!!\n`);
        console.log(`If you choose to change the username/password, you will be asked for the existing password.`);
        console.log(`If you do not remember your old password, you will have to manually delete auth.db\n`);

        const replace = await askUserYesNo('Do you want to change the existing username/password', false);
        if (replace) {
            existingPass = await askUserPrivate('Current password', null, async (pass) => {
                if (pass === '-1') {
                    return true;
                }

                return await User.loginInternal(pass);
            }, 'Passwords do not match (-1 to abort)'); // Assume the user doesn't want '-1' as their password.

            if (existingPass === '-1') {
                console.log('Username/password setup aborted.');
                return false;
            }
        } else {
            return true;
        }
    }

    const username = (await askUser('Username: ', null, value => {
        value = value.trim();
        return value.length === value.replace(/ /g, '').length && value.length <= 256 && value.length > 0;
    }, 'Username cannot contain spaces and has a maximum length of 256 characters')).trim();

    let password;
    let failures = 0;
    let passes = 0;
    let abort = false;
    const validatePass = pass => {
        if (passes > 1 && pass === '-1') {
            abort = true;
            return true;
        }

        return pass.length > 0;
    };

    const validateConfirmation = pass => {
        if (pass !== password) {
            ++failures;
            if (failures === 3) {
                console.log('Password verification failed, please try again' +
                    (passes > 1 ? ' (-1 to disable auth and continue setup).\n' : '\n'));
                return true;
            }
        }

        return pass === password;
    };

    for (;;) {
        ++passes;
        failures = 0;
        password = await askUserPrivate('Password', null, validatePass, 'Password cannot be empty');
        if (abort) {
            return false;
        }

        await askUserPrivate(
            'Confirm password', null, validateConfirmation, 'Passwords do not match');
        if (failures < 3) {
            break;
        }
    }

    if (abort) {
        return false;
    }

    if (!await User.changePassword(username, password, password)) {
        console.log('\n!!! ERROR - auth setup failed !!!\n');
        if (await askUserYesNo('Would you like to continue setup with auth disabled', false)) {
            return false;
        }

        console.log('Aborting setup.');
        throw new Error('Server setup failed, cannot continue');
    }

    return true;
}

/**
 * Determine the type of thumbnails to use, if any.
 * @param {RawConfig} config */
async function getThumbnailSettings(config) {
    config.features.previewThumbnails = await askUserYesNo('Do you want to view preview thumbnails when editing markers', true);
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
        const standardThumbs = await askUserYesNo(`Do you want to use Plex's generated thumbnails (y), or ffmpeg (n)`, true);
        config.features.preciseThumbnails = !standardThumbs;
    } else if (ffmpegExists) { // !canUsePlexThumbs
        console.log(`WARN: No data path was provided, so Plex's generated thumbnails cannot be used.`);
        console.log(`      However, because FFmpeg has been detected, precise thumbnails can be enabled.`);
        console.log(`      For this to work, the path to your media must match what's in Plex's, or be`);
        console.log(`      properly mapped via pathMappings.\n`);
        config.features.preciseThumbnails = await askUserYesNo(`Do you want to keep FFmpeg-based thumbnails enabled`, true);
    } else if (canUsePlexThumbs) { // !ffmpegExists
        console.log(`NOTE: Precise thumbnails cannot be enabled - FFmpeg not found on path.`);
        console.log(`      If you want to enable on-the-fly thumbnail generation, make sure FFmpeg`);
        console.log(`      is available.\n`);
        await read({ prompt : 'Press Enter to continue: ' });
        config.features.preciseThumbnails = false;
    } else { // !ffmpegExists && !canUsePlexThumbs
        console.log('WARN: Cannot enable preview thumbnails - no data path provided, and FFmpeg was');
        console.log('      not found. To enable this feature in the future, provide your Plex data');
        console.log('      path in config.json, or ensure FFmpeg exists on your path.\n');
        await read({ prompt : 'Press Enter to continue: ' });
        config.features.previewThumbnails = false;
    }
    /* eslint-enable require-atomic-updates */
}

/**
 * Retrieve mapped paths from the user, if any. */
async function getPathMappings() {
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
    while (await askUserYesNo(msg, false)) {
        const from = await askUser(`Map from: `, null);
        const to = await askUser(`Map to: `, null);

        // If one path ends with a separator but the other doesn't, print a warning since that's likely not
        // what the user intended (e.g. if replacing 'Z:\Movies' with '/mnt/data/Movies', the user probably doesn't
        // want to replace 'Z:\Movies\Some Movie' with '/mnt/data/MoviesSome Movie').
        const fromEndsWithSep = endsWithSep.test(from);
        if (fromEndsWithSep !== endsWithSep.test(to)) {
            console.log(`WARN: 'from' path ${fromEndsWithSep ? 'ends with' : 'does not end with' } a path separator, but`);
            console.log(`      'to' path does${fromEndsWithSep ? ' not' : ''}. Is that intentional?`);
        }

        const confirm = await askUserYesNo(`Confirm mapping from '${from}' to '${to}'`, true);
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
 * @param {string} defaultPath
 * @param {boolean} canSkip */
async function askUserPath(question, defaultPath='', canSkip=false) {
    const defaultExists = defaultPath.length !== 0 && existsSync(defaultPath);
    const validate = path => {
        if (canSkip && path === '-1') {
            return true;
        }

        return existsSync(path.trim());
    };

    for (;;) {
        const defaultText = 'auto' + (canSkip ? ', -1 to skip' : '');
        const answer = await askUser(question, defaultText, validate, 'Path does not exist');
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
 * @param {(value: string) => boolean|Promise<boolean>} [validateFunc=null] Function to validate the user's input, if any.
 * @param {string} validateMsg The message to display if validation fails.
 * @returns {Promise<string>} */
function askUser(question, defaultValue, validateFunc=null, validateMsg=null) {
    return askUserCore(question, defaultValue, validateFunc, validateMsg, false /*silent*/);
}

/**
 * Ask the user an open-ended question, hiding their input.
 * @param {string} question The question to ask the user.
 * @param {string} defaultValue The default value if one is not provided.
 * @param {(value: string) => boolean|Promise<boolean>} [validateFunc=null] Function to validate the user's input, if any.
 * @param {string} validateMsg The message to display if validation fails.
 * @returns {Promise<string>} */
function askUserPrivate(question, defaultValue, validateFunc=null, validateMsg=null) {
    return askUserCore(question, defaultValue, validateFunc, validateMsg, true /*silent*/);
}

/**
 * Ask the user an open-ended question.
 * @param {string} question The question to ask the user.
 * @param {string} defaultValue The default value if one is not provided.
 * @param {(value: string) => boolean|Promise<boolean>} [validateFunc=null] Function to validate the user's input, if any.
 * @param {string} validateMsg The message to display if validation fails.
 * @returns {Promise<string>} */
async function askUserCore(question, defaultValue, validateFunc=null, validateMsg=null, silent=false) {
    if (defaultValue) {
        question += ` (default: ${defaultValue}): `;
    }

    for (;;) {
        const opts = {};
        if (silent) {
            opts.silent = true;
            opts.replace = '*';
        }

        const answer = await read({ prompt : question, ...opts });
        if ((answer.length === 0 && defaultValue !== null) || !validateFunc || await validateFunc(answer)) {
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
 * @param {boolean} defaultValue The default response. */
async function askUserYesNo(question, defaultValue) {
    question += ` [y/n]? (default: ${defaultValue ? 'y' : 'n'}): `;
    for (;;) {
        const answer = await read({ prompt : question });
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

/**
 * Validate that the given session timeout is valid.
 * @param {string} timeout */
function validTimeout(timeout) {
    const timeoutInt = parseInt(timeout);
    return !isNaN(timeoutInt) && timeoutInt >= 300 && timeoutInt.toString() === timeout;
}

export default FirstRunConfig;
