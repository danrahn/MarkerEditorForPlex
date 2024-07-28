import { contentType } from 'mime-types';
import { createServer } from 'http';
import { execFileSync } from 'child_process';
import { gzip } from 'zlib';
/** @typedef {!import('http').Server} Server */
/** @typedef {!import('http').ServerResponse} ServerResponse */

import { ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';

import ServerError from './ServerError.js';


const Log = new ContextualLog('ServerHelpers');

/**
 * Helper method that returns the given HTTP status code alongside a JSON object with a single 'Error' field.
 * @param {ServerResponse} res
 * @param {Error|string} error The error to log
 * @param {number?} code Error code to return. Not necessary if error is a ServerError. */
export function sendJsonError(res, error, code) {
    let message = error;
    let stack = '[Stack trace not available]';
    if (error instanceof Error) {
        message = error.message;
        if (error.stack) { stack = error.stack; }
    }

    if (error instanceof ServerError) {
        code = error.code;
    }

    Log.error(message);
    Log.verbose(stack);

    if (!code) {
        Log.warn(`sendJsonError didn't receive a valid error code, defaulting to 500`);
        code = 500;
    }

    sendCompressedData(res, code, JSON.stringify({ Error : message }), contentType('application/json'));
}

/**
 * Helper method that returns a success HTTP status code alongside any data we want to return to the client.
 * @param {ServerResponse} res
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
 * @param {ServerResponse} res
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

/**
 * Verifies that we can find ffmpeg in our path */
export function testFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version']);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Determine if the given host/port is in use.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ valid: boolean, errorCode?: string }>}*/
export function testHostPort(host, port) {
    return new Promise(resolve => {
        /** @type {Server} */
        const serverPing = createServer();
        serverPing.listen(port, host, () => {
            serverPing.close(_ => resolve({ valid : true }));
        }).on('error', (err) => {
            serverPing.close(_ => resolve({ valid : false, errorCode : err.code }));
        });
    });
}

// Binaries invoke built.cjs (keep in sync with Build.js's transpile()). Assume anything else is from source.
const looksLikeBinary = process.argv[1]?.includes('built.cjs');

/**
 * Returns whether this application is running as a binary. Returns false if running from source. */
export function isBinary() {
    return looksLikeBinary;
}
