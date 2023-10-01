import { $, $$, appendChildren, buildNode } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import Animation from './inc/Animate.js';

import { MarkerData } from '../../Shared/PlexTypes.js';
import { MarkerEnum } from '../../Shared/MarkerType.js';
import Overlay from './inc/Overlay.js';
import TableElements from './TableElements.js';
import ThemeColors from './ThemeColors.js';

/** @typedef {!import('../../Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */


/** @typedef {{ [showId: number] : { [seasonId: number]: MarkerData[] } }} BulkMarkerResult */

const Log = new ContextualLog('BulkAction');

/**
 * Base class that represents a row in a bulk action customization table.
 */
class BulkActionRow {
    /** @type {number} */
    id;
    /** @type {HTMLTableElement} */
    table;
    /** @type {boolean} */
    enabled = false;
    /** @type {boolean} */
    selected = false;
    /**
     * @type {HTMLElement} */
    row;
    /** @type {BulkActionTable} */
    parent;

    constructor(parent, id) {
        this.parent = parent;
        this.id = id;
    }

    /**
     * Handles a row click. If the checkbox or its containing td is clicked,
     * process that as a direct checkbox click. Otherwise, select the row for multiselect
     * @param {MouseEvent} e */
    onRowClick(e) {
        const checkbox = $$('input[type=checkbox]', this.row);
        if (e.target == checkbox) {
            // Just let the checkbox change event do its thing.
            return;
        }

        // Clicking outside the checkbox but inside its td counts as a check.
        // Checkbox is in a div, so both the parent and grandparent should be checked
        if (e.target == checkbox.parentNode || e.target == checkbox.parentNode.parentNode) {
            checkbox.click();
            return;
        }

        // Otherwise, hand it off to the parent for multi-select handling
        this.parent.onRowClicked(e, this);
    }

    /**
     * Common helper for constructing a table row.
     * @param  {...HTMLElement} columns */
    buildRow(...columns) {
        this.row = TableElements.rawTableRow(...columns);
        this.row.addEventListener('click', this.onRowClick.bind(this));
        this.row.classList.add('noSelect'); // Selection gets annoying with multiselect
        return this.row;
    }


    /**
     * Event fired when the row's checkbox is clicked.
     * @param {HTMLInputElement} checkbox */
    onChecked(checkbox) {
        this.enabled = checkbox.checked;
        this.update();
    }

    /**
     * Directly set the checkbox value
     * @param {boolean} checked */
    setChecked(checked) {
        if (this.enabled != checked) {
            $$('input[type=checkbox]', this.row).click();
        }
    }

    /**
     * Set whether this row is selected as part of multiselect.
     * @param {boolean} selected */
    setSelected(selected) {
        if (selected == this.selected) {
            return;
        }

        this.selected = selected;
        selected ? this.row.classList.add('selectedRow') : this.row.classList.remove('selectedRow');
    }

    /** Build the table row. To be implemented by the concrete class. */
    build() { Log.error('BulkActionRow.build should be overridden.'); }
    /** Updates the contents/style of the table row. To be implemented by the concrete class. */
    update() { Log.error('BulkActionRow.update should be overridden.'); }

    /**
     * Create a marker table checkbox
     * @param {boolean} checked
     * @param {number} mid Marker id
     * @param {number} eid Episode id
     * @param {*} attributes Dictionary of extra attributes to apply to the checkbox. */
    createCheckbox(checked, mid, eid, attributes={}) {
        this.enabled = checked;
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

        checkbox.addEventListener('change', this.onChecked.bind(this, checkbox));
        for (const [key, value] of Object.entries(attributes)) {
            checkbox.setAttribute(key, value);
        }

        return appendChildren(buildNode('div'),
            buildNode('label', { for : checkboxName, class : 'hidden' }, `Marker ${mid} Checkbox`),
            checkbox);
    }
}

/**
 * Class that holds a bulk action customization table that supports multi-select.
 */
