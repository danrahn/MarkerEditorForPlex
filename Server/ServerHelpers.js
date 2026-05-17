import { contentType } from 'mime-types';
import { gzip } from 'zlib';

/** @typedef {!import('http').Server} Server */
/** @typedef {!import('express').Response} ExpressResponse */

import { ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';

export { isBinary, testFfmpeg, testHostPort } from './RuntimeChecks.js';
import { ServerEventHandler, ServerEvents, waitForServerEvent } from './ServerEvents.js';
import { ServerState, SetServerState } from './ServerState.js';
import { Config } from './Config/MarkerEditorConfig.js';
import ServerError from './ServerError.js';


const Log = ContextualLog.Create('ServerHelpers');

/**
 * Helper method that returns the given HTTP status code alongside a JSON object with a single 'Error' field.
 * @param {ExpressResponse} res
 * @param {Error|string} error The error to log
 * @param {number?} code Error code to return. Not necessary if error is a ServerError. */
export function sendJsonError(res, error, code) {
    let message = error;
    let stack = '[Stack trace not available]';
    if (error instanceof Error) {
        message = error.message;
        if (error.stack) { stack = error.stack; }
    }

    let expected = false;
    if (error instanceof ServerError) {
        code = error.code;
        expected = error.expected;
    }

    // No need for noisy logging if we hit an expected error, like querying for data when the server is suspended.
    if (expected) {
        Log.info(`Hit expected error: ${message}`);
    } else {
        Log.error(message);
        Log.verbose(stack);
    }

    if (!code || typeof code !== 'number' || code < 100 || code > 599) {
        Log.warn(`sendJsonError didn't receive a valid error code, defaulting to 500`);
        code = 500;
    }

    sendCompressedData(res, code, JSON.stringify({ Error : message }), contentType('application/json'));
}

/**
 * Helper method that returns a success HTTP status code alongside any data we want to return to the client.
 * @param {ExpressResponse} res
 * @param {Object} [data] Data to return to the client. If empty, returns a simple success message. */
export function sendJsonSuccess(res, data) {
    // TMI logging, post the entire response, for verbose just indicate we succeeded.
    if (Log.getLevel() <= ConsoleLog.Level.TMI) {
        Log.tmi(data ? JSON.parse(JSON.stringify(data)) : 'true', 'Success');
    } else {
        Log.verbose(true, 'Success');
    }

    sendCompressedData(res, 200, JSON.stringify(data || { success : true }), contentType('application/json'));
}

/**
 * Attempt to send gzip compressed data to reduce network traffic, falling back to plain text on failure.
 * @param {ExpressResponse} res
 * @param {number} status HTTP status code.
 * @param {*} data The data to compress and return.
 * @param {string|false} typeString The MIME type of `data`.
 * @param {number} cacheAge The max-age for this resource. 0 if the request is not cacheable. Should only be true when running as a
 *                          binary, and the request URL is cache-bustable */
export function sendCompressedData(res, status, data, typeString, cacheAge=0) {
    // It's technically possible for contentType to be false if we attempt to read an unknown file type.
    // Allow sniffing in that case;
    /** @type {{ [header: string]: string }} */
    const headers = {};
    if (typeString !== false) {
        headers['Content-Type'] = typeString;
        headers['x-content-type-options'] = 'nosniff';
    }

    if (cacheAge !== 0) {
        headers['Cache-Control'] = `max-age=${cacheAge}, immutable`;
    }

    gzip(data, (err, buffer) => {
        if (err) {
            Log.warn('Failed to compress data, sending uncompressed');
            res.writeHead(status, headers);
            res.end(data);
            return;
        }

        res.writeHead(status, {
            'Content-Encoding' : 'gzip',
            ...headers
        });

        res.end(buffer);
    });
}

/** @type {NodeJS.Timeout|null} */
let autoSuspendTimeout = null;
function autoSuspend() {
    Log.info('Auto-suspending server due to inactivity');
    waitForServerEvent(ServerEvents.AutoSuspend).then(() => {
        Log.info('Server auto-suspend event completed, setting server state to AutoSuspended');
        SetServerState(ServerState.AutoSuspended);
    }).catch(err => {
        Log.error('Error while waiting for AutoSuspend event:', err);
    });
}

/**
 * Resets the auto-suspend timeout after server activity is detected (if auto-suspend is enabled). */
export function resetAutoSuspendTimeout() {
    if (autoSuspendTimeout) {
        clearTimeout(autoSuspendTimeout);
    }

    if (Config.autoSuspend()) {
        autoSuspendTimeout = setTimeout(autoSuspend, Config.autoSuspendTimeout() * 1000);
    }
}

ServerEventHandler.on(ServerEvents.AutoSuspendChanged, resolve => {
    resetAutoSuspendTimeout();
    resolve();
});
