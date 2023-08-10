
import { $, $$, appendChildren, buildNode, clearEle, errorResponseOverlay, ServerCommand } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import Overlay from './inc/Overlay.js';

import { EpisodeResultRow, MovieResultRow } from './ResultRow.js';
import { MarkerEdit, ThumbnailMarkerEdit } from './MarkerEdit.js';
import ButtonCreator from './ButtonCreator.js';
import { ClientSettings } from './ClientSettings.js';
import { MarkerData } from '../../Shared/PlexTypes.js';
import { MarkerType } from '../../Shared/MarkerType.js';
import TableElements from './TableElements.js';


const Log = new ContextualLog('MarkerTableRow');

/** @typedef {!import('./ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('./ResultRow').BaseItemResultRow} BaseItemResultRow */

class MarkerRow {
    /**
     * The raw HTML of this marker row.
     * @type {HTMLElement} */
    html;

    /**
     * The media item row that owns this marker row.
     * @type {BaseItemResultRow} */
    #parentRow;

    /**
     * The editor in charge of handling the UI and eventing related to marker edits.
     * @type {MarkerEdit} */
    #editor;

    /**
     * Create a new base MarkerRow. This should not be instantiated on its own, only through its derived classes.
     * @param {BaseItemResultRow} parent The media item that owns this marker.
     * @param {boolean} isMovie Whether this marker is for a movie. */
    constructor(parent) {
        this.#parentRow = parent;
        const useThumbs = ClientSettings.useThumbnails();
        let hasThumbs = false;
        if (useThumbs) {
            if (parent instanceof MovieResultRow) {
                hasThumbs = parent.movie().hasThumbnails;
            } else {
                if (!(parent instanceof EpisodeResultRow)) {
                    Log.warn(`Attempting to create a marker row for something that's not a movie or episode. That's not right!`);
                    hasThumbs = false;
                } else {
                    hasThumbs = parent.episode().hasThumbnails;
                }
            }
        }

        if (hasThumbs) {
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
    parent() { return this.#parentRow; }

    /**
     * The marker table this row belongs to can be cached across searches, but the
     * result row will be different, so we have to update the parent.
     * @param {BaseItemResultRow} parentRow */
    setParent(parentRow) { this.#parentRow = parentRow; }

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

    /**
     * @param {MarkerData} marker The marker to base this row off of.
     * @param {BaseItemResultRow} parent The parent media item that owns this marker. */
    constructor(marker, parent) {
        super(parent);
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
        const tr = buildNode('tr');

        const td = (data, properties={}) => buildNode('td', properties, data);

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

        const data = [
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
        const container = buildNode('div', { class : 'overlayDiv' });
        const header = buildNode('h2', {}, 'Are you sure?');
        const subtext = buildNode('div', {}, 'Are you sure you want to permanently delete this marker?');

        const okayAttr = { id : 'overlayDeleteMarker', class : 'overlayButton confirmDelete', markerId : this.#markerData.id };
        const okayButton = ButtonCreator.textButton('Delete', this.#onMarkerDelete.bind(this), okayAttr);

        const cancelAttr = { id : 'deleteMarkerCancel', class : 'overlayButton' };
        const cancelButton = ButtonCreator.textButton('Cancel', this.#dismissAndFocus.bind(this, true /*forCancel*/), cancelAttr);

        const outerButtonContainer = buildNode('div', { class : 'formInput', style : 'text-align: center' });
        const buttonContainer = buildNode('div', { style : 'float: right; overflow: auto; width: 100%; margin: auto' });
        outerButtonContainer.appendChild(appendChildren(buttonContainer, okayButton, cancelButton));
        appendChildren(container, header, subtext, outerButtonContainer);
        Overlay.build({ dismissible : true, centered : false, setup : { fn : () => $('#deleteMarkerCancel').focus() } }, container);
    }

    /** Makes a request to delete a marker, removing it from the marker table on success. */
    async #onMarkerDelete() {
        const thisButton = $('#overlayDeleteMarker');
        if (thisButton) {
            thisButton.value = 'Deleting...';
        }

        try {
            const rawMarkerData = await ServerCommand.delete(this.markerId());
            this.#dismissAndFocus(false /*forCancel*/);
            const deletedMarker = new MarkerData().setFromJson(rawMarkerData);
            /** @type {MediaItemWithMarkerTable} */
            const mediaItem = this.parent().mediaItem();
            mediaItem.markerTable().deleteMarker(deletedMarker, this.row());
        } catch (err) {
            errorResponseOverlay('Failed to delete marker.', err);
        }
    }

    /**
     * Dismisses the delete marker overlay, setting focus back to the right location.
     * If the delete was successful, focus on the parent episode/movie row. If it was
     * canceled, focus back on the delete button.
     * @param {Event} _e
     * @param {boolean} forCancel Whether the marker delete was canceled. */
    #dismissAndFocus(_e, forCancel) {
        Overlay.dismiss();
        if (forCancel) {
            // TODO: Not this. Find a way to hook into Overlay.setFocusBackElement, or keep
            //       a reference to the delete button so we don't rely on alt text.
            $$('[alt="Delete Marker"]', this.html)?.parentElement.focus();
        } else {
            $$('.tabbableRow', this.parent().html())?.focus();
        }
    }
}

/**
 * Represents a marker that does not exist yet, (i.e. being added by the user). */
class NewMarkerRow extends MarkerRow {

    /**
     * @param {BaseItemResultRow} parent The parent metadata item that owns this row. */
    constructor(parent) {
        super(parent);
        this.buildRow();
    }

    /**
     * Builds an empty row for a new marker. The creator should immediately invoke `editor().onEdit()`
     * after creating this row. */
    buildRow() {
        const td = (data, properties={}) => buildNode('td', properties, data);

        this.html = appendChildren(buildNode('tr'),
            td('-', { class : 'topAlignedPlainText' }),
            td('-'),
            td('-'),
            td('-', { class : 'centeredColumn timeColumn topAlignedPlainText' }),
            td('', { class : 'centeredColumn topAligned' }));
    }

    forAdd() { return true; }
}

export { MarkerRow, ExistingMarkerRow, NewMarkerRow };
