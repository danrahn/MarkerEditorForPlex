import { $, $$, $append, $br, $clear, $div, $h, $hr, $plainDivHolder, $table, $tbody, $textSpan, $thead } from '../HtmlHelpers.js';
import { msToHms, toggleVisibility } from '../Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { animateOpacity, slideDown, slideUp } from '../AnimationHelpers.js';
import { ExistingMarkerRow, NewMarkerRow } from './MarkerTableRow.js';
import { Attributes } from '../DataAttributes.js';
import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { errorToast } from '../ErrorHandling.js';
import { isSmallScreen } from '../WindowResizeEventHandler.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import { TableNavigation as Nav } from './MarkerTableNavigation.js';
import { TableElements } from './TableElements.js';

/** @typedef {!import('/Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('./MarkerTableRow').MarkerRow} MarkerRow */
/** @typedef {!import('../ResultRow/BaseItemResultRow').BaseItemResultRow} BaseItemResultRow */

/**
 * @typedef {{
 *  lastSelected?: HTMLElement,
 *  ctrlKey?: boolean,
 *  left?: boolean,
 *  forceNavMatch?: boolean,
 * }} BestFocusMatchOptions
 *
 * @typedef {{
 *  select?: HTMLElement,
 *  lastResort?: HTMLElement,
 * }} BestFocusMatchBackups
 * */

const Log = ContextualLog.Create('MarkerTable');

/**
 * The UI representation of an episode's markers. Handles adding, editing, and removing markers for a single episode.
 */
export class MarkerTable {
    /**
     * The raw HTML of this table, including its container.
     * @type {HTMLElement} */
    #html;

    /**
     * The actual table element.
     * @type {HTMLTableElement} */
    #table;

    /**
     * The element that controls the visibility of the table. Used for better animations.
     * @type {HTMLDivElement} */
    #visibilityControl;

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
     * The chapters (if any) associated with the marker table's parent episode/movie.
     * @type {ChapterData[]} */
    #chapters = [];

    /**
     * The number of markers we expect in this table before actually populating it.
     * Only used by movies.
     * @type {number?} */
    #cachedMarkerCountKey = undefined;

    /** Tracks whether the marker table was created via static Create* methods or directly (which we shouldn't do) */
    static #constructGuard = false;

    /**
     * Creates a minimal MarkerTable that doesn't actually create the UI table, but has just enough
     * data to provide the right information to callers that need marker count data.
     * @param {BaseItemResultRow} parentRow The media item this table is associated with.
     * @param {number} cachedMarkerCountKey The number of credits and intros we expect this table to have. */
    static CreateLazyInitMarkerTable(parentRow, cachedMarkerCountKey) {
        MarkerTable.#constructGuard = true;
        const markerTable = new MarkerTable(parentRow);
        MarkerTable.#constructGuard = false;
        markerTable.#minimalInit(cachedMarkerCountKey);
        return markerTable;
    }

    /**
     * Creates a full MarkerTable with UI already initialized.
     * @param {MarkerData[]} markers The markers to add to this table.
     * @param {BaseItemResultRow} parentRow The media item this table is associated with.
     * @param {ChapterData[]} chapterData The chapters, if any, associated with this media item. */
    static CreateMarkerTable(markers, parentRow, chapterData=[]) {
        MarkerTable.#constructGuard = true;
        const markerTable = new MarkerTable(parentRow);
        MarkerTable.#constructGuard = false;
        markerTable.#fullInit(markers, chapterData);
        return markerTable;
    }

    /**
     * Instantiates a MarkerTable. Should only be called via the static MarkerTable.Create* methods.
     * @param {BaseItemResultRow} parentRow The episode/movie UI that this table is attached to. */
    constructor(parentRow) {
        if (!MarkerTable.#constructGuard) {
            Log.warn(`Created a MarkerTable outside of the static Create methods.`);
        }

        this.#parentRow = parentRow;
    }

