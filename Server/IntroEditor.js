/** External dependencies */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import Open from 'open';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */
/** @typedef {!import('http').Server} httpServer */

/** Server dependencies */
import FirstRunConfig from './FirstRunConfig.js';
import GETHandler from './GETHandler.js';
import { MarkerBackupManager, BackupManager } from './MarkerBackupManager.js';
import { MarkerCacheManager } from './MarkerCacheManager.js';
import { IntroEditorConfig, Config } from './IntroEditorConfig.js';
import { PlexQueryManager } from './PlexQueryManager.js';
import ServerCommands from './ServerCommands.js';
import ServerError from './ServerError.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import { ServerState, GetServerState, SetServerState } from './ServerState.js';
import { ThumbnailManager } from './ThumbnailManager.js';

/** Server+Client shared dependencies */
import { Log } from '../Shared/ConsoleLog.js';

/**
 * HTTP server instance.
 * @type {httpServer} */
let Server;

/** Global flag indicating if the server is running tests. */
let IsTest = false;

/** Initializes and starts the server */
async function run() {
    setupTerminateHandlers();
    const testData = checkTestData();
    const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    // In docker, the location of the config and backup data files are not the project root.
    const dataRoot = process.env.IS_DOCKER ? '/Data' : projectRoot;
    if (!testData.isTest) {
        await FirstRunConfig(dataRoot);
    }

    const config = IntroEditorConfig.Create(projectRoot, testData, dataRoot);

    // Set up the database, and make sure it's the right one.
    const queryManager = await PlexQueryManager.CreateInstance(config.databasePath(), config.pureMode());
    if (config.backupActions()) {
        await MarkerBackupManager.CreateInstance(IsTest ? join(dataRoot, 'Test') : dataRoot);
    } else {
        Log.warn('Marker backup not enabled. Any changes removed by Plex will not be recoverable.');
    }

    await ThumbnailManager.Create(queryManager.database(), config.metadataPath());
    if (config.extendedMarkerStats()) {
        const markerCache = MarkerCacheManager.Create(queryManager.database(), queryManager.markerTagId());
        try {
            await markerCache.buildCache();
            await BackupManager?.buildAllPurges();
        } catch (err) {
            Log.error(err.message, 'Failed to build marker cache:');
            Log.error('Continuing to server creating, but extended marker statistics will not be available.');
            config.disableExtendedMarkerStats();
            MarkerCacheManager.Close();
        }
    }

    Log.info('Creating server...');
    return launchServer();
}

export { run };

/** Set up process listeners that will shut down the process
 * when it encounters an unhandled exception or SIGINT. */
function setupTerminateHandlers() {
    // Only need to do this on first boot, not if we're restarting/resuming
    if (GetServerState() != ServerState.FirstBoot) {
        return;
    }

    // If we encounter an unhandled exception, handle it somewhat gracefully and exit the process.
    process.on('uncaughtException', (err) => {
        Log.critical(err.message);
        const stack = err.stack ? err.stack : '(Could not find stack trace)';
        IsTest ? Log.error(stack) : Log.verbose(stack);
        Log.error('The server ran into an unexpected problem, exiting...');
        writeErrorToFile(err.message + '\n' + stack);
        cleanupForShutdown();
        process.exit(1);
    });

    // Capture Ctrl+C (and other interrupts) and cleanly exit the process
    const signalCallback = (sig) => handleClose(sig);
    process.on('SIGINT', signalCallback);
    process.on('SIGQUIT', signalCallback);
    process.on('SIGTERM', signalCallback);

    // On Windows, Ctrl+Break immediately shuts down without cleanup
    process.on('SIGBREAK', () => {
        Log.warn('Ctrl+Break detected, shutting down immediately.');
        process.exit(1);
    });
}

/**
 * Attempts to write critical errors to a log file, which can be helpful for
 * debugging if the console window closes on process exit.
 * @param {string} message The message to log */
function writeErrorToFile(message) {
    try {
        // Early init failures won't have a valid Config, so grab the project root directly.
        let logDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'Logs');
        if (!existsSync(logDir)) {
            mkdirSync(logDir);
        }

        const now = new Date();
        let padLeft = (str, pad=2) => ("00" + str).substr(-pad);
        let time = `${now.getFullYear()}.${padLeft(now.getMonth() + 1)}.${padLeft(now.getDate())}.` +
            `${padLeft(now.getHours())}.${padLeft(now.getMinutes())}.${padLeft(now.getSeconds())}.` +
            `${padLeft(now.getMilliseconds(), 3)}`;
        const filename = `IntroEditor.${time}.err`;
        writeFileSync(join(logDir, filename), message);
        Log.verbose(`Wrote error file to ${join(logDir, filename)}`);
    } catch (ex) {
        Log.critical(ex.message, 'Unable to write error to log file');
    }
}

