import { ContextualLog } from '../../Shared/ConsoleLog.js';

const Log = new ContextualLog('ThemeColors');

/** Static class of colors used for icons, which may vary depending on the current theme. */
class ThemeColors {
    static #dict = {
        0 /*dark*/ : {
            standard : 'c1c1c1',
            green : '4C4',
            red : 'C44',
            orange : 'C94',
        },
        1 /*light*/ : {
            standard : '212121',
            green : '292',
            red : 'A22',
            orange : 'A22', // Just red, looks better than orange/brown
        }
    };

    static #isDark = false;

    /**
     * Set the current theme.
     * @param {boolean} isDark Whether dark theme is enabled.
     */
    static setDarkTheme(isDark) { this.#isDark = isDark; }

    /**
     * Return the hex color for the given color category.
     * @param {string} category The color category for the button.
     * @returns {string} The hex color associated with the given color category.
     */
    static get(category) {
        return ThemeColors.#dict[this.#isDark ? 0 : 1][category];
    }

    /**
     * Return the full hex string for the given color category, with an optional
     * opacity applied.
     * @param {string} category The color category
     * @param {string} [opacity] The hex opacity (0-F, cannot be two characters)
     */
    static getHex(category, opacity='F') {
        if (!/^[0-9A-Fa-f]$/.test(opacity)) {
            Log.warn(`getHex: invalid opacity "${opacity}", defaulting to opaque`);
            opacity = 'F';
        }

        const color = ThemeColors.#dict[this.#isDark ? 0 : 1][category];
        if (color.length > 3) {
            opacity += String(opacity);
        }

        return '#' + color + opacity;
    }

    /**
     * Get the URL to the given icon with the given color category.
     * @param {string} iconName The name of the icon to retrieve
     * @param {string} category The color category for the icon.
     */
    static getIcon(iconName, category) {
        return `/i/${ThemeColors.get(category)}/${iconName}.svg`;
    }
}

export default ThemeColors;
