import { ContextualLog } from '/Shared/ConsoleLog.js';

/** @typedef {!import('./Icons').IconKeys} IconKeys */

const Log = new ContextualLog('ThemeColors');

/**
 * List of available theme colors. */
export const ThemeColors = {
    /** @readonly */
    Primary : 'Primary',
    /** @readonly */
    Green : 'Green',
    /** @readonly */
    Red : 'Red',
    /** @readonly */
    Orange : 'Orange',
};

/** @typedef {ThemeColors} ThemeColorKeys */

/** Static class of colors used for icons, which may vary depending on the current theme. */
export class Theme {
    static #dict = {
        0 /*dark*/ : {
            [ThemeColors.Primary] : 'c1c1c1',
            [ThemeColors.Green] : '4C4',
            [ThemeColors.Red] : 'C44',
            [ThemeColors.Orange] : 'C94',
        },
        1 /*light*/ : {
            [ThemeColors.Primary] : '212121',
            [ThemeColors.Green] : '292',
            [ThemeColors.Red] : 'A22',
            [ThemeColors.Orange] : 'A22', // Just red, looks better than orange/brown
        }
    };

    static #isDark = false;

    /**
     * Set the current theme.
     * @param {boolean} isDark Whether dark theme is enabled. */
    static setDarkTheme(isDark) { this.#isDark = isDark; }

    /**
     * Return the hex color for the given color category.
     * @param {keyof ThemeColors} themeColor The color category for the button.
     * @returns {string} The hex color associated with the given color category. */
    static get(themeColor) {
        return Theme.#dict[this.#isDark ? 0 : 1][themeColor];
    }

    /**
     * Return the full hex string for the given color category, with an optional
     * opacity applied.
     * @param {keyof ThemeColors} themeColor The color category
     * @param {string} [opacity] The hex opacity (0-F, cannot be two characters) */
    static getHex(themeColor, opacity='F') {
        if (!/^[0-9A-Fa-f]$/.test(opacity)) {
            Log.warn(`getHex: invalid opacity "${opacity}", defaulting to opaque`);
            opacity = 'F';
        }

        const color = Theme.#dict[this.#isDark ? 0 : 1][themeColor];
        if (color.length > 3) {
            opacity += String(opacity);
        }

        return '#' + color + opacity;
    }
}
