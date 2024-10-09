/** External dependencies */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { default as express } from 'express';
import { join } from 'path';
import Open from 'open';
import { randomBytes } from 'crypto';
import { default as session } from 'express-session';

/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('http').Server} httpServer */

/** Server+Client shared dependencies */
import { ContextualLog } from '../Shared/ConsoleLog.js';

/** Server dependencies */
import { BackupManager, MarkerBackupManager } from './MarkerBackupManager.js';
import { Config, MarkerEditorConfig, ProjectRoot } from './MarkerEditorConfig.js';
import { GetServerState, ServerState, SetServerState } from './ServerState.js';
import { registerPostCommands, runPostCommand } from './PostCommands.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import { ServerEventHandler, ServerEvents } from './ServerEvents.js';
import { User, UserAuthentication } from './Authentication/Authentication.js';
import { AuthDatabase } from './Authentication/AuthDatabase.js';
import { DatabaseImportExport } from './ImportExport.js';
import FirstRunConfig from './FirstRunConfig.js';
import GETHandler from './GETHandler.js';
import LegacyMarkerBreakdown from './LegacyMarkerBreakdown.js';
import { MarkerCacheManager } from './MarkerCacheManager.js';
import { PlexQueryManager } from './PlexQueryManager.js';
import { PostCommands } from '../Shared/PostCommands.js';
import { ServerConfigState } from '../Shared/ServerConfig.js';
import ServerError from './ServerError.js';
import { default as Sqlite3Store } from './Authentication/SqliteSessionStore.js';
import { ThumbnailManager } from './ThumbnailManager.js';

/**
 * @typedef {Object} CLIArguments
 * @property {boolean} isTest Indicates this is a test run
 * @property {string?} configOverride The path to a config file to override the existing one
 * @property {boolean} version The user passed `-v`/`--version` to the command line
 * @property {boolean} help The user passed `-h`/`--help`/`--?` to the command line
 * @property {boolean} cliSetup The user wants to set up Marker Editor using the command line, not a browser.
 */

const Log = new ContextualLog('ServerCore');

/**
 * HTTP server instance.
 * @type {httpServer} */
let Server;

/** Global flag indicating if the server is running tests. */
let IsTest = false;

/** Initializes and starts the server */
async function run() {
    bootstrap();
    const argInfo = checkArgs();
    if (shouldExitEarly(argInfo)) {
        process.exit(0);
    }

    // In docker, the location of the config and backup data files are not the project root.
    const dataRoot = process.env.IS_DOCKER ? '/Data' : ProjectRoot();

    // Initialize auth database before everything else, as it doesn't rely on Config, and
    // FirstRunConfig might need access to it.
    await AuthDatabase.Initialize(dataRoot);
    await UserAuthentication.Initialize();

    if (!argInfo.isTest) {
        await FirstRunConfig(dataRoot, argInfo.cliSetup);
    }

    // If we don't have a config file, still launch the server using some default values.
    const config = await MarkerEditorConfig.Create(argInfo, dataRoot);
    const configValid = config.getValid() === ServerConfigState.Valid;


    if (configValid) {

        // Set up the database, and make sure it's the right one.
        const queryManager = await PlexQueryManager.CreateInstance(config.databasePath());
        await MarkerBackupManager.CreateInstance(IsTest ? join(dataRoot, 'Test') : dataRoot);

        ThumbnailManager.Create(queryManager.database(), config.metadataPath());
        if (config.extendedMarkerStats()) {
            try {
                await MarkerCacheManager.Create(queryManager.database(), queryManager.markerTagId());
                await BackupManager.buildAllPurges();
            } catch (err) {
                Log.error(err.message, 'Failed to build marker cache');
                Log.error('Continuing to server creation, but extended marker statistics will not be available.');
                config.disableExtendedMarkerStats();
                MarkerCacheManager.Close();
            }
        }
    }

    Log.info('Creating server...');
    await launchServer(dataRoot);
    if (!configValid) {
        SetServerState(ServerState.RunningWithoutConfig);
    }
}

/**
 * Set up core processes of Marker Editor. */
