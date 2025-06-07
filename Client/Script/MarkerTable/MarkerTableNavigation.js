import { $, $$ } from '../HtmlHelpers.js';
import { Attributes, TableNavDelete } from '../DataAttributes.js';
import ButtonCreator from '../ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { scrollAndFocus } from '../Common.js';

const Log = ContextualLog.Create('MarkerTableNav');

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
 * [3] Visible marker table.
 */
export class TableNavigation {
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
        TableNavigation.#SelectNextTableCore(e, baseItemRow, input, up, false /*lastMatch*/);
    }

    /**
     * Jump to the first/last visible marker table (Ctrl+Alt+Shift+Up/Down when focused on a table)
     * @param {Event} e The initiating event
     * @param {BaseItemResultRow} baseItemRow The base item row associated with the current focus target
     * @param {HTMLElement} input The currently focused element
     * @param {boolean} up Whether we're navigating up or down. */
    static SelectFirstLastTable(e, baseItemRow, input, up) {
        TableNavigation.#SelectNextTableCore(e, baseItemRow, input, up, true /*lastMatch*/);
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
        const targetRow = TableNavigation.#GetTargetRow(input);
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
            return TableNavigation.SelectBaseItemRow(e, baseItemRow, up);
        } else if (goMax) {
            up = !up;
        }

        let focusRow = goMax ? rows[currentIndex] : (up ? targetRow.previousSibling : targetRow.nextSibling);
        while (focusRow) {
            const bestFocus = TableNavigation.GetBestFocusableInput(focusRow, { lastSelected : input, ctrlKey : goMax });
            if (bestFocus) {
                return baseItemRow.focus(e, bestFocus);
            }

            focusRow = up ? focusRow.previousSibling : focusRow.nextSibling;
        }

        // We had next rows, but nothing was focusable.
        TableNavigation.SelectBaseItemRow(e, baseItemRow, up);
    }

    /**
     * Select the next focusable input in the current marker row.
     * @param {Event} e Initiating event.
     * @param {HTMLElement} currentInput The currently focus target.
     * @param {boolean} left Whether we're navigating left or right. */
    static SelectNextTableRowInput(e, currentInput, left) {
        const inputs = TableNavigation.#GetRowInputs(currentInput);
        const currentIndex = inputs.indexOf(currentInput);
        if (currentIndex === -1 && !e.ctrlKey) {
            Log.warn(`selectNextTableRowInput: current input not a navigable input, can't navigate.`);
            return;
        }

        const focusRow = TableNavigation.#GetTargetRow(currentInput);
        const focusInput = TableNavigation.GetBestFocusableInput(focusRow,
            { lastSelected : currentInput, left : left, ctrlKey : e.ctrlKey });
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
        const inputs = TableNavigation.#GetRowInputs(row);
        let currentIndex = inputs.indexOf(options.lastSelected);
        const sameRow = currentIndex !== -1;
        const leftSet = typeof(options.left) === 'boolean';
        Log.assert(!sameRow || (leftSet || options.ctrlKey),
            `If lastSelected is in the same row, 'options.left' should be set, or ctrl should be set.`);
        Log.assert(!options.forceNavMatch || options.lastSelected, `forceNavMatch doesn't work without a lastSelect element.`);

        // Only do nav target matching if we're switching rows.
        if (!sameRow) {
            const navMatch = TableNavigation.#CheckNavMatch(options.lastSelected, row);
            if (navMatch) {
                return navMatch;
            }

            if (options.forceNavMatch) {
                return;
            }

            // If we don't have a nav match, but are switching rows, calculate the number of visible
            // inputs we are from the end, as that results in better "nearest neighbor" positioning.
            const bestIndex = TableNavigation.#GetBestIndex(options.lastSelected, inputs);
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
            if (TableNavigation.#IsInputTargetable(input)) {
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
            return TableNavigation.#GetBestLeftRight(options, inputs, currentIndex, checkInput);
        }

        return TableNavigation.#GetBestNeighbor(options, inputs, currentIndex, checkInput);
    }

    /**
     * Check for a nav id match in the given row.
     * @param {HTMLElement} input The input to check
     * @param {HTMLElement} row The row to check for a nav match in. */
    static #CheckNavMatch(input, row) {
        const navTarget = input?.getAttribute(Attributes.TableNav);
        if (navTarget) {
            const navMatch = $$(`[${Attributes.TableNav}="${navTarget}"]`, row);
            if (navMatch && TableNavigation.#IsInputTargetable(navMatch)) {
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

        const lastRows = TableNavigation.#GetRowInputs(input);
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
        const tagName = input.tagName;
        if (upDown) {
            // For up/down navigation, we just care whether we're
            // in a select element, in which case we don't want to navigate.
            return tagName !== 'SELECT';
        }

        if (tagName === 'SELECT') {
            // No matter what, disable left/right to toggle select options, only allow up/down.
            e.preventDefault();
            return true;
        }

        if (tagName !== 'INPUT' || input.type !== 'text') {
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
        const row = TableNavigation.#GetTargetRow(element);
        if (!row) {
            return [];
        }

        // Completely ignore hidden inputs, as we never want to select them.
        // However, keep disabled elements, since even though we won't select them,
        // they're important for nearest-neighbor calculations
        return Array.from($(`[${Attributes.TableNav}]`, row)).filter(i => !TableNavigation.#IsInputHidden(i));
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
        return !TableNavigation.#IsInputHidden(input) && !TableNavigation.#IsInputDisabled(input);
    }
}