/**
 * Shut down the server and exit the process (if we're not restarting).
 * @param {String} signal The signal that initiated this shutdown.
 * @param {boolean} [restart=false] Whether we should restart the server after closing */
function handleClose(signal, restart=false) {
    SetServerState(ServerState.ShuttingDown);
    Log.info(`${signal} detected, attempting to exit cleanly... Ctrl+Break to exit immediately`);
    cleanupForShutdown();
    const exitFn = (error, restart) => {
        if (restart) {
            Log.info('Restarting server...');
            SetServerState(ServerState.ReInit);
            Server = null;
            run();
        } else if (!IsTest) {
            // Gross, but integration tests does its own killing
            // of the process.
            Log.info('Exiting process.');

            setTimeout(() => process.exit(error ? 1 : 0), 1000);
        }
    };

    if (Server) {
        Server.close((err) => {
            if (err) {
                Log.error(err, 'Failed to cleanly shut down HTTP server');
            } else {
                Log.info('Successfully shut down HTTP server.');
            }

            exitFn(err, restart);
        });
    } else {
        // Didn't even get to server creation, immediately terminate/restart
        exitFn(0, restart);
    }
}

/** Properly close out open resources in preparation for shutting down the process. */
function cleanupForShutdown() {
    ServerCommands.clear();
    PlexQueryManager.Close();
    MarkerBackupManager.Close();
    MarkerCacheManager.Close();
    ThumbnailManager.Close();
    IntroEditorConfig.Close();

    // Either we failed to resume the server, or we got a shutdown request in the middle of
    // resuming. Send a failure response now so the server can close cleanly.
    if (ResumeResponse) {
        sendJsonError(ResumeResponse, new ServerError(`Failed to resume server.`, 500));
        ResumeResponse = null;
    }
}

/**
 * Shuts down the server after a user-initiated shutdown request.
 * @param {ServerResponse} res */
function userShutdown(res) {
    sendJsonSuccess(res);
    handleClose('User Shutdown');
}

/** Restarts the server after a user-initiated restart request.
 * @param {ServerResponse} res */
function userRestart(res) {
    sendJsonSuccess(res);
    handleClose('User Restart', true /*restart*/);
}

/** Suspends the server, keeping the HTTP server running, but disconnects from the Plex database. */
function userSuspend(res) {
    Log.verbose('Attempting to pause the server');
    if (GetServerState() != ServerState.Running) {
        return sendJsonError(res, new ServerError('Server is either already suspended or shutting down.', 400))
    }

    SetServerState(ServerState.Suspended);
    cleanupForShutdown();
    Log.info('Server successfully suspended.');
    sendJsonSuccess(res);
}

/**
 * The response to our resume event. Kept at the global scope
 * to avoid passing it through the mess of init callbacks initiated by `run()`.
 * @type {ServerResponse} */
let ResumeResponse;

/**
 * Resumes the server after being disconnected from the Plex database.
 * @param {ServerResponse} res */
function userResume(res) {
    Log.verbose('Attempting to resume the server');
    if (GetServerState() != ServerState.Suspended) {
        Log.verbose(`userResume: Server isn't suspended (${GetServerState()})`);
        return sendJsonSuccess(res, { message : 'Server is not suspended' });
    }

    if (ResumeResponse) {
        Log.verbose('userResume: Already in a resume operation');
        return sendJsonSuccess(res, { message : 'Server is already resuming.' });
    }

    ResumeResponse = res;

    run();
}

/** Creates the server. Called after verifying the config file and database. */
async function launchServer() {
    if (!shouldCreateServer()) {
        return;
    }

    Server = createServer(serverMain);

    return new Promise((resolve, _) => {
        Server.listen(Config.port(), Config.host(), () => {
            const url = `http://${Config.host()}:${Config.port()}`;
            Log.info(`Server running at ${url} (Ctrl+C to exit)`);
            if (process.env.IS_DOCKER) {
                Log.info(`NOTE: External port will be different when run in Docker, based on '-p' passed into docker run`)
            }
            if (Config.autoOpen() && GetServerState() == ServerState.FirstBoot) {
                Log.info('Launching browser...');
                Open(url);
            }

            SetServerState(ServerState.Running);
            resolve();
        });
    });
}

