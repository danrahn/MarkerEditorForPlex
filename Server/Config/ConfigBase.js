import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { Setting } from '../../Shared/ServerConfig.js';

const Log = ContextualLog.Create('EditorConfig');

/**
 * @typedef {<T>(key: string, defaultValue?: T, defaultType?: string) => Setting<T>} GetOrDefault
 */

/**
 * The protected fields of ConfigBase that are available to derived classes, but not available externally.
 * @typedef {{json : Object, getOrDefault : <T>(key: string, defaultValue?: T, defaultType?: string) => Setting<T> }} ConfigBaseProtected */

/**
 * Base class for a piece of a configuration file.
 *
 * Note that this is also acting as a bit of an experiment with "protected" members, i.e. members
 * that are only accessible to the base class and those that derive from it. To accomplish this,
 * derived classes pass in an empty object to this base class's constructor, and this class
 * populates it with the "protected" members, bound to this base instance. Derived classes then
 * set their own private #Base member to that object, and use it as a proxy to this classes
 * private members.
 *
 * It's not super clean, and probably much easier to just make the base members public, or
 * duplicate the code between PlexFeatures and MarkerEditorConfig, but where's the fun in that?
 */
export default class ConfigBase {
    /** The raw configuration file.
     * @type {object} */
    #json;

    /**
     * @param {object} json
     * @param {ConfigBaseProtected} protectedFields Out parameter - contains private members and methods
     * to share with the derived class that called us, making them "protected" */
    constructor(json, protectedFields) {
        this.#json = json || {};
        protectedFields.getOrDefault = this.#getOrDefault.bind(this);
        protectedFields.json = this.#json;
    }

    /**
     * @template T
     * @param {string} key The config property to retrieve.
     * @param {T?} [defaultValue] The default value if the property doesn't exist.
     * @param {string?} defaultType If defaultValue is a function, defaultType indicates the return value type.
     * @returns {Setting<T>} The retrieved property value.
     * @throws if `value` is not in the config and `defaultValue` is not set. */
    #getOrDefault(key, defaultValue=null, defaultType=null) {
        if (!Object.prototype.hasOwnProperty.call(this.#json, key)) {
            if (defaultValue === null) {
                throw new Error(`'${key}' not found in config file, and no default is available.`);
            }

            // Some default values are non-trivial to determine, so don't compute it
            // until we know we need it.
            if (typeof defaultValue === 'function')  {
                defaultValue = defaultValue();
            }

            Log.info(`'${key}' not found in config file. Defaulting to '${defaultValue}'.`);
            return new Setting(null, defaultValue);
        }

        // If we have a default value and its type doesn't match what's in the config, reset it to default.
        const value = this.#json[key];
        return this.#checkType(key, value, defaultValue, defaultType);
    }

    /**
     * @param {string} key
     * @param {any} value
     * @param {any} defaultValue
     * @param {string?} defaultType */
    #checkType(key, value, defaultValue, defaultType) {
        const vt = typeof value;
        let dt = typeof defaultValue;

        if (dt === 'function') {
            Log.assert(defaultType !== null, '#checkType - Cant have a null defaultType if defaultValue is a function.');
            dt = defaultType;
        }

        if (defaultValue === null || vt === dt || defaultType === 'any') {
            Log.verbose(`Setting ${key} to ${dt === 'object' ? JSON.stringify(value) : value}`);
            return new Setting(value, defaultValue);
        }

        Log.warn(`Type Mismatch: '${key}' should have a type of '${dt}', found '${vt}'. Attempting to coerce...`);

        const space = '                ';
        // Allow some simple conversions
        switch (dt) {
            case 'boolean':
                // Intentionally don't allow for things like tRuE, just the standard lower- or title-case.
                if (new Set(['true', 'True', '1', 1]).has(value)) {
                    Log.warn(`${space}Coerced to boolean value 'true'`);
                    return new Setting(true, defaultValue);
                }

                if (new Set(['false', 'False', '0', 0]).has(value)) {
                    Log.warn(`${space}Coerced to boolean value 'false'`);
                    return new Setting(false, defaultValue);
                }

                break;
            case 'string':
                switch (vt) {
                    case 'boolean':
                    case 'number':
                        Log.warn(`${space}Coerced to string value '${value.toString()}'`);
                        return new Setting(value.toString(), defaultValue);
                }
                break;
            case 'number': {
                const asNum = +value;
                if (!isNaN(asNum)) {
                    Log.warn(`${space}Coerced to number value '${asNum}'`);
                    return new Setting(asNum, defaultValue);
                }
                break;
            }
        }

        const ret = (typeof defaultValue === 'function') ? defaultValue() : defaultValue;
        Log.error(`${space}Could not coerce. Ignoring value '${value}' and setting to '${ret}'`);
        return new Setting(null, ret);
    }
}
