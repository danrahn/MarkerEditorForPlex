import { contentType, lookup } from 'mime-types';
import { join } from 'path';
import { readFileSync } from 'fs';
/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { Config, ProjectRoot } from './MarkerEditorConfig.js';
import { GetServerState, ServerState } from './ServerState.js';
import { ThumbnailNotGeneratedError, Thumbnails } from './ThumbnailManager.js';
import DatabaseImportExport from './ImportExport.js';
import { sendCompressedData } from './ServerHelpers.js';
import ServerError from './ServerError.js';


const Log = new ContextualLog('GETHandler');

class GETHandler {

    /**
     * Regex that defines valid paths, which are currently index.html, or anything inside
     * the client, shared, or svg folder, as long as it doesn't contain '/..' or '\..'
     * somewhere in the path.
     */
    static #whitelistRegex = /^\/(?:index\.html|(?:client|shared|svg)\/(?:(?![\\/]\.\.).)*)$/i;

    /**
     * Handle the given GET request.
     * @param {IncomingMessage} req
     * @param {ServerResponse} res */
    static handleRequest(req, res) {
        let url = req.url;

        // GET requests should always have a URL
        if (!url) {
            res.writeHead(400).end(`Invalid request - no URL found`);
            return;
        }

        if (url === '/') {
            url = '/index.html';
        }

        switch (url.substring(0, 3)) {
            case '/i/':
                return ImageHandler.GetSvgIcon(url, res);
            case '/t/':
                return ImageHandler.GetThumbnail(url, res);
            default:
                break;
        }

        if (url.startsWith('/export/')) {
            return DatabaseImportExport.exportDatabase(res, parseInt(url.substring('/export/'.length)));
        }

        const mimetype = contentType(lookup(url));
        if (!mimetype) {
            res.writeHead(404).end(`Bad MIME type: ${url}`);
            return;
        }

        if (!GETHandler.#whitelistRegex.test(url)) {
            Log.warn(url, `Attempting to access url that is not whitelisted`);
            res.writeHead(404).end('Not Found');
            return;
        }

        try {
            const contents = readFileSync(join(ProjectRoot(), url));
            sendCompressedData(res, 200, contents, mimetype);
        } catch (err) {
            Log.warn(`Unable to serve ${url}: ${err.message}`);
            res.writeHead(404).end(`Not Found: ${err.message}`);
        }
    }
}

/**
 * Handles retrieving SVG icons and preview thumbnails
 */
class ImageHandler {

    /**
     * Retrieve an SVG icon requests with the given color.
     * @param {string} url The svg url of the form /i/[hex color]/[icon].svg
     * @param {ServerResponse} res */
    static GetSvgIcon(url, res) {
        const badRequest = (msg, code=400) => {
            Log.error(msg, `[${url}] Unable to retrieve icon`);
            res.writeHead(code).end(msg);
        };

        const parts = url.split('/');
        if (parts.length !== 3) {
            return badRequest('Invalid icon request format');
        }

        try {
            const icon = parts[2];
            const contents = readFileSync(join(ProjectRoot(), 'SVG', icon), { encoding : 'utf-8' });
            res.writeHead(200, {
                'Content-Type' : contentType('image/svg+xml'),
                'x-content-type-options' : 'nosniff'
            }).end(Buffer.from(contents, 'utf-8'));
        } catch (err) {
            return badRequest(err.message, err.code && err.code === 'ENOENT' ? 404 : 500);
        }
    }

    /**
     * Retrieve a thumbnail for the episode and timestamp denoted by the url, /t/metadataId/timestampInSeconds.
     * @param {string} url Thumbnail url
     * @param {ServerResponse} res */
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
            try {
                let contents = readFileSync(join(ProjectRoot(), 'SVG', 'badThumb.svg'), { encoding : 'utf-8' });

                // Raw file has IMAGE_HEIGHT to be replaced with our desired height, as
                // width is constant, so height will depend on the aspect ratio.
                contents = contents.replace(/IMAGE_HEIGHT/g, `${timestamp}`);
                res.writeHead(200, {
                    'Content-Type' : contentType('image/svg+xml'),
                    'x-content-type-options' : 'nosniff'
                }).end(Buffer.from(contents, 'utf-8'));
                return;
            } catch (err) {
                return badRequest(err.message, err.code && err.code === 'ENOENT' ? 404 : 500);
            }
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
