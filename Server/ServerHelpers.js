import { contentType } from 'mime-types';
import { execFileSync } from 'child_process';
import { gzip } from 'zlib';
/** @typedef {!import('http').ServerResponse} ServerResponse */

import { ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';

import ServerError from './ServerError.js';


const Log = new ContextualLog('ServerHelpers');
/**
 * Helper method that returns the given HTTP status code alongside a JSON object with a single 'Error' field.
 * @param {ServerResponse} res
 * @param {Error|string} error The error to log
 * @param {number?} code Error code to return. Not necessary if error is a ServerError. */
function sendJsonError(res, error, code) {
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
function sendJsonSuccess(res, data) {
    // TMI logging, post the entire response, for verbose just indicate we succeeded.
    if (Log.getLevel() <= ConsoleLog.Level.Tmi) {
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
 * @param {string|false} contentType The MIME type of `data`. */
function sendCompressedData(res, status, data, contentType) {
    // It's technically possible for contentType to be false if we attempt to read an unknown file type.
    // Allow sniffing in that case;
    /** @type {{ [header: string]: string }} */
    const headers = {};
    if (contentType !== false) {
        headers['Content-Type'] = contentType;
        headers['x-content-type-options'] = 'nosniff';
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
function testFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version']);
        return true;
    } catch (err) {
        return false;
    }
}

export { sendJsonSuccess, sendJsonError, sendCompressedData, testFfmpeg };
