import { appendChildren, buildNode, clearEle, msToHms } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';

import Overlay from './inc/Overlay.js';

import { ExistingMarkerRow, NewMarkerRow } from './MarkerTableRow.js';
import ButtonCreator from './ButtonCreator.js';
import MarkerBreakdown from '../../Shared/MarkerBreakdown.js';
import TableElements from './TableElements.js';

/** @typedef {!import('../../Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('./MarkerTableRow').MarkerRow} MarkerRow */
/** @typedef {!import('./ResultRow').BaseItemResultRow} BaseItemResultRow */

/**
 * The UI representation of an episode's markers. Handles adding, editing, and removing markers for a single episode.
 */
class MarkerTable {
    /**
     * The raw HTML of this table, including its container.
     * @type {HTMLElement} */
    #html;

    /**
     * The actual <table> element.
     * @type {HTMLTableElement} */
    #table;

    /**
     * The episode/movie UI that this table is attached to.
     * @type {BaseItemResultRow} */
    #parentRow;

    /**
     * The array of existing markers for this item.
     * @type {MarkerData[]} */
    #markers = [];

    /**
     * The array of MarkerRows for this table, including any in-progress additions.
     * @type {MarkerRow[]} */
    #rows = [];

    /**
     * The number of markers we expect in this table before actually populating it.
     * Only used by movies.
     * @type {number?} */
    #cachedMarkerCountKey = undefined;

    /**
     * @param {MarkerData[]} markers The markers to add to this table.
     * @param {BaseItemResultRow} parentRow The episode/movie UI that this table is attached to.
     * @param {boolean} [lazyLoad=false] Whether we expect our marker data to come in later, so don't populate the table yet.
     * @param {number} [cachedMarkerCountKey] If we're lazy loading, this captures the number of credits and intros that
     *                                        we expect the table to have. */
    constructor(markers, parentRow, lazyLoad=false, cachedMarkerCountKey=0) {
        this.#parentRow = parentRow;
        if (lazyLoad) {
            this.#cachedMarkerCountKey = cachedMarkerCountKey;
        } else {
            this.#initCore(markers);
        }
    }

