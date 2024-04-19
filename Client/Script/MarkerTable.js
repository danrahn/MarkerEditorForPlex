import { $, $$, appendChildren, buildNode, clearEle, msToHms, scrollAndFocus } from './Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { animateOpacity, slideDown, slideUp } from './AnimationHelpers.js';
import { Attributes, TableNavDelete } from './DataAttributes.js';
import { ExistingMarkerRow, NewMarkerRow } from './MarkerTableRow.js';
import ButtonCreator from './ButtonCreator.js';
import { errorToast } from './ErrorHandling.js';
import { isSmallScreen } from './WindowResizeEventHandler.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import TableElements from './TableElements.js';

/** @typedef {!import('/Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('./MarkerTableRow').MarkerRow} MarkerRow */
/** @typedef {!import('./ResultRow/BaseItemResultRow').BaseItemResultRow} BaseItemResultRow */

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

const Log = new ContextualLog('MarkerTable');

/**
 * Static helper class that encapsulates the logic that determines keyboard navigation targets.
 *
 * Note: If you want a table element to be focusable via keyboard shortcuts, make sure it has a
 * data-nav-target attribute set. Some of these methods might be better suited for MarkerTableRow,
 * but the current DataAttribute.TableNav system is good enough for now at least.
 *
 * Breakdown of all shortcuts, when a marker table element currently has focus:
 * @example
 * `
 * ┌────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │            │ Modifier(s)                                                                                        │
 * │            ├──────────────┬───────────────┬──────────────────┬────────────────┬────────────────┬────────────────┤
 * │ Base Key   │ None         │ Ctrl          │ Alt              │ Shift          │ Ctrl+Shift     │ Ctrl+Alt+Shift │
 * ├────────────┼──────────────┼───────────────┼──────────────────┼────────────────┼────────────────┼────────────────┤
 * │ ArrowUp    │ Previous row │ Jump to first │ Jump to previous │ Jump to    [2] │ Jump to first  │ Jump to    [2] │
 * │            │ or base item │ table row [1] │ base row         │ previous table │ focusable item │ first table    │
 * ├────────────┼──────────────┼───────────────┼──────────────────┼────────────────┼────────────────┼────────────────┤
 * │ ArrowDown  │ Next row or  │ Jump to last  │ Jump to next     │ Jump to next   │ Jump to last   │ Jump to    [2] │
 * │            │ base item    │ table row [1] │ base row         │ table      [2] │ base item      │ last table     │
 * ├────────────┼──────────────┼───────────────┼──────────────────┴────────────────┴────────────────┴────────────────┘
 * │ ArrowLeft  │ Previous row │ Jump to first │
 * │            │ input        │ row input     │
 * ├────────────┼──────────────┼───────────────┤
 * │ ArrowRight │ Next row     │ Jump to last  │
 * │            │ input        │ row input     │
 * └────────────┴──────────────┴───────────────┘
 * [1] If a <select> is currently focused, go to the next/previous row,
 *     as unmodified up/down changes the selected option.
 * [2] Visible marker table
 * `
 * @example
 * // When a base item row currently has focus:
 * `
 * ┌────────────┬────────────────────────────────────────────────────────────────────────────────────┐
 * │            │ Modifier(s)                                                                        │
 * │            ├─────────────┬───────────────┬──────────────────┬──────────────────┬────────────────┤
 * │ Base Key   │ None        │ Ctrl          │ Alt              │ Shift            │ Ctrl+Shift     │
 * ├────────────┼─────────────┼───────────────┼──────────────────┼──────────────────┼────────────────┤
 * │ ArrowUp    │ [1]         │ Jump to first │ Jump to previous │ Jump to previous │ Jump to first  │
 * │            │             │ base item     │ marker table [3] │ base item        │ focusable item │
 * ├────────────┼─────────────┼───────────────┼──────────────────┼──────────────────┼────────────────┤
 * │ ArrowDown  │ [2]         │ Jump to last  │ Jump to next     │ Jump to next     │ Jump to last   │
 * │            │             │ base item     │ marker table     │ base item        │ base item      │
 * ├────────────┼─────────────┼───────────────┼──────────────────┴──────────────────┴────────────────┘
 * │ ArrowLeft  │ Hide marker │ Hide all      │
 * │            │ table       │ marker tables │
 * ├────────────┼─────────────┼───────────────┤
 * │ ArrowRight │ Show marker │ Show all      │
 * │            │ table       │ marker tables │
 * └────────────┴─────────────┴───────────────┘
 *
 * [1] Previous navigable item. It could be the last row of the previous base item's marker table,
       a bulk action, or another movie/episode row.
 * [2] Next navigable item, e.g. the first row of its own marker table, or the next movie/episode row.
 * [3] Visible marker table.`
 */
