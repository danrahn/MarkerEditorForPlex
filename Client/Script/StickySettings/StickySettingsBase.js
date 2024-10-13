import { ContextualLog } from '/Shared/ConsoleLog.js';

import { CustomEvents } from '../CustomEvents.js';
import { StickySettingsType } from './StickySettingsTypes.js';

const Log = ContextualLog.Create('StickySettings');

/**
 * The protected fields of ConfigBase that are available to derived classes, but not available externally.
 * I should really just convert everything to TS if I want better 'protected' support.
 * @typedef {{get : (key: string) => any, set : (key: string, value: any) => void }} StickySettingsBaseProtected */

/**
 * Base class for managing "sticky" settings, i.e. client settings that might persist for the session, or
 * across all sessions, depending on the client's "stickiness" setting.
 */
export class StickySettingsBase {
    /** Prefix used for local storage keys when the user wants to persist settings across sessions. */
    static #storagePrefix = 'markerEditor_sticky_';

    /**
     * Dictionary of currently registered sticky settings, containing the default values to use when
     * a new sticky settings instance is created..
     * @type {{ [key: string]: { instance: StickySettingsBase, settings: Object } }} */
    static #sessionSettings = {};

    /**
     * The current stickiness. */
    static #currentStickiness = StickySettingsType.None;

    /** One-time setup to initialize client settings callback. */
    static Setup() {
        window.addEventListener(CustomEvents.StickySettingsChanged, StickySettingsBase.onStickyTypeChange);
    }

    /**
     * Callback invoked when client setting stickiness changes.
     * @param {CustomEvent} event */
    static onStickyTypeChange(event) {
        StickySettingsBase.#currentStickiness = event.detail;
        switch (event.detail) {
            case StickySettingsType.None: // Reset everything to default
                StickySettingsBase.#resetCurrentToDefault();
                // __fallthrough
            case StickySettingsType.Session: // Wipe out any localStorage, but keep any current values.
                StickySettingsBase.#resetLocalStorage();
                break;
            case StickySettingsType.Always: // Save out any current values to localStorage
                StickySettingsBase.#copyCurrentToLocalStorage();
                break;
            default:
                Log.error(`Unknown StickySettingsType ${event.detail}.`);
                this.#currentStickiness = StickySettingsType.None;
                break;
        }
    }

    /**
     * When the user decides not to persist settings, clear out all current values and restore to defaults.
     * Makes the incorrect assumption that stickiness cannot change in the middle of an operation affected by stickiness. */
    static #resetCurrentToDefault() {
        for (const [key, setting] of Object.entries(StickySettingsBase.#sessionSettings)) {
            if (!setting.instance) {
                continue;
            }

            StickySettingsBase.#sessionSettings[key].settings = setting.instance.defaultData();
        }
    }

