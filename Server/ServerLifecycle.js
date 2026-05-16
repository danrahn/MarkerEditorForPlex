/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('http').Server} httpServer */

import { GetServerState, ServerState, SetServerState } from './ServerState.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import { ServerEventHandler, ServerEvents } from './ServerEvents.js';
import { AuthDatabase } from './Authentication/AuthDatabase.js';
import { ContextualLog } from '../Shared/ConsoleLog.js';
import { DatabaseImportExport } from './ImportExport.js';
import { isTestRun } from './CLIHandler.js';
import { MarkerBackupManager } from './MarkerBackupManager.js';
import { MarkerCacheManager } from './MarkerCacheManager.js';
import { MarkerEditorConfig } from './Config/MarkerEditorConfig.js';
import { PlexQueryManager } from './PlexQueryManager.js';
import { PostCommands } from '../Shared/PostCommands.js';
import { ThumbnailManager } from './ThumbnailManager.js';

import LegacyMarkerBreakdown from './LegacyMarkerBreakdown.js';
import ServerError from './ServerError.js';

const Log = ContextualLog.Create('ServerLifecycle');

/**
 * HTTP server instance.
 * @type {httpServer|null} */
let Server = null;

/**
 * HTTPS server instance.
 * @type {httpServer|null} */
let ServerSSL = null;

/**
 * The response to our resume event. Kept at the module scope
 * to avoid passing it through the mess of init callbacks initiated by `run()`.
 * @type {ExpressResponse|null} */
let ResumeResponse = null;

/**
 * The response data to send once we're ready to resume. If not set, a
 * default 'resumed' message will be sent.
 * @type {*} */
let ResumeData;

/**
 * Callback to restart the server. Set by MarkerEditor.js to avoid circular dependency.
 * @type {() => Promise<void>} */
let restartCallback = () => { Log.error('restartCallback not set!'); };

/**
 * Set the callback that restarts the server.
 * @param {() => Promise<void>} callback */
export function setRestartCallback(callback) {
    restartCallback = callback;
}

/**
 * Get the current HTTP server instance.
 * @returns {httpServer|null} */
export function getServer() { return Server; }

/**
 * Get the current HTTPS server instance.
 * @returns {httpServer|null} */
export function getServerSSL() { return ServerSSL; }

/**
 * Set the HTTP server instance.
 * @param {httpServer|null} server */
export function setServer(server) { Server = server; }

/**
 * Set the HTTPS server instance.
 * @param {httpServer|null} server */
export function setServerSSL(server) { ServerSSL = server; }

/**
 * Clear both server instances (used during restart). */
