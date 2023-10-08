import { ContextualLog } from '../Shared/ConsoleLog.js';
import ServerError from './ServerError.js';

/** @typedef {!import('http').IncomingMessage} IncomingMessage */

/** @typedef {{ [name: string]: { name : string, data : string, [optionalKeys: string]: string? } }} ParsedFormData */

const Log = new ContextualLog('FormData');

/** Regex that looks for expected 'Content-Disposition: form-data' key/value pairs */
const headerRegex = /\b(?<key>\w+)="(?<value>[^"]+)"/g;

/**
 * Helper class that parses form-data from HTML request bodies.
 */
class FormDataParse {

    /**
     * Retrieves all data from the request body and returns the parsed body as an object of key-value pairs.
     * If we ever have reason to parse many megabytes/gigabytes of data, stream the data to a file first and
     * then parse. In the meantime, let the caller pass in a reasonable upper limit.
     * @param {IncomingMessage} request
     * @param {number} maxSize Maximum number of bytes in the body before we bail out. */
    static async parseRequest(request, maxSize) {
        const data = await new Promise((resolve, reject) => {
            let body = '';
            request.on('data', chunk => {
                if (Buffer.isBuffer(chunk)) {
                    body += chunk.toString('binary');
                } else {
                    body += chunk;
                }

                if (body.length > maxSize) {
                    Log.error('Form data parse failed - data too large.');
                    reject('Form data is too large.');
                }
            });

            request.on('end', () => {
                Log.verbose(`Form data parsed (${body.length} bytes)`);
                resolve(body);
            });
        });

        return FormDataParse.rebuildFormData(data);
    }

    /**
     * Takes raw form input and rebuilds a key-value dictionary.
     * Note: I _really_ should use a library. There's probably a built-in one I
     *       should be using, but a very quick search didn't bring up anything I liked.
     * @param {string} raw
     * @returns {ParsedFormData} */
    static rebuildFormData(raw) {
        const data = {};

        const sentinelBase = raw.substring(0, raw.indexOf('\r\n'));
        if (!sentinelBase) {
            throw new ServerError('Malformed response, did not find form data sentinel', 500);
        }

        const sentinel = sentinelBase + '\r\n';
        const responseEnd = '\r\n' + sentinelBase + '--\r\n';

        let index = sentinel.length;
        for (;;) {
            const headerStart = index;
            const headerEnd = raw.indexOf('\r\n\r\n', index) + 4;
            index = headerEnd;
            if (!sentinel || headerEnd === 3) {
                return data;
            }

            const rawHeaders = raw.substring(headerStart, headerEnd).split('\r\n').filter(h => !!h);
            let name = '';
            // We specifically are looking for form-data
            // Also make our lives easier and assume no double quotes in names
            for (const header of rawHeaders) {
                const headerNorm = header.toLowerCase();
                if (headerNorm.startsWith('content-disposition:') && headerNorm.includes('form-data;')) {
                    const fields = {};
                    for (const match of header.matchAll(headerRegex)) {
                        fields[match.groups.key] = match.groups.value;
                    }

                    if (!fields['name']) {
                        throw new ServerError('Invalid form data - no name for field', 500);
                    }

                    name = fields['name'];
                    data[name] = fields;

                    // Are any other fields relevant? If so, parse those as well instead of breaking
                    break;
                }
            }

            const dataStart = index;
            const dataEnd = raw.indexOf(sentinelBase, index);
            if (dataEnd === -1) {
                throw new ServerError('Invalid form input - could not find data sentinel', 500);
            }

            data[name].data = raw.substring(dataStart, dataEnd - 2); // Don't include CRLF before sentinel
            index = raw.indexOf(sentinel, dataEnd);
            if (index === -1) {
                // If we don't find the sentinel, we better be at the end
                if (raw.indexOf(responseEnd, dataEnd - 2) != dataEnd - 2) {
                    Log.warn('Unexpected response end, returning what we have.');
                }

                Log.verbose(`Parsed POST body. Found ${Object.keys(data).length} fields.`);
                return data;
            }

            index += sentinel.length;
        }
    }
}

export default FormDataParse;