    /**
     * When the user no longer wants to persist client settings across sessions, clear out any
     * currently stored local settings. */
    static #resetLocalStorage() {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith(StickySettingsBase.#storagePrefix)) {
                localStorage.removeItem(key);
            }
        }
    }

    /**
     * When the user now wants to persist client settings across sessions, copy all current
     * settings to local storage. */
    static #copyCurrentToLocalStorage() {
        for (const [key, setting] of Object.entries(StickySettingsBase.#sessionSettings)) {
            localStorage.setItem(StickySettingsBase.#storageKey(key), JSON.stringify(setting.settings));
        }
    }

    /** Builds the localStorage key for the specified base key. */
    static #storageKey(key) { return `${StickySettingsBase.#storagePrefix}${key}`; }

    /** The unique key for this group of sticky settings. */
    #key = '';

    /** Current settings for this specific instance. */
    #data = {};

    /**
     * Create a new sticky settings instance with default values depending on the current stickiness settings.
     * @param {string} key The unique key for this group of sticky settings.
     * @param {StickySettingsBaseProtected} protectedFields Out parameter - contains private members and methods to share with the
     *                           derived class that called us, making them "protected". More complicated than it needs to be. */
    constructor(key, protectedFields) {
        protectedFields.get = this.#get.bind(this);
        protectedFields.set = this.#set.bind(this);
        this.#key = key;
        StickySettingsBase.#sessionSettings[key] ??= {};
        StickySettingsBase.#sessionSettings[key].instance = this;
        switch (StickySettingsBase.#currentStickiness) {
            case StickySettingsType.None:
                StickySettingsBase.#sessionSettings[key].settings = this.defaultData();
                break;
            case StickySettingsType.Session:
                StickySettingsBase.#sessionSettings[key].settings = this.#getSessionSettings();
                break;
            case StickySettingsType.Always:
                StickySettingsBase.#sessionSettings[key].settings = this.#getLocalStorage();
                break;
        }

        this.#data = StickySettingsBase.#sessionSettings[key].settings;
    }

    /** The default settings for this group of sticky settings, regardless of current stickiness. */
    defaultData() { Log.error('defaultData() must be overridden!'); return {}; }

    /**
     * Retrieve a setting specified by `key`.
     * Should only be called by classes that extend StickySettingsBase.
     * @param {string} key */
    #get(key) {
        return this.#data[key];
    }

    /**
     * Sets a setting to the given value.
     * Should only be called by classes that extend StickySettingsBase.
     * @param {string} key
     * @param {any} value */
    #set(key, value) {
        // Setting to the same value, short-circuit.
        if (value === this.#data[key]) {
            return;
        }

        this.#data[key] = value;
        const stickiness = StickySettingsBase.#currentStickiness;
        if (stickiness === StickySettingsType.None) {
            return; // Nothing else to do, _registeredSettings doesn't need new data, since it always uses the default.
        }

        // Set the new baseline data
        StickySettingsBase.#sessionSettings[this.#key].settings[key] = value;

        // Re-save it to localStorage if needed
        if (stickiness === StickySettingsType.Always) {
            this.#saveSettings(StickySettingsBase.#sessionSettings[this.#key].settings);
        }
    }

    /**
     * Save the given settings to localStorage using this instance's key.
     * @param {object} settings */
    #saveSettings(settings) {
        Log.assert(StickySettingsBase.#currentStickiness === StickySettingsType.Always,
            `#saveSettings() should only be called if settings are being saved across sessions.`);
        localStorage.setItem(StickySettingsBase.#storageKey(this.#key), JSON.stringify(settings));
    }

    /**
     * Retrieve the current sessions settings, or the default settings if no session settings exist yet.
     * @returns {object} */
    #getSessionSettings() {
        StickySettingsBase.#sessionSettings[this.#key].settings ??= this.defaultData();
        return StickySettingsBase.#sessionSettings[this.#key].settings;
    }

    /**
     * Retrieves the local storage settings, or the default settings if local settings don't exist, or are invalid.
     * @returns {object} */
    #getLocalStorage() {
        const defaultData = this.defaultData();
        let storedData = localStorage.getItem(StickySettingsBase.#storageKey(this.#key));
        if (!storedData) {
            Log.verbose(`No stored settings for ${this.#key}, using default settings.`);
            this.#saveSettings(defaultData);
            return defaultData;
        }

        try {
            storedData = JSON.parse(storedData);
        } catch (ex) {
            Log.warn(`Invalid JSON for ${this.#key} sticky settings, setting to default.`);
            this.#saveSettings(defaultData);
            return defaultData;
        }

        let needsResave = false;
        for (const [key, value] of Object.entries(defaultData)) {
            if (!Object.prototype.hasOwnProperty.call(storedData, key)) {
                Log.warn(`Stored sticky settings for ${this.#key} does not contain "${key}", setting to default.`);
                storedData[key] = defaultData[key];
                needsResave = true;
                continue;
            }

            if ((typeof storedData[key]) !== (typeof value)) {
                Log.warn(`Stored sticky setting for ${this.#key}'s "${key}" is of the wrong type ` +
                    `(${typeof storedData[key]}, expected ${typeof value}), setting to default.`);
                storedData[key] = defaultData[key];
                needsResave = true;
                continue;
            }

            if (!this.validateStorageKey(key, value)) {
                Log.warn(`Custom validation for ${this.#key}'s "${key}" failed. Setting to default.`);
                storedData[key] = defaultData[key];
                needsResave = true;
                continue;
            }
        }

        if (needsResave) {
            this.#saveSettings(storedData);
        }

        Log.verbose(storedData, `Got cross-session sticky settings for ${this.#key}`);

        return storedData;
    }

    /**
     * Overridable extra validation to perform for a given key/value settings pair.
     * @param {string} _key
     * @param {any} _value
     * @returns {boolean} */
    validateStorageKey(_key, _value) { return true; }
}
