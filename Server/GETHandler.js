import { contentType, lookup } from 'mime-types';
import { join } from 'path';
import { readFile } from 'fs';

/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('express').Response} ExpressResponse */

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { Config, ProjectRoot } from './MarkerEditorConfig.js';
import { GetServerState, ServerState } from './ServerState.js';
import { isBinary, sendCompressedData } from './ServerHelpers.js';
import { ThumbnailNotGeneratedError, Thumbnails } from './ThumbnailManager.js';
import { DatabaseImportExport } from './ImportExport.js';
import ServerError from './ServerError.js';
import { User } from './Authentication/Authentication.js';


const Log = new ContextualLog('GETHandler');

/** The cache duration for cache-bustable files (30 days) */
const StaticCacheAge = 86400 * 30;

/**
 * The cache duration for preview thumbnails.
 * Only 5 minutes on the off-chance that the underlying file/BIF file changes. */
const ThumbCacheAge = 300;

class GETHandler {

    /**
     * Regex that defines valid paths, which are currently index.html, or anything inside
     * the client, shared, or svg folder, as long as it doesn't contain '/..' or '\..'
     * somewhere in the path. For built packages, also allow index.[guid].(html|js)*/
    /* eslint-disable prefer-named-capture-group */
    static #whitelistRegex = /^\/(dist\/)?((index|login)\.([a-f0-9]+\.)?(html|js)|(client|shared|svg)\/[^.]{2}((?![\\/]\.\.).)*)$/i;

    /**
     * Regex that defines allowed GET requests when the user is not signed in.
     * Only allow access to static resources. */
    static #noAuthRegex = /^(\/|.*\.(css|html|js|svg))$/i;
    /* eslint-enable prefer-named-capture-group */

    /**
     * Handle the given GET request.
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res */
    static async handleRequest(req, res) {
        let url = req.url;

        // GET requests should always have a URL
        if (!url) {
            res.writeHead(400).end(`Invalid request - no URL found`);
            return;
        }

        if (!GETHandler.#requestAllowed(req, res)) {
            return; // #requestAllowed handles writing the response.
        }

        // Only production files use cache-busing techniques, so don't
        // set a cache-age if we're using raw dev files. Make an exception
        // for production HTML though, as they do not use cache-busting.
        let cacheable = isBinary();

        if (url === '/') {
            url = '/index.html';
        }

        const urlPlain = url.split('?')[0].toLowerCase();

        if (urlPlain === '/index.html') {
            if (Config.useAuth() && !User.signedIn(req)) {
                res.redirect('/login.html');
                return;
            }

            cacheable = false;
        }

        if (urlPlain === '/login.html') {
            if (!Config.useAuth() || User.signedIn(req)) {
                res.redirect('/');
                return;
            }

            url = '/Client/login.html';
            cacheable = false;
        }

        switch (url.substring(0, 3)) {
            case '/i/':
                return ImageHandler.GetSvgIcon(url, res, cacheable);
            case '/t/':
                return await ImageHandler.GetThumbnail(url, res);
            default:
                break;
        }

        if (url.startsWith('/export/')) {
            return await DatabaseImportExport.exportDatabase(res, parseInt(url.substring('/export/'.length)));
        }

        const mimetype = contentType(lookup(urlPlain));
        if (!mimetype) {
            res.writeHead(404).end(`Bad MIME type: ${urlPlain}`);
            return;
        }

        if (!GETHandler.#whitelistRegex.test(url)) {
            Log.warn(url, `Attempting to access url that is not whitelisted`);
            res.writeHead(404).end('Not Found');
            return;
        }

        // Avoid readFileSync to improve parallelism. Also avoid the promise version,
        // as nexe doesn't work with fs/promise.
        readFile(join(ProjectRoot(), url), (err, contents) => {
            if (err) {
                Log.warn(`Unable to serve ${url}: ${err.message}`);
                res.writeHead(404).end(`Not Found: ${err.message}`);
                return;
            }

            sendCompressedData(res, 200, contents, mimetype, cacheable ? StaticCacheAge : 0);
        });
    }

    /**
     * Determines whether the given request is allowed. There are special cases for users
     * who aren't signed in, and when the user hasn't gone through the first-time setup yet.
     * @param {ExpressRequest} req
     * @param {ExpressResponse} res */
    static #requestAllowed(req, res) {
        if (Config.useAuth() && !req.session.authenticated) {
            if (!this.#noAuthRegex.test(req.url.split('?')[0])) {
                res.writeHead(401).end(`Cannot access resource without authorization: "${req.url}"`);
                return false;
            }
        }

