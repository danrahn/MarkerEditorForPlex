
import { $, $$, appendChildren, buildNode, clearEle, errorResponseOverlay, ServerCommand } from "./Common.js";
import { MarkerData, MarkerType } from "../../Shared/PlexTypes.js";

import Overlay from "./inc/Overlay.js";

import ButtonCreator from "./ButtonCreator.js";
import SettingsManager from "./ClientSettings.js";
import { MarkerEdit, ThumbnailMarkerEdit } from "./MarkerEdit.js";
import TableElements from "./TableElements.js";
import PlexClientState from "./PlexClientState.js";

class MarkerRow {
    /**
     * The raw HTML of this marker row.
     * @type {HTMLElement} */
    html;

    /**
     * The metadata id of the episode this marker belongs to.
     * @type {number} */
    #episodeId;

    /**
     * The editor in charge of handling the UI and eventing related to marker edits.
     * @type {MarkerEdit} */
    #editor;

    /**
     * Create a new base MarkerRow. This should not be instantiated on its own, only through its derived classes.
     * @param {number} episodeId The metadata id of the episode this marker belongs to. */
    constructor(episodeId) {
        this.#episodeId = episodeId;
        if (SettingsManager.Get().useThumbnails() && PlexClientState.GetState().getEpisode(this.#episodeId).hasThumbnails) {
            this.#editor = new ThumbnailMarkerEdit(this);
        } else {
            this.#editor = new MarkerEdit(this);
        }
    }

    /** Build the HTML of the table row. Overridden by derived classes. */
    buildRow() {}

    /** Return the raw HTML of this row. */
    row() { return this.html; }

    /** Return the metadata id of the episode this marker belongs to. */
    episodeId() { return this.#episodeId; }

    /** Returns the editor for this marker. */
    editor() { return this.#editor; }

    /**
     * Returns the start time for this marker. 0 if {@linkcode forAdd} is true. */
    startTime() { return 0; }

    /** Returns the end time for this marker. 0 if {@linkcode forAdd} is true. */
    endTime() { return 0; }

    /** Returns whether this is an in-progress marker addition. */
    forAdd() { return false; }

    /** Returns the marker id for this marker, if it's an edit of an existing marker. */
    markerId() { return -1; }

    /** Returns the type of this marker. */
    markerType() { return 'intro'; }

    /** Return whether this marker was originally created by Plex automatically, or by the user. */
    createdByUser() { return true; }

    /** Resets this marker row after an edit is completed (on success or failure). */
    reset() {}
}

/** Represents an existing marker in the database. */
class ExistingMarkerRow extends MarkerRow {
    /** @type {MarkerData} */
    #markerData;

    /** @param {MarkerData} marker The marker to base this row off of. */
    constructor(marker) {
        super(marker.episodeId);
        this.#markerData = marker;
        this.buildRow();
    }

    startTime() { return this.#markerData.start; }
    endTime() { return this.#markerData.end; }
    markerId() { return this.#markerData.id; }
    markerType() { return this.#markerData.markerType; }
    createdByUser() { return this.#markerData.createdByUser; }
    reset() {
        const children = this.#tableData(!!$$('.markerOptionsHolder', this.html));
        for (let i = 0; i < children.length; ++i) {
            clearEle(this.html.children[i]);
            if (typeof children[i] == 'string') {
                this.html.children[i].innerText = children[i];
            } else {
                this.html.children[i].appendChild(children[i]);
            }
        }
    }

    /**
     * Builds the marker row based on the existing marker values. */
    buildRow() {
        let tr = buildNode('tr');

        const td = (data, properties={}) => {
            return buildNode('td', properties, data);
        };

        const tableData = this.#tableData(true);
        appendChildren(tr,
            td(tableData[0], { class : 'topAlignedPlainText' }),
            td(tableData[1]),
            td(tableData[2]),
            td(tableData[3], { class : 'centeredColumn timeColumn topAlignedPlainText' }),
            td(tableData[4], { class : 'centeredColumn topAligned' }));

        this.html = tr;
    }

    /**
     * Retrieve the data fields for the table in the form of an array of strings/HTMLElements.
     * @param {boolean} includeOptions Whether the 'options' column should be included in the data.
     * This will be false if invoking an edit operation didn't need to overwrite the original options. */
    #tableData(includeOptions) {

        let data = [
            Object.keys(MarkerType).find(k => MarkerType[k] == this.#markerData.markerType),
            TableElements.timeData(this.#markerData.start),
            TableElements.timeData(this.#markerData.end),
            TableElements.friendlyDate(this.#markerData)
        ];

        if (includeOptions) {
            data.push(this.#buildOptionButtons());
        }

        return data;
    }

    /**
     * Create and return the edit/delete marker option buttons.
     * @returns {HTMLElement} */
    #buildOptionButtons() {
        return appendChildren(buildNode('div', { class : 'markerOptionsHolder' }),
            ButtonCreator.fullButton('Edit', 'edit', 'Edit Marker', 'standard', this.editor().onEdit.bind(this.editor())),
            ButtonCreator.fullButton('Delete', 'delete', 'Delete Marker', 'red', this.#confirmMarkerDelete.bind(this))
        );
    }

    /** Prompts the user before deleting a marker. */
    #confirmMarkerDelete() {
        // Build confirmation dialog
        let container = buildNode('div', { class : 'overlayDiv' });
        let header = buildNode('h2', {}, 'Are you sure?');
        let subtext = buildNode('div', {}, 'Are you sure you want to permanently delete this intro marker?');

        let okayAttr = { id : 'overlayDeleteMarker', class : 'overlayButton confirmDelete', markerId : this.#markerData.id };
        let okayButton = ButtonCreator.textButton('Delete', this.#onMarkerDelete.bind(this), okayAttr);

        let cancelAttr = { id : 'deleteMarkerCancel', class : 'overlayButton' };
        let cancelButton = ButtonCreator.textButton('Cancel', Overlay.dismiss, cancelAttr);

        let outerButtonContainer = buildNode("div", { class : "formInput", style : "text-align: center" });
        let buttonContainer = buildNode("div", { style : "float: right; overflow: auto; width: 100%; margin: auto" });
        outerButtonContainer.appendChild(appendChildren(buttonContainer, okayButton, cancelButton));
        appendChildren(container, header, subtext, outerButtonContainer);
        Overlay.build({ dismissible: true, centered: false, setup: { fn : () => $('#deleteMarkerCancel').focus() } }, container);
    }

    /** Makes a request to delete a marker, removing it from the marker table on success. */
    async #onMarkerDelete() {
        let thisButton = $('#overlayDeleteMarker');
        if (thisButton) {
            thisButton.value = 'Deleting...';
        }

        try {
            const rawMarkerData = await ServerCommand.delete(this.markerId());
            Overlay.dismiss();
            const deletedMarker = new MarkerData().setFromJson(rawMarkerData);
            PlexClientState.GetState().getEpisode(this.episodeId()).deleteMarker(deletedMarker, this.row());
        } catch (err) {
            errorResponseOverlay('Failed to delete marker.', err);
        }
    }
}

/**
 * Represents a marker that does not exist yet, (i.e. being added by the user). */
class NewMarkerRow extends MarkerRow {

    /** @param {number} episodeId The metadata id of the episode to add the marker to. */
    constructor(episodeId) {
        super(episodeId);
        this.buildRow();
    }

    /**
     * Builds an empty row for a new marker. The creator should immediately invoke `editor().onEdit()`
     * after creating this row. */
    buildRow() {
        const td = (data, properties={}) => {
            return buildNode('td', properties, data);
        };
        this.html = appendChildren(buildNode('tr'),
            td('-', { class : 'topAlignedPlainText' }),
            td('-'),
            td('-'),
            td('-', { class : 'centeredColumn timeColumn topAlignedPlainText' }),
            td('', { class : 'centeredColumn topAligned' }));
    }

    forAdd() { return true; }
}

export { MarkerRow, ExistingMarkerRow, NewMarkerRow }
