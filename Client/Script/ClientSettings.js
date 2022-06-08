import { ConsoleLog, Log } from '../../Shared/ConsoleLog.js';
import ButtonCreator from './ButtonCreator.js';
import { $, $$, buildNode, appendChildren, jsonRequest, errorMessage, clearEle } from './Common.js';

import Overlay from './inc/Overlay.js';
import Tooltip from './inc/Tooltip.js';

import { PlexUI } from './PlexUI.js';
import ServerPausedOverlay from './ServerPausedOverlay.js';
import ThemeColors from './ThemeColors.js';

/**
 * Base class for implementing a client-side setting.
 */
class SettingBase {
    /** Static value that tells the settings manager whether settings
     * should be saved after initialization because a settings we expected
     * to find wasn't present and we should save the default configuration. */
    static needsSave = false;

    /** The localStorage key to use for this setting. */
    settingsKey = '';

    /**
     * Constructs a base setting with the given string key.
     * @param {string} settingsKey The unique key to use when saving settings to localStorage. */
    constructor(settingsKey) {
        if (!settingsKey) {
            Log.error(`'settingsKey' not set! This setting won't be saved properly.`);
        }

        this.settingsKey = settingsKey;
    }

    /**
     * Retrieve the given `key` from `data`, or `defaultValue` if it doesn't exist.
     * @param {object} data
     * @param {string} key
     * @param {*} defaultValue */
    fieldOrDefault(data, key, defaultValue) {
        if (!data.hasOwnProperty(key)) {
            Log.verbose(data, `Client settings: Didn't find '${key}', defaulting to '${defaultValue}'`);
            SettingBase.needsSave = true;
            return defaultValue;
        }

        return data[key];
    }

    /**
     * Serializes this setting. Every class that derives from
     * this class must have their own overriding implementation. */
    serialize(_) {
        Log.error(`This class didn't implement 'serialize'! Setting won't be saved.`);
        return;
    }
}

/** Helper class that holds theme-related settings. */
class ThemeSetting extends SettingBase {
    /** Whether the user is in dark mode. */
    dark;

    /** Whether the user set the theme.
     * If `false`, the theme is based on the browser theme. */
    userSet;

    /**
     * @param {boolean} dark Whether dark theme is set.
     * @param {boolean} userSet Whether the current theme was set by the user. */
    constructor(settings) {
        super('theme');
        let themeData = this.fieldOrDefault(settings, this.settingsKey, {});
        this.dark = this.fieldOrDefault(themeData, 'dark', false);
        this.userSet = this.fieldOrDefault(themeData, 'userSet', false);
    }

    /**
     * Add this setting to the given setting object in preparation for serialization.
     * @param {{string : any}} object The settings object to attach ourselves to. */
    serialize(object) {
        object[this.settingsKey] = {
            dark : this.dark,
            userSet : this.userSet
        };
    }
}

/** Generic implementation for a feature that can be blocked by a server setting. */
class BlockableSetting extends SettingBase {
    /** Whether this setting is enabled by the user */
    #enabled = false;

    /** Whether the correlating server setting is disabled, therefore
     * blocking it client-side regardless of the user's preference. */
    #blocked = false;