class Nav {
    /**
     * Select the BaseItemResultRow closest to the current one.
     * @param {KeyboardEvent} e The initiating event
     * @param {BaseItemResultRow} baseItemRow The base item row associated with the current focus target.
     * @param {boolean} up Whether we're navigating up or down. */
    static SelectBaseItemRow(e, baseItemRow, up) {
        if (e.ctrlKey && e.shiftKey) {
            // Ctrl+Shift escapes the table and goes directly to the top/bottom row.
            const evt = new KeyboardEvent('keydown', {
                key : e.key,
                code : e.code,
                location : e.location,
                repeat : e.repeat,
                isComposing : e.isComposing,
                charCode : e.charCode,
                keyCode : e.keyCode,
                which : e.which,
                ctrlKey : true,
                altKey : false,
                shiftKey : false,
                metaKey : e.metaKey,
            });

            baseItemRow.onBaseItemResultRowKeydown(evt);
            return;
        }

        if (up) {
            baseItemRow.focus(e);
        } else {
            baseItemRow.getNextBaseItem()?.focus(e);
        }
    }

    /**
     * Jump to the next visible marker table (Shift+Up/Down when focused on a table)
     * @param {Event} e The initiating event
     * @param {BaseItemResultRow} baseItemRow The base item row associated with the current focus target
     * @param {HTMLElement} input The currently focused element
     * @param {boolean} up Whether we're navigating up or down. */
    static SelectNextTable(e, baseItemRow, input, up) {
        Nav.#SelectNextTableCore(e, baseItemRow, input, up, false /*lastMatch*/);
    }

    /**
     * Jump to the first/last visible marker table (Ctrl+Alt+Shift+Up/Down when focused on a table)
     * @param {Event} e The initiating event
     * @param {BaseItemResultRow} baseItemRow The base item row associated with the current focus target
     * @param {HTMLElement} input The currently focused element
     * @param {boolean} up Whether we're navigating up or down. */
    static SelectFirstLastTable(e, baseItemRow, input, up) {
        Nav.#SelectNextTableCore(e, baseItemRow, input, up, true /*lastMatch*/);
    }

    /**
     * Core "next table" routine, which selects either the next available or last available
     * marker table in the given direction.
     * @param {Event} e The initiating event
     * @param {BaseItemResultRow} baseItemRow The base item row associated with the current focus target
     * @param {HTMLElement} input The currently focused element
     * @param {boolean} up Whether we're navigating up or down.
     * @param {boolean} lastMatch Whether to select the last match found or the first. */
    static #SelectNextTableCore(e, baseItemRow, input, up, lastMatch) {
        /** @type {(sibling: BaseItemResultRow) => BaseItemResultRow?} */
        const nextSibling = sibling => up ? sibling.getPreviousBaseItem() : sibling.getNextBaseItem();
        let sibling = nextSibling(baseItemRow);
        let markerTable = sibling?.baseItem().markerTable();
        let lastSibling = sibling;
        let lastMarkerTable = markerTable;
        // eslint-disable-next-line no-unmodified-loop-condition
        while (sibling && (!markerTable || !markerTable.isVisible() || lastMatch)) {
            sibling = nextSibling(sibling);
            markerTable = sibling?.baseItem().markerTable();
            if (lastMatch && markerTable?.isVisible()) {
                lastSibling = sibling;
                lastMarkerTable = markerTable;
            }
        }

