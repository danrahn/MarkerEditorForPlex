/** External dependencies */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { join } from 'path';
import Open from 'open';
/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */
/** @typedef {!import('http').Server} httpServer */

/** Server+Client shared dependencies */
import { ContextualLog } from '../Shared/ConsoleLog.js';

/** Server dependencies */
import { BackupManager, MarkerBackupManager } from './MarkerBackupManager.js';
import { Config, IntroEditorConfig, ProjectRoot } from './IntroEditorConfig.js';
import { GetServerState, ServerState, SetServerState } from './ServerState.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import DatabaseImportExport from './ImportExport.js';
import FirstRunConfig from './FirstRunConfig.js';
import GETHandler from './GETHandler.js';
import { MarkerCacheManager } from './MarkerCacheManager.js';
import { PlexQueryManager } from './PlexQueryManager.js';
import ServerCommands from './ServerCommands.js';
import ServerError from './ServerError.js';
import { ThumbnailManager } from './ThumbnailManager.js';

const Log = new ContextualLog('ServerCore');

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
    // In docker, the location of the config and backup data files are not the project root.
    const dataRoot = process.env.IS_DOCKER ? '/Data' : ProjectRoot();
    if (!testData.isTest) {
        await FirstRunConfig(dataRoot);
    }

    const config = IntroEditorConfig.Create(testData, dataRoot);

    // Set up the database, and make sure it's the right one.
    const queryManager = await PlexQueryManager.CreateInstance(config.databasePath());
    await MarkerBackupManager.CreateInstance(IsTest ? join(dataRoot, 'Test') : dataRoot);

    await ThumbnailManager.Create(queryManager.database(), config.metadataPath());
    if (config.extendedMarkerStats()) {
        const markerCache = MarkerCacheManager.Create(queryManager.database(), queryManager.markerTagId());
        try {
            await markerCache.buildCache();
            await BackupManager.buildAllPurges();
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
        cleanupForShutdown(true /*fullShutdown*/);
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
        const logDir = join(ProjectRoot(), 'Logs');
        if (!existsSync(logDir)) {
            mkdirSync(logDir);
        }

        const now = new Date();
        const padLeft = (str, pad=2) => ('00' + str).substr(-pad);
        const time = `${now.getFullYear()}.${padLeft(now.getMonth() + 1)}.${padLeft(now.getDate())}.` +
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
    if (restart) {
        Log.info(`${signal} detected, attempting shut down for a reboot...`);
    } else {
        Log.info(`${signal} detected, attempting to exit cleanly... Ctrl+Break to exit immediately`);
    }

    cleanupForShutdown(!restart);
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

/**
 * Properly close out open resources in preparation for shutting down the process.
 * @param {boolean} fullShutdown Whether we're _really_ shutting down the process, or just suspending/restarting it. */
async function cleanupForShutdown(fullShutdown) {
    ServerCommands.clear();
    MarkerCacheManager.Close();
    ThumbnailManager.Close(fullShutdown);
    DatabaseImportExport.Close(fullShutdown);

    await Promise.all([
        PlexQueryManager.Close(),
        MarkerBackupManager.Close(),
    ]);

    // Ensure this is always last, as some classes
    // above may rely on values here.
    IntroEditorConfig.Close();

    // Either we failed to resume the server, or we got a shutdown request in the middle of
    // resuming. Send a failure response now so the server can close cleanly.
    if (ResumeResponse) {
        sendJsonError(ResumeResponse, new ServerError(`Failed to resume server.`, 500));
        ResumeResponse = null;
    }
}

/**
 * Wait for the server to be in a "ready" state (running or suspended),
 * used to ensure we don't try to restart/shutdown when we're already
 * attempting to change states. There's definitely a better way than
 * what's essentially a spin lock, but cases that require this should
 * be rare, mainly isolated to tests. */
async function waitForStable() {
    while (!ServerState.Stable()) {
        await new Promise((resolve, _) => setTimeout(resolve, 100));
    }
}

/**
 * Shuts down the server after a user-initiated shutdown request.
 * @param {ServerResponse} res */
async function userShutdown(res) {
    // Make sure we're in a stable state before shutting down
    await waitForStable();
    sendJsonSuccess(res);
    handleClose('User Shutdown');
}

/** Restarts the server after a user-initiated restart request.
 * @param {ServerResponse} res */
async function userRestart(res) {
    await waitForStable();
    sendJsonSuccess(res);
    handleClose('User Restart', true /*restart*/);
}

/** Suspends the server, keeping the HTTP server running, but disconnects from the Plex database. */
async function userSuspend(res) {
    Log.verbose('Attempting to pause the server');
    await waitForStable();

    SetServerState(ServerState.Suspended);
    cleanupForShutdown(false /*fullShutdown*/);
    Log.info('Server successfully suspended.');
    sendJsonSuccess(res);
}

/**
 * The response to our resume event. Kept at the global scope
 * to avoid passing it through the mess of init callbacks initiated by `run()`.
 * @type {ServerResponse} */
let ResumeResponse;

/**
 * The response data to send once we're ready to resume. If not set, a
 * default 'resumed' message will be sent.
 * @type {*} */
let ResumeData;

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

/**
 * Restart without restarting the HTTP server. Essentially a suspend+resume.
 * @param {ServerResponse} res */
async function userReload(res) {
    Log.verbose('Attempting to reload marker data');
    if (GetServerState() != ServerState.Running) {
        return sendJsonError(res, new ServerError('Server must be running in order to reload.', 400));
    }

    SetServerState(ServerState.Suspended);
    await cleanupForShutdown(false /*fullShutdown*/);
    if (ResumeResponse) {
        Log.verbose('userReload: Already in the middle of a user operation');
        return sendJsonSuccess(res, { message : 'Server is already resuming.' });
    }

    ResumeResponse = res;
    run();
}

/**
 * Do a soft internal restart to rebuild all internal caches
 * and reconnect to databases, usually after a large operation where
 * it's easier to just rebuild everything from scratch.
 *
 * TODO: How much of this can be moved to a different file instead of Main?
 *
 * @param {ServerResponse?} response The response to send when the reload completes.
 * @param {*?} data The data to send alongside the response, if any. */
async function softRestart(response, data) {
    Log.info('Soft reset started. Rebuilding everything.');
    if (GetServerState() != ServerState.Running) {
        Log.warn(`Attempting a soft reset when the server isn't running. Ignoring it.`);
        return;
    }

    SetServerState(ServerState.Suspended);
    await cleanupForShutdown(false /*fullShutdown*/);
    Log.assert(GetServerState() == ServerState.Suspended, 'Server state changed during cleanup, that\'s not right!');
    SetServerState(ServerState.SoftBoot);
    if (response) {
        ResumeResponse = response;
    }

    if (data) {
        ResumeData = data;
    }

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
                Log.info(`NOTE: External port will be different when run in Docker, based on '-p' passed into docker run`);
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

    if (GetServerState() != ServerState.Suspended && GetServerState() != ServerState.SoftBoot) {
        Log.warn('Calling launchServer when server already exists!');
    }

    SetServerState(ServerState.Running);
    if (ResumeResponse) {
        const data = ResumeData || { message : 'Server resumed' };
        sendJsonSuccess(ResumeResponse, data);
        ResumeResponse = null;
        ResumeData = null;
    }

    return false;
}

/**
 * Entrypoint for incoming connections to the server.
 * @type {Http.RequestListener}
 * @param {IncomingMessage} req
 * @param {ServerResponse} res */
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
    reload   : (res) => userReload(res),
};

/**
 * Map of actions that require more direct access to the underlying request and response.
 * Instead of adjusting ServerCommands to accommodate these, have a separate map.
 * @type {[endpoint: string]: (req: IncomingMessage, res: ServerResponse) => Promise<any>} */
const RawActions = {
    import_db : async (req, res) => await DatabaseImportExport.importDatabase(req, res),
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

    if (Object.prototype.hasOwnProperty.call(ServerActionMap, endpoint)
        && typeof ServerActionMap[endpoint] === 'function') {
        return ServerActionMap[endpoint](res);
    }

    if (RawActions[endpoint]) {
        try {
            return await RawActions[endpoint](req, res);
        } catch (err) {
            return sendJsonError(res, err);
        }
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
    const testData = {
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
            cleanupForShutdown(true /*fullShutdown*/);
            process.exit(1);
        }

        testData.configOverride = process.argv[configIndex + 1];
    }

    return testData;
}

export { softRestart };