function bootstrap() {
    // Only need to do this on first boot, not if we're restarting/resuming
    if (GetServerState() !== ServerState.FirstBoot) {
        return;
    }

    setupTerminateHandlers();
    registerPostCommands();
}

/** Set up process listeners that will shut down the process
 * when it encounters an unhandled exception or SIGINT. */
function setupTerminateHandlers() {
    Log.assert(GetServerState() === ServerState.FirstBoot, `We should only be calling setupTerminateHandlers on first boot!`);
    if (GetServerState() !== ServerState.FirstBoot) {
        return;
    }

    // If we encounter an unhandled exception, handle it somewhat gracefully and exit the process.
    process.on('uncaughtException', async (err) => {
        Log.critical(err.message);
        const stack = err.stack ? err.stack : '(Could not find stack trace)';
        IsTest ? Log.error(stack) : Log.verbose(stack);
        Log.error('The server ran into an unexpected problem, exiting...');
        writeErrorToFile(err.message + '\n' + stack);
        await cleanupForShutdown(true /*fullShutdown*/);
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
        const filename = `MarkerEditor.${time}.err`;
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
async function handleClose(signal, restart=false) {
    SetServerState(ServerState.ShuttingDown);
    if (restart) {
        Log.info(`${signal} detected, attempting shut down for a reboot...`);
    } else {
        Log.info(`${signal} detected, attempting to exit cleanly... Ctrl+Break to exit immediately`);
    }

    await cleanupForShutdown(!restart);
    const exitFn = (error, forRestart) => {
        if (forRestart) {
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
        Server.close(async (err) => {
            if (err) {
                Log.error(err, 'Failed to cleanly shut down HTTP server');
            } else {
                Log.info('Successfully shut down HTTP server.');
            }

            // Only close session DB after the server itself has shut down.
            if (!restart) {
                await AuthDatabase.Close();
            }

            exitFn(err, restart);
        });
    } else {
        // Didn't even get to server creation, immediately terminate/restart
        exitFn(new Error('Error before server creation'), restart);
    }
}

/**
 * Properly close out open resources in preparation for shutting down the process.
 * @param {boolean} fullShutdown Whether we're _really_ shutting down the process, or just suspending/restarting it. */
async function cleanupForShutdown(fullShutdown) {
    LegacyMarkerBreakdown.Clear();
    MarkerCacheManager.Close();
    DatabaseImportExport.Close(fullShutdown);

    await Promise.all([
        PlexQueryManager.Close(),
        MarkerBackupManager.Close(),
        ThumbnailManager.Close(fullShutdown),
    ]);

    // Ensure this is always last, as some classes
    // above may rely on values here.
    MarkerEditorConfig.Close();

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
        await new Promise((resolve, _) => { setTimeout(resolve, 100); });
    }
}

/**
 * Shuts down the server after a user-initiated shutdown request.
 * @param {ExpressResponse} res */
async function userShutdown(res) {
    // Make sure we're in a stable state before shutting down
    await waitForStable();
    sendJsonSuccess(res);
    await handleClose('User Shutdown');
}

/** Restarts the server after a user-initiated restart request.
 * @param {ExpressResponse} res */
async function userRestart(res, data=undefined) {
    await waitForStable();
    sendJsonSuccess(res, data);
    await handleClose('User Restart', true /*restart*/);
}

/** Suspends the server, keeping the HTTP server running, but disconnects from the Plex database. */
async function userSuspend(res) {
    Log.verbose('Attempting to pause the server');
    await waitForStable();

    SetServerState(ServerState.Suspended);
    await cleanupForShutdown(false /*fullShutdown*/);
    Log.info('Server successfully suspended.');
    sendJsonSuccess(res);
}

/**
 * The response to our resume event. Kept at the global scope
 * to avoid passing it through the mess of init callbacks initiated by `run()`.
 * @type {ExpressResponse|null} */
let ResumeResponse = null;

/**
 * The response data to send once we're ready to resume. If not set, a
 * default 'resumed' message will be sent.
 * @type {*} */
let ResumeData;

/**
 * Resumes the server after being disconnected from the Plex database.
 * @param {ExpressResponse} res */
function userResume(res) {
    Log.verbose('Attempting to resume the server');
    if (GetServerState() !== ServerState.Suspended) {
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
 * @param {ExpressResponse} res */
async function userReload(res, data) {
    Log.verbose('Attempting to reload marker data');
    if (![ServerState.Running, ServerState.RunningWithoutConfig].includes(GetServerState())) {
        return sendJsonError(res, new ServerError('Server must be running in order to reload.', 400));
    }

    SetServerState(ServerState.Suspended);
    await cleanupForShutdown(false /*fullShutdown*/);
    if (ResumeResponse) {
        Log.verbose('userReload: Already in the middle of a user operation');
        return sendJsonSuccess(res, { message : 'Server is already resuming.' });
    }

    ResumeResponse = res;
    ResumeData = data;
    run();
}

/** Creates the server. Called after verifying the config file and database.
 * @returns {Promise<void>} */
async function launchServer() {
    if (!shouldCreateServer()) {
        return;
    }

    const app = express();
    await initializeSessionStore(app);

    // TODO: express-ify this with standard routing.
    app.all('*', serverMain);

    Server = createServer(app);

    return new Promise((resolve, _) => {
        Server.listen(Config.port(), Config.host(), () => {
            const url = `http://${Config.host()}:${Config.port()}`;
            Log.info(`Server running at ${url} (Ctrl+C to exit)`);
            if (process.env.IS_DOCKER) {
                Log.info(`NOTE: External port will be different when run in Docker, based on '-p' passed into docker run`);
            }

            if (Config.autoOpen() && GetServerState() === ServerState.FirstBoot) {
                Log.info('Launching browser...');
                Open(url);
            }

            SetServerState(ServerState.Running);
            resolve();
        });
    });
}

/**
 * Initialize session information. */
async function initializeSessionStore(app) {
    // Don't deal with session management is auth is disabled.
    // Enabling auth forces a full server restart anyway.
    if (!Config.useAuth()) {
        return;
    }

    const sessionStore = new Sqlite3Store({
        expire : Config.authSessionTimeout(),
        clear : true,
        intervalMs : 900000,
    });

    // On each boot, create a new session secret, but still allow older
    // sessions to be validated by keeping around older secrets for a while.
    const newSecret = randomBytes(32).toString('hex');
    const oldSecrets = await Sqlite3Store.oldSecrets();
    await Sqlite3Store.setNewSecret(newSecret);
    app.use(
        session({
            secret : [newSecret, ...oldSecrets],
            rolling : true, // Only expire sessions that are inactive for maxAge.
            resave : false,
            saveUninitialized : false,
            name : 'markereditor.sid',
            store : sessionStore,
            cookie : { maxAge : Config.authSessionTimeout() * 1000 }
        })
    );
}

/**
 * Return whether we should attempt to create the server. Will only return false
 * if we're resuming from a previous suspension.
 * @returns {boolean} */
function shouldCreateServer() {
    if (!Server) {
        return true;
    }

    if (GetServerState() !== ServerState.Suspended && GetServerState() !== ServerState.SoftBoot) {
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
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res */
function serverMain(req, res) {
    Log.verbose(`(${req.socket.remoteAddress || 'UNKNOWN'}) ${req.method}: ${req.url}`);
    const method = req.method?.toLowerCase();

    if (GetServerState() === ServerState.ShuttingDown) {
        Log.warn('Got a request when attempting to shut down the server, returning 503.');
        if (method === 'get') {
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
                return GETHandler.handleRequest(req, res);
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
 * Map of server actions (shutdown/restart/etc) to their corresponding functions.
 * Split from EndpointMap as some of these require direct access to the ExpressResponse.
 * @type {{[endpoint: string]: (res : ExpressResponse) => any}} */
const ServerActionMap = {
    [PostCommands.ServerShutdown] : (res) => userShutdown(res),
    [PostCommands.ServerRestart]  : (res) => userRestart(res),
    [PostCommands.ServerSuspend]  : (res) => userSuspend(res),
    [PostCommands.ServerResume]   : (res) => userResume(res),
    [PostCommands.ServerReload]   : (res) => userReload(res),
};

ServerEventHandler.on(ServerEvents.HardRestart, async (response, data, resolve) => {
    await userRestart(response, data);
    resolve();
});

ServerEventHandler.on(ServerEvents.SoftRestart, async (response, data, resolve) => {
    await userReload(response, data);
    resolve();
});

/**
 * Handle POST requests, used to return JSON data queried by the client.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res */
async function handlePost(req, res) {
    const url = req.url.toLowerCase();
    const endpointIndex = url.indexOf('?');
    const endpoint = endpointIndex === -1 ? url.substring(1) : url.substring(1, endpointIndex);
    if (GetServerState() === ServerState.Suspended
        && (endpoint !== PostCommands.ServerResume
        && endpoint !== PostCommands.ServerShutdown)) {
        return sendJsonError(res, new ServerError('Server is suspended', 503));
    }

    try {
        if (Object.prototype.hasOwnProperty.call(ServerActionMap, endpoint)
            && typeof ServerActionMap[endpoint] === 'function') {
            if (!Config.useAuth() || User.signedIn(req)) {
                await ServerActionMap[endpoint](res);
            } else {
                sendJsonError(res, new ServerError('Not authorized', 401));
            }

            return;
        }

        await runPostCommand(endpoint, req, res);
    } catch (ex) {
        ex.message = `Exception thrown for ${req.url}: ${ex.message}`;
        sendJsonError(res, ex, ex.code || 500);
    }
}

/**
 * Parse command line arguments.
 * @returns {CLIArguments} */
function checkArgs() {
    /** @type {CLIArguments} */
    const argInfo = {
        isTest : false,
        configOverride : null,
        version : false,
        help : false,
        cliSetup : false,
    };

    const argsLower = process.argv.map(x => x.replace(/_/g, '-').toLowerCase());
    if (argsLower.includes('-v') || argsLower.includes('--version')) {
        argInfo.version = true;
    }

    if (argsLower.includes('-h')
        || argsLower.includes('/h')
        || argsLower.includes('--help')
        || argsLower.includes('-?')
        || argsLower.includes('/?')) {
        argInfo.help = true;
    }

    if (argsLower.includes('--cli-setup')) {
        argInfo.cliSetup = true;
    }

    if (argsLower.includes('--test')) {
        argInfo.isTest = true;
        IsTest = true;

        // Tests default to testConfig.json, but it can be overridden below
        argInfo.configOverride = 'testConfig.json';
    }

    const coi = argsLower.indexOf('--config-override');
    if (coi !== -1) {
        if (process.argv.length <= coi - 1) {
            Log.critical('Invalid config override file detected, aborting...');
            // We're very early into boot. Just get out of here.
            process.exit(1);
        }

        argInfo.configOverride = process.argv[coi + 1];
    }

    return argInfo;
}

/**
 * Process command line arguments, spits out info if needed, and returns
 * whether we should exit the program early.
 * @param {CLIArguments} args */
function shouldExitEarly(args) {
    let version;
    if (args.version || args.help) {
        const packagePath = join(ProjectRoot(), 'package.json');
        if (existsSync(packagePath)) {
            try {
                version = JSON.parse(readFileSync(packagePath).toString()).version;
                console.log(`Marker Editor version ${version}`);
            } catch (err) {
                console.log('Error retrieving version info.');
            }
        } else {
            console.log('Error retrieving version info.');
        }

        if (args.version) {
            return true;
        }
    }

    if (args.help) {
        const isBin = process.argv[1]?.includes('built.cjs');
        const isWin = process.platform === 'win32';
        const invoke = (isBin ? (isWin ? '.\\MarkerEditor.exe' : './MarkerEditor') : 'node app.js');
        console.log(`Usage: ${invoke} [options]`);
        console.log();
        console.log(`  OPTIONS`);
        console.log(`    -v | --version              Print out the current version of MarkerEditor.`);
        console.log(`    -h | --help                 Print out this help text.`);
        console.log(`    --cli-setup                 Set up Marker Editor using the command line instead of a browser.`);
        console.log(`    --config-override [config]  Use the given config file instead of the standard config.json`);
        console.log(`    --test                      Indicates we're launching MarkerEditor for tests. Do not set manually.`);
        console.log('\n    For setup and usage instructions, visit https://github.com/danrahn/MarkerEditorForPlex/wiki.');
        return true;
    }

    return false;
}

export { run };
