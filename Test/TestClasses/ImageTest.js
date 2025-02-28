import { join } from 'path';
import { readdirSync } from 'fs';

import { ProjectRoot } from '../../Server/Config/MarkerEditorConfig.js';

import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

class ImageTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.test200OnAllSVGs,
            this.testMissingSVG,
        ];
    }

    // Hacky, but there are some SVGs that don't have a currentColor, so we don't expect to see it in the text.
    static #colorExceptions = new Set(['favicon.svg', 'noise.svg', 'badthumb.svg']);

    className() { return 'ImageTest'; }

    /**
     * Ensure all SVG icons in the SVG directory are returned successfully. */
    async test200OnAllSVGs() {
        const files = readdirSync(join(ProjectRoot(), 'SVG'));
        for (const file of files) {
            // Shouldn't happen, but maybe non-SVGs snuck in here
            if (!file.toLowerCase().endsWith('.svg')) {
                continue;
            }

            const endpoint = `i/${file}`;
            const result = await this.get(endpoint);
            await this.#ensureValidSVG(endpoint, result);
        }
    }

    /**
     * Ensure we return a failing status code if a non-existent icon is asked for. */
    async testMissingSVG() {
        this.expectFailure();
        const endpoint = `i/_BADIMAGE.svg`;
        const result = await this.get(endpoint);
        TestHelpers.verify(result.status === 404, `Expected request for "${endpoint}" to return 404, found ${result.status}`);
    }

    /**
     * Helper that verifies the given image has the right content type, * and the right content.
     * @param {string} endpoint
     * @param {Response} response */
    async #ensureValidSVG(endpoint, response) {
        TestHelpers.verify(response.status === 200, `Expected 200 when retrieving ${endpoint}, got ${response.status}.`);
        TestHelpers.verifyHeader(response.headers, 'Content-Type', 'img/svg+xml', endpoint);

        if (ImageTest.#colorExceptions.has(endpoint.substring(endpoint.lastIndexOf('/') + 1).toLowerCase())) {
            return;
        }

        const text = await response.text();

        // Should immediately start with "<svg", since these icons are intended to be directly interpreted as an inline SVG icon.
        TestHelpers.verify(text.toLowerCase().startsWith('<svg'));
        TestHelpers.verify(text.trim().toLowerCase().endsWith('/svg>'));
        TestHelpers.verify(text.indexOf('currentColor') !== 1, `Expected theme-able icon to have "currentColor"`);

        // Guard against legacy FILL_COLOR
        TestHelpers.verify(text.indexOf('FILL_COLOR') === -1,
            `SVG icons should no longer use FILL_COLOR for dynamic coloring, but "currentColor" + css variables.`);
    }
}

export default ImageTest;
