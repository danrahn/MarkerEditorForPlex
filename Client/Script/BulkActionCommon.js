import { MarkerData } from '../../Shared/PlexTypes.js';

import Animation from './inc/Animate.js';
import { $, appendChildren, buildNode } from './Common.js';
import ThemeColors from './ThemeColors.js';
import { Log } from '../../Shared/ConsoleLog.js';

/** @typedef {!import("../../Shared/PlexTypes").SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import("../../Shared/PlexTypes").SerializedMarkerData} SerializedMarkerData */


/** @typedef {{ [showId: number] : { [seasonId: number]: MarkerData[] } }} BulkMarkerResult */

/**
 * Holds common static methods shared between bulk actions.
 */
class BulkActionCommon {

    /**
     * Sorts the given marker list by season/episode/index
     * @param {SerializedMarkerData[]} markers
     * @param {{[episodeId: number]: SerializedEpisodeData}} episodeData */
    static sortMarkerList(markers, episodeData) {
        return markers.sort((a, b) => {
            /** @type {SerializedEpisodeData} */
            const aEd = episodeData[a.episodeId];
            /** @type {SerializedEpisodeData} */
            const bEd = episodeData[b.episodeId];
            if (aEd.seasonIndex != bEd.seasonIndex) { return aEd.seasonIndex - bEd.seasonIndex; }
            if (aEd.index != bEd.index) { return aEd.index - bEd.index; }
            return a.index - b.index;
        });
    }

    /**
     * Create a marker table checkbox
     * @param {boolean} checked
     * @param {number} mid Marker id
     * @param {number} eid Episode id
     * @param {*} attributes Dictionary of extra attributes to apply to the checkbox.
     * @param {(checkbox: HTMLInputElement) => void} callback
     * @param {*} thisArg */
    static checkbox(checked, mid, eid, attributes, callback, thisArg) {
        const checkboxName = `mid_check_${mid}`;
        const checkbox = buildNode('input', {
            type : 'checkbox',
            name : checkboxName,
            id : checkboxName,
            mid : mid,
            eid : eid,
        });

        if (checked) {
            checkbox.setAttribute('checked', 'checked');
        }

        checkbox.addEventListener('change', callback.bind(thisArg, checkbox));
        for (const [key, value] of Object.entries(attributes)) {
            checkbox.setAttribute(key, value);
        }

        return appendChildren(buildNode('div'),
            buildNode('label', { for : checkboxName, class : 'hidden' }, `Marker ${mid} Checkbox`),
            checkbox);
    }

    /**
     * Bulk check/uncheck all items in the given table based on the checkbox state.
     * @param {HTMLInputElement} checkbox
     * @param {string} tableName */
    static selectUnselectAll(checkbox, tableName) {
        const table = $(`#${tableName}`);
        if (!table) { return; } // How?

        $('tbody input[type=checkbox]', table).forEach(c => { c.checked = checkbox.checked; c.dispatchEvent(new Event('change')); });
    }

    /**
     * Converts a flat list of serialized markers to a hierarchical map of MarkerData.
     * @param {SerializedMarkerData[]} markers */
    static markerMapFromList(markers) {
        /** @type {BulkMarkerResult} */
        const markerMap = {};
        for (const marker of markers) {
            if (!markerMap[marker.showId]) { markerMap[marker.showId] = {}; }
            const show = markerMap[marker.showId];
            if (!show[marker.seasonId]) { show[marker.seasonId] = []; }
            show[marker.seasonId].push(new MarkerData().setFromJson(marker));
        }

        return markerMap;
    }

    /**
     * Flash the background of the given button the given theme color.
     * @param {string|HTMLElement} buttonId
     * @param {string} color
     * @param {number} [duration=500] */
    static async flashButton(buttonId, color, duration=500) {
        const button = typeof buttonId === 'string' ? $(`#${buttonId}`) : buttonId;
        if (!button) { Log.warn(`BulkActionCommon::flashButton - Didn't find button`); return; }
        Animation.queue({ backgroundColor : `#${ThemeColors.get(color)}4` }, button, duration);
        return new Promise((resolve, _) => {
            Animation.queueDelayed({ backgroundColor : 'transparent' }, button, duration, duration, true, resolve);
        });
    }
}

/** Enum of bulk actions */
const BulkActionType = {
    Shift  : 0,
    Add    : 1,
    Delete : 2,
}

export { BulkActionCommon, BulkActionType };
