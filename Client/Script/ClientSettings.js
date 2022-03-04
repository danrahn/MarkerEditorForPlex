/** Helper class that holds theme-related settings. */
class ThemeSetting {

    /** Whether the user is in dark mode.
     * @type {boolean} */
    dark;

    /** Whether the user set the theme.
     * If `false`, the theme is based on the browser theme.
     * @type {boolean} */
    userSet;

    /**
     * @param {boolean} dark Whether dark theme is set.
     * @param {boolean} userSet Whether the current theme was set by the user.
     */
    constructor(dark, userSet) {
        this.dark = dark;
        this.userSet = userSet;
    }
}

/**
 * `ClientSettings` is responsible for holding the local user settings for Plex Intro Editor.
 */
class ClientSettings {
    /** Key used for getting and retrieving settings from {@linkcode localStorage} */
    static #settingsKey = 'plexIntro_settings';

    /** Settings related to the current color theme.
     * @type {ThemeSetting} */
    theme;

    /** Whether thumbnails appear when adding/editing markers.
     * @type {boolean} */
    useThumbnails = true;

    /**
     * Create an instance of ClientSettings based on the values stored in {@linkcode localStorage}.
     * Default values are used if the `localStorage` key doesn't exist. */
    constructor() {
        let json;
        try {
            json = JSON.parse(localStorage.getItem(ClientSettings.#settingsKey));
            if (!json) {
                json = {};
            }
        } catch (e) {
            json = {};
        }

        let themeData = this.#valueOrDefault(json, 'theme', { dark : false, userSet : false });
        this.theme = new ThemeSetting(
            this.#valueOrDefault(themeData, 'dark', false),
            this.#valueOrDefault(themeData, 'userSet', false));
        this.useThumbnails = this.#valueOrDefault(json, 'useThumbnails', true);
    }

    /** Save the current settings to {@linkcode localStorage}. */
    save() {
        localStorage.setItem(ClientSettings.#settingsKey, JSON.stringify(this));
    }

    /**
     * Retrieve the given `key` from `object`, or `defaultValue` if it doesn't exist.
     * @param {object} object
     * @param {string} key
     * @param {*} defaultValue
     */
    #valueOrDefault(object, key, defaultValue) {
        if (!object.hasOwnProperty(key)) {
            return defaultValue;
        }

        return object[key];
    }
}

/**
 * `ClientSettingsUI` is responsible for displaying the
 * settings dialog and saving any changes that were made.
 */
class ClientSettingsUI {
    /** The owning `ClientSettingsManager`.
     * @type {ClientSettingsManager} */
    #settingsManager;

    /**
     * @param {ClientSettingsManager} settingsManager
     */
    constructor(settingsManager) {
        this.#settingsManager = settingsManager;
    }

    /**
     * Show the settings overlay.
     * Currently only has two options:
     * * Dark Mode: toggles dark mode, and is linked to the main dark mode toggle
     * * Show Thumbnails: Toggles whether thumbnails are shown when editing/adding markers.
     *   Only visible if app settings have thumbnails enabled.
     */
    showSettings() {
        let options = [];
        options.push(this.#buildSettingCheckbox('Dark Mode', 'darkModeSetting', this.#settingsManager.isDarkTheme()));
        if (!this.#settingsManager.thumbnailsBlockedByServer()) {
            options.push(this.#buildSettingCheckbox(
                'Show Thumbnails',
                'showThumbnailsSetting',
                this.#settingsManager.useThumbnails(),
                'When editing markers, display thumbnails that<br>correspond to the current timestamp (if available)'));
        }
        options.push(buildNode('hr'));
    
        let container = appendChildren(buildNode('div', { id : 'settingsContainer'}),
            buildNode('h3', {}, 'Settings'),
            buildNode('hr')
        );
    
        options.forEach(option => container.appendChild(option));
        const buildButton = (text, id, callback, style='') => buildNode(
            'input', {
                type : 'button',
                value : text,
                id : id,
                style : style
            },
            0,
            {
                click : callback
            });
    
        appendChildren(container.appendChild(buildNode('div', { class : 'formInput' }),
            appendChildren(buildNode('div', { class : 'settingsButtons' }),
                buildButton('Cancel', 'cancelSettings', Overlay.dismiss, 'margin-right: 10px'),
                buildButton('Apply', 'applySettings', this.#applySettings.bind(this))
            )
        ));
    
        Overlay.build({ dismissible : true, centered : false, noborder: true }, container);
    }

    /**
     * Helper method that builds a label+checkbox combo for use in the settings dialog.
     * @param {*} label The string label for the setting.
     * @param {*} name The HTML name for the setting.
     * @param {*} checked Whether the checkbox should initially be checked.
     * @param {*} [tooltip=''] Hover tooltip, if any.
     * @returns A new checkbox setting for the settings dialog.
     */
    #buildSettingCheckbox(label, name, checked, tooltip='') {
        let labelNode = buildNode('label', { for : name }, label + ': ');
        if (tooltip) {
            Tooltip.setTooltip(labelNode, tooltip);
        }
    
        let checkbox = buildNode('input', { type : 'checkbox', name : name, id : name });
        if (checked) {
            checkbox.setAttribute('checked', 'checked');
        }
        return appendChildren(buildNode('div', { class : 'formInput' }),
            labelNode,
            checkbox
        );
    }

    /** Apply and save settings after the user chooses to commit their changes. */
    #applySettings() {
        if ($('#darkModeSetting').checked != this.#settingsManager.isDarkTheme()) {
            $('#darkModeCheckbox').click();
        }
    
        this.#settingsManager.setThumbnails($('#showThumbnailsSetting').checked);
        Overlay.dismiss();
    }
}

/**
 * Main manager that keeps track of client-side settings.
 */
class ClientSettingsManager {
    /** a `link` element that is used to swap between light and dark theme.
     * @type {HTMLElement} */
    #themeStyle;

    /** The current client settings.
     * @type {ClientSettings} */
    #settings;

    /** The query that will listen to browser theme changes.
     * @type {MediaQueryList} */
    #themeQuery;

    /** The theme toggle that lives outside of the settings dialog.
     * @type {HTMLInputElement} */
    #checkbox;

    /** The UI manager that handles displaying the settings dialog.
     * @type {ClientSettingsUI} */
    #uiManager;

    /** Determines whether thumbnails are blocked by the server, and should not be controllable client-side.
     * @type {boolean} */
    #thumbnailsBlocked = false;

    constructor() {
        this.#settings = new ClientSettings();
        this.#uiManager = new ClientSettingsUI(this);
        this.#themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        if (!this.isThemeUserSet()) {
            // Theme wasn't set by the user, make sure it matches the system theme if possible.
            this.#settings.theme.dark = this.#themeQuery != 'not all' && this.#themeQuery.matches;
        }

        const href = `Client/Style/theme${this.isDarkTheme() ? 'Dark' : 'Light'}.css`;
        this.#themeStyle = buildNode('link', { rel : 'stylesheet', type : 'text/css', href : href });
        $$('head').appendChild(this.#themeStyle);

        this.#checkbox = $('#darkModeCheckbox');
        this.#checkbox.checked = this.isDarkTheme();
        this.#checkbox.addEventListener('change', (e) => this.toggleTheme(e.target.checked, true /*manual*/));

        ThemeColors.setDarkTheme(this.isDarkTheme());
        this.toggleTheme(this.isDarkTheme(), this.isThemeUserSet());

        // After initialization, start the system theme listener.
        this.#themeQuery.addEventListener('change', this.#onSystemThemeChanged);

        // index.html hard-codes the dark theme icon. Adjust if necessary.
        if (!this.isDarkTheme()) {
            $('#settings').src = '/i/212121/settings.svg';
        }
    }

    /** @returns Whether dark theme is currently enabled. */
    isDarkTheme() { return this.#settings.theme.dark; }

    /**
     * @returns Whether the current theme was set by the user.
     * If `false, the theme is based on the current browser theme. */
    isThemeUserSet() { return this.#settings.theme.userSet; }

    /** @returns Whether thumbnails should be displayed when adding/editing markers. */
    useThumbnails() { return this.#settings.useThumbnails; }

    /** @returns Whether the server doesn't have preview thumbnails enabled. */
    thumbnailsBlockedByServer() { return this.#thumbnailsBlocked; }

    /**
     * Sets whether thumbnails should be displayed when adding/editing markers.
     * This is a no-op if {@linkcode thumbnailsBlockedByServer} is `true`.
     * @param {boolean} useThumbnails
     */
    setThumbnails(useThumbnails) {
        useThumbnails = useThumbnails && !this.#thumbnailsBlocked;
        this.#settings.useThumbnails = useThumbnails;
        this.#settings.save();
    }

    /** Display the settings dialog. */
    showSettings() { this.#uiManager.showSettings(); }

    /**
     * Toggle light/dark theme.
     * @param {boolean} isDark Whether dark mode is enabled.
     * @param {boolean} manual Whether we're toggling due to user interaction, or due to a change in the system theme.
     * @returns {boolean} Whether we actually toggled the theme.
     */
    toggleTheme(isDark, manual) {
        if (isDark == this.isDarkTheme()) {
            return false;
        }

        if (manual) {
            this.#settings.theme.dark = isDark;
            this.#settings.theme.userSet = true;
            this.#settings.save();
        } else if (this.#settings.theme.userSet) {
            // System theme change, but the user has manually set the theme.
            return false;
        }

        if (isDark) {
            this.#themeStyle.href = 'Client/Style/themeDark.css';
        } else {
            this.#themeStyle.href = 'Client/Style/themeLight.css';
        }

        this.#adjustIcons();
        return true;
    }

    /**
     * Called after the client retrieves the server config. Enables the settings
     * icon and determines whether the server is blocking preview thumbnails.
     * @param {object} serverConfig
     */
    parseServerConfig(serverConfig) {
        // Now that we have the server config, we can show the settings icon.
        $('#settings').classList.remove('hidden');
        if (!serverConfig.useThumbnails) {
            // If thumbnails aren't available server-side, don't make them an option client-side.
            this.#settings.useThumbnails = false;
            this.#thumbnailsBlocked = true;
        }
    }

    /**
     * Callback invoked when the system browser theme changes.
     * @param {MediaQueryListEvent} e
     */
    #onSystemThemeChanged(e) {
        if (this.toggleTheme(e.matches, false /*manual*/)) {
            this.#checkbox.checked = e.matches;
        }
    }

    /** After changing the theme, make sure any theme-sensitive icons are also adjusted. */
    #adjustIcons() {
        ThemeColors.setDarkTheme(this.#settings.theme.dark);
        for (const icon of $('img[src^="/i/"]')) {
            const split = icon.src.split('/');
            icon.src = `/i/${ThemeColors.get(icon.getAttribute('theme'))}/${split[split.length - 1]}`;
        }
    }
}

// Hack for VSCode intellisense.
if (typeof __dontEverDefineThis !== 'undefined') {
    const { $, $$, buildNode, appendChildren  } = require('./Common');
    const { Overlay } = require('./inc/Overlay');
    const { ThemeColors } = require('./ThemeColors');
    module.exports = { ClientSettingsManager };
}
