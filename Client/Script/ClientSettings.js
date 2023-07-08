import {
    $,
    $$,
    appendChildren,
    buildNode,
    clearEle,
    clickOnEnterCallback,
    errorMessage,
    errorResponseOverlay,
    ServerCommand } from './Common.js';
import { ConsoleLog, ContextualLog } from '../../Shared/ConsoleLog.js';

import Overlay from './inc/Overlay.js';
import Tooltip from './inc/Tooltip.js';

import ButtonCreator from './ButtonCreator.js';
import { PlexUI } from './PlexUI.js';
import ServerPausedOverlay from './ServerPausedOverlay.js';
import ThemeColors from './ThemeColors.js';

/** @typedef {!import('./inc/Overlay').OverlayOptions} OverlayOptions */

const Log = new ContextualLog('ClientSettings');

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
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
            Log.verbose(data, `Didn't find '${key}', defaulting to '${defaultValue}'`);
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
        const themeData = this.fieldOrDefault(settings, this.settingsKey, {});
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
    /** Whether preview thumbnails should loaded automatically instead of requiring 'Enter'
     * @type {boolean} */
    autoload;

    constructor(settings) {
        super('useThumbnails', settings, null /*defaultValue*/, true /*customData*/);
        const thumbnails = this.fieldOrDefault(settings, this.settingsKey, {});
        this.enable(this.fieldOrDefault(thumbnails, 'enabled', true));
        this.collapsed = this.fieldOrDefault(thumbnails, 'collapsed', false);
        this.autoload = this.fieldOrDefault(thumbnails, 'autoload', false);
    }

    /**
     * Add this setting to the given setting object in preparation for serialization.
     * @param {{string : any}} object The settings object to attach ourselves to. */
    serialize(object) {
        object[this.settingsKey] = {
            enabled : this.enabledIgnoringBlock(),
            collapsed : this.collapsed,
            autoload : this.autoload,
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
        const rememberData = this.fieldOrDefault(settings, this.settingsKey, {});
        this.remember = this.fieldOrDefault(rememberData, 'remember', true);
        this.sectionId = this.fieldOrDefault(rememberData, 'sectionId', -1);
    }

    /**
     * Add this setting to the given setting object in preparation for serialization.
     * @param {{string : any}} object The settings object to attach ourselves to. */
    serialize(object) {
        object[this.settingsKey] = {
            remember : this.remember,
            sectionId : this.sectionId
        };
    }
}

