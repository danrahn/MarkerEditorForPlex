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
     * Get the URL to the given icon with the given color category.
     * @param {string} iconName The name of the icon to retrieve
     * @param {string} category The color category for the icon.
     */
    static getIcon(iconName, category) {
        return `/i/${ThemeColors.get(category)}/${iconName}.svg`;
    }
}

export default ThemeColors;