        if (lastMatch) {
            sibling = lastSibling;
            markerTable = lastMarkerTable;
        }

        if (!markerTable || !markerTable.isVisible()) {
            return;
        }

        sibling.focus(e, markerTable.getNextFocusElement(up, input, true /*tryForceNav*/));
    }

    /**
     * Jump to the next row in the current table, or the next base item if at the start/end of the table.
     * @param {KeyboardEvent} e Initiating event.
     * @param {BaseItemResultRow} baseItemRow The base item row associated with the current focus target.
     * @param {HTMLElement} input The currently focused element.
     * @param {boolean} up Whether we're navigating up or down. */
    static SelectNextTableRow(e, baseItemRow, input, up) {
        const isSelect = input instanceof HTMLSelectElement;
        if (isSelect && !e.ctrlKey) {
            return;
        }

        const goMax = !isSelect && e.ctrlKey;
        const targetRow = Nav.#GetTargetRow(input);
        const markerTable = baseItemRow.baseItem().markerTable().table();
        if (!targetRow || !markerTable) {
            Log.warn(`Unable to associate focus element with a marker table row, can't navigate`);
            return;
        }

        const rows = Array.from($('.markerRow', markerTable));
        const currentIndex = goMax ? (up ? 0 : rows.length - 1) : rows.indexOf(targetRow);

        if (currentIndex === -1) {
            Log.warn(`Unable to associate focus element with a marker table row, can't navigate`);
            return;
        }

        if (!goMax && currentIndex === (up ? 0 : rows.length - 1)) {
            // At the edge of the table. Move to a base item row.
            return Nav.SelectBaseItemRow(e, baseItemRow, up);
        } else if (goMax) {
            up = !up;
        }

        let focusRow = goMax ? rows[currentIndex] : (up ? targetRow.previousSibling : targetRow.nextSibling);
        while (focusRow) {
            const bestFocus = Nav.GetBestFocusableInput(focusRow, { lastSelected : input, ctrlKey : goMax });
            if (bestFocus) {
                return baseItemRow.focus(e, bestFocus);
            }

            focusRow = up ? focusRow.previousSibling : focusRow.nextSibling;
        }

        // We had next rows, but nothing was focusable.
        Nav.SelectBaseItemRow(e, baseItemRow, up);
    }

    /**
     * Select the next focusable input in the current marker row.
     * @param {Event} e Initiating event.
     * @param {HTMLElement} currentInput The currently focus target.
     * @param {boolean} left Whether we're navigating left or right. */
    static SelectNextTableRowInput(e, currentInput, left) {
        const inputs = Nav.#GetRowInputs(currentInput);
        const currentIndex = inputs.indexOf(currentInput);
        if (currentIndex === -1 && !e.ctrlKey) {
            Log.warn(`selectNextTableRowInput: current input not a navigable input, can't navigate.`);
            return;
        }

        const focusRow = Nav.#GetTargetRow(currentInput);
        const focusInput = Nav.GetBestFocusableInput(focusRow, { lastSelected : currentInput, left : left, ctrlKey : e.ctrlKey });
        if (focusInput) {
            // Since we're navigating sideways, just make sure the marker row is visible,
            // not the entire table.
            scrollAndFocus(e, focusRow, focusInput);
        }
    }

    /**
     * Retrieve the actual element we want to treat as the input element.
     * @param {KeyboardEvent} e */
    static GetTargetInput(e) {
        const target = e.target;
        const button = ButtonCreator.getButton(target);
        if (button) {
            Log.assert(button.getAttribute(Attributes.TableNav), 'All buttons in the marker table should have a nav attribute');
            return button;
        }

        // Otherwise input or select
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
            Log.assert(target.getAttribute(Attributes.TableNav), 'All inputs in the marker table should have a nav attribute');
            return target;
        }

        return null;
    }

    /**
     * Selects the "best" next item to set focus to, based on a handful of criteria:
     *
     *  1. Prefer non-Delete buttons over Delete buttons, unless our last selection was also a Delete button.
     *  2. Prefer non-Select inputs over Select inputs, as up/down arrows will get "stuck" in <select>s
     *  3. If `options.lastSelected` is not provided, select the first input that isn't hidden or disabled
     *    (with #1 and #2 still applying).
     *  4. If `options.lastSelected` is set and we're changing rows, try to find an element that matches the
     *    last selected item's navigation id.
     *  5. If `options.lastSelected` is set, but we didn't find a nav-id match, try to select the item that's
     *     vertically closest to the last selected item, unless `options.forceNavMatch` is set.
     *  6. If `options.left` is provided (true or false, not undefined):
     *     * If `options.ctrlKey` is `true`, select the first (if left) or last (if right) input that is selectable.
     *     * If `options.ctrlKey` is `false`, select the next selectable item to the left/right of lastSelected.
     * @param {HTMLElement} row
     * @param {BestFocusMatchOptions} options */
    static GetBestFocusableInput(row, options) {
        const inputs = Nav.#GetRowInputs(row);
        let currentIndex = inputs.indexOf(options.lastSelected);
        const sameRow = currentIndex !== -1;
        const leftSet = typeof(options.left) === 'boolean';
        Log.assert(!sameRow || (leftSet || options.ctrlKey),
            `If lastSelected is in the same row, 'options.left' should be set, or ctrl should be set.`);
        Log.assert(!options.forceNavMatch || options.lastSelected, `forceNavMatch doesn't work without a lastSelect element.`);

        // Only do nav target matching if we're switching rows.
        if (!sameRow) {
            const navMatch = Nav.#CheckNavMatch(options.lastSelected, row);
            if (navMatch) {
                return navMatch;
            }

            if (options.forceNavMatch) {
                return;
            }

            // If we don't have a nav match, but are switching rows, calculate the number of visible
            // inputs we are from the end, as that results in better "nearest neighbor" positioning.
            const bestIndex = Nav.#GetBestIndex(options.lastSelected, inputs);
            if (bestIndex !== -1) {
                currentIndex = bestIndex;
            }
        }

        const allowSelect = leftSet || options.lastSelected instanceof HTMLSelectElement;

        /**
         * Returns whether the given input should be selected.
         * @param {HTMLElement} input
         * @param {BestFocusMatchBackups} backup  */
        const checkInput = (input, backup) => {
            if (Nav.#IsInputTargetable(input)) {
                if (!allowSelect && (input instanceof HTMLSelectElement)) {
                    backup.select ??= input;
                } else if (input.getAttribute(Attributes.TableNav) === TableNavDelete) {
                    backup.lastResort ??= input;
                } else {
                    return true;
                }
            }

            return false;
        };

        if (!options.lastSelected) {
            // We don't have a last-selected item, so just pick the first one that fits our criteria.
            /** @type {BestFocusMatchBackups} */
            const backups = { select : null, lastResort : null };
            for (const input of inputs) {
                if (checkInput(input, backups)) {
                    return input;
                }
            }

            return backups.select || backups.lastResort;
        }

        // Pick what's closest to our last selection.
        if (leftSet) {
            return Nav.#GetBestLeftRight(options, inputs, currentIndex, checkInput);
        }

        return Nav.#GetBestNeighbor(options, inputs, currentIndex, checkInput);
    }

    /**
     * Check for a nav id match in the given row.
     * @param {HTMLElement} input The input to check
     * @param {HTMLElement} row The row to check for a nav match in. */
    static #CheckNavMatch(input, row) {
        const navTarget = input?.getAttribute(Attributes.TableNav);
        if (navTarget) {
            const navMatch = $$(`[${Attributes.TableNav}="${navTarget}"]`, row);
            if (navMatch && Nav.#IsInputTargetable(navMatch)) {
                return navMatch;
            }
        }
    }

    /**
     * Determine the best starting index based on the given baseline input and
     * available inputs in the target row. -1 if no best index could be found.
     * @param {HTMLElement?} input
     * @param {HTMLElement[]} newInputs */
    static #GetBestIndex(input, newInputs) {
        if (!input) {
            return -1;
        }

        const lastRows = Nav.#GetRowInputs(input);
        const idx = lastRows.indexOf(input);
        if (idx !== -1) {
            return Math.max(0, newInputs.length - (lastRows.length - idx));
        }

        return -1;
    }

    /**
     * Finds the best input when we're navigating left/right.
     * @param {BestFocusMatchOptions} options
     * @param {HTMLElement[]} inputs
     * @param {number} startIndex
     * @param {(HTMLElement, BestFocusMatchBackups) => boolean} checkInput */
    static #GetBestLeftRight(options, inputs, startIndex, checkInput) {
        Log.assert(startIndex !== -1, `We should only be here if we're targeting an item in the same row.`);
        let index = -1;
        if (options.ctrlKey) {
            index = options.left ? 0 : inputs.length - 1;
            options.left = !options.left;
        } else {
            index = options.left ? startIndex - 1 : startIndex + 1;
        }

        const indexLimit = options.left ? -1 : inputs.length;
        /** @type {BestFocusMatchBackups} */
        const backups = { select : null, lastResort : null };
        const nextI = i => i + (options.left ? -1 : 1);
        while (index !== indexLimit) {
            const input = inputs[index];
            if (checkInput(input, backups)) {
                return input;
            }

            index = nextI(index);
        }

        return backups.select || backups.lastResort;
    }

    /**
     * Finds the best input when we're selecting an item in a new row based off of input from a different row.
     * @param {BestFocusMatchOptions} options
     * @param {HTMLElement[]} inputs
     * @param {number} startIndex
     * @param {(HTMLElement, BestFocusMatchBackups) => boolean} checkInput */
    static #GetBestNeighbor(options, inputs, startIndex, checkInput) {
        /** @type {BestFocusMatchBackups} */
        const backups = { select : null, lastResort : null };

        if (startIndex >= 0 && startIndex <= inputs.length - 1) {
            const input = inputs[startIndex];
            if (checkInput(input, backups)) {
                return input;
            }
        }

        let indexLeft = options.ctrlKey ? startIndex : startIndex - 1;
        let indexRight = options.ctrlKey ? startIndex : startIndex + 1;

        while (indexLeft >= 0 || indexRight < inputs.length) {
            for (const index of [indexLeft, indexRight]) {
                if (index < 0 || index >= inputs.length) {
                    continue;
                }

                const input = inputs[index];
                if (checkInput(input, backups)) {
                    return input;
                }
            }

            indexLeft += options.ctrlKey ? 1 : -1;
            indexRight += options.ctrlKey ? -1 : 1;
        }

        return backups.select || backups.lastResort;
    }

    /**
     * Given our currently focused element, should we allow arrow navigation
     * to switch to a new input?
     * @param {KeyboardEvent} e The initiating event.
     * @param {HTMLElement} input The currently selected input.
     * @param {boolean} upDown Are we navigating up/down, or left/right?
     * @param {boolean} left If navigating sideways, are we navigating left? */
    static ShouldSwitchInput(e, input, upDown, left) {
        const tagName = input.tagName.toLowerCase();
        if (upDown) {
            // For up/down navigation, we just care whether we're
            // in a select element, in which case we don't want to navigate.
            return tagName !== 'select';
        }

        if (tagName === 'select') {
            // No matter what, disable left/right to toggle select options, only allow up/down.
            e.preventDefault();
            return true;
        }

        if (tagName !== 'input' || input.type !== 'text') {
            return true;
        }

        const start = input.selectionStart;
        if (start !== input.selectionEnd) {
            return false;
        }

        return left ? start === 0 : start === input.value.length;
    }

    /**
     * Retrieve the marker row that the given element belongs to.
     * @param {HTMLElement} element */
    static #GetTargetRow(element) {
        let row = element;
        while (!row.classList.contains('markerRow')) {
            row = row.parentElement;
        }

        return row;
    }

    /**
     * For the given element, retrieve all input-like elements that are in
     * the same marker row as element (if element is not the row itself)
     * @param {HTMLElement} element
     * @returns {HTMLElement[]} */
    static #GetRowInputs(element) {
        const row = Nav.#GetTargetRow(element);
        if (!row) {
            return [];
        }

        // Completely ignore hidden inputs, as we never want to select them.
        // However, keep disabled elements, since even though we won't select them,
        // they're important for nearest-neighbor calculations
        return Array.from($(`[${Attributes.TableNav}]`, row)).filter(i => !Nav.#IsInputHidden(i));
    }

    /**
     * Returns whether the given input is currently being hidden.
     * @param {HTMLElement} input */
    static #IsInputHidden(input) {
        let element = input;
        while (element) {
            if (element.classList.contains('hidden')) {
                return true;
            }

            element = element.parentElement;
        }

        return !input;
    }

    /**
     * Returns whether the input is currently disabled.
     * @param {HTMLElement} input */
    static #IsInputDisabled(input) {
        let element = input;
        while (element) {
            if (element.classList.contains('disabled') || element.disabled) {
                return true;
            }

            element = element.parentElement;
        }

        return !input;
    }

    /**
     * Returns whether the input is a valid focus target (i.e. not hidden or disabled)
     * @param {HTMLElement} input */
    static #IsInputTargetable(input) {
        return !Nav.#IsInputHidden(input) && !Nav.#IsInputDisabled(input);
    }
}

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
     * The element that controls the visibility of the <table>. Used for better animations.
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
        const container = buildNode('div', { class : 'tableHolder' });
        const table = buildNode('table', { class : 'markerTable' }, 0, { keydown : this.#onTableKeydown.bind(this) });
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    TableElements.centeredColumn('Type'),
                    TableElements.timeColumn('Start Time'),
                    TableElements.timeColumn('End Time'),
                    TableElements.dateColumn(isSmallScreen() ? 'Added' : 'Date Added'),
                    TableElements.optionsColumn('Options')
                )
            )
        );

        const rows = buildNode('tbody');
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

        this.#visibilityControl = buildNode('div', { class : 'hidden markerTableVisibility' });

        // markerTableSpacer is a 10px empty div that is used to ensure there's a consistent margin when
        // showing/hiding the marker table. When animating the table we explicitly set the height, which can
        // result in margin-top of the table itself not being respected, leading to extra shifting as the height
        // grows large enough to fit all of the table. By setting the top margin of the table to 0 and ensuring
        // the spacer div is always visible before animating the table height, we guarantee static top positioning.
        appendChildren(container,
            buildNode('div', { class : 'hidden markerTableSpacer' }),
            appendChildren(this.#visibilityControl,
                table
            )
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
            row.setParent(parentRow);
        }
    }

    /**
     * @param {MarkerData[]} markers
     * @param {ChapterData[]} chapters */
    lazyInit(markers, chapters) {
        if (this.#markers.length !== 0) {
            // Reset data
            Log.warn(`Attempting to lazy-init a marker table that already has markers!`);
            clearEle(this.#tbody());
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
            tableHolder.classList[visible ? 'remove' : 'add']('hidden');
            spacer.classList[visible ? 'remove' : 'add']('hidden');
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
                    `New marker overlaps [${msToHms(row.startTime())}-${msToHms(row.endTime())}].<br>${message}`);
                return false;
            }
        }

        return true;
    }

    /**
     * Displays an error message when a marker's bounds are invalid.
     * @param {string} title
     * @param {string} message */
    #valueErrorToast(title, message) {
        errorToast(appendChildren(buildNode('div'),
            buildNode('h4', {}, title),
            buildNode('hr'),
            buildNode('span', {}, message)), 5000);
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
            clearEle(row);
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
}

export default MarkerTable;