class BulkActionTable {
    /**
     * A map of row ids to both the row itself and the row's index in the table.
     * @type {{[id: number]: { rowIndex : number, row : BulkActionRow }}} */
    #rowMap = {};

    /** @type {BulkActionRow[]} */
    #rows = [];
    /**
     * Set of selected rows
     * @type {Set<BulkActionRow>} */
    #selected = new Set();
    /**
     * The last row that was selected. Used as the base of Shift and Ctrl+Shift multiselect actions.
     * @type {BulkActionRow} */
    #lastSelected;
    /**
     * Whether the last row selection was a select or deselect operation, which can affect Ctrl and Ctrl+Shift actions.
     * @type {boolean} */
    #lastSelectedWasDeselect = false;
    /**
     * Holds the bulk check/uncheck checkboxes and label.
     * @type {HTMLDivElement} */
    #multiSelectContainer;

    /** @type {HTMLTableElement} */
    #html = null;

    /**
     * The tbody that holds the rows. Cached to prevent retrieving it
     * for each added row.
     * @type {HTMLTableSectionElement} */
    #tbody = null;

    /**
     * Event listeners are created using .bind(this), as the listener is private, but .bind creates a
     * new reference for each use, so something like `removeEventListener('a', this.#fn.bind(this))`
     * will not remove the #fn listener. This intermediate object is used instead to ensure the same
     * bound reference is captured.
     * @type {() => void} */
    #boundMultiCheckboxListener = null;

