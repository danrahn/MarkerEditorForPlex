import { appendChildren, buildNode, msToHms } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';
import { MarkerData } from '../../Shared/PlexTypes.js';

import Overlay from './inc/Overlay.js';

import ButtonCreator from './ButtonCreator.js';
import { ExistingMarkerRow, MarkerRow, NewMarkerRow } from './MarkerTableRow.js';
import TableElements from './TableElements.js';
import { EpisodeResultRow } from './ResultRow.js';

/**
 * The UI representation of an episode's markers. Handles adding, editing, and removing markers for a single episode.
 */
class MarkerTable {
    /**
     * The raw HTML of this table.
     * @type {HTMLElement} */
    #html;

    /**
     * The episode UI that this table is attached to.
     * @type {EpisodeResultRow} */
    #parentRow;

    /**
     * The array of existing markers for this episode.
     * @type {MarkerData[]} */
    #markers = [];

    /**
     * The array of MarkerRows for this table, including any in-progress additions.
     * @type {MarkerRow[]} */
    #rows = [];

    /**
     * @param {MarkerData[]} markers The markers to add to this table.
     * @param {EpisodeResultRow} parentRow The episode UI that this table is attached to. */
    constructor(markers, parentRow) {
        this.#parentRow = parentRow;
        this.#markers = markers;
        let container = buildNode('div', { class : 'tableHolder' });
        let table = buildNode('table', { class : 'hidden markerTable' });
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    TableElements.centeredColumn('Index'),
                    TableElements.timeColumn('Start Time'),
                    TableElements.timeColumn('End Time'),
                    TableElements.dateColumn('Date Added'),
                    TableElements.optionsColumn('Options')
                )
            )
        );

        let rows = buildNode('tbody');
        if (markers.length == 0) {
            rows.appendChild(TableElements.noMarkerRow());
        }

        for (const marker of markers) {
            const markerRow = new ExistingMarkerRow(marker);
            this.#rows.push(markerRow);
            rows.appendChild(markerRow.row());
        }

        rows.appendChild(TableElements.spanningTableRow(ButtonCreator.textButton('Add Marker', this.#onMarkerAdd.bind(this))));
        table.appendChild(rows);
        container.appendChild(table);
        this.#html = container;
    }

    /** @returns {HTMLElement} The raw HTML of the marker table. */
    table() { return this.#html; }

    /** @returns {number} The number of markers this episode has (not including in-progress additions). */
    markerCount() { return this.#markers.length; }

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
            Overlay.show(`Could not parse start and/or end times. Please make sure they are specified in milliseconds (with no separators), or hh:mm:ss.000`);
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
      * @param {MarkerData} markerData The marker to add.
      * @param {HTMLElement?} oldRow The temporary row used to create the marker, if any. */
    addMarker(markerData, oldRow) {
        //  oldRow will be null if a marker was added via purge restoration
        if (oldRow) {
            this.removeTemporaryMarkerRow(oldRow);
        }

        let tableBody = this.#tbody();
        if (this.#markers.length == 0) {
            // This is the first marker for the episode, which means we also have
            // to remove the placeholder 'No markers found' row.
            tableBody.removeChild(tableBody.firstChild);
        }

        for (let i = markerData.index; i < this.#markers.length; ++i) {
            let markerCurrent = this.#markers[i];
            ++markerCurrent.index;
            tableBody.children[i].firstChild.innerText = markerCurrent.index.toString() // Should be done by MarkerRow?
        }

        const newRow = new ExistingMarkerRow(markerData);
        this.#rows.splice(markerData.index, 0, newRow);
        this.#markers.splice(markerData.index, 0, markerData);
        tableBody.insertBefore(newRow.row(), tableBody.children[newRow.rowIndex()]);
        this.#parentRow.updateMarkerBreakdown(1 /*delta*/);
    }

    /**
      * Edits the given marker for this table.
      * @param {MarkerData} partialMarker The marker that has been edited.
      * Not a "real" marker, but a partial representation of one that has
      * all the fields required to successfully edit the real marker it represents. */
    editMarker(partialMarker, forceReset=false) {
        const newIndex = partialMarker.index;
        let oldIndex = -1;
        // First loop - find the one we edited, modify its fields, and store its old index.
        for (let marker of this.#markers) {
            if (marker.id == partialMarker.id) {
                oldIndex = marker.index;
                marker.index = newIndex;
                marker.start = partialMarker.start;
                marker.end = partialMarker.end;

                // This won't match the YYYY-MM-DD hh:mm:ssZ returned by the database, but
                // we just need a valid UTC string for client-side parsing.
                marker.modifiedDate = new Date().toUTCString();
                break;
            }
        }

        if (newIndex == oldIndex) {
            return; // Same position, no rearranging needed.
        }

        let tableBody = this.#tbody();
        tableBody.removeChild(this.#rows[oldIndex].row());
        tableBody.insertBefore(this.#rows[oldIndex].row(), tableBody.children[newIndex]);

        const lo = newIndex > oldIndex ? oldIndex : newIndex;
        const hi = newIndex > oldIndex ? newIndex : oldIndex;
        const between = x => x >= lo && x <= hi;

        // Second loop - Go through all markers and update their index as necessary.
        this.#markers.forEach((marker, index) => {
            // Update table index
            const row = tableBody.children[index];
            row.children[0].innerText = index.toString();

            // Update marker index.
            if (marker.id == partialMarker.id) {
                return; // We already handled this.
            }

            if (between(marker.index)) {
                if (newIndex > marker.index) {
                    --marker.index;
                } else {
                    ++marker.index;
                }
            }
        });

        if (forceReset) {
            this.#rows[oldIndex].reset();
        }

        this.#rows.splice(newIndex, 0, this.#rows.splice(oldIndex, 1)[0]);
        this.#markers.splice(newIndex, 0, this.#markers.splice(oldIndex, 1)[0]);
    }

    /**
     * Deletes a marker for this episode and updates the HTML marker table accordingly.
     * @param {MarkerData} deletedMarker The marker to delete. This is _not_ the same
     * marker that's in {@linkcode this.markers}, but a standalone copy.
     * @param {HTMLElement} [row=null] The HTML row for the deleted marker. */
    deleteMarker(deletedMarker, row=null) {
        let tableBody = this.#tbody();
        if (this.#markers.length == 1) {
            tableBody.insertBefore(TableElements.noMarkerRow(), tableBody.firstChild);
        } else {
            for (let index = deletedMarker.index + 1; index < this.#markers.length; ++index) {
                tableBody.children[index].firstChild.innerText = (index - 1).toString();
            }
        }

        if (!row) {
            for (const markerRow of this.#rows) {
                if (markerRow.markerId() == deletedMarker.id) {
                    row = markerRow.row();
                }
            }
        }

        if (!row) {
            Log.warn('Attempted to delete a marker without a row! Data may be incorrect');
            return;
        }

        tableBody.removeChild(row);
        this.#markers.splice(deletedMarker.index, 1);
        this.#rows.splice(deletedMarker.index, 1);
        this.#markers.forEach((marker, index) => {
            marker.index = index;
        });

        this.#parentRow.updateMarkerBreakdown(-1 /*delta*/);
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
        const addRow = new NewMarkerRow(this.#parentRow.episode().metadataId);
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