    /** Enable/disable this feature. No-op of the setting is blocked by the server. */
    enable(enabled) { if (!this.#blocked) { this.#enabled = enabled; } }

    /** @returns Whether this feature is currently enabled */
    enabled() { return this.#enabled && !this.#blocked; }

    /** @returns Whether this feature would be enabled if the server wasn't blocking it. */
    enabledIgnoringBlock() { return this.#enabled; }

    /** @returns Whether the setting is disabled because the corresponding server setting is disabled. */
    blocked() { return this.#blocked; }

    /** Block this setting because the corresponding server setting is disabled. */
    block() { this.#blocked = true; }

    /**
     * Constructs a new BlockableSetting.
     * @param {string} settingsKey The unique key to use when saving settings to localStorage.
     * @param {object} settings The existing settings found in localStorage
     * @param {*} defaultValue Whether this setting is enabled by default, in case we don't find it in localStorage.
     * @param {boolean} [customData=false] Whether this BlockableSetting has more data than just enabled/disabled. If `true`,
     * defer parsing the settings to the owning class with the expectation that they will call `enable` as appropriate.
     */
    constructor(settingsKey, settings, defaultValue, customData=false) {
        super(settingsKey);
        if (!customData) {
            this.#enabled = this.fieldOrDefault(settings, settingsKey, defaultValue);
        }
    }

    /**
     * Add this setting to the given setting object in preparation for serialization.
     * @param {{string : any}} object The settings object to attach ourselves to. */
    serialize(object) {
        // When serializing, we don't care if the server blocked us, we want the user's last choice.
        object[this.settingsKey] = this.#enabled;
    }
}

/** Setting for allowing the display of preview thumbnails when adding/editing markers.
 * Can be blocked by its corresponding server-side setting. */
class PreviewThumbnailsSetting extends BlockableSetting {
    /** Whether preview thumbnails should be collapsed by default.
     * @type {boolean} */
    collapsed;

    constructor(settings) {
        super('useThumbnails', settings, null /*defaultValue*/, true /*customData*/);
        let thumbnails = this.fieldOrDefault(settings, this.settingsKey, {});
        this.enable(this.fieldOrDefault(thumbnails, 'enabled', true));
        this.collapsed = this.fieldOrDefault(thumbnails, 'collapsed', false);
    }

    /**
     * Add this setting to the given setting object in preparation for serialization.
     * @param {{string : any}} object The settings object to attach ourselves to. */
    serialize(object) {
        object[this.settingsKey] = {
            enabled : this.enabledIgnoringBlock(),
            collapsed : this.collapsed
        };
    }
}

/** Setting for displaying marker statistics at the show/season level.
 * Can be blocked by its corresponding server-side setting. */
class ExtendedMarkerStatsSetting extends BlockableSetting {
    constructor(settings) {
        super('extendedMarkerStats', settings, true);
    }
}

/** Setting for remembering the last library the user was navigating. Helpful if
 * the user has multiple TV show libraries, but is primarily interested in a single one. */
class RememberLastSectionSetting extends SettingBase {
    /** Whether we should keep track of the last library the user was navigating.
     * @type {boolean} */
    remember;
    /** The last library section id the user was navigating, or -1 if we shouldn't remember.
     * @type {number} */
    sectionId;

    /**
     * Creates an instance of the setting that tracks the last library
     * the user looked at (and whether we should use it).
     * @param {object} settings The existing settings found in localStorage */
    constructor(settings) {
        super('rememberLastSection');
        let rememberData = this.fieldOrDefault(settings, this.settingsKey, {});
        this.remember = this.fieldOrDefault(rememberData, 'remember', true);
        this.sectionId = this.fieldOrDefault(rememberData, 'sectionId', -1);
    }

    /**
     * Add this setting to the given setting object in preparation for serialization.
     * @param {{string : any}} object The settings object to attach ourselves to. */
    serialize(object) {
        object[this.settingsKey] = {
            remember: this.remember,
            sectionId : this.sectionId
        };
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
     * @type {PreviewThumbnailsSetting} */
    previewThumbnails;

    /** Whether extended marker statistics should be shown when displaying shows/seasons
     * @type {ExtendedMarkerStatsSetting} */
    extendedMarkerStats;

    /** The last section the user selected.
     * @type {RememberLastSectionSetting} */
    lastSection;

    /** Whether the backup database is enabled server-side.
     * @type {boolean} */
    backupActions = false;

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

        this.theme = new ThemeSetting(json);
        this.previewThumbnails = new PreviewThumbnailsSetting(json);
        this.extendedMarkerStats = new ExtendedMarkerStatsSetting(json);
        this.lastSection = new RememberLastSectionSetting(json);
        if (SettingBase.needsSave) {
            Log.info('Not all expected settings were in localStorage. Saving them now.');
            this.save();
            SettingBase.needsSave = false;
        } else {
            Log.verbose(json, 'Got client settings');
        }
    }

    /** Save the current settings to {@linkcode localStorage}. */
    save() {
        localStorage.setItem(ClientSettings.#settingsKey, this.#serialize());
    }

    /** Returns a stringified version of the current client settings. */
    #serialize() {
        let json = {};
        this.theme.serialize(json);
        this.previewThumbnails.serialize(json);
        this.extendedMarkerStats.serialize(json);
        this.lastSection.serialize(json);
        Log.verbose(json, 'Settings to be serialized');
        return JSON.stringify(json);
    }
}

/**
 * `ClientSettingsUI` is responsible for displaying the
 * settings dialog and saving any changes that were made.
 */
class ClientSettingsUI {
    /** The owning `SettingsManager`.
     * @type {SettingsManager} */
    #settingsManager;

    /**
     * @param {SettingsManager} settingsManager
     */
    constructor(settingsManager) {
        this.#settingsManager = settingsManager;
    }

    /**
     * Show the settings overlay.
     * Currently has three options:
     * * Dark Mode: toggles dark mode, and is linked to the main dark mode toggle
     * * Show Thumbnails: Toggles whether thumbnails are shown when editing/adding markers.
     *   Only visible if app settings have thumbnails enabled.
     * * Show extended marker information: Toggles whether we show marker breakdowns at the
     *   show and season level, not just at the episode level. Only visible if app settings
     *   have extended marker stats enabled.
     */
    showSettings() {
        Overlay.build({ dismissible : true, centered : false, noborder: true }, this.#optionsUI());
    }

    #optionsUI() {
        let options = [];
        options.push(this.#buildSettingCheckbox('Dark Mode', 'darkModeSetting', this.#settingsManager.isDarkTheme()));
        options.push(
            this.#buildSettingCheckbox(
                'Remember Selected Library',
                'rememberSection',
                this.#settingsManager.rememberLastSection(),
                'Remember the last library selected between sessions.')
        );

        if (!this.#settingsManager.thumbnailsBlockedByServer()) {
            const showThumbs = this.#buildSettingCheckbox(
                'Enable Thumbnail Previews',
                'showThumbnailsSetting',
                this.#settingsManager.useThumbnails(),
                'When editing markers, display thumbnails that<br>correspond to the current timestamp (if available)');
            options.push(showThumbs);
            let collapsed = this.#buildSettingCheckbox(
                'Collapse Thumbnails',
                'collapseThumbnailsSetting',
                this.#settingsManager.collapseThumbnails(),
                'Keep thumbnails collapsed by default, with the option to<br>expand them when adding/editing a marker.'
            );
            
            if (!this.#settingsManager.useThumbnails()) {
                this.#toggleSettingEnabled(collapsed);
            }

            options.push(collapsed);
            $$('input[type="checkbox"]', showThumbs).addEventListener('change', function() {
                this.#toggleSettingEnabled($('#collapseThumbnailsSetting').parentNode);
            }.bind(this));

        }

        if (!this.#settingsManager.extendedMarkerStatsBlocked()) {
            options.push(this.#buildSettingCheckbox(
                'Extended Marker Stats',
                'extendedStatsSetting',
                this.#settingsManager.showExtendedMarkerInfo(),
                `When browsing shows/seasons, show a breakdown<br>of how many episodes have markers.`
            ));
        }

        options.push(buildNode('hr'));

        // Log level setting. This isn't a setting that's serialized via ClientSettings,
        // instead using ConsoleLog's own storage mechanism.
        let logLevelOptions = {};
        for (const [level, value] of Object.entries(ConsoleLog.Level)) { logLevelOptions[level] = value; }
        options.push(this.#buildSettingDropdown(
            'Log Level',
            'logLevelSetting',
            logLevelOptions,
            Log.getLevel(),
            'Set the log verbosity in the browser console.'));

        const icon = (icon, text, fn) => {
            const id = text.toLowerCase() + 'Server';
            text = text + ' Server';
            return ButtonCreator.iconButton(icon, text, 'standard', fn, { id : id, class : 'serverStateButton' });
        }

        options.push(buildNode('hr'));
        let container = appendChildren(buildNode('div', { id : 'settingsContainer'}),
            icon('pause', 'Pause', this.#pauseServer.bind(this)),
            icon('restart', 'Restart', this.#restartServer.bind(this)),
            icon('cancel', 'Shutdown', this.#shutdownServer.bind(this)),
            buildNode('h3', {}, 'Settings'),
            buildNode('hr')
        );

        options.forEach(option => container.appendChild(option));
        const buildButton = (text, id, callback, style='') => buildNode(
            'input', { type : 'button', value : text, id : id, style : style },
            0,
            { click : callback }
        );

        appendChildren(container.appendChild(buildNode('div', { class : 'formInput' })),
            appendChildren(buildNode('div', { class : 'settingsButtons' }),
                buildButton('Cancel', 'cancelSettings', Overlay.dismiss),
                buildButton('Apply', 'applySettings', this.#applySettings.bind(this))
            )
        );

        return container;
    }

    /**
     * Transition to a confirmation UI when the user attempts to restart or shut down the server.
     * @param {string} message Overlay message to display
     * @param {string} confirmText Confirmation button text.
     * @param {Function} confirmCallback Callback invoked when shutdown/restart is confirmed. */
    serverStateCommon(message, confirmText, confirmCallback) {
        Log.tmi(`Transitioning to ${confirmText} confirmation`);
        let container = buildNode('div', { id : 'shutdownRestartOverlay' });
        appendChildren(container,
            buildNode('div', { id : 'serverStateMessage' }, message),
            buildNode('hr'),
            appendChildren(
                buildNode('div', { class : 'formInput' }),
                    appendChildren(buildNode('div', { class : 'settingsButtons' }),
                        buildNode('input', { type : 'button', value : 'Cancel', id : 'srCancel' }, 0, { click : this.#onServerStateCancel.bind(this) }),
                        buildNode('input', { type : 'button', value : confirmText, id : 'srConfirm' }, 0, { click : confirmCallback })))
            );

        this.#transitionOverlay(container); 
    }

    /** Transition to a confirmation UI when the user attempts to pause/suspend the server. */
    #pauseServer() {
        this.serverStateCommon(
            'Are you sure you want to pause the server?<br>' +
            'This will disconnect from the Plex database to allow you to resume Plex. When you want to continue ' +
            'editing markers, shut down Plex again and Resume.',
            'Pause',
            this.#onPauseConfirm.bind(this)
        );
    }

    /** Callback when we successfully paused the server. Shows a new static overlay
     *  that allows the user to resume the server. */
    #onPauseConfirm() {
        Log.info('Attempting to pause server.');
        const successFunc = () => {
            ServerPausedOverlay.Show();
        }

        const failureFunc = (response) => {
            Overlay.show(`Failed to pause server: ${errorMessage(response)}`, 'OK');
        }

        jsonRequest('suspend', {}, successFunc, failureFunc);
    }

    /** Transition to a confirmation UI when the user attempts to restart the server. */
    #restartServer() {
        this.serverStateCommon(
            'Are you sure you want to restart the server?',
            'Restart',
            this.#onRestartConfirm.bind(this));
    }

    /** Switch back to the settings UI if the user cancelled a restart/shutdown. */
    #onServerStateCancel() {
        Log.tmi('Shutdown/restart cancelled.');
        this.#transitionOverlay(this.#optionsUI(), { dismissible : true, centered : false, noborder: true });
    }

    /**
     * Callback when we successfully told the server to restart.
     * Transitions to a new UI that will restart the page automatically in 30 seconds,
     * with the option to restart immediately. */
    #onRestartConfirm() {
        Log.info('Attempting to restart server.');
        const successFunc = () => {
            $('#serverStateMessage').innerText = 'Server is restarting now.';
            let cancelBtn = $('#srCancel');
            const btnContainer = cancelBtn.parentElement;
            btnContainer.removeChild(cancelBtn);
            cancelBtn = buildNode('input', { type : 'button', value : 'Refreshing in 30', id : 'srCancel' });
            btnContainer.appendChild(cancelBtn);

            const refreshCountdown = () => {
                if (!cancelBtn.isConnected) {
                    return;
                }

                const nextValue = parseInt(cancelBtn.value.substring(cancelBtn.value.lastIndexOf(' ') + 1)) - 1;
                if (nextValue < 1) {
                    window.location.reload();
                    return;
                }

                cancelBtn.value = `Refreshing in ${nextValue}`;
                setTimeout(refreshCountdown, 1000);
            };

            setTimeout(refreshCountdown, 1000);

            let confirmBtn = $('#srConfirm');
            btnContainer.removeChild(confirmBtn);
            confirmBtn = buildNode('input', { type : 'button', value : 'Refresh Now', id : 'srConfirm' }, 0, { click : () => window.location.reload() });
            confirmBtn.addEventListener('click', () => window.location.reload());
            btnContainer.appendChild(confirmBtn);
        };

        const failureFunc = (response) => {
            $('#serverStateMessage').innerText = `Failed to initiate restart: ${errorMessage(response)}`;
            $('#srConfirm').value = 'Try Again.';
        };

        jsonRequest('restart', {}, successFunc, failureFunc);
    }

    /** Transition to a confirmation UI when the user attempts to shut down the server. */
    #shutdownServer() {
        this.serverStateCommon(
            'Are you sure you want to shut down the server?',
            'Shutdown',
            this.#onShutdownConfirm.bind(this));
    }

    /**
     * Callback when we successfully told the server to shut down.
     * Removes buttons and keeps the undismissible overlay up, since we can't do anything anymore.*/
    #onShutdownConfirm() {
        Log.info('Attempting to shut down server.');
        const successFunc = () => {
            $('#serverStateMessage').innerText = 'Server is shutting down now.';
            const btnHolder = $('#srCancel').parentElement;
            clearEle(btnHolder);
        };

        const failureFunc = (response) => {
            $('#serverStateMessage').innerText = `Failed to shut down server: ${errorMessage(response)}`;
            $('#srConfirm').value = 'Try Again.';
        };

        jsonRequest('shutdown', {}, successFunc, failureFunc);
    }

    /**
     * Dismisses the current overlay and brings in a new one.
     * @param {HTMLElement} newOverlayContainer The new overlay to display.
     * @param {*} [options={}] The new overlay's options, if any. */
    #transitionOverlay(newOverlayContainer, options={}) {
        Overlay.dismiss();
        setTimeout(() => Overlay.build(options, newOverlayContainer), 250);
    }

    /** Enables or disabled a dialog setting
     * @param {HTMLElement} element The .formInput div that encapsulates a setting in the dialog. */
    #toggleSettingEnabled(element) {
        const check = $$('input[type="checkbox"]', element);
        const currentlyDisabled = element.classList.contains('disabledSetting');
        if (currentlyDisabled) {
            element.classList.remove('disabledSetting');
            check.removeAttribute('disabled');
        } else {
            element.classList.add('disabledSetting');
            check.setAttribute('disabled', '1');
        }
    }

    /**
     * Helper method that builds a label+checkbox combo for use in the settings dialog.
     * @param {string} label The string label for the setting.
     * @param {string} name The HTML name for the setting.
     * @param {boolean} checked Whether the checkbox should initially be checked.
     * @param {string} [tooltip=''] Hover tooltip, if any.
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

    /**
     * Build a dropdown setting.
     * @param {string} title The name of the setting.
     * @param {string} name The internal name/id to use.
     * @param {{label: string, number}} options The options to add to the dropdown.
     * @param {number} [selectedValue] The item to preselect in the dropdown.
     * @param {string} [tooltip] The tooltip text, if any.
     */
    #buildSettingDropdown(title, name, options, selectedValue=null, tooltip='') {
        let labelNode = buildNode('label', { for : name }, title + ':');
        if (tooltip) {
            Tooltip.setTooltip(labelNode, tooltip);
        }
        let select = buildNode('select', { name : name, id : name });
        for (const [label, value] of Object.entries(options)) {
            select.appendChild(buildNode('option', { value : value }, label));
        }

        if (selectedValue != null) {
            select.value = selectedValue;
        }

        return appendChildren(buildNode('div', { class : 'formInput' }), labelNode, select);
    }