export function clearServers() {
    Server = null;
    ServerSSL = null;
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
 * Properly close out open resources in preparation for shutting down the process.
 * @param {boolean} fullShutdown Whether we're _really_ shutting down the process, or just suspending/restarting it.
 * @param {boolean} [resetConfig=true] Whether to close the config. */
export async function cleanupForShutdown(fullShutdown, resetConfig = true) {
    LegacyMarkerBreakdown.Clear();
    MarkerCacheManager.Close();
    DatabaseImportExport.Close(fullShutdown);

    await Promise.all([
        PlexQueryManager.Close(),
        MarkerBackupManager.Close(),
        ThumbnailManager.Close(fullShutdown),
    ]);

    // Ensure this is always last, as some classes above may rely on values here.
    // Also don't close it if we're just suspending the server, as the server itself
    // is still running and needs values from the config.
    if (resetConfig) {
        MarkerEditorConfig.Close();
    }

    // Either we failed to resume the server, or we got a shutdown request in the middle of
    // resuming. Send a failure response now so the server can close cleanly.
    if (ResumeResponse) {
        sendJsonError(ResumeResponse, new ServerError(`Failed to resume server.`, 500));
        ResumeResponse = null;
    }
}

/**
 * Shut down the server and exit the process (if we're not restarting).
 * @param {String} signal The signal that initiated this shutdown.
 * @param {boolean} [restart=false] Whether we should restart the server after closing */
export async function handleClose(signal, restart = false) {
    SetServerState(ServerState.ShuttingDown);
    if (restart) {
        Log.info(`${signal} detected, attempting shut down for a reboot...`);
    } else {
        Log.info(`${signal} detected, attempting to exit cleanly... Ctrl+Break to exit immediately`);
    }

    await cleanupForShutdown(!restart);
    const exitFn = async (error, forRestart) => {
        if (forRestart) {
            Log.info('Restarting server...');
            SetServerState(ServerState.ReInit);
            clearServers();
            await restartCallback();
        } else if (!isTestRun()) {
            // Gross, but integration tests does its own killing
            // of the process.
            Log.info('Exiting process.');

            setTimeout(() => process.exit(error ? 1 : 0), 1000);
        }
    };

    let anyError = false;
    const closeFn = (r, s) =>
        async (err) => {
            if (err) {
                anyError = true;
                Log.error(err, `Failed to cleanly shut down ${s} server`);
            } else {
                Log.info(`Successfully shut down ${s} server.`);
            }

            // Only close session DB after the server itself has shut down.
            if (!restart) {
                await AuthDatabase.Close();
            }

            r();
        };

    await Promise.all([
        new Promise(r => { if (Server) { Server.close(closeFn(r, 'HTTP')); } else { r(); } }),
        new Promise(r => { if (ServerSSL) { ServerSSL.close(closeFn(r, 'HTTPS')); } else { r(); } })
    ]);

    await exitFn(anyError || (!Server && !ServerSSL), restart);
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

/**
 * Restarts the server after a user-initiated restart request.
 * @param {ExpressResponse} res
 * @param {*} [data] Optional data to return in the response. */
async function userRestart(res, data = undefined) {
    await waitForStable();
    sendJsonSuccess(res, data);
    await handleClose('User Restart', true /*restart*/);
}

/**
 * Suspends the server, keeping the HTTP server running, but disconnects from the Plex database.
 * @param {ExpressResponse} [res] Optional response object (not present for auto-suspend). */
async function userSuspend(res) {
    Log.verbose('Attempting to pause the server');
    await waitForStable();

    SetServerState(ServerState.Suspended);
    await cleanupForShutdown(false /*fullShutdown*/, false /*resetConfig*/);
    Log.info('Server successfully suspended.');

    // We won't have a response for auto-suspend.
    if (res) {
        sendJsonSuccess(res);
    }
}

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

    // Only once we resume do we clear out the old config and reload any potential changes.
    MarkerEditorConfig.Close();
    restartCallback();
}

/**
 * Restart without restarting the HTTP server. Essentially a suspend+resume.
 * @param {ExpressResponse} res
 * @param {*} [data] Optional data to return in the response. */
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
    restartCallback();
}

/**
 * Automatically resumes the server after it was previously suspended due to inactivity. */
export async function autoResume() {
    if (GetServerState() !== ServerState.AutoSuspended) {
        Log.verbose(`autoResume: Server isn't auto-suspended (${GetServerState()})`);
        return;
    }

    // TODO: Do we need to handle any potential issues with ResumeResponse/ResumeData?
    SetServerState(ServerState.Suspended);
    await restartCallback();
    Log.info('Server automatically resumed after inactivity.');
}

/**
 * Return whether we should attempt to create the server. Will only return false
 * if we're resuming from a previous suspension.
 * @returns {boolean} */
export function shouldCreateServer() {
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
 * Map of server actions (shutdown/restart/etc) to their corresponding functions.
 * Split from EndpointMap as some of these require direct access to the ExpressResponse.
 * @type {{[endpoint: string]: (res: ExpressResponse) => any}} */
export const ServerActionMap = {
    [PostCommands.ServerShutdown] : (res) => userShutdown(res),
    [PostCommands.ServerRestart]  : (res) => userRestart(res),
    [PostCommands.ServerSuspend]  : (res) => userSuspend(res),
    [PostCommands.ServerResume]   : (res) => userResume(res),
    [PostCommands.ServerReload]   : (res) => userReload(res),
};

// Register event handlers for server lifecycle events
ServerEventHandler.on(ServerEvents.HardRestart, async (response, data, resolve) => {
    await userRestart(response, data);
    resolve();
});

ServerEventHandler.on(ServerEvents.SoftRestart, async (response, data, resolve) => {
    await userReload(response, data);
    resolve();
});

ServerEventHandler.on(ServerEvents.AutoSuspend, async (resolve) => {
    // It's fine to just go through the normal suspend process, we just need to set the right state afterwards.
    await userSuspend();
    SetServerState(ServerState.AutoSuspended);
    Log.info('Server auto-suspended due to inactivity.');
    resolve();
});