        // Most GET requests are allowed in first run, except for thumbnails and export
        if (GetServerState() === ServerState.RunningWithoutConfig
            && (req.url.substring(0, 3) === '/t/' || req.url.startsWith('/export/'))) {
            res.writeHead(503).end(`Disallowed request during First Run experience: "${req.url}"`);
            return false;
        }

        return true;
    }
}

/**
 * Handles retrieving SVG icons and preview thumbnails
 */
class ImageHandler {

    /**
     * Retrieve an SVG icon requests with the given color.
     * @param {string} url The svg url of the form /i/[hex color]/[icon].svg
     * @param {ExpressResponse} res
     * @param {boolean} cacheable Whether this request should be cached (i.e. whether we're
     *                            retrieving a cache-bustable SVG from a production binary) */
    static GetSvgIcon(url, res, cacheable=false) {
        const badRequest = (msg, code=400) => {
            Log.error(msg, `[${url}] Unable to retrieve icon`);
            res.writeHead(code).end(msg);
        };

        const parts = url.split('/');
        if (parts.length !== 3) {
            return badRequest('Invalid icon request format');
        }

        const headers = {
            'Content-Type' : contentType('image/svg+xml'),
            'x-content-type-options' : 'nosniff'
        };

        if (cacheable) {
            headers['Cache-Control'] = `max-age=${StaticCacheAge}, immutable`;
        }

        const icon = parts[2];
        readFile(join(ProjectRoot(), 'SVG', icon), { encoding : 'utf-8' }, (err, contents) => {
            if (err) {
                return badRequest(err.message, err.code && err.code === 'ENOENT' ? 404 : 500);
            }

            res.writeHead(200, headers).end(Buffer.from(contents, 'utf-8'));
        });
    }

    /**
     * Retrieve a thumbnail for the episode and timestamp denoted by the url, /t/metadataId/timestampInSeconds.
     * @param {string} url Thumbnail url
     * @param {ExpressResponse} res */
    static async GetThumbnail(url, res) {
        const badRequest = (msg, errorCode=400) => {
            Log.error(msg, `Unable to retrieve thumbnail`);
            res.writeHead(errorCode).end(msg);
        };

        if (!Config.useThumbnails()) {
            return badRequest('Preview thumbnails are not enabled');
        }

        if (GetServerState() === ServerState.Suspended) {
            return badRequest(`Server is suspended, can't retrieve thumbnail.`);
        }

        const split = url.split('/');
        if (split.length !== 4) {
            return badRequest(`Malformed thumbnail URL: ${url}`);
        }

        const metadataId = parseInt(split[2]);
        const timestamp = parseInt(split[3]);
        if (isNaN(metadataId) || isNaN(timestamp)) {
            return badRequest(`Non-integer id/timestamp provided`);
        }

        if (metadataId === -1) {
            // This is an expected fallback case when we initially fail to grab a thumbnail.
            // The 'timestamp' is actually the height of the SVG we want to generate that has
            // a generic 'Error' text in the middle of it.
            readFile(join(ProjectRoot(), 'SVG', 'badThumb.svg'), { encoding : 'utf-8' }, (err, contents) => {
                if (err) {
                    return badRequest(err.message, err.code && err.code === 'ENOENT' ? 404 : 500);
                }

                // Raw file has IMAGE_HEIGHT to be replaced with our desired height, as
                // width is constant, so height will depend on the aspect ratio.
                contents = contents.replace(/IMAGE_HEIGHT/g, `${timestamp}`);
                res.writeHead(200, {
                    'Content-Type' : contentType('image/svg+xml'),
                    'x-content-type-options' : 'nosniff',
                    'Cache-Control' : `max-age=${ThumbCacheAge}`
                }).end(Buffer.from(contents, 'utf-8'));
            });


            return;
        }

        try {
            const data = await Thumbnails.getThumbnail(metadataId, timestamp);
            res.writeHead(200, {
                'Content-Type' : 'image/jpeg',
                'Content-Length' : data.length,
                'x-content-type-options' : 'nosniff'
            }).end(data);
        } catch (err) {
            if (err instanceof ThumbnailNotGeneratedError) {
                Log.warn(err.message); // This error is expected in some cases, so just warn.
            } else {
                Log.error(err, 'Failed to retrieve thumbnail');
            }

            res.writeHead(err instanceof ServerError ? err.code : 500).end('Failed to retrieve thumbnail.');
        }
    }
}

export default GETHandler;