    /** Apply and save settings after the user chooses to commit their changes. */
    #applySettings() {
        let shouldResetView = false;
        if ($('#darkModeSetting').checked != this.#settingsManager.isDarkTheme()) {
            $('#darkModeCheckbox').click();
        }

        const remember = $('#rememberSection').checked;
        this.#settingsManager.setRememberSection(remember);
        if (remember) {
            // setLastSection usually immediately saves out settings. No need to here though since we call it below.
            this.#settingsManager.setLastSection(parseInt($('#libraries').value), false /*save*/);
        }

        shouldResetView = this.#updateSetting('showThumbnailsSetting', 'useThumbnails', 'setThumbnails')
                       || this.#updateSetting('collapseThumbnailsSetting', 'collapseThumbnails', 'setCollapseThumbnails')
                       || this.#updateSetting('extendedStatsSetting', 'showExtendedMarkerInfo', 'setExtendedStats');

        const logLevel = parseInt($('#logLevelSetting').value);
        Log.setLevel(logLevel);

        // Always adjust the server-side log settings, and assume if the browser is in dark mode,
        // the server-side output is as well. In the future we could allow them to be separate,
        // but for now assume that only one person is interacting with the application, and keep
        // the client and server side logging levels in sync.
        jsonRequest('log_settings', { level : logLevel, dark : Log.getDarkConsole(), trace : Log.getTrace() }, () => {});