    /**
     * Minimally initializes the marker table with a cached marker key count.
     * @param {number} cachedMarkerCountKey The number of credits and intros we expect this table to have. */
    #minimalInit(cachedMarkerCountKey) {
        this.#cachedMarkerCountKey = cachedMarkerCountKey;
    }

    /**
     * Fully initializes this marker table with the given marker data and chapter info.
     * @param {MarkerData[]} markers The markers to add to this table.
     * @param {ChapterData[]} [chapterData] The chapters associated with this table's media item (if any). If undefined,
     *                                      indicates that we haven't determined whether chapters are available. */
    #fullInit(markers, chapterData) {
        this.#chapters = chapterData;
        this.#initCore(markers);
    }

    /**
     * Create the HTML table for the given markers.
     * @param {MarkerData[]} markers */
    #initCore(markers) {
        this.#markers = markers.sort((a, b) => a.start - b.start);
        const container = $div({ class : 'tableHolder' });
        const table = $table({ class : 'markerTable' }, { keydown : this.#onTableKeydown.bind(this) });
        table.appendChild(
            $thead(TableElements.rawTableRow(
                TableElements.centeredColumn('Type'),
                TableElements.timeColumn('Start Time'),
                TableElements.timeColumn('End Time'),
                TableElements.dateColumn(isSmallScreen() ? 'Added' : 'Date Added'),
                TableElements.optionsColumn('Options', ClientSettings.useThumbnails() ? 3 : 2))
            )
        );

        const rows = $tbody();
        if (markers.length === 0) {
            rows.appendChild(TableElements.noMarkerRow());
        }

        for (const marker of markers) {
            const markerRow = new ExistingMarkerRow(marker, this.#parentRow, this.#chapters);
            this.#rows.push(markerRow);
            rows.appendChild(markerRow.row());
        }

        rows.appendChild(TableElements.spanningTableRow(
            ButtonCreator.textButton('Add Marker', this.#onMarkerAdd.bind(this), { [Attributes.TableNav] : 'new-marker' }),
            { class : 'markerRow' }));
        table.appendChild(rows);

        this.#visibilityControl = $div({ class : 'hidden markerTableVisibility' });

        // markerTableSpacer is a 10px empty div that is used to ensure there's a consistent margin when
        // showing/hiding the marker table. When animating the table we explicitly set the height, which can
        // result in margin-top of the table itself not being respected, leading to extra shifting as the height
        // grows large enough to fit all of the table. By setting the top margin of the table to 0 and ensuring
        // the spacer div is always visible before animating the table height, we guarantee static top positioning.
        $append(container,
            $div({ class : 'hidden markerTableSpacer' }),
            $append(this.#visibilityControl, table)
        );

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
            row.setBaseItem(parentRow);
        }
    }

    /**
     * @param {MarkerData[]} markers
     * @param {ChapterData[]} chapters */
    lazyInit(markers, chapters) {
        if (this.#markers.length !== 0) {
            // Reset data
            Log.warn(`Attempting to lazy-init a marker table that already has markers!`);
            $clear(this.#tbody());
        }

        this.#chapters = chapters;
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
    isVisible() { return !!this.#visibilityControl && !this.#visibilityControl.classList.contains('hidden'); }

    /**
     * Sets this table to be visible or hidden. No-op if the table is not initialized.
     * @param {boolean} visible
     * @param {boolean} bulk Whether we're in a bulk update. Determines whether we try to scroll the current row into view.
     * @param {boolean} animate Whether to animate the visibility change. NOTE: even if set to true,
     *                          the row won't be animated if we think it's off-screen. */
    setVisibility(visible, bulk=false, animate=true) {
        if (!this.#table) {
            // This is expected in bulk-hide cases, where we try to hide an already hidden and uninitialized table.
            Log.assert(bulk && !visible, `Attempting to show/hide a marker table that doesn't exist yet outside of a bulk operation!`);
            return Promise.resolve();
        }

        if (visible === this.isVisible()) {
            // We're already in the right state.
            return Promise.resolve();
        }

        const tableHolder = $$('.markerTableVisibility', this.#html);
        const spacer = $$('.markerTableSpacer', this.#html);
        const noAnimate = () => {
            toggleVisibility(tableHolder, visible);
            toggleVisibility(spacer, visible);
            if (!bulk) {
                this.#parentRow.scrollTableIntoView();
            }
        };

        if (!animate) {
            // The caller has already determined that we don't want to animate this row.
            // Avoid the bounds calculations and show/hide directly.
            noAnimate();
            return Promise.resolve();
        }

        const duration = 150;
        const body = document.body.getBoundingClientRect();
        const parent = this.#parentRow.html().getBoundingClientRect();
        if (parent.top > body.height || parent.y + parent.height < 0) {
            // Table is not  currently visible, don't animate.
            noAnimate();
            return Promise.resolve();
        }

        if (visible) {
            // Do a mini animation for the 10px margin, then slide down the table itself.
            spacer.classList.remove('hidden');
            return slideDown(spacer, '10px', 20, () => {
                tableHolder.classList.remove('hidden');
                slideDown(tableHolder, tableHolder.getBoundingClientRect().height + 10 + 'px', duration, () => {
                    if (!bulk) { this.#parentRow.scrollTableIntoView(); }
                });
            });
        }

        // Slide up the table, then do a mini slide up for the 10px margin
        return slideUp(tableHolder, duration, () => {
            tableHolder.classList.add('hidden');
            slideUp(spacer, 20, () => spacer.classList.add('hidden'));
        });
    }

    /** @returns {MarkerData[]} */
    markers() {
        if (this.#cachedMarkerCountKey !== undefined) {
            Log.warn(`Attempting to grab MarkerTable markers before the table has been initialized!`);
            return [];
        }

        return this.#markers;
    }

    chapters() {
        if (this.#cachedMarkerCountKey !== undefined) {
            Log.warn(`Attempting to grab MarkerTable chapters before the table has been initialized!`);
            return [];
        }

        return this.#chapters;
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
            this.#valueErrorToast(
                `Could not parse start and/or end times.`,
                `Please make sure they are specified in milliseconds (with no separators), or hh:mm:ss.000`);
            return false;
        }

        if (startTime >= endTime) {
            this.#valueErrorToast(`Marker Error`, 'Start time cannot be greater than or equal to the end time.');
            return false;
        }

        for (const row of this.#rows) {
            if (row.forAdd()) {
                continue; // Ignore any rows that are not committed.
            }

            if (row.markerId() !== markerId && row.endTime() > startTime && row.startTime() <= endTime) {
                const message = markerId === -1 ?
                    `Consider expanding the range of the existing marker.` :
                    `Adjust this marker's timings or delete the other marker first to avoid overlap.`;
                this.#valueErrorToast(
                    `Marker Overlap`,
                    $textSpan(`New marker overlaps [${msToHms(row.startTime())}-${msToHms(row.endTime())}].`, $br(), message));
                return false;
            }
        }

        return true;
    }

    /**
     * Displays an error message when a marker's bounds are invalid.
     * @param {string} title
     * @param {string|HTMLElement|Text} message */
    #valueErrorToast(title, message) {
        errorToast($plainDivHolder($h(4, title), $hr(), message), 5000);
    }

    /**
      * Add a new marker to this table.
      * @param {MarkerData} newMarker The marker to add.
      * @param {HTMLElement?} oldRow The temporary row used to create the marker, if any. */
    async addMarker(newMarker, oldRow) {
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
            await this.removeTemporaryMarkerRow(oldRow);
        }

        const tableBody = this.#tbody();
        if (this.#markers.length === 0) {
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

        const newRow = new ExistingMarkerRow(newMarker, this.#parentRow, this.#chapters);
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
        const oldIndex = this.#markers.findIndex(x => x.id === editedMarker.id);
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

        if (newIndex === oldIndex) {
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

        const oldIndex = this.#markers.findIndex(x => x.id === deletedMarker.id);
        const needsNoMarkerRow = this.#markers.length === 1;
        const tableBody = this.#tbody();

        if (!row) {
            for (const markerRow of this.#rows) {
                if (markerRow.markerId() === deletedMarker.id) {
                    row = markerRow.row();
                    break;
                }
            }

            if (!row) {
                Log.warn('Attempted to delete a marker without a row! Data may be incorrect');
                return;
            }
        }

        this.#animateRowRemoval(row, () => {
            if (needsNoMarkerRow) {
                tableBody.insertBefore(TableElements.noMarkerRow(), tableBody.firstChild);
            }
        });
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
            if (this.#rows[index].row() === markerRow) {
                break;
            }
        }

        if (index === this.#rows.length) {
            Log.warn('removeTemporaryMarkerRow: Unable to find marker to remove');
            return;
        }

        // Should we force await on this? Also, are there any possible race conditions with quick operations if we don't?
        const ret = this.#animateRowRemoval(markerRow);
        this.#rows.splice(index, 1);
        return ret;
    }

    /**
     * @param {HTMLTableRowElement} row
     * @param {() => void} callback */
    #animateRowRemoval(row, callback) {
        // First need to explicitly set tr height so it doesn't immediately shrink when we clear the element
        row.style.height = row.getBoundingClientRect().height + 'px';
        return animateOpacity(row, 1, 0, 100, () => {
            $clear(row);
            slideUp(row, 150, () => { callback?.(); this.#tbody().removeChild(row); });
        });
    }

    /**
     * Callback invoked when 'Add Marker' is clicked, creating a new temporary marker row.
     * @param {KeyboardEvent|MouseEvent} e */
    #onMarkerAdd(e) {
        const addRow = new NewMarkerRow(this.#parentRow, this.#chapters);
        const tbody = this.#tbody();
        tbody.insertBefore(addRow.row(), tbody.lastChild);
        this.#rows.push(addRow);
        addRow.editor().onEdit(e.shiftKey);
    }

    /**
     * Returns the <tbody> of this table.
     * @returns {HTMLElement} */
    #tbody() { return $$('tbody', this.#html); }

    /**
     * Retrieve the best element in this table to set focus to
     * after a navigation command.
     * @param {boolean} up Whether we're navigating up or down.
     * @param {HTMLElement?} lastFocus The last table element that had focus, if any.
     * @param {boolean} tryForceNav Only look for nav-id matches first, only falling back to nearest-neighbor if that fails.*/
    getNextFocusElement(up, lastFocus, tryForceNav=false) {
        if (!this.hasRealData()) {
            return;
        }

        const rows = $('.markerRow', this.#html);

        const nextI = i => up ? i - 1 : i + 1;
        const lastI = up ? -1 :rows.length;
        for (let navLoop = tryForceNav ? 1 : 0; navLoop >= 0; --navLoop) {
            for (let i = up ? rows.length - 1 : 0; i !== lastI; i = nextI(i)) {
                const focusable = Nav.GetBestFocusableInput(rows[i], { lastSelected : lastFocus, forceNavMatch : navLoop === 1 });
                if (focusable) {
                    return focusable;
                }
            }
        }
    }

    /**
     * @param {KeyboardEvent} e */
    #onTableKeydown(e) {
        if (!this.#keydownPrecheck(e)) {
            return;
        }

        const upDown = e.key === 'ArrowUp' || e.key === 'ArrowDown';
        const up = upDown && e.key === 'ArrowUp';
        const left = e.key === 'ArrowLeft';

        const input = Nav.GetTargetInput(e);
        if (!input) {
            return;
        }

        switch (e.key) {
            case 'ArrowUp':
            case 'ArrowDown':
                if (e.ctrlKey && e.shiftKey && e.altKey) {
                    Nav.SelectFirstLastTable(e, this.#parentRow, input, up);
                } else if ((e.ctrlKey && e.shiftKey) || e.altKey) {
                    Nav.SelectBaseItemRow(e, this.#parentRow, up);
                } else if (e.ctrlKey) {
                    Nav.SelectNextTableRow(e, this.#parentRow, input, up);
                } else if (e.shiftKey) {
                    Nav.SelectNextTable(e, this.#parentRow, input, up);
                } else {
                    Nav.SelectNextTableRow(e, this.#parentRow, input, up);
                }
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                if (!e.shiftKey) {
                    if (!Nav.ShouldSwitchInput(e, input, false /*northSouth*/, left)) {
                        return;
                    }

                    Nav.SelectNextTableRowInput(e, input, left);
                }
                break;
        }
    }

    #keydownPrecheck(e) {
        const modifierCount = e.altKey + e.shiftKey + e.ctrlKey;

        switch (e.key) {
            default:
                return false;
            case 'ArrowUp':
            case 'ArrowDown':
                return modifierCount !== 2 || !e.altKey;
            case 'ArrowLeft':
            case 'ArrowRight':
                return modifierCount < 2;
        }
    }

    /**
     * When switching between large and small window modes, tell each row
     * to update its elements accordingly. */
    onWindowResize() {
        for (const row of this.#rows) {
            row.onWindowResize();
        }
    }

    /**
     * Show/hide all static preview thumbnails in this table.
     * @param {boolean} show Whether to show or hide the preview thumbnails */
    showHidePreviewThumbnails(show) {
        /** @type {Promise<void>[]} */
        const promises = [];
        for (const row of this.#rows) {
            if (!row.editor().editing) { // TODO?
                promises.push(...row.toggleStaticPreviews(show));
            }
        }

        return promises;
    }
}
