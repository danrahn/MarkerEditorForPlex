import StickySettingsBase from './StickySettingsBase.js';

import { MarkerEnum } from '/Shared/MarkerType.js';

/** @typedef {!import('./StickySettingsBase').StickySettingsBaseProtected} StickySettingsBaseProtected */

/**
 * Contains bulk delete settings that can persist depending on client persistence setting.
 */
export class BulkDeleteStickySettings extends StickySettingsBase {
    /**
     * Bulk delete settings that persist based on the user's stickiness setting. */
    static #keys = {
        /** @readonly */
        ApplyTo : 'applyTo',
    };

    /**
     * Imitates "protected" methods from the base class.
     * @type {StickySettingsBaseProtected} */
    #protected = {};

    /** Create bulk shift settings. */
    constructor() {
        const protectedMethods = {};
        super('bulkDelete', protectedMethods);
        this.#protected = protectedMethods;
    }

    /** Default values, used when the user doesn't want to persist settings, or they haven't changed the defaults. */
    defaultData() {
        const keys = BulkDeleteStickySettings.#keys;
        return {
            [keys.ApplyTo] : MarkerEnum.All,
        };
    }

    /** The type(s) of markers to delete.
     * @returns {number} */
    applyTo() { return this.#protected.get(BulkDeleteStickySettings.#keys.ApplyTo); }
    /** Set the type(s) of markers to delete.
     * @param {number} applyTo */
    setApplyTo(applyTo) { this.#protected.set(BulkDeleteStickySettings.#keys.ApplyTo, applyTo); }

    /** Custom validation for a stored key/value pair. */
    validateStorageKey(key, value) {
        const keys = BulkDeleteStickySettings.#keys;
        switch (key) {
            case keys.ApplyTo:
                return Object.values(MarkerEnum).includes(value);
            default:
                return true;
        }
    }
}