        this.#settingsManager.save();
        Overlay.dismiss();
        PlexUI.Get().onSettingsApplied(shouldResetView);
    }

    /**
     * Reads a setting nad updates it value in the settings manager, returning whether the value changed.
     * @param {string} id The HTML id of the checkbox
     * @param {string} getFn The function to invoke to get the previous value.
     * @param {string} setFn Function to invoke to set the new value.
     */
    #updateSetting(id, getFn, setFn) {
        let changed = false;
        const checkbox = document.getElementById(id);
        if (checkbox) {
            changed = checkbox.checked != this.#settingsManager[getFn]();
            this.#settingsManager[setFn](checkbox.checked);
        }

        return changed;
    }
}

/**
 * Main manager that keeps track of client-side settings.
 */
class SettingsManager {
    /**
     * The singleton settings manager for the current session.
     * @type {SettingsManager} */
    static #settingsManager;

    /** `link` elements that are used to swap between light and dark themes.
     * @type {HTMLLinkElement[]} */
    #themeStyles;

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

    /** Creates the singleton SettingsManager for this session */
    static Initialize() {
        if (SettingsManager.#settingsManager) {
            Log.error('We should only have a single SettingsManager instance!');
            return;
        }

        SettingsManager.#settingsManager = new SettingsManager();
    }

