import { $, $$, $append, $div, $divHolder, $id, $label, $option, $plainDivHolder, $select, $span, $table,
    $tbody, $thead } from './HtmlHelpers.js';
import { clickOnEnterCallback, ctrlOrMeta, scrollAndFocus, toggleVisibility } from './Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { BulkMarkerResolveType, MarkerData } from '/Shared/PlexTypes.js';
import { customCheckbox } from './CommonUI.js';
import { flashBackground } from './AnimationHelpers.js';
import { MarkerEnum } from '/Shared/MarkerType.js';
import Overlay from './Overlay.js';
import { TableElements } from './MarkerTable/TableElements.js';
import { Theme } from './ThemeColors.js';

/** @typedef {!import('/Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */


/** @typedef {{ [showId: number] : { [seasonId: number]: MarkerData[] } }} BulkMarkerResult */

const Log = ContextualLog.Create('BulkAction');

/**
 * Base class that represents a row in a bulk action customization table.
 */
class BulkActionRow {
    /** @type {number} */
    id;
    /** Whether this row is checked/unchecked. */
    enabled = false;
    /** Whether this row is selected for a bulk select action. */
    selected = false;
    /** Whether this row is currently filtered from the table (and is excluded from any selection operations). */
    filtered = false;
    /**
     * @type {HTMLTableRowElement} */
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
        // If the row is filtered, don't do anything.
        if (this.filtered) {
            return;
        }

        const checkbox = $$('input[type=checkbox]', this.row);
        if (e.target === checkbox) {
            // Just let the checkbox change event do its thing.
            return;
        }

        // Clicking outside the checkbox but inside its td counts as a check.
        // Checkbox is in a div, so both the parent and grandparent should be checked
        if (e.target === checkbox.parentNode || e.target === checkbox.parentNode.parentNode) {
            checkbox.click();
            return;
        }