    constructor() {
        // If this changes, I'll need to find another bottleneck for removing window event listeners.
        Log.assert(Overlay.showing(), 'The overlay should be showing if we\'re showing a customization table.');
        Overlay.addDismissEvent(this.#removeEventListeners.bind(this));
    }

    /**
     * Retrieve the HTML <table> */
    html() {
        if (this.#tbody) {
            this.#html.appendChild(this.#tbody);
            this.#tbody = null;
        }

        return this.#html;
    }

    /**
     * Retrieve the list of BulkActionRows */
    rows() { return this.#rows; }

    /**
     * Remove this table from the DOM. */
    remove() {
        if (this.#multiSelectContainer) {
            this.#html.parentElement.removeChild(this.#multiSelectContainer);
        }

        if (this.#html && this.#html.isConnected) {
            this.#html.parentNode.removeChild(this.#html);
        }

        this.#removeEventListeners();
    }

    /**
     * Remove any event listeners that this table added. */
    #removeEventListeners() {
        window.removeEventListener('resize', this.#boundMultiCheckboxListener);
        const overlay = Overlay.get();
        if (overlay) {
            overlay.removeEventListener('scroll', this.#boundMultiCheckboxListener);
        }
    }

    /**
     * Begin creating the table, adding a header row with the given columns.
     * @param  {...HTMLElement} columns */
    buildTableHead(...columns) {
        Log.assert(
            !this.#html,
            `BulkActionTable.buildTableHead: We should only be building a table header if the table doesn't already exist!`);

        this.#html = buildNode('table', { class : 'markerTable', id : 'bulkActionCustomizeTable' });
        const mainCheckbox = buildNode('input', { type : 'checkbox', title : 'Select/unselect all', checked : 'checked' });
        mainCheckbox.addEventListener('change', BulkActionCommon.selectUnselectAll.bind(this, mainCheckbox, 'bulkActionCustomizeTable'));
        this.#html.appendChild(appendChildren(buildNode('thead'), TableElements.rawTableRow(mainCheckbox, ...columns)));
        this.#tbody = buildNode('tbody');
    }

    /**
     * Add the given row to the table.
     * @param {BulkActionRow} row */
    addRow(row) {
        if (this.#rowMap[row.id]) {
            Log.error(`BulkActionTable: Attempting to add a row with the same id ${row.id}! Ignoring it.`);
            return;
        }

        this.#rowMap[row.id] = { rowIndex : this.#rows.length, row : row };
        this.#rows.push(row);
        this.#tbody.appendChild(row.build());
    }

    /**
     * Retrieve the list of row ids that are not checked.
     * @returns {number[]} */
    getIgnored() {
        const ignored = [];
        for (const row of this.#rows) {
            if (!row.enabled) {
                ignored.push(row.id);
            }
        }

        return ignored;
    }

    /**
     * Sets the current select context.
     * @param {BulkActionRow} row The row that was just toggled
     * @param {boolean} wasSelected Whether the row was selected or deselected */
    #setSelectState(row, wasSelected) {
        wasSelected ? this.#selected.add(row) : this.#selected.delete(row);
        this.#lastSelectedWasDeselect = !wasSelected;
        this.#lastSelected = row;
        row.setSelected(wasSelected);
    }

    /**
     * Callback for when the user chooses to check/uncheck all selected markers.
     * @param {HTMLInputElement} checkbox
     * @param {MouseEvent} e */
    #onMultiSelectClick(checkbox, e) {
        e.preventDefault(); // Don't change the check state
        const select = checkbox.id == 'multiSelectSelect';
        for (const row of this.#selected.values()) {
            row.setChecked(select);
        }
    }

    /**
     * Reposition the check/uncheck all inputs based on the position of the first selected item in the list.
     * If the first item is not in the viewport, pin it to the top/bottom. */
    #repositionMultiSelectCheckboxes() {
        if (!this.#multiSelectContainer) {
            this.#multiSelectContainer = buildNode('div', { class : 'multiSelectContainer hidden' });
            const label = buildNode('span', { class : 'multiSelectLabel' });
            this.#multiSelectContainer.appendChild(label);
            let checked = true;
            for (const id of ['multiSelectSelect', 'multiSelectDeselect']) {
                const checkbox = buildNode('input', {
                    type : 'checkbox', id : id,
                    class : 'multiSelectCheck',
                    title : id.substring(11) + ' Selected' });

                checkbox.addEventListener('click', this.#onMultiSelectClick.bind(this, checkbox));
                if (checked) {
                    checkbox.checked = 'checked';
                    checked = !checked;
                }

                this.#multiSelectContainer.appendChild(checkbox);

            }

            this.#html.parentElement.appendChild(this.#multiSelectContainer);
            this.#boundMultiCheckboxListener = this.#repositionMultiSelectCheckboxes.bind(this);
            Overlay.get().addEventListener('scroll', this.#boundMultiCheckboxListener);
            window.addEventListener('resize', this.#boundMultiCheckboxListener);
        }

        // Hide if no items or only a single item is selected.
        if (this.#selected.size < 2) {
            this.#multiSelectContainer.classList.add('hidden');
            return;
        }

        this.#multiSelectContainer.classList.remove('hidden');
        for (const row of this.#rows) {
            if (row.selected) {
                const label = $$('span', this.#multiSelectContainer);
                const bounds = row.row.getBoundingClientRect();
                let newTop = 0;
                const overlay = Overlay.get();
                if (bounds.y < 0) { // Row is above viewport, pin to top
                    newTop = overlay.scrollTop;
                } else if (bounds.y > window.innerHeight) { // Row is in viewport
                    newTop = overlay.scrollTop + window.innerHeight - 25;
                } else { // Row is below viewport, pin to bottom
                    newTop = bounds.y + overlay.scrollTop;
                }

                newTop += 'px';
                this.#multiSelectContainer.style.top = newTop;
                label.innerText = `[${this.#selected.size}]`;
                this.#multiSelectContainer.style.right = (bounds.right) + 'px';
                return;
            }
        }

        Log.error('Unable to adjust multiselect check boxes, no selected row found!');
    }

    /**
     * Process a row being clicked, selecting/deselecting all relevant rows
     * based on what modifier keys were used.
     * @param {MouseEvent} e
     * @param {BulkActionRow} toggledRow */
    onRowClicked(e, toggledRow) {
        // The following should match the behavior of Windows Explorer bulk-selection
        if (!e.ctrlKey && !e.shiftKey) {
            // Regular click. Clear out any existing selection and select
            // this one, even if it was previously in the group selection.
            for (const selectedRow of this.#selected.values()) {
                selectedRow.setSelected(false);
            }

            this.#selected.clear();
            this.#setSelectState(toggledRow, true);
        } else if (e.ctrlKey && e.shiftKey) {
            // If we previously weren't selecting anything, this
            // just sets last selected without selecting this row.
            if (!this.#lastSelected) {
                this.#setSelectState(toggledRow, false);
            } else {

                // Iterate from the last selected row to this row. If the last
                // selected row was a deselect, deselect everything, otherwise select everything.
                // This does _not_ change lastSelected. Not sure if I quite like that behavior,
                // but that's what Windows does.
                const startIndex = this.#rowMap[this.#lastSelected.id].rowIndex;
                const endIndex = this.#rowMap[toggledRow.id].rowIndex;
                for (let i = Math.min(startIndex, endIndex); i <= Math.max(startIndex, endIndex); ++i) {
                    const row = this.#rows[i];
                    if (this.#lastSelectedWasDeselect) {
                        this.#selected.delete(row);
                        row.setSelected(false);
                    } else {
                        this.#selected.add(row);
                        row.setSelected(true);
                    }
                }
            }
        } else if (e.shiftKey) {
            // Select everything from start to end, unselecting everything else.

            // Inefficient, but just clear out everything and select it all again.
            for (const row of this.#selected.values()) {
                row.setSelected(false);
            }

            this.#selected.clear();
            const startIndex = this.#rowMap[this.#lastSelected.id].rowIndex;
            const endIndex = this.#rowMap[toggledRow.id].rowIndex;
            for (let i = Math.min(startIndex, endIndex); i <= Math.max(startIndex, endIndex); ++i) {
                const row = this.#rows[i];
                this.#selected.add(row);
                row.setSelected(true);
            }

            // Plain shift doesn't set last selected
            this.#lastSelectedWasDeselect = false;
        } else {
            Log.assert(e.ctrlKey, `BulkActionTable.onRowToggled - How did we get here if alt isn't pressed?`);

            // Select or deselect based on the row's current selection state.
            this.#setSelectState(toggledRow, !this.#selected.has(toggledRow));
        }

        this.#repositionMultiSelectCheckboxes();
    }
}

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
            const aEd = episodeData[a.parentId];
            /** @type {SerializedEpisodeData} */
            const bEd = episodeData[b.parentId];
            if (aEd.seasonIndex != bEd.seasonIndex) { return aEd.seasonIndex - bEd.seasonIndex; }

            if (aEd.index != bEd.index) { return aEd.index - bEd.index; }

            return a.start - b.start;
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
            const show = markerMap[marker.showId] ??= {};
            (show[marker.seasonId] ??= []).push(new MarkerData().setFromJson(marker));
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

    /**
     * Common UI to select specific marker type(s) for bulk operations.
     * @param {string} label The label for the dropdown
     * @param {() => void} callback The function to call when the value changes. */
    static markerSelectType(label, callback) {
        return appendChildren(buildNode('div'),
            buildNode('label', { for : 'markerTypeSelect' }, label),
            appendChildren(
                buildNode('select', { id : 'markerTypeSelect' }, 0, { change : callback }),
                buildNode('option', { value : MarkerEnum.All, selected : 'selected' }, 'All'),
                buildNode('option', { value : MarkerEnum.Intro }, 'Intro'),
                buildNode('option', { value : MarkerEnum.Credits }, 'Credits')
            )
        );
    }
}

/** Enum of bulk actions */
const BulkActionType = {
    Shift  : 0,
    Add    : 1,
    Delete : 2,
};

export { BulkActionCommon, BulkActionRow, BulkActionTable, BulkActionType };
