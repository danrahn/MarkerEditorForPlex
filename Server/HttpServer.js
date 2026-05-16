/** External dependencies */
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { default as express } from 'express';
import { randomBytes } from 'crypto';
import { default as session } from 'express-session';

import Open from 'open';
import rateLimit from 'express-rate-limit';

/** @typedef {!import('express').Application} ExpressApp */
/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('http').Server} httpServer */

import { autoResume, ServerActionMap, setServer, setServerSSL, shouldCreateServer } from './ServerLifecycle.js';
import { GetServerState, ServerState, SetServerState } from './ServerState.js';
import { isBinary, resetAutoSuspendTimeout, sendJsonError } from './ServerHelpers.js';
import { PostCommands, SuspendedWhitelist } from '../Shared/PostCommands.js';
import { Config } from './Config/MarkerEditorConfig.js';
import { ContextualLog } from '../Shared/ConsoleLog.js';
import { runPostCommand } from './PostCommands.js';
import { User } from './Authentication/Authentication.js';

import GETHandler from './GETHandler.js';
import ServerError from './ServerError.js';
import { default as Sqlite3Store } from './Authentication/SqliteSessionStore.js';

const Log = ContextualLog.Create('ServerCore');

/**
 * Creates the server. Called after verifying the config file and database.
 * @returns {Promise<void>} */
export function launchServer() {
    if (!shouldCreateServer()) {
        return;
    }

    return Promise.all([
        new Promise(r => { createServer(Config.host(), Config.port(), false /*ssl*/, r); }),
        new Promise(r => { createServer(Config.sslHost(), Config.sslPort(), true /*ssl*/, r); })
    ]);
}

/**
 * Create an HTTP or HTTPS server.
 * @param {string} host
 * @param {number} port
 * @param {boolean} ssl
 * @param {() => void} resolve */
function createServer(host, port, ssl, resolve) {
    if (ssl ? !Config.useSsl() : Config.sslOnly()) {
        resolve();
        return;
    }

    const app = express();
    initializeSessionStore(app, ssl);
    const ignoreProxyErrors = Config.trustProxy() === 'ignore';
    /** @type {import('express-rate-limit').EnabledValidations} */
    let rateLimitValidate = { xForwardedForHeader : false, trustProxy : false };
    if (!ignoreProxyErrors) {
        app.set('trust proxy', Config.trustProxy());
        rateLimitValidate = undefined;
    }

    if (Config.useAuth()) {
        // One unauthenticated request per second, spread out over 5 seconds.
        /** @type {Partial<import('express-rate-limit').Options>} */
        const strictRateLimit = {
            windowMs : 5000,
            limit : 5,
            message : { Error : 'Too many requests' },
            validate : rateLimitValidate,
        };

        app.use(new RegExp(`.*/${PostCommands.Login}`), rateLimit(strictRateLimit));
        app.use(new RegExp(`.*/${PostCommands.NeedsPassword}`), rateLimit(strictRateLimit));

        // Strict limit for other POST commands as well, but no limit for authenticated users.
        app.post(/.*/, rateLimit({ skip : (req, _res) => req.session?.authenticated, ...strictRateLimit }), serverPost);

        // Pretty high limits for all GET requests. This should only affect loading everything
        // required for login.html, as the main page is only available after logging in.
        // Basically just prevents the user from constantly force-reloading the page.
        app.get(/.*/, rateLimit({
            windowMs : 10000,
            limit : isBinary() ? 25 : 200, // Binary bundles JS into a single file, source gets raw JS (>40 files)
            skip : (req, _res) => req.session?.authenticated,
            validate : rateLimitValidate,
        }), serverGet);
    } else {
        // Explicitly ignore rate limiting - the user has bigger problems than DoS if they're externally exposing an unauthenticated app.
        const noRateLimit = rateLimit({ windowMs : 5000, limit : 200, skip : () => true, validate : rateLimitValidate });
        app.get(/.*/, noRateLimit, serverGet);
        app.post(/.*/, noRateLimit, serverPost);
    }

    const listenerCallback = () => {
        const url = `http${ssl ? 's' : ''}://${host}:${port}`;
        Log.info(`HTTP${ssl ? 'S' : ''} Server running at ${url} (Ctrl+C to exit)`);
        if (process.env.IS_DOCKER) {
            Log.info(`NOTE: External port may be different when run in Docker, based on '-p' passed into docker run`);
        }

        if (!ssl && Config.autoOpen() && GetServerState() === ServerState.FirstBoot) {
            Log.info('Launching browser...');
            void Open(url).catch(err => {
                Log.warn(`Unable to auto-open browser: ${err.message}`);
            });
        }

        SetServerState(ServerState.Running);
        resolve();
    };

    if (ssl) {
        setServerSSL(createHttpsServer(Config.sslOpts(), app).listen(port, host, listenerCallback));
    } else {
        setServer(createHttpServer(app).listen(port, host, listenerCallback));
    }
}

