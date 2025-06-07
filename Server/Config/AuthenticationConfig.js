import ConfigBase from './ConfigBase.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

/** @typedef {!import('./ConfigBase').ConfigBaseProtected} ConfigBaseProtected */
/** @typedef {!import('./ConfigBase').GetOrDefault} GetOrDefault */
/** @template T @typedef {!import('/Shared/ServerConfig').Setting<T>} Setting<T> */

/**
 * @typedef {{
 *  enabled?: boolean,
 *  sessionTimeout?: number
 * }} RawAuthConfig
 */

const Log = ContextualLog.Create('EditorConfig');

/**
 * Captures the 'authentication' portion of the configuration file.
 */
export default class AuthenticationConfig extends ConfigBase {
    /** @type {ConfigBaseProtected} */
    #Base = {};
    /** @type {Setting<boolean>} */
    enabled;
    /** @type {Setting<number>} */
    sessionTimeout;
    /** @type {Setting<boolean|string|number>} */
    trustProxy;

    constructor(json) {
        const baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Authentication not found in config, setting defaults');
        }

        this.enabled = this.#getOrDefault('enabled', false);
        this.sessionTimeout = this.#getOrDefault('sessionTimeout', 86_400);
        this.trustProxy = this.#getOrDefault('trustProxy', false, 'any');
        if (this.sessionTimeout < 300) {
            Log.warn(`Session timeout must be at least 300 seconds, found ${this.sessionTimeout}. Setting to 300.`);
            this.sessionTimeout = 300;
        }
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null, defaultType=null) {
        return this.#Base.getOrDefault(key, defaultValue, defaultType);
    }
}