/**
 * `ClientSettings` is responsible for holding the local user settings for the editor.
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
            json = JSON.parse(localStorage.getItem(ClientSettings.#settingsKey)) || {};
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

        const toggle = $('#toggleContainer');
        toggle.addEventListener('keydown', clickOnEnterCallback);
        toggle.addEventListener('keydown', this.#toggleKeydown.bind(this));
        $('#settings').addEventListener('keydown', clickOnEnterCallback);
    }

    /** Save the current settings to {@linkcode localStorage}. */
    save() {
        localStorage.setItem(ClientSettings.#settingsKey, this.#serialize());
    }

    /** Returns a stringified version of the current client settings. */
    #serialize() {
        const json = {};
        this.theme.serialize(json);
        this.previewThumbnails.serialize(json);
        this.extendedMarkerStats.serialize(json);
        this.lastSection.serialize(json);
        Log.verbose(json, 'Settings to be serialized');
        return JSON.stringify(json);
    }

    /**
     * Overkill, but also allow arrow keys to adjust the theme, based on the current slider state.
     * @param {KeyboardEvent} e */
    #toggleKeydown(e) {
        if (e.ctrlKey || e.shiftKey || e.altKey) {
            return;
        }

        /** @type {HTMLInputElement} */
        const check = $('#darkModeCheckbox');
        switch (e.key) {
            case ' ':
                return check.click(); // Enter is handled by clickOnEnterCallback
            case 'ArrowLeft':
                if (check.checked) {
                    check.click();
                }
                break;
            case 'ArrowRight':
                if (!check.checked) {
                    check.click();
                }
                break;
        }
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
        Overlay.build(
            {   dismissible : true,
                centered : false,
                noborder : true,
                setup : this.#focusOnShow('darkModeSetting'),
                focusBack : $('#settings') },
            this.#optionsUI());
    }

    /**
     * Return a setup object to pass into Overlay.build's setup parameter to set focus to a given element.
     * @param {string} id The id of the element to set focus on when displaying an overlay. */
    #focusOnShow(id) {
        return { fn : () => $(`#${id}`).focus() };
    }

    /**
     * Retrieve the overlay UI container
     * @returns {HTMLElement} */
    #optionsUI() {
        const options = [];
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
                'When editing markers, display thumbnails that correspond to the current timestamp (if available)');
            options.push(showThumbs);
            const collapsed = this.#buildSettingCheckbox(
                'Collapse Thumbnails',
                'collapseThumbnailsSetting',
                this.#settingsManager.collapseThumbnails(),
                'Keep thumbnails collapsed by default, with the option to expand them when adding/editing a marker.'
            );
            const autoload = this.#buildSettingCheckbox(
                'Auto Load Thumbnails',
                'autoloadThumbnailSetting',
                this.#settingsManager.autoLoadThumbnails(),
                'Load thumbnails automatically after a short delay. If disabled, the user must press Enter for a thumbnail to load.'
            );

            if (!this.#settingsManager.useThumbnails()) {
                this.#toggleSettingEnabled(collapsed);
                this.#toggleSettingEnabled(autoload);
            }

            options.push(collapsed);
            options.push(autoload);
            $$('input[type="checkbox"]', showThumbs).addEventListener('change', /**@this {ClientSettingsUI}*/ function() {
                this.#toggleSettingEnabled($('#collapseThumbnailsSetting').parentNode);
                this.#toggleSettingEnabled($('#autoloadThumbnailSetting').parentNode);
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
        const logLevelOptions = {};
        for (const [level, value] of Object.entries(ConsoleLog.Level)) { if (value >= 0) { logLevelOptions[level] = value; } }

        options.push(this.#buildSettingDropdown(
            'Log Level',
            'logLevelSetting',
            logLevelOptions,
            Log.getLevel(),
            'Set the log verbosity in the browser console.'));

        const icon = (icon, text, fn) => {
            const id = text.toLowerCase() + 'Server';
            text += ' Server';
            return ButtonCreator.iconButton(icon, text, 'standard', fn, { id : id, class : 'serverStateButton' });
        };

        options.push(buildNode('hr'));
        const container = appendChildren(buildNode('div', { id : 'settingsContainer' }),
            icon('pause', 'Pause', this.#pauseServer.bind(this)),
            icon('restart', 'Restart', this.#restartServer.bind(this)),
            icon('cancel', 'Shutdown', this.#shutdownServer.bind(this)),
            buildNode('h3', {}, 'Settings'),
            buildNode('hr')
        );

        options.forEach(option => container.appendChild(option));

        appendChildren(container.appendChild(buildNode('div', { class : 'formInput' })),
            appendChildren(buildNode('div', { class : 'settingsButtons' }),
                ButtonCreator.textButton('Apply', this.#applySettings.bind(this), { class : 'confirmSetting' }),
                ButtonCreator.textButton('Cancel', Overlay.dismiss, { class : 'cancelSetting' })
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
        const container = buildNode('div', { id : 'shutdownRestartOverlay' });
        appendChildren(container,
            buildNode('div', { id : 'serverStateMessage' }, message),
            buildNode('hr'),
            appendChildren(
                buildNode('div', { class : 'formInput' }),
                appendChildren(buildNode('div', { class : 'settingsButtons' }),
                    ButtonCreator.textButton('Cancel', this.#onServerStateCancel.bind(this), { id : 'srCancel' }),
                    ButtonCreator.textButton(confirmText, confirmCallback, { id : 'srConfirm', class : 'cancelSetting' })))
        );

        this.#transitionOverlay(container);
    }

    /** Transition to a confirmation UI when the user attempts to pause/suspend the server. */
    #pauseServer() {
        this.serverStateCommon(
            'Are you sure you want to pause the server?<br><br>' +
            'This will disconnect from the Plex database to allow you to resume Plex. When you want to continue ' +
            'editing markers, shut down Plex again and Resume.',
            'Pause',
            this.#onPauseConfirm.bind(this)
        );
    }

    /** Callback when we successfully paused the server. Shows a new static overlay
     *  that allows the user to resume the server. */
    async #onPauseConfirm() {
        Log.info('Attempting to pause server.');
        try {
            await ServerCommand.suspend();
            ServerPausedOverlay.Show();
        } catch (err) {
            errorResponseOverlay('Failed to pause server.', err);
        }
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
        this.#transitionOverlay(
            this.#optionsUI(),
            { dismissible : true, centered : false, noborder : true, setup : this.#focusOnShow('darkModeSetting') });
    }

    /**
     * Callback when we successfully told the server to restart.
     * Transitions to a new UI that will restart the page automatically in 30 seconds,
     * with the option to restart immediately. */
    async #onRestartConfirm() {
        Log.info('Attempting to restart server.');
        try {
            await ServerCommand.restart();
        } catch (err) {
            $('#serverStateMessage').innerText = `Failed to initiate restart: ${errorMessage(err)}`;
            $('#srConfirm').value = 'Try Again.';
            return;
        }

        $('#serverStateMessage').innerText = 'Server is restarting now.';
        let cancelBtn = $('#srCancel');
        const btnContainer = cancelBtn.parentElement;
        btnContainer.removeChild(cancelBtn);
        cancelBtn = ButtonCreator.textButton('Refreshing in 30', () => {}, { id : 'srCancel' });
        btnContainer.appendChild(cancelBtn);

        const refreshCountdown = () => {
            if (!cancelBtn.isConnected) {
                return;
            }

            const nextValue = parseInt(cancelBtn.innerText.substring(cancelBtn.innerText.lastIndexOf(' ') + 1)) - 1;
            if (nextValue < 1) {
                window.location.reload();
                return;
            }

            cancelBtn.innerHTML = `<span>Refreshing in ${nextValue}</span>`;
            setTimeout(refreshCountdown, 1000);
        };

        setTimeout(refreshCountdown, 1000);

        let confirmBtn = $('#srConfirm');
        btnContainer.removeChild(confirmBtn);
        confirmBtn = ButtonCreator.textButton('Refresh Now', () => { window.location.reload(); }, { id : 'srConfirm' });
        btnContainer.appendChild(confirmBtn);
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
    async #onShutdownConfirm() {
        Log.info('Attempting to shut down server.');
        try {
            await ServerCommand.shutdown();
        } catch (err) {
            $('#serverStateMessage').innerText = `Failed to shut down server: ${errorMessage(err)}`;
            $('#srConfirm').value = 'Try Again.';
            return;
        }

        $('#serverStateMessage').innerText = 'Server is shutting down now.';
        const btnHolder = $('#srCancel').parentElement;
        clearEle(btnHolder);
    }

    /**
     * Dismisses the current overlay and brings in a new one.
     * @param {HTMLElement} newOverlayContainer The new overlay to display.
     * @param {OverlayOptions?} [options={}] The new overlay's options, if any. */
    #transitionOverlay(newOverlayContainer, options={}) {
        // Don't mess with focusBack. null == don't overwrite, undefined == reset.
        options.focusBack = null;
        Overlay.dismiss(true /*forReshow*/);
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
        const labelNode = buildNode('label', { for : name }, label + ': ');
        if (tooltip) {
            Tooltip.setTooltip(labelNode, tooltip);
        }

        const checkbox = buildNode('input', { type : 'checkbox', name : name, id : name });
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
        const labelNode = buildNode('label', { for : name }, title + ':');
        if (tooltip) {
            Tooltip.setTooltip(labelNode, tooltip);
        }

        const select = buildNode('select', { name : name, id : name });
        for (const [label, value] of Object.entries(options)) {
            select.appendChild(buildNode('option', { value : value }, label));
        }

        if (selectedValue != null) {
            select.value = selectedValue;
        }

        return appendChildren(buildNode('div', { class : 'formInput' }), labelNode, select);
    }

    /** Apply and save settings after the user chooses to commit their changes. */
    async #applySettings() {
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

        // autoload doesn't affect the current view, no need to reset.
        this.#updateSetting('autoloadThumbnailSetting', 'autoLoadThumbnails', 'setAutoLoadThumbnails');
        const logLevel = parseInt($('#logLevelSetting').value);
        Log.setLevel(logLevel);

        // Always adjust the server-side log settings, and assume if the browser is in dark mode,
        // the server-side output is as well. In the future we could allow them to be separate,
        // but for now assume that only one person is interacting with the application, and keep
        // the client and server side logging levels in sync.
        try {
            await ServerCommand.logSettings(logLevel, Log.getDarkConsole(), Log.getTrace());
        } catch (err) {
            // For logging
            errorMessage(err);
        }

        this.#settingsManager.save();
        Overlay.dismiss();
        PlexUI.onSettingsApplied(shouldResetView);
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
 * Singleton settings instance
 * @type {SettingsManager}
 * @readonly */ // Externally readonly
let Instance;

/**
 * Main manager that keeps track of client-side settings.
 */
class SettingsManager {

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
    static CreateInstance() {
        if (Instance) {
            Log.error('We should only have a single SettingsManager instance!');
            return;
        }

        Instance = new SettingsManager();
    }

    constructor() {
        if (Instance) {
            throw new Error(`Don't create a new SettingsManager when the singleton already exists!`);
        }

        $('#settings').addEventListener('click', this.#showSettings.bind(this));
        this.#settings = new ClientSettings();
        this.#uiManager = new ClientSettingsUI(this);
        this.#themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (!this.isThemeUserSet()) {
            // Theme wasn't set by the user, make sure it matches the system theme if possible.
            this.#settings.theme.dark = this.#themeQuery != 'not all' && this.#themeQuery.matches;
        }

        const styleNode = (link) => {
            const href = `Client/Style/${link}${this.isDarkTheme() ? 'Dark' : 'Light'}.css`;
            return buildNode('link', { rel : 'stylesheet', type : 'text/css', href : href });
        };

        this.#themeStyles = [
            styleNode('theme'),
            styleNode('Overlay'),
            styleNode('Settings'),
            styleNode('BulkActionOverlay'),
        ];

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
            $('#helpBtn').src = '/i/212121/help.svg';
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
    setCollapseThumbnails(collapsed) { this.#settings.previewThumbnails.collapsed = collapsed; }

    /** @returns Whether thumbnails should load automatically instead of requiring 'Enter'. */
    autoLoadThumbnails() { return this.useThumbnails() && this.#settings.previewThumbnails.autoload; }

    /** Sets whether thumbnails should load automatically instead of requiring 'Enter'. */
    setAutoLoadThumbnails(autoload) { this.#settings.previewThumbnails.autoload = autoload; }

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

        const cssFind = isDark ? 'Light.css' : 'Dark.css';
        const cssRep = isDark ? 'Dark.css' : 'Light.css';
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

export { SettingsManager, Instance as ClientSettings };