        // Otherwise, hand it off to the parent for multi-select handling
        this.parent.onRowClicked(e, this, false /*fFromKeyboard*/);
    }

    /**
     * Common helper for constructing a table row.
     * @param  {...(HTMLElement|CustomClassColumn)} columns */
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
        if (this.enabled !== checked) {
            $$('input[type=checkbox]', this.row).click();
        }
    }

    /**
     * Set whether this row is selected as part of multiselect.
     * @param {boolean} selected */
    setSelected(selected) {
        if (selected === this.selected) {
            return;
        }

        this.selected = selected;
        selected ? this.row.classList.add('selectedRow') : this.row.classList.remove('selectedRow');
    }

    /**
     * Set whether this row is filtered (hidden) from the table.
     * @param {boolean} filtered */
    setFiltered(filtered) {
        const changed = this.filtered !== filtered;
        toggleVisibility(this.row, !filtered);
        this.filtered = filtered;
        if (changed) {
            this.update();
        }
    }

    /**
     * @param {HTMLInputElement} checkbox
     * @param {KeyboardEvent} e */
    onCheckboxKeydown(checkbox, e) {
        if (this.filtered) {
            return; // This row isn't visible, but some event propagation might still reach us.
        }

        switch (e.key) {
            case 'Enter':
                if (!e.ctrlKey && !e.shiftKey && !e.altKey && (e.target instanceof HTMLInputElement)) {
                    checkbox.checked = !checkbox.checked;
                    this.update();
                }
                break;
            case 's':
                this.parent.onRowClicked(new MouseEvent('click', { ctrlKey : true }), this, true /*fromKeyboard*/);
                break;
            case 'c':
                this.parent.toggleAllChecked(this.selected ? !this.enabled : undefined);
                break;
            case 'C':
            {
                const mainCheck = $$('.selAllCheck', this.parent.html());
                mainCheck.checked = !mainCheck.checked;
                this.parent.checkUncheckAll();
                break;
            }
            case 'ArrowUp':
            case 'ArrowDown':
                this.parent.onCheckboxNav(e, this);
                break;
        }
    }

    /** Build the table row. To be implemented by the concrete class. */
    build() { Log.error('BulkActionRow.build should be overridden.'); }
    /** Updates the contents/style of the table row. To be implemented by the concrete class. */
    update() { Log.error('BulkActionRow.update should be overridden.'); }

    /**
     * Create a marker table checkbox
     * @param {boolean} checked
     * @param {number} identifier Unique identifier for this checkbox
     * @param {*} attributes Dictionary of extra attributes to apply to the checkbox. */
    createCheckbox(checked, identifier, attributes={}) {
        this.enabled = checked;
        const checkboxName = `mid_check_${identifier}`;
        const checkbox = customCheckbox({
            id : checkboxName,
            ...attributes,
            checked : checked,
        },
        { change : this.onChecked,
          keydown : this.onCheckboxKeydown },
        {},
        { thisArg : this });

        return $append(checkbox, $label(`Marker ${identifier} Checkbox`, checkboxName, { class : 'hidden' }));
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
     * Whether our last selection was initiated from keyboard input, not a mouse click.
     * @type {boolean} */
    #inKeyboardSelection = false;
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

    #id = 'bulkActionCustomizeTable';

    constructor(id) {
        // If this changes, I'll need to find another bottleneck for removing window event listeners.
        Log.assert(Overlay.showing(), 'The overlay should be showing if we\'re showing a customization table.');
        Overlay.addDismissEvent(this.#removeEventListeners.bind(this));
        if (id) { this.#id = id; }
    }

    /**
     * Retrieve the HTML table */
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

        this.#html = $table({ class : 'markerTable', id : this.#id });
        const mainCheckbox = customCheckbox({
            title : 'Select/unselect all',
            name : 'selAllCheck',
            id : `selAllCheck_${this.#id}`,
            class : 'selAllCheck',
            checked : 'checked'
        },
        { change : this.checkUncheckAll.bind(this),
          keydown : [ clickOnEnterCallback, this.#onMainCheckboxKeydown.bind(this) ] });

        this.#html.appendChild($thead(TableElements.rawTableRow(mainCheckbox, ...columns)));
        this.#tbody = $tbody();
    }

    #onMainCheckboxKeydown(e) {
        if (e.key !== 'ArrowDown') {
            return;
        }

        const target = (e.ctrlKey && e.shiftKey) ? this.#rows[this.#rows.length - 1] : this.#rows[0];
        scrollAndFocus(e, $$('input[type="checkbox"]', target.row));
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
        this.toggleAllChecked(checkbox.id === 'multiSelectSelect');
    }

    /**
     * Bulk check/uncheck all items in this table based on the checkbox state. */
    checkUncheckAll() {
        const table = $id(this.#id);
        if (!table) {
            Log.assert(false, `How did we hit selectUnselectAll without a customization table?`);
            return;
        }

        const checkbox = $$('.selAllCheck', table);
        if (!checkbox) {
            Log.assert(false, `Why doesn't the selectUnselectAll checkbox exist if we're in selectUnselectAll?`);
            return;
        }

        $('tbody input[type=checkbox]', table).forEach(c => { c.checked = checkbox.checked; c.dispatchEvent(new Event('change')); });
    }

    /**
     * Check/Uncheck all selected markers. If check is undefined,
     * toggle based on the first selected item's checked state.
     * @param {boolean?} check */
    toggleAllChecked(check) {
        let setChecked = check;
        for (const row of this.#selected.values()) {
            setChecked ??= !row.enabled;
            row.setChecked(setChecked);
        }
    }

    /**
     * Remove the current selection from the table. */
    removeSelection() {
        for (const row of this.#selected.values()) {
            row.setSelected(false);
        }

        this.#selected.clear();
        this.#lastSelected = null;
        this.#lastSelectedWasDeselect = false;
        this.#repositionMultiSelectCheckboxes();
    }

    /**
     * Reposition the check/uncheck all inputs based on the position of the first selected item in the list.
     * If the first item is not in the viewport, pin it to the top/bottom. */
    #repositionMultiSelectCheckboxes() {
        if (!this.#multiSelectContainer) {
            this.#multiSelectContainer = $div({ class : 'multiSelectContainer hidden' });
            const label = $span(null, { class : 'multiSelectLabel' });
            this.#multiSelectContainer.appendChild(label);
            let checked = true;
            for (const id of ['multiSelectSelect', 'multiSelectDeselect']) {
                const checkbox = customCheckbox({
                    id : id,
                    class : 'multiSelectCheck',
                    checked : checked,
                },
                { click : this.#onMultiSelectClick },
                { title : id.substring(11) + ' Selected' },
                { thisArg : this });
                checked = !checked;

                this.#multiSelectContainer.appendChild(checkbox);

            }

            this.#html.parentElement.appendChild(this.#multiSelectContainer);
            this.#boundMultiCheckboxListener = this.#repositionMultiSelectCheckboxes.bind(this);
            Overlay.get().addEventListener('scroll', this.#boundMultiCheckboxListener);
            window.addEventListener('resize', this.#boundMultiCheckboxListener);
        }

        // Hide if no items or only a single item is selected.
        const multiSelectVisible = this.#selected.size >= 2;
        toggleVisibility(this.#multiSelectContainer, multiSelectVisible);
        if (!multiSelectVisible) {
            return;
        }

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

                // Account for td padding from BulkActionOverlay.css
                newTop += 3;
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
     * @param {BulkActionRow} toggledRow
     * @param {boolean} fromKeyboard */
    onRowClicked(e, toggledRow, fromKeyboard) {
        this.#inKeyboardSelection = fromKeyboard;
        // The following should match the behavior of Windows Explorer bulk-selection
        const ctrlIsh = ctrlOrMeta(e);
        if (!ctrlIsh && !e.shiftKey) {
            // If this is the only row that's currently selected, deselect with a plain click.
            const onlyThisWasSelected = this.#selected.size === 1 && toggledRow.selected;

            // Regular click. Clear out any existing selection and select
            // this one, even if it was previously in the group selection.
            for (const selectedRow of this.#selected.values()) {
                selectedRow.setSelected(false);
            }

            this.#selected.clear();
            this.#setSelectState(toggledRow, !onlyThisWasSelected);
        } else if (ctrlIsh && e.shiftKey) {
            if (this.#lastSelected) {
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
            } else {
                // If we previously weren't selecting anything, this
                // just sets last selected without selecting this row.
                this.#setSelectState(toggledRow, false);
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
            Log.assert(ctrlIsh, `BulkActionTable.onRowToggled - How did we get here if alt isn't pressed?`);

            // Select or deselect based on the row's current selection state.
            this.#setSelectState(toggledRow, !this.#selected.has(toggledRow));
        }

        this.#repositionMultiSelectCheckboxes();
    }

    /**
     * @param {KeyboardEvent} e
     * @param {BulkActionRow} currentRow */
    onCheckboxNav(e, currentRow) {
        if (e.altKey) {
            return;
        }

        const up = e.key === 'ArrowUp';
        const thisIndex = this.#rowMap[currentRow.id].rowIndex;
        if (up && thisIndex === 0) {
            // Just set focus to the table head checkbox and return.
            const thead = $$(`#${this.#id} thead`);
            if (thead) {
                scrollAndFocus(e, thead, $$('input[type="checkbox"]', thead));
            }

            return;
        }

        let nextIndex = 0;
        if (e.ctrlKey) {
            nextIndex = up ? 0 : this.#rows.length - 1;
        } else {
            nextIndex = Math.max(0, Math.min(thisIndex + (up ? -1 : 1), this.#rows.length - 1));
        }

        const nextRow = this.#rows[nextIndex];

        // Shift creates a selection
        if (e.shiftKey) {
            if (this.#inKeyboardSelection) {
                // If we're already in the middle of keyboard selection,
                // treat the calling row as a Ctrl+Click if it's not already
                // selected, and treat the new row as a Ctrl+Shift+Click.
                if (!currentRow.selected) {
                    this.onRowClicked(new MouseEvent('click', { ctrlKey : true }), currentRow, true /*fromKeyboard*/);
                }

                this.onRowClicked(new MouseEvent('click', { ctrlKey : true, shiftKey : true }), nextRow, true /*fromKeyboard*/);
            } else {
                // Fresh keyboard selection. Simulate a click of the initial row unless it's
                // already the only item selected, and Shift+Click the next row.
                if (this.#selected.size !== 1 || !currentRow.selected) {
                    this.onRowClicked(new MouseEvent('click'), currentRow);
                }

                this.onRowClicked(new MouseEvent('click', { shiftKey : true }), nextRow, true /*fromKeyboard*/);
            }
        }

        // Now set focus.
        scrollAndFocus(e, nextRow.row, $$('input[type="checkbox"]', nextRow.row));
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
            if (aEd.seasonIndex !== bEd.seasonIndex) { return aEd.seasonIndex - bEd.seasonIndex; }

            if (aEd.index !== bEd.index) { return aEd.index - bEd.index; }

            return a.start - b.start;
        });
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
    static flashButton(buttonId, color, duration=1000) {
        return flashBackground(buttonId, Theme.getHex(color, 4), duration);
    }

    /**
     * Common UI to select specific marker type(s) for bulk operations.
     * @param {string} label The label for the dropdown
     * @param {() => void} callback The function to call when the value changes.
     * @param {number} initialValue The initial value to select in the dropdown. Defaults to 'All'. */
    static markerSelectType(label, callback, initialValue=MarkerEnum.All) {
        const select = $append(
            $select('markerTypeSelect', callback),
            $option('All', MarkerEnum.All),
            $option('Intro', MarkerEnum.Intro),
            $option('Credits', MarkerEnum.Credits),
            $option('Ad', MarkerEnum.Ad),
        );

        select.value = initialValue;

        return $plainDivHolder($label(label, 'markerTypeSelect'), select);
    }
}

/** Descriptions for different marker conflict resolution strategies. */
const conflictResolutionStrings = {
    [BulkMarkerResolveType.Fail]  : `If any {VERB} marker conflicts with existing markers, fail the entire operation`,
    [BulkMarkerResolveType.Merge] : `If any {VERB} markers conflict with existing markers, merge them with into the existing marker(s)`,
    [BulkMarkerResolveType.Ignore] : `If any {VERB} marker conflicts with existing markers, don't add the marker to the episode`,
    [BulkMarkerResolveType.Overwrite] : `If any {VERB} marker conflicts with existing markers, overwrite the existing marker(s)`,
};

/**
 * Encapsulates the UI/logic for selecting a conflict resolution strategy.
 */
class ConflictResolutionSelection {
    #id = '';
    #label = '';
    #verb = '';
    /** @type {((applyType: number) => any)} */
    #userChange = null;
    #initialValue = BulkMarkerResolveType.Fail;

    /**
     * Create a conflict resolution selection element.
     * @param {string} id The id of the element
     * @param {string} label The label for the select element
     * @param {string} verb The verb to use in the description
     * @param {(e: Event) => void} onChange The function to call when the value changes
     * @param {number} initialValue The initial value to select in the dropdown. Defaults to Fail. */
    constructor(id, label, verb, onChange, initialValue=BulkMarkerResolveType.Fail) {
        this.#id = id;
        this.#label = label;
        this.#verb = verb;
        this.#userChange = onChange;
        this.#initialValue = initialValue;
    }

    /**
     * Creates and returns the conflict resolution selection element with auto-adjusting descriptions. */
    build() {
        const holder = $divHolder({ id : this.#id },
            $label(`${this.#label}: `, 'applyTypeSelect'),
            $append(
                $select('applyTypeSelect', this.#onChange.bind(this)),
                $option('Fail', 1),
                $option('Overwrite', 4),
                $option('Merge', 2),
                $option('Ignore', 3)),
            $div({ id : 'applyTypeDescription' }, this.#getDescription(this.#initialValue))
        );

        $id('applyTypeSelect', holder).value = this.#initialValue;
        return holder;
    }

    /**
     * Callback invoked when the select value changes. */
    #onChange() {
        const select = $id('applyTypeSelect');
        if (!select) {
            Log.error(`ConflictResolutionSelection: Unable to find select element with id 'applyTypeSelect'!`);
            return;
        }

        const description = $id('applyTypeDescription');
        if (!description) {
            Log.error(`ConflictResolutionSelection: Unable to find description element with id 'applyTypeDescription'!`);
            return;
        }

        const applyType = parseInt(select.value);
        description.innerText = this.#getDescription(applyType);
        this.#userChange(applyType);
    }

    /**
     * Retrieve the description for the given apply type.
     * @param {number} applyType */
    #getDescription(applyType) {
        if (applyType < BulkMarkerResolveType.Fail || applyType > BulkMarkerResolveType.Max) {
            Log.error(`Invalid apply type ${applyType} for conflict resolution description!`);
            return '';
        }

        return conflictResolutionStrings[applyType].replace('{VERB}', this.#verb);
    }
}

/** Enum of bulk actions */
const BulkActionType = {
    Shift  : 0,
    Add    : 1,
    Delete : 2,
};

export {
    BulkActionCommon,
    BulkActionRow,
    BulkActionTable,
    BulkActionType,
    ConflictResolutionSelection
};