    /**
     * Create the HTML table for the given markers.
     * @param {MarkerData[]} markers */
    #initCore(markers) {
        this.#markers = markers.sort((a, b) => a.start - b.start);
        const container = buildNode('div', { class : 'tableHolder' });
        const table = buildNode('table', { class : 'hidden markerTable' });
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    TableElements.centeredColumn('Type'),
                    TableElements.timeColumn('Start Time'),
                    TableElements.timeColumn('End Time'),
                    TableElements.dateColumn('Date Added'),
                    TableElements.optionsColumn('Options')
                )
            )
        );

        const rows = buildNode('tbody');
        if (markers.length == 0) {
            rows.appendChild(TableElements.noMarkerRow());
        }

        for (const marker of markers) {
            const markerRow = new ExistingMarkerRow(marker, this.#parentRow);
            this.#rows.push(markerRow);
            rows.appendChild(markerRow.row());
        }

        rows.appendChild(TableElements.spanningTableRow(ButtonCreator.textButton('Add Marker', this.#onMarkerAdd.bind(this))));
        table.appendChild(rows);
        container.appendChild(table);
        this.#html = container;
        this.#table = table;
    }

    /**
     * Sets the new parent of this table. Used for movies, where this table
     * is cached on the ClientMovieData, which can survive multiple searches,
     * but the ResultRow is different every time, so this needs to be reattached.
     * @param {BaseItemResultRow} parentRow */
    setParent(parentRow) {
        this.#parentRow = parentRow;
        for (const row of this.#rows) {
            row.setParent(parentRow);
        }
    }

    /**
     * @param {MarkerData[]} markers */
    lazyInit(markers) {
        if (this.#markers.length !== 0) {
            // Reset data
            Log.warn(`Attempting to lazy-init a marker table that already has markers!`);
            clearEle(this.#tbody());
        }

        this.#initCore(markers);
        this.#cachedMarkerCountKey = undefined;
        this.#parentRow.updateMarkerBreakdown();
    }

    /**
     * Return whether this table has real data, or just a placeholder marker count. */
    hasRealData() { return this.#cachedMarkerCountKey === undefined; }

    /** @returns {HTMLElement} The raw HTML of the marker table. */
    table() { return this.#html; }

    /** @returns {boolean} Whether the marker table is visible. */
    isVisible() { return !!this.#table && !this.#table.classList.contains('hidden'); }

    /**
     * Sets this table to be visible or hidden. No-op if the table is not initialized.
     * @param {boolean} visible */
    setVisibility(visible) {this.#table?.classList[visible ? 'remove'  : 'add']('hidden'); }

    /** @returns {MarkerData[]} */
    markers() {
        if (this.#cachedMarkerCountKey !== undefined) {
            Log.warn(`Attempting to grab MarkerTable markers before the table has been initialized!`);
            return [];
        }

        return this.#markers;
    }

    /** @returns {number} The number of markers this episode has (not including in-progress additions). */
    markerCount() {
        if (this.#cachedMarkerCountKey === undefined) {
            return this.#markers.length;
        }

        return MarkerBreakdown.markerCountFromKey(this.#cachedMarkerCountKey);
    }

    /** @returns {number} */
    markerKey() {
        if (this.#cachedMarkerCountKey === undefined) {
            // TODO: Replace base item's MarkerBreakdown with a single-key class so this doesn't have to be calculated
            //       from scratch every time.
            return this.#markers.reduce((acc, marker) => acc + MarkerBreakdown.deltaFromType(1, marker.markerType), 0);
        }

        return this.#cachedMarkerCountKey;
    }

    /**
     * Returns whether a marker the user wants to add/edit is valid.
     * Markers must:
     *  * Have a start time earlier than its end time.
     *  * Not overlap with any existing marker. The database technically supports overlapping markers (multiple versions of an episode with
     *    slightly different intro detection), but since the markers apply to the episode regardless of the specific version, there's no
     *    reason to actually allow overlapping markers.
     * @param {number} marker The id of the marker we're modifying, or -1 if it's an in-progress marker.
     * @param {number} startTime The start time of the marker, in milliseconds.
     * @param {number} endTime The end time of the marker, in milliseconds. */
    checkValues(markerId, startTime, endTime) {
        if (isNaN(startTime) || isNaN(endTime)) {
            Overlay.show(
                `Could not parse start and/or end times. ` +
                `Please make sure they are specified in milliseconds (with no separators), or hh:mm:ss.000`);
            return false;
        }

        if (startTime >= endTime) {
            Overlay.show('Start time cannot be greater than or equal to the end time.');
            return false;
        }

        for (const row of this.#rows) {
            if (row.forAdd()) {
                continue; // Ignore any rows that are not committed.
            }

            if (row.markerId() != markerId && row.endTime() > startTime && row.startTime() <= endTime) {
                const message = markerId == -1 ?
                    `Consider expanding the range of the existing marker.` :
                    `Adjust this marker's timings or delete the other marker first to avoid overlap.`;
                Overlay.show(
                    `That overlaps with an existing marker (${msToHms(row.startTime())}-${msToHms(row.endTime())}).<br>${message}`);
                return false;
            }
        }

        return true;
    }

    /**
      * Add a new marker to this table.
      * @param {MarkerData} newMarker The marker to add.
      * @param {HTMLElement?} oldRow The temporary row used to create the marker, if any. */
    addMarker(newMarker, oldRow) {
        if (this.#cachedMarkerCountKey !== undefined) {
            // Assume that addMarker calls coming in when our table isn't initialized
            // is coming from purge restores and just update the count/breakdown.
            Log.tmi(`Got an addMarker call without an initialized table, updating cache count.`);
            this.#cachedMarkerCountKey += MarkerBreakdown.deltaFromType(1, newMarker.markerType);
            this.#parentRow.updateMarkerBreakdown();
            return;
        }

        //  oldRow will be null if a marker was added via purge restoration
        if (oldRow) {
            this.removeTemporaryMarkerRow(oldRow);
        }

        const tableBody = this.#tbody();
        if (this.#markers.length == 0) {
            // This is the first marker for the episode, which means we also have
            // to remove the placeholder 'No markers found' row.
            tableBody.removeChild(tableBody.firstChild);
        }

        let newIndex = 0;
        for (const marker of this.#markers) {
            if (marker.start > newMarker.start) {
                break;
            }

            ++newIndex;
        }

        const newRow = new ExistingMarkerRow(newMarker, this.#parentRow);
        this.#rows.splice(newIndex, 0, newRow);
        this.#markers.splice(newIndex, 0, newMarker);
        tableBody.insertBefore(newRow.row(), tableBody.children[newIndex]);
        this.#parentRow.updateMarkerBreakdown();
    }

    /**
      * Edits the given marker for this table.
      * @param {MarkerData} editedMarker The marker that has been edited.
      * Not a "real" marker, but a partial representation of one that has
      * all the fields required to successfully edit the real marker it represents. */
    editMarker(editedMarker, forceReset=false) {
        const oldIndex = this.#markers.findIndex(x => x.id == editedMarker.id);
        const updatedItem = this.#markers.splice(oldIndex, 1)[0];
        updatedItem.start = editedMarker.start;
        updatedItem.end = editedMarker.end;
        updatedItem.modifiedDate = editedMarker.modifiedDate;
        updatedItem.markerType = editedMarker.markerType;
        updatedItem.isFinal = editedMarker.isFinal;

        let newIndex = 0;

        for (const marker of this.#markers) {
            if (marker.start > editedMarker.start) {
                break;
            }

            ++newIndex;
        }

        if (newIndex == oldIndex) {
            if (forceReset) {
                this.#rows[oldIndex].reset(); // Still want to reset timings even if the index is the same.
            }

            this.#markers.splice(newIndex, 0, updatedItem);
            this.#parentRow.updateMarkerBreakdown(); // This edit might update the purge status.
            return; // Same position, no rearranging needed.
        }

        const tableBody = this.#tbody();
        tableBody.removeChild(this.#rows[oldIndex].row());
        tableBody.insertBefore(this.#rows[oldIndex].row(), tableBody.children[newIndex]);

        if (forceReset) {
            this.#rows[oldIndex].reset();
        }

        this.#rows.splice(newIndex, 0, this.#rows.splice(oldIndex, 1)[0]);
        this.#markers.splice(newIndex, 0, updatedItem);
        this.#parentRow.updateMarkerBreakdown(); // This edit might update the purge status.
    }

    /**
     * Deletes a marker for this episode and updates the HTML marker table accordingly.
     * @param {MarkerData} deletedMarker The marker to delete. This is _not_ the same
     * marker that's in {@linkcode this.markers}, but a standalone copy.
     * @param {HTMLElement} [row=null] The HTML row for the deleted marker. */
    deleteMarker(deletedMarker, row=null) {
        if (this.#cachedMarkerCountKey !== undefined) {
            // Assume that deleteMarker calls coming in when our table isn't initialized
            // is coming from purge restores and just update the count/breakdown.
            Log.tmi(`Got an addMarker call without an initialized table, updating cache count.`);
            this.#cachedMarkerCountKey += MarkerBreakdown.deltaFromType(-1, deletedMarker.markerType);
            this.#parentRow.updateMarkerBreakdown();
            return;
        }

        const oldIndex = this.#markers.findIndex(x => x.id == deletedMarker.id);
        const tableBody = this.#tbody();
        if (this.#markers.length == 1) {
            tableBody.insertBefore(TableElements.noMarkerRow(), tableBody.firstChild);
        }

        if (!row) {
            for (const markerRow of this.#rows) {
                if (markerRow.markerId() == deletedMarker.id) {
                    row = markerRow.row();
                    break;
                }
            }

            if (!row) {
                Log.warn('Attempted to delete a marker without a row! Data may be incorrect');
                return;
            }
        }

        tableBody.removeChild(row);
        this.#markers.splice(oldIndex, 1);
        this.#rows.splice(oldIndex, 1);
        this.#parentRow.updateMarkerBreakdown();
    }

    /**
     * Removes the given temporary row from the table.
     * @param {HTMLElement} markerRow */
    removeTemporaryMarkerRow(markerRow) {
        let index = this.#markers.length;
        for (; index < this.#rows.length; ++index) {
            if (this.#rows[index].row() == markerRow) {
                break;
            }
        }

        if (index == this.#rows.length) {
            Log.warn('removeTemporaryMarkerRow: Unable to find marker to remove');
            return;
        }

        this.#tbody().removeChild(markerRow);
        this.#rows.splice(index, 1);
    }

    /**
     * Callback invoked when 'Add Marker' is clicked, creating a new temporary marker row. */
    #onMarkerAdd() {
        const addRow = new NewMarkerRow(this.#parentRow);
        const tbody = this.#tbody();
        tbody.insertBefore(addRow.row(), tbody.lastChild);
        this.#rows.push(addRow);
        addRow.editor().onEdit();
    }

    /**
     * Returns the <tbody> of this table.
     * @returns {HTMLElement} */
    #tbody() { return this.#html.firstChild.children[1]; }
}

export default MarkerTable;