    /** @returns {SettingsManager} */
    static Get() {
        if (!SettingsManager.#settingsManager) {
            Log.error(`Accessing settings before it's been initialized'! Initializing now...`);
            SettingsManager.Initialize();
        }

        return this.#settingsManager;
    }

    constructor() {
        if (SettingsManager.#settingsManager) {
            throw new Error(`Don't create a new SettingsManager when the singleton already exists!`);
        }

        $('#settings').addEventListener('click', this.#showSettings.bind(this));
        this.#settings = new ClientSettings();
        this.#uiManager = new ClientSettingsUI(this);
        this.#themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        if (!this.isThemeUserSet()) {
            // Theme wasn't set by the user, make sure it matches the system theme if possible.
            this.#settings.theme.dark = this.#themeQuery != 'not all' && this.#themeQuery.matches;
        }

        const styleNode = (link) => {
            const href = `Client/Style/${link}${this.isDarkTheme() ? 'Dark' : 'Light'}.css`;
            return buildNode('link', { rel : 'stylesheet', type : 'text/css', href : href });
        };
        this.#themeStyles = [styleNode('theme'), styleNode('Overlay')];
        for (const style of this.#themeStyles) {
            $$('head').appendChild(style);
        }

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
    useThumbnails() { return this.#settings.previewThumbnails.enabled(); }

    /** @returns Whether thumbnails should be hidden by default, if thumbnails are enabled in the first place. */
    collapseThumbnails() { return this.useThumbnails() && this.#settings.previewThumbnails.collapsed; }

    /** Sets whether thumbnails should be hidden by default, if thumbnails are enabled in the first place. */
    setCollapseThumbnails(collapsed) { return this.#settings.previewThumbnails.collapsed = collapsed; }

    /** @returns Whether the server doesn't have preview thumbnails enabled. */
    thumbnailsBlockedByServer() { return this.#settings.previewThumbnails.blocked(); }

    /**
     * Sets whether thumbnails should be displayed when adding/editing markers.
     * This is a no-op if {@linkcode PreviewThumbnailsSetting.blocked()} is `true`.
     * @param {boolean} useThumbnails
     */
    setThumbnails(useThumbnails) {
        this.#settings.previewThumbnails.enable(useThumbnails);
    }

    /** @returns Whether extended marker statistics should be displayed when navigating shows/seasons */
    showExtendedMarkerInfo() { return this.#settings.extendedMarkerStats.enabled(); }

    /** @returns Whether the server doesn't have extended marker statistics enabled. */
    extendedMarkerStatsBlocked() { return this.#settings.extendedMarkerStats.blocked(); }

    /**
     * Sets whether extra marker information should be displayed when navigating shows/seasons.
     * This is a no-ope if {@linkcode ExtendedMarkerStatsSetting.blocked()} is `true`.
     * @param {boolean} showStats
     */
    setExtendedStats(showStats) {
        this.#settings.extendedMarkerStats.enable(showStats);
    }

    /** @returns Whether we should remember the library the user was looking at. */
    rememberLastSection() { return this.#settings.lastSection.remember; }

    /** Set whether we should remember the library the user was looking at.
     * @param {boolean} remember */
    setRememberSection(remember) {
        this.#settings.lastSection.remember = remember;
        if (!remember) {
            this.setLastSection(-1);
        }
    }

    /** @returns The library the user was last looking at, or -1 if we shouldn't remember. */
    lastSection() { return this.rememberLastSection() ? this.#settings.lastSection.sectionId : -1; }

    /** Set the last library the user looked at. If we want to remember it,
     * save settings immediately to ensure it's persisted.
     * @param {number} section
     * @param {boolean} [save=true] Whether to save settings after setting the section. */
    setLastSection(section, save=true) {
        // Do nothing if we don't want to remember.
        if (this.rememberLastSection() || section == -1) {
            this.#settings.lastSection.sectionId = section;
            Log.verbose('Selected section changed. Saving ');
            if (save) {
                this.#settings.save();
            }
        }
    }

    /** @returns Whether the server has backups enabled. */
    backupEnabled() { return this.#settings.backupActions; }

    /** Save the currently active settings to {@linkcode localStorage} */
    save() {
        this.#settings.save();
    }

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

        let cssFind = isDark ? 'Light.css' : 'Dark.css';
        let cssRep = isDark ? 'Dark.css' : 'Light.css';
        for (const style of this.#themeStyles) {
            style.href = style.href.replace(cssFind, cssRep);
        }

        this.#adjustIcons();
        return true;
    }

    /**
     * Called after the client retrieves the server config. Enables the settings
     * icon and determines whether the server is blocking various UI options.
     * @param {object} serverConfig
     */
    parseServerConfig(serverConfig) {
        // Now that we have the server config, we can show the settings icon.
        $('#settings').classList.remove('hidden');
        if (!serverConfig.useThumbnails) {
            // If thumbnails aren't available server-side, don't make them an option client-side.
            this.#settings.previewThumbnails.block();
        }

        if (!serverConfig.extendedMarkerStats) {
            // Similarly, don't allow extended marker information if the server isn't set to collect it.
            this.#settings.extendedMarkerStats.block();
        }

        this.#settings.backupActions = serverConfig.backupActions ?? false;
    }

    /** Display the settings dialog. */
    #showSettings() { this.#uiManager.showSettings(); }

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

export default SettingsManager;
