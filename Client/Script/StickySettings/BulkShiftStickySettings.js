import StickySettingsBase from './StickySettingsBase.js';

import { MarkerEnum } from '/Shared/MarkerType.js';

/** @typedef {!import('./StickySettingsBase').StickySettingsBaseProtected} StickySettingsBaseProtected */

/**
 * Contains bulk shift settings that can persist depending on client persistence setting.
 */
export default class BulkShiftStickySettings extends StickySettingsBase {
    /**
     * Bulk shift settings that persist based on the user's stickiness setting. */
    static #keys = {
        /** @readonly */
        SeparateShift : 'separateShift',
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
        super('bulkShift', protectedMethods);
        this.#protected = protectedMethods;
    }

    /** Default values, used when the user doesn't want to persist settings, or they haven't changed the defaults. */
    defaultData() {
        const keys = BulkShiftStickySettings.#keys;
        return {
            [keys.SeparateShift] : false,
            [keys.ApplyTo] : MarkerEnum.All,
        };
    }

    /** Whether to shift the start and end times separately.
     * @returns {boolean} */
    separateShift() { return this.#protected.get(BulkShiftStickySettings.#keys.SeparateShift); }
    /** Set whether to shift the start and end times separately.
     * @param {boolean} separateShift */
    setSeparateShift(separateShift) { this.#protected.set(BulkShiftStickySettings.#keys.SeparateShift, separateShift); }

    /** The type(s) of markers to shift.
     * @returns {number} */
    applyTo() { return this.#protected.get(BulkShiftStickySettings.#keys.ApplyTo); }
    /** Set the type(s) of markers to shift.
     * @param {number} applyTo */
    setApplyTo(applyTo) { this.#protected.set(BulkShiftStickySettings.#keys.ApplyTo, applyTo); }

    /** Custom validation for a stored key/value pair. */
    validateStorageKey(key, value) {
        const keys = BulkShiftStickySettings.#keys;
        switch (key) {
            case keys.ApplyTo:
                return Object.values(MarkerEnum).includes(value);
            default:
                return true;
        }
    }
}
