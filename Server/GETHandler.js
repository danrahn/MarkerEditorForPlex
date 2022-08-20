import { promises as FS } from 'fs';
import { contentType, lookup } from 'mime-types';
import { join } from 'path';
/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */

import { Log } from '../Shared/ConsoleLog.js';

import { Config } from './PlexIntroEditorConfig.js'
import ServerError from './ServerError.js';
import { sendCompressedData } from './ServerHelpers.js';
import { ServerState, GetServerState } from './ServerState.js';
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

        const mimetype = contentType(lookup(url));
        if (!mimetype) {
            res.writeHead(404).end(`Bad MIME type: ${url}`);
        }

        try {
            const contents = await FS.readFile(join(Config.projectRoot(), url));
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
        }

        let parts = url.split('/');
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
            let contents = await FS.readFile(join(Config.projectRoot(), 'SVG', icon));
            if (Buffer.isBuffer(contents)) {
                contents = contents.toString('utf-8');
            }

            // Raw file has FILL_COLOR in place of hardcoded values. Replace
            // it with the requested hex color (after decoding the contents)
            contents = contents.replace(/FILL_COLOR/g, `#${color}`);
            res.writeHead(200, {
                'Content-Type' : contentType('image/svg+xml'),
                'x-content-type-options': 'nosniff'
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
        }

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

        try {
            const data = await Thumbnails.getThumbnail(metadataId, timestamp);
            res.writeHead(200, {
                'Content-Type' : 'image/jpeg',
                'Content-Length' : data.length,
                'x-content-type-options' : 'nosniff'
            }).end(data);
        } catch (err) {
            Log.error(err, 'Failed to retrieve thumbnail');
            res.writeHead(err instanceof ServerError ? err.code : 500).end('Failed to retrieve thumbnail.');
        }
    }
}

export default GETHandler;