/**
 * Return whether we should attempt to create the server. Will only return false
 * if we're resuming from a previous suspension.
 * @returns {boolean} */
function shouldCreateServer() {
    if (!Server) {
        return true;
    }

    if (GetServerState() != ServerState.Suspended) {
        Log.warn('Calling launchServer when server already exists!');
    }

    SetServerState(ServerState.Running);
    if (ResumeResponse) {
        sendJsonSuccess(ResumeResponse, { message : 'Server resumed' });
        ResumeResponse = null;
    }

    return false;
}

/**
 * Entrypoint for incoming connections to the server.
 * @type {Http.RequestListener}
 */
async function serverMain(req, res) {
    Log.verbose(`(${req.socket.remoteAddress || 'UNKNOWN'}) ${req.method}: ${req.url}`);
    const method = req.method?.toLowerCase();

    if (GetServerState() == ServerState.ShuttingDown) {
        Log.warn('Got a request when attempting to shut down the server, returning 503.');
        if (method == 'get') {
            // GET methods don't return JSON
            res.statusCode = 503;
            return res.end();
        }

        return sendJsonError(res, new ServerError('Server is shutting down', 503));
    }

    // Don't get into node_modules or parent directories
    if (req.url.toLowerCase().indexOf('node_modules') != -1 || req.url.indexOf('/..') != -1) {
        return sendJsonError(res, new ServerError(`Cannot access ${req.url}: Forbidden`, 403));
    }

    try {
        // Only serve static resources via GET, and only accept queries for JSON via POST.
        switch (method) {
            case 'get':
                await GETHandler.handleRequest(req, res);
                return;
            case 'post':
                await handlePost(req, res);
                return;
            default:
                return sendJsonError(res, new ServerError(`Unexpected method "${req.method?.toUpperCase()}"`, 405));
        }
    } catch (e) {
        e.message = `Exception thrown for ${req.url}: ${e.message}`;
        sendJsonError(res, e, e.code || 500);
    }
}

/**
 * Map of server actions (shutdown/restart/etc) to their corresponding functions.
 * Split from EndpointMap as some of these require direct access to the ServerResponse.
 * @type {[endpoint: string]: (res : ServerResponse) => void} */
const ServerActionMap = {
    shutdown : (res) => userShutdown(res),
    restart  : (res) => userRestart(res),
    suspend  : (res) => userSuspend(res),
    resume   : (res) => userResume(res),
};

/**
 * Handle POST requests, used to return JSON data queried by the client.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res */
async function handlePost(req, res) {
    const url = req.url.toLowerCase();
    const endpointIndex = url.indexOf('?');
    const endpoint = endpointIndex == -1 ? url.substring(1) : url.substring(1, endpointIndex);
    if (GetServerState() == ServerState.Suspended && (endpoint != 'resume' && endpoint != 'shutdown')) {
        return sendJsonError(res, new ServerError('Server is suspended', 503));
    }

    if (ServerActionMap[endpoint]) {
        return ServerActionMap[endpoint](res);
    }

    try {
        const response = await ServerCommands.runCommand(endpoint, req);
        sendJsonSuccess(res, response);
    } catch (err) {
        // Default handler swallows exceptions and adds the endpoint to the json error message.
        err.message = `${req.url} failed: ${err.message}`;
        sendJsonError(res, err, err.code || 500);
    }
}

/**
 * Returns test override data specified in the command line, if any.
 * @returns {{isTest: boolean, configOverride : string?}} */
 function checkTestData() {
    let testData = {
        isTest : false,
        configOverride : null,
    };

    if (process.argv.indexOf('--test') != -1) {
        testData.isTest = true;
        IsTest = true;

        // Tests default to testConfig.json, but it can be overridden below
        testData.configOverride = 'testConfig.json';
    }

    const configIndex = process.argv.indexOf('--config_override');
    if (configIndex != -1) {
        if (process.argv.length <= configIndex - 1) {
            Log.critical('Invalid config override file detected, aborting...');
            cleanupForShutdown();
            process.exit(1);
        }

        testData.configOverride = process.argv[configIndex + 1];
    }

    return testData;
}
