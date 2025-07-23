import { StickySettingsBase } from './StickySettingsBase.js';

import { BulkMarkerResolveType } from '/Shared/PlexTypes.js';

/** @typedef {!import('./StickySettingsBase').StickySettingsBaseProtected} StickySettingsBaseProtected */

/**
 * Contains marker copy settings that can persist depending on client persistence setting.
 */
export class CopyMarkerStickySettings extends StickySettingsBase {

    /** Copy marker settings that persist based on the user's stickiness setting. */
    static #keys = {
        /** @readonly */
        ApplyType : 'applyType',
        /** @readonly */
        MoveDontCopy : 'moveDontCopy',
    };

    /**
     * Imitates "protected" methods from the base class.
     * @type {StickySettingsBaseProtected} */
    #protected = {};

    /** Create bulk add settings. */
    constructor() {
        const protectedMethods = {};
        super('copyMarker', protectedMethods);
        this.#protected = protectedMethods;
    }

    /** Default values, used when the user doesn't want to persist settings, or they haven't changed the defaults. */
    defaultData() {
        const keys = CopyMarkerStickySettings.#keys;
        return {
            [keys.ApplyType] : BulkMarkerResolveType.Fail,
            [keys.MoveDontCopy] : false, // If true, markers will be moved instead of copied.
        };
    }

    /** The apply behavior (fail/overwrite/merge/ignore)
     * @returns {number} */
    applyType() { return this.#protected.get(CopyMarkerStickySettings.#keys.ApplyType); }
    /** Set the bulk apply behavior
     * @param {number} applyType */
    setApplyType(applyType) { this.#protected.set(CopyMarkerStickySettings.#keys.ApplyType, applyType); }

    /** Whether to move markers instead of copying them.
     * @returns {boolean} */
    moveDontCopy() { return this.#protected.get(CopyMarkerStickySettings.#keys.MoveDontCopy); }
    /** Set whether to move markers instead of copying them.
     * @param {boolean} moveDontCopy */
    setMoveDontCopy(moveDontCopy) { this.#protected.set(CopyMarkerStickySettings.#keys.MoveDontCopy, moveDontCopy); }

    /** Custom validation for a stored key/value pair. */
    validateStorageKey(key, value) {
        switch (key) {
            case CopyMarkerStickySettings.#keys.ApplyType:
                // Dry Run not available in copy.
                return value > BulkMarkerResolveType.DryRun && value <= BulkMarkerResolveType.Max;
            default:
                return true; // All other keys are handled by default validation
        }
    }
}
