import { EpisodeData, MarkerData } from "../../Shared/PlexTypes.js";
import MarkerTable from "./MarkerTable.js";

/**
 * An extension of the client/server-agnostic EpisodeData to include client-specific functionality
 */
class ClientEpisodeData extends EpisodeData {
    
    /**
     * The UI representation of the markers
     * @type {MarkerTable} */
    #markerTable = null;

    /** @param {Object<string, any>} [episode] */
    constructor(episode) {
        super(episode);
    }

    /**
     * Creates the marker table for this episode.
     * @param {{[metadataId: number]: Object[]}} serializedMarkers Map of episode ids to an array of
     * serialized {@linkcode MarkerData} for the episode. */
    createMarkerTable(serializedMarkers) {
        if (this.#markerTable != null) {
            Log.warn('The marker table already exists, we shouldn\'t be creating a new one!');
        }

        const markers = [];
        for (const marker of serializedMarkers) {
            markers.push(new MarkerData().setFromJson(marker));
        }

        this.#markerTable = new MarkerTable(markers, this.metadataId);
    }

    /** @returns {HTMLElement} The HTML of the marker table. */
    markerTable() { return this.#markerTable.table(); }

    /**
     * @returns The number of markers this episode has. */
    markerCount() { return this.#markerTable.markerCount(); }

    /**
     * Check whether new start/end values for a marker are valid.
     * @param {number} markerId The id of the exiting marker we're editing, or -1 if the marker is being added.
     * @param {number} startMs The start time of the added/edited marker, in milliseconds.
     * @param {number} endMs The end time of the added/edited marker, in milliseconds. */
    checkValues(markerId, startMs, endMs) {
        return this.#markerTable.checkValues(markerId, startMs, endMs);
    }

    /**
      * Add a new marker to this episode.
      * @param {MarkerData} newMarker The marker to add.
      * @param {HTMLElement} oldRow The temporary row used to create the marker. */
    addMarker(newMarker, oldRow) {
        this.#markerTable.addMarker(newMarker, oldRow);
    }

    /**
      * Edits the given marker for this episode.
      * @param {MarkerData} partialMarker The marker that has been edited.
      * Not a "real" marker, but a partial representation of one that has
      * all the fields required to successfully edit the real marker it represents. */
    editMarker(partialMarker) {
        this.#markerTable.editMarker(partialMarker);
    }

    /**
     * Deletes a marker for this episode and updates the HTML marker table accordingly.
     * @param {MarkerData} deletedMarker The marker to delete. This is _not_ the same
     * marker that's in {@linkcode this.markers}, but a standalone copy.
     * @param {HTMLElement} deletedRow The HTML row for the deleted marker. */
    deleteMarker(deletedMarker, deletedRow) {
        this.#markerTable.deleteMarker(deletedMarker, deletedRow);
    }
 
    /**
     * Removes the temporary add row after the operation was cancelled.
     * @param {HTMLElement} markerRow The temporary row to remove. */
    cancelMarkerAdd(markerRow) {
        this.#markerTable.removeTemporaryMarkerRow(markerRow);
    }
}

export default ClientEpisodeData;
