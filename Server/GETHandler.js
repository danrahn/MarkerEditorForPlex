import { contentType, lookup } from 'mime-types';
import { join } from 'path';
import { readFileSync } from 'fs';
/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */

import { Log } from '../Shared/ConsoleLog.js';

import { GetServerState, ServerState } from './ServerState.js';
import { Config } from './IntroEditorConfig.js';
import DatabaseImportExport from './ImportExport.js';
import { sendCompressedData } from './ServerHelpers.js';
import ServerError from './ServerError.js';
import { Thumbnails } from './ThumbnailManager.js';

class GETHandler {

    /**
     * Handle the given GET request.
     * @param {IncomingMessage} req
     * @param {ServerResponse} res */
    static async handleRequest(req, res) {
        let url = req.url;
        if (url == '/') {
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

        try {
            const contents = readFileSync(join(Config.projectRoot(), url));
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
    static async GetSvgIcon(url, res) {
        const badRequest = (msg, code=400) => {
            Log.error(msg, `[${url}] Unable to retrieve icon`);
            res.writeHead(code).end(msg);
        };

        const parts = url.split('/');
        if (parts.length !== 4) {
            return badRequest('Invalid icon request format');
        }

        const color = parts[2];
        const icon = parts[3];

        // Expecting a 3 or 6 character hex string
        if (!/^[a-fA-F0-9]{3}$/.test(color) && !/^[a-fA-F0-9]{6}$/.test(color)) {
            return badRequest(`Invalid icon color: "${color}"`);
        }

        try {
            let contents = readFileSync(join(Config.projectRoot(), 'SVG', icon));
            if (Buffer.isBuffer(contents)) {
                contents = contents.toString('utf-8');
            }

            // Raw file has FILL_COLOR in place of hardcoded values. Replace
            // it with the requested hex color (after decoding the contents)
            contents = contents.replace(/FILL_COLOR/g, `#${color}`);
            res.writeHead(200, {
                'Content-Type' : contentType('image/svg+xml'),
                'x-content-type-options' : 'nosniff'
            }).end(Buffer.from(contents, 'utf-8'));
        } catch (err) {
            return badRequest(err.message, err.code && err.code == 'ENOENT' ? 404 : 500);
        }
    }

    /**
     * Retrieve a thumbnail for the episode and timestamp denoted by the url, /t/metadataId/timestampInSeconds.
     * @param {string} url Thumbnail url
     * @param {ServerResponse} res */
    static async GetThumbnail(url, res) {
        const badRequest = (msg) => {
            Log.error(msg, `Unable to retrieve thumbnail`);
            res.writeHead(400).end(msg);
        };

        if (!Config.useThumbnails()) {
            return badRequest('Preview thumbnails are not enabled');
        }

        if (GetServerState() == ServerState.Suspended) {
            return badRequest(`Server is suspended, can't retrieve thumbnail.`);
        }

        const split = url.split('/');
        if (split.length != 4) {
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
                let contents = readFileSync(join(Config.projectRoot(), 'SVG', 'badThumb.svg'));
                if (Buffer.isBuffer(contents)) {
                    contents = contents.toString('utf-8');
                }

                // Raw file has IMAGE_HEIGHT to be replaced with our desired height, as
                // width is constant, so height will depend on the aspect ratio.
                contents = contents.replace(/IMAGE_HEIGHT/g, `${timestamp}`);
                res.writeHead(200, {
                    'Content-Type' : contentType('image/svg+xml'),
                    'x-content-type-options' : 'nosniff'
                }).end(Buffer.from(contents, 'utf-8'));
                return;
            } catch (err) {
                return badRequest(err.message, err.code && err.code == 'ENOENT' ? 404 : 500);
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
            if ((err instanceof ServerError) && err.message.endsWith('duration.')) {
                Log.warn(`Failed to retrieve thumbnail for ${metadataId} at timestamp ${timestamp}, likely due to duration differences.`);
            } else {
                Log.error(err, 'Failed to retrieve thumbnail');
            }

            res.writeHead(err instanceof ServerError ? err.code : 500).end('Failed to retrieve thumbnail.');
        }
    }
}

export default GETHandler;
