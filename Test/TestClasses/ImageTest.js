import { readdirSync } from 'fs';
import { join } from 'path';

import { ProjectRoot } from '../../Server/PlexIntroEditor.js';

import TestBase from "../TestBase.js";
import TestHelpers from '../TestHelpers.js';

class ImageTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.test200OnAllSVGs,
            this.testMissingSVG,
            this.testGoodSVGColors,
            this.testBadSVGColors,
        ];
    }

    // Hacky, but there are some SVGs that don't have a FILL_COLOR, so we don't expect to see it in the text.
    static #colorExceptions = { 'favicon.svg' : 1, 'noise.svg' : 1 };

    className() { return 'ImageTest'; }

    /**
     * Ensure all SVG icons in the SVG directory are returned successfully. */
    async test200OnAllSVGs() {
        let files = readdirSync(join(ProjectRoot, 'SVG'));
        for (const file of files) {
            // Shouldn't happen, but maybe non-SVGs snuck in here
            if (!file.toLowerCase().endsWith('.svg')) {
                continue;
            }

            const endpoint = `i/CCC/${file}`;
            const result = await this.get(endpoint);
            await this.#ensureValidSVG(endpoint, result, 'CCC');
        }
    }

    /**
     * Ensure we return a failing status code if a non-existent icon is asked for. */
    async testMissingSVG() {
        this.expectFailure();
        const endpoint = `i/CCC/_BADIMAGE.svg`;
        const result = await this.get(endpoint);
        TestHelpers.verify(result.status == 404, `Expected request for "${endpoint}" to return 404, found ${result.status}`);
    }

    /**
     * Ensure we succeed in retrieving an icon in various different colors. */
    async testGoodSVGColors() {
        const endpoint = (color) => `i/${color}/settings.svg`;
        const testColors = [
            'CCC',
            'CCCCCC',
            '000',
            '000000',
            'ffffff',
            'f0f0f0',
            'FFffFf',
            '123',
            '123456',
        ];

        for (const color of testColors) {
            const img = endpoint(color);
            const result = await this.get(img);
            await this.#ensureValidSVG(img, result, color);
        }
    }

    /**
     * Ensure we fail to retrieve icons if provided an invalid hex color. */
    async testBadSVGColors() {
        this.expectFailure();
        const endpoint = (color) => `i/${color}/settings.svg`;
        const testColors = [
            'C',
            'CC',
            'CCCC',
            'CCCCC',
            'CCCCCCC',
            'ggg',
            'fffffg',
            'F2GF2F',
            'FOO',
            'BaR',
            'bAz'
        ];

        for (const color of testColors) {
            const img = endpoint(color);
            const result = await this.get(img);
            await TestHelpers.verifyBadRequest(result, `invalid SVG color`, false /*json*/);
        }
    }

    /**
     * Helper that verifies the given image has the right content type, and that the content
     * itself contains the right color (ish)
     * @param {string} endpoint
     * @param {Response} response
     * @param {string} color */
    async #ensureValidSVG(endpoint, response, color) {
        TestHelpers.verify(response.status == 200, `Expected 200 when retrieving ${endpoint}, got ${response.status}.`);
        TestHelpers.verifyHeader(response.headers, 'Content-Type', 'img/svg+xml', endpoint);

        if (ImageTest.#colorExceptions[endpoint.substring(endpoint.lastIndexOf('/') + 1).toLowerCase()]) {
            return Promise.resolve();
        }

        const text = await response.text();
        TestHelpers.verify(text.indexOf(`#${color}`) != -1, `Expected to see color "${color}" in "${endpoint}", didn't find it!`);
    }
}

export default ImageTest;
