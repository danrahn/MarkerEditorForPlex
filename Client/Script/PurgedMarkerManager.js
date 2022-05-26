import { $$, jsonRequest } from "./Common.js";
import Overlay from "./inc/Overlay.js";
import Tooltip from "./inc/Tooltip.js";
import PlexClientState from "./PlexClientState.js";

/** @typedef {!import("../../Server/MarkerBackupManager.js").MarkerAction} MarkerAction */

/**
 * Manages purged markers, i.e. markers that the user added/edited, but Plex removed for one reason
 * or another, most commonly because a new file was added to a season with modified markers.
 * TODO: Consolidate/integrate/reconcile with PurgeTable
 */
class PurgedMarkerManager {
    #plexState;

    /** Create a new manager for the given client state.
     * @param {PlexClientState} plexState
     * @param {boolean} findAllEnabled Whether the user can search for all purged markers for a given section. */
    constructor(plexState, findAllEnabled) {
        this.#plexState = plexState;
        if (findAllEnabled) {
            const button = $$('#purgedMarkers');
            $$('#purgedMarkers').addEventListener('click', this.findPurgedMarkers.bind(this));
            Tooltip.setTooltip(button, 'Search for user modified markers<br>that Plex purged from its database.');
        }
    }

    /** Find all purged markers for the current library section. */
    findPurgedMarkers() {
        const section = this.#plexState.activeSection();
        jsonRequest('all_purges', { sectionId : section }, this.#onMarkersFound.bind(this), this.#onMarkersFailed.bind(this));
    };

    /**
     * Callback invoked when we successfully queried for purged markers (regardless of whether we found any).
     * @param {MarkerAction[]} markerActions List of purged markers in the current library section. */
    #onMarkersFound(markerActions) {
        Overlay.show(`Found ${markerActions.length} purged markers in this section.`, 'OK');
    }

    /**
     * Callback invoked when we failed to search for purged markers.
     * @param {*} response Server response */
    #onMarkersFailed(response) {
        Overlay.show(`Something went wrong retrieving purged markers. Please try again later.<br><br>Server message:<br>${errorMessage(response)}`, 'OK');
    }
}

export default PurgedMarkerManager;
