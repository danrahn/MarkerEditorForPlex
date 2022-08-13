/** External dependencies */
import { promises as Fs } from 'fs';
import { createServer, IncomingMessage, Server as httpServer, ServerResponse } from 'http';
import { contentType, lookup } from 'mime-types';
import Open from 'open';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** Server dependencies */
import MarkerBackupManager from './MarkerBackupManager.js';
import MarkerCacheManager from './MarkerCacheManager.js';
import PlexIntroEditorConfig from './PlexIntroEditorConfig.js';
import PlexQueryManager from './PlexQueryManager.js';
import ThumbnailManager from './ThumbnailManager.js';
/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */

/** Server+Client shared dependencies */
import { Log } from './../Shared/ConsoleLog.js';
import { sendCompressedData, sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import ServerError from './ServerError.js';
import ServerCommands from './ServerCommands.js';

/**
 * HTTP server instance.
 * @type {httpServer} */
let Server;

/**
 * User configuration.
 * @type {PlexIntroEditorConfig} */
let Config;

/**
 * Manages retrieving preview thumbnails for episodes.
 * @type {ThumbnailManager}
 */
let Thumbnails;

/**
 * Manages basic marker information for the entire database.
 * @type {MarkerCacheManager}
 */
let MarkerCache = null;

/**
 * Manages executing queries to the Plex database.
 * @type {PlexQueryManager}
 */
let QueryManager;

/**
 * Records marker actions in a database to be restored if Plex removes them, or reverted
 * if changes in Plex's marker schema causes these markers to break the database.
 * @type {MarkerBackupManager} */
let BackupManager;

/** @type {ServerCommands} */
let Commands;

/**
 * Set of possible server states. */
const ServerState = {
    /** Server is booting up. */
    FirstBoot : 0,
    /** Server is booting up after a restart. */
    ReInit : 1,
    /** Server is running normally. */
    Running : 2,
    /** Server is in a suspended state. */
    Suspended : 3,
    /** The server is in the process of shutting down. Either permanently or during a restart. */
    ShuttingDown : 4,
}

/**
 * Indicates whether we're in the middle of shutting down the server, and
 * should therefore immediately fail all incoming requests.
 * @type {number} */
let CurrentState = ServerState.FirstBoot;

/** @returns The current ServerState of the server. */
function getState() { return CurrentState; }

/** Global flag indicating if the server is running tests. */
let IsTest = false;

/** The root of the project, which is one directory up from the 'Server' folder we're currently in. */
const ProjectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Initializes and starts the server */
async function run() {
    setupTerminateHandlers();
    const testData = checkTestData();
    Config = new PlexIntroEditorConfig(ProjectRoot, testData);

    // Set up the database, and make sure it's the right one.
    QueryManager = await PlexQueryManager.CreateInstance(Config.databasePath(), Config.pureMode());
    if (Config.backupActions()) {
        BackupManager = await MarkerBackupManager.CreateInstance(QueryManager, IsTest ? join(ProjectRoot, 'Test') : ProjectRoot);
    } else {
        Log.warn('Marker backup not enabled. Any changes removed by Plex will not be recoverable.');
    }

    Thumbnails = new ThumbnailManager(QueryManager.database(), Config.metadataPath());
    if (Config.extendedMarkerStats()) {
        MarkerCache = new MarkerCacheManager(QueryManager.database(), QueryManager.markerTagId());
        try {
            await MarkerCache.buildCache();
            await BackupManager?.buildAllPurges(MarkerCache);
        } catch (err) {
            Log.error(err.message, 'Failed to build marker cache:');
            Log.error('Continuing to server creating, but extended marker statistics will not be available.');
            Config.disableExtendedMarkerStats();
            MarkerCache = null;
        }
    }

    Commands = new ServerCommands(Config, QueryManager, MarkerCache, BackupManager, Thumbnails);

    Log.info('Creating server...');
    launchServer();
}

export { run, ServerState, getState };

/** Set up process listeners that will shut down the process
 * when it encounters an unhandled exception or SIGINT. */
function setupTerminateHandlers() {
    // Only need to do this on first boot, not if we're restarting/resuming
    if (CurrentState != ServerState.FirstBoot) {
        return;
    }

    // If we encounter an unhandled exception, handle it somewhat gracefully and exit the process.
    process.on('uncaughtException', (err) => {
        Log.critical(err.message);
        Log.verbose(err.stack ? err.stack : '(Could not find stack trace)');
        Log.error('The server ran into an unexpected problem, exiting...');
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
 * Shut down the server and exit the process (if we're not restarting).
 * @param {String} signal The signal that initiated this shutdown.
 * @param {boolean} [restart=false] Whether we should restart the server after closing */
function handleClose(signal, restart=false) {
    CurrentState = ServerState.ShuttingDown;
    Log.info(`${signal} detected, exiting...`);
    cleanupForShutdown();
    const exitFn = (error, restart) => {
        if (restart) {
            Log.info('Restarting server...');
            CurrentState = ServerState.ReInit;
            Server = null;
            run();
        } else if (!IsTest) {
            // Gross, but integration tests does its own killing
            // of the process.
            Log.info('Exiting process.');
            process.exit(error ? 1 : 0);
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
    Commands?.clear();
    Commands = null;
    QueryManager?.close();
    QueryManager = null;
    BackupManager?.close();
    BackupManager = null;
    MarkerCache = null;
    Thumbnails = null;
    Config = null;

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
    if (CurrentState != ServerState.Running) {
        return sendJsonError(res, new ServerError('Server is either already suspended or shutting down.', 400))
    }

    CurrentState = ServerState.Suspended;
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
    if (CurrentState != ServerState.Suspended) {
        Log.verbose(`userResume: Server isn't suspended (${CurrentState})`);
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
function launchServer() {
    if (!shouldCreateServer()) {
        return;
    }

    Server = createServer(serverMain);

    Server.listen(Config.port(), Config.host(), () => {
        const url = `http://${Config.host()}:${Config.port()}`;
        Log.info(`Server running at ${url} (Ctrl+C to exit)`);
        if (Config.autoOpen() && CurrentState == ServerState.FirstBoot) {
            Log.info('Launching browser...');
            Open(url);
        }

        CurrentState = ServerState.Running;
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

    if (CurrentState != ServerState.Suspended) {
        Log.warn('Calling launchServer when server already exists!');
    }

    CurrentState = ServerState.Running;
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
function serverMain(req, res) {
    Log.verbose(`(${req.socket.remoteAddress || 'UNKNOWN'}) ${req.method}: ${req.url}`);
    const method = req.method?.toLowerCase();

    if (CurrentState == ServerState.ShuttingDown) {
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
                return handleGet(req, res);
            case 'post':
                return handlePost(req, res);
            default:
                return sendJsonError(res, new ServerError(`Unexpected method "${req.method?.toUpperCase()}"`, 405));
        }
    } catch (e) {
        e.message = `Exception thrown for ${req.url}: ${e.message}`;
        sendJsonError(res, e, e.code || 500);
    }
}

/**
 * Handle GET requests, used to serve static content like HTML/CSS/SVG.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
function handleGet(req, res) {
    let url = req.url;
    if (url == '/') {
        url = '/index.html';
    }

    if (url.startsWith('/i/')) {
        return getSvgIcon(url, res);
    } else if (url.startsWith('/t/')) {
        if (CurrentState == ServerState.Suspended) {
            // We're disconnected from the backing data, can't return anything.
            res.statusCode = 400;
            res.end(`Server is suspended, can't retrieve thumbnail.`);
            return;
        }

        return getThumbnail(url, res);
    }

    let mimetype = contentType(lookup(url));
    if (!mimetype) {
        res.statusCode = 404;
        res.end('Bad MIME type!');
        return;
    }

    Fs.readFile(ProjectRoot + url).then(contents => {
        sendCompressedData(res, 200, contents, mimetype);
    }).catch(err => {
        Log.warn(`Unable to serve ${url}: ${err.message}`);
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    });
}

/**
 * Retrieve an SVG icon requested with the given color.
 * @param {string} url The svg url of the form /i/[hex color]/[icon].svg.
 * @param {ServerResponse} res
 */
function getSvgIcon(url, res) {
    let parts = url.split('/');
    if (parts.length !== 4) {
        return sendJsonError(res, new ServerError('Invalid icon request.', 400));
    }

    const color = parts[2];
    const icon = parts[3];

    // Expecting a 3 or 6 character hex string
    if (!/^[a-fA-F0-9]{3}$/.test(color) && !/^[a-fA-F0-9]{6}$/.test(color)) {
        return sendJsonError(res, new ServerError(`Invalid icon color: "${color}"`, 400));
    }

    Fs.readFile(ProjectRoot + '/SVG/' + icon).then(contents => {
        // Raw file has FILL_COLOR in place of hardcoded values. Replace
        // it with the requested hex color (after decoding the contents)
        if (Buffer.isBuffer(contents)) {
            contents = contents.toString('utf-8');
        }

        // Could send this back compressed, but most of these are so small
        // that it doesn't make a tangible difference.
        contents = contents.replace(/FILL_COLOR/g, `#${color}`);
        res.setHeader('Content-Type', contentType('image/svg+xml'));
        res.setHeader('x-content-type-options', 'nosniff');
        res.end(Buffer.from(contents, 'utf-8'));
    }).catch(err => {
        Log.error(err, 'Failed to read icon');
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    })
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
    if (CurrentState == ServerState.Suspended && (endpoint != 'resume' && endpoint != 'shutdown')) {
        return sendJsonError(res, new ServerError('Server is suspended', 503));
    }

    if (ServerActionMap[endpoint]) {
        return ServerActionMap[endpoint](res);
    }

    try {
        const response = await Commands.runCommand(endpoint, req);
        sendJsonSuccess(res, response);
    } catch (err) {
        // Default handler swallows exceptions and adds the endpoint to the json error message.
        err.message = `${req.url} failed: ${err.message}`;
        sendJsonError(res, err, err.code || 500);
    }
}


/**
 * Retrieve a thumbnail for the episode and timestamp denoted by the url, /t/metadataId/timestampInSeconds
 * @param {string} url The url specifying the thumbnail to retrieve.
 * @param {ServerResponse} res
 */
function getThumbnail(url, res) {
    /** @param {ServerResponse} res */
    const badRequest = (res) => { res.statusCode = 400; res.end(); };

    if (!Config.useThumbnails()) {
        return badRequest(res);
    }

    const split = url.split('/');
    if (split.length != 4) {
        return badRequest(res);
    }

    const metadataId = parseInt(split[2]);
    const timestamp = parseInt(split[3]);
    if (isNaN(metadataId) || isNaN(timestamp)) {
        return badRequest(res);
    }

    Thumbnails.getThumbnail(metadataId, timestamp).then(data => {
        res.writeHead(200, {
            'Content-Type' : 'image/jpeg',
            'Content-Length' : data.length,
            'x-content-type-options' : 'nosniff'
        });
        res.end(data);
    }).catch((err) => {
        Log.error(err, 'Failed to retrieve thumbnail');
        res.statusCode = 500, res.end();
    });
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