/**
 * Initialize session information.
 * @param {ExpressApp} app
 * @param {boolean} [https=false] */
function initializeSessionStore(app, https = false) {
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
    const oldSecrets = Sqlite3Store.oldSecrets(https);
    Sqlite3Store.setNewSecret(newSecret, https);
    app.use(
        session({
            secret : [newSecret, ...oldSecrets],
            rolling : true, // Only expire sessions that are inactive for maxAge.
            resave : false,
            saveUninitialized : false,
            name : 'markereditor.sid',
            store : sessionStore,
            cookie : { maxAge : Config.authSessionTimeout() * 1000, secure : https }
        })
    );
}

/**
 * Get the remote address from a request.
 * @param {ExpressRequest} request
 * @returns {string} */
function remoteAddr(request) {
    if (request.headers['x-forwarded-for']) {
        return request.headers['x-forwarded-for'].split(',')[0].trim();
    }

    return request.socket.remoteAddress || 'UNKNOWN';
}

/**
 * Entrypoint for incoming GET requests to the server.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res */
function serverGet(req, res) {
    Log.verbose(`(${remoteAddr(req)}) GET: ${req.url}`);
    if (GetServerState() === ServerState.ShuttingDown) {
        Log.warn('Got a request when attempting to shut down the server, returning 503.');
        res.statusCode = 503;
        res.end();
        return;
    }

    try {
        return GETHandler.handleRequest(req, res);
    } catch (err) {
        err.message = `Exception thrown for ${req.url}: ${err.message}`;
        sendJsonError(res, err, err.code || 500);
    }
}

/**
 * Entrypoint for incoming POST requests to the server.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res */
function serverPost(req, res) {
    Log.verbose(`(${remoteAddr(req)}) POST: ${req.url}`);

    if (GetServerState() === ServerState.ShuttingDown) {
        Log.warn('Got a request when attempting to shut down the server, returning 503.');
        sendJsonError(res, new ServerError('Server is shutting down', 503));
        return;
    }

    return handlePost(req, res);
}

/**
 * Handle POST requests, used to return JSON data queried by the client.
 * @param {ExpressRequest} req
 * @param {ExpressResponse} res */
async function handlePost(req, res) {
    let url = req.url.toLowerCase();
    const baseUrl = Config.baseUrl();
    if (url.startsWith(baseUrl)) {
        url = '/' + url.substring(baseUrl.length);
    }

    const endpointIndex = url.indexOf('?');
    const endpoint = endpointIndex === -1 ? url.substring(1) : url.substring(1, endpointIndex);
    if (GetServerState() === ServerState.Suspended && !SuspendedWhitelist.has(endpoint)) {
        return sendJsonError(res, new ServerError('Server is suspended', 503, true /*expected*/));
    }

    if (GetServerState() === ServerState.AutoSuspended && !SuspendedWhitelist.has(endpoint)) {
        Log.info('Resuming server after auto-suspended.');
        await autoResume();
    }

    resetAutoSuspendTimeout();

    try {
        if (Object.prototype.hasOwnProperty.call(ServerActionMap, endpoint)
            && typeof ServerActionMap[endpoint] === 'function') {
            if (!Config?.useAuth() || User.signedIn(req)) {
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
