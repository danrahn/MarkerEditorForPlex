import { $$, toggleClass } from '../HtmlHelpers.js';
import { Attributes } from '../DataAttributes.js';
import { ClientMovieData } from '../ClientDataExtensions.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { CustomEvents } from '../CustomEvents.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import { ResultRow } from './ResultRow.js';
import { scrollAndFocus } from '../Common.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';

/** @typedef {!import('../ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('./ResultRow').FocusNext} FocusNext */


const Log = ContextualLog.Create('BaseItemRow');

/**
 * Class with functionality shared between "base" media types, i.e. movies and episodes.
 */
export class BaseItemResultRow extends ResultRow {
    /** @type {{ [metadataId: number]: BaseItemResultRow }} */
    static #baseItems = {};
    static #registeredListener = false;

    /** Current MarkerBreakdown key. See MarkerCacheManager.js's BaseItemNode */
    #markerCountKey = 0;

    /**
     * @param {MediaItemWithMarkerTable} mediaItem
     * @param {string} [className] */
    constructor(mediaItem, className) {
        super(mediaItem, className);
        if (mediaItem && mediaItem.markerBreakdown()) {
            // Episodes are loaded differently from movies. It's only expected that movies have a valid value
            // here. Episodes set this when creating the marker table for the first time.
            Log.assert(mediaItem instanceof ClientMovieData, 'mediaItem instanceof ClientMovieData');
            this.#markerCountKey = mediaItem.markerBreakdown().key();
        }
    }

    /** @returns {MediaItemWithMarkerTable} */
    baseItem() { return this.mediaItem(); }

    isMovie() { return false; }

    currentKey() { return this.#markerCountKey; }
    /** @param {number} key */
    setCurrentKey(key) { this.#markerCountKey = key; }

    /**
     * Handles common keyboard input on rows with marker tables.
     * @param {KeyboardEvent} e */
    onBaseItemResultRowKeydown(e) {
        if (this.ignoreRowClick(e.target)) {
            return;
        }

        let bypass = false;
        if (e.ctrlKey) {
            bypass = this.#handleBaseItemCtrlKey(e);
        }

        if (e.shiftKey || e.altKey) {
            bypass ||= this.#handleBaseItemAltShiftKey(e);
        }

        if (!bypass && (e.altKey || e.shiftKey || e.ctrlKey)) {
            return;
        }

        switch (e.key) {
            default:
                return;
            case ' ':
                e.preventDefault();
            // fallthrough
            case 'Enter':
            {
                // Movie marker tables might not exist yet. In that case we want to show the table since we're
                // guaranteed to be hidden anyway, and showHideMarkerTable takes care of ensuring we have all
                // the data we need.
                return this.showHideMarkerTable(this.baseItem().markerTable().isVisible());
            }
            case 'ArrowRight':
            case 'ArrowLeft':
            case 'ArrowUp':
            case 'ArrowDown':
            case 'h':
            case 'e':
                return this.#handleBaseItemKeyNavigation(e);
        }
    }

    /**
     * Handles expanding/contracting all marker tables, and returns whether
     * it's okay to continue execution even if modifiers are present.
     * @param {KeyboardEvent} e */
    #handleBaseItemCtrlKey(e) {
        // Like clicking, ctrl+arrow expands/collapses all.
        switch (e.key) {
            case 'ArrowRight':
                this.showHideMarkerTables(false /*hide*/);
                return false;
            case 'ArrowLeft':
                this.showHideMarkerTables(true /*hide*/);
                return false;
            case 'ArrowUp':
            case 'ArrowDown':
                // Allow shift, and treat it the same as non-shift, as
                // it helps with shortcut chaining with other navigation
                // commands that use shift.
                return !e.altKey;
            default:
                return false;
        }
    }

    /**
     * Determine whether it's okay to continue processing the given
     * keystroke when Alt and/or Shift are pressed.
     * @param {KeyboardEvent} e */
    #handleBaseItemAltShiftKey(e) {
        switch (e.key) {
            case 'ArrowUp':
            case 'ArrowDown':
                return !e.ctrlKey && (e.altKey ^ e.shiftKey);
            case 'ArrowLeft':
            case 'ArrowRight':
                return !e.altKey;
        }

        return false;
    }

    /**
     * Entrypoint for handling arrow navigation.
     * See table in MarkerTable.js for an overview
     * of available shortcuts.
     * @param {KeyboardEvent} e */
    #handleBaseItemKeyNavigation(e) {
        let up = false;
        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowLeft':
                // Note: this is async for movies. If this ever changes to have additional
                // logic, make sure that's accounted for.
                return this.showHideMarkerTable(e.key === 'ArrowLeft' /*hide*/);
            case 'ArrowUp':
                up = true;
                // fallthrough
            case 'ArrowDown':
                if (e.ctrlKey) {
                    // Top/bottom. Very top if Ctrl+Shift
                    return this.#handleTopBottomNav(e, up, e.shiftKey);
                }

                if (e.shiftKey) {
                    // Only base item rows are allowed.
                    const nextRow = up ? this.getPreviousBaseItem() : this.getNextBaseItem();
                    nextRow?.focus(e);
                    return;
                }

                // Otherwise, try to be smart about our next target
                return this.#handleUpDownNavHard(e, up);
            case 'h':
                up = true;
                // fallthrough
            case 'e':
                return this.#handleTopBottomNav(e, up, false /*veryTop*/);
        }
    }

    /**
     * Handles navigating to the top or bottom of our list.
     * @param {KeyboardEvent} e The initiating event.
     * @param {boolean} up Whether we're navigating up or down.
     * @param {boolean} veryTop Whether to go to the very top (i.e. above the main rows) */
    #handleTopBottomNav(e, up, veryTop) {
        if (up && (veryTop || !this.getPreviousBaseItem())) {
            // Go up to section options. It's not a tabbable row,
            // so focus the first focusable thing.
            this.#focusNonBaseItemRow(e, this.html().parentElement.firstChild);
            return;
        }

        // eslint-disable-next-line consistent-this
        let curItem = this;
        /** @type {BaseItemResultRow} */
        let prevItem = curItem;
        while (curItem) {
            prevItem = curItem;
            curItem = up ? curItem.getPreviousBaseItem() : curItem.getNextBaseItem();
        }

        prevItem?.focus(e);
    }

    /**
     * Get the best next target, whether it's another base row, a marker table, or a header item.
     * @param {KeyboardEvent} e The initiating event.
     * @param {boolean} up Whether we're navigating up or down. */
    #handleUpDownNavHard(e, up) {
        let nextRow = up ? this.getPreviousBaseItem() : this;
        if (!nextRow) {
            if (e.altKey) {
                return;
            }

            // At the top row, so go into the header because Alt isn't preventing us
            // from only selecting marker tables.
            /** @type {FocusNext} */
            const focusResult = {};
            this.getFirstNavElement(true, this.html().previousSibling, focusResult);
            if (focusResult.scrollTo) {
                scrollAndFocus(e, focusResult.scrollTo, focusResult.focusTo);
            }

            return;
        }

        let markerTable = nextRow.baseItem().markerTable();
        while (nextRow && (!markerTable || !markerTable.isVisible())) {
            if (e.altKey) {
                nextRow = up ? nextRow.getPreviousBaseItem() : nextRow.getNextBaseItem();
                markerTable = nextRow?.baseItem().markerTable();
            } else {
                // No marker table, and we aren't forced to find one, so move to the next base item and exit.
                if (!up) { nextRow = this.getNextBaseItem(); }

                nextRow?.focus(e);
                return;
            }
        }

        if (!markerTable || !markerTable.isVisible()) {
            // No marker table, but we were forced to find one, so don't do anything.
            Log.assert(e.altKey, `This should only be possible when alt is pressed.`);
            return;
        }

        const input = markerTable.getNextFocusElement(up);
        if (!input) {
            // This really shouldn't be possible, since all marker tables should
            // have at least one item that can be focused at all times.
            Log.warn(`Didn't find a single focusable item in a marker table. How did that happen?`);
            if (!up) { nextRow = this.getNextBaseItem(); }

            nextRow?.focus(e);
            return;
        }

        scrollAndFocus(e, nextRow.html(), input);
    }

    /**
     * @param {KeyboardEvent} e
     * @param {HTMLElement} focusRow */
    #focusNonBaseItemRow(e, focusRow) {
        const focusItem = focusRow && $$(`[${Attributes.TableNav}]`, focusRow);
        if (focusItem) {
            scrollAndFocus(e, focusRow, focusItem);
        }
    }

    /**
     * Returns the expand/contract arrow element */
    getExpandArrow() {
        return getSvgIcon(Icons.Arrow, ThemeColors.Primary, { class : 'expandIcon collapsed' });
    }

    /**
     * Rotates the expand/contract arrow after showing/hiding the marker table.
     * @param {boolean} hide Whether the marker table is being hidden */
    updateExpandArrow(hide) {
        toggleClass($$('.expandIcon', this.html()), 'collapsed', hide);
    }

    /**
     * Add this row to the collection of active rows.
     * Public, but should be treated as protected. */
    register() {
        BaseItemResultRow.#RegisterBaseItem(this);
    }

    /**
     * Retrieve the BaseItem that is above this row, if any */
    getPreviousBaseItem() {
        return BaseItemResultRow.#GetBaseItemFromHtml(this.html().previousSibling);
    }

    /**
     * Retrieve the BaseItem that is below this row, if any. */
    getNextBaseItem() {
        return BaseItemResultRow.#GetBaseItemFromHtml(this.html().nextSibling);
    }

    /**
     * @param {Event} e
     * @param {HTMLElement?} focusTarget */
    focus(e, focusTarget) {
        const focusOn = focusTarget || $$('.tabbableRow', this.html());
        scrollAndFocus(e, this.html(), focusOn);
    }

    showHideMarkerTablesAfterLongPress(target) {
        if (!this.ignoreRowClick(target)) {
            this.showHideMarkerTables(this.baseItem().markerTable().isVisible());
        }
    }

    /**
     * Expands or contracts the marker table for this row.
     * @param {boolean} hide
     * @param {boolean} bulk Whether we're in a bulk show/hide operation
     * @param {boolean} animate Whether to animate the visibility change. NOTE: even if set to true,
     *                          the row won't be animated if we think it's off-screen. */
    showHideMarkerTable(hide, bulk = false, animate = true) {
        const promise = this.baseItem().markerTable().setVisibility(!hide, bulk, animate);
        this.updateExpandArrow(hide);

        // Should really only be necessary on hide, but hide tooltips on both show and hide
        Tooltip.dismiss();
        return promise;
    }

    showHideMarkerTables(_hide) { Log.error(`BaseItemRow classes must override showHideMarkerTables `); }

    /**
     * Show/hide all marker tables for a given list of base items.
     * @param {boolean} hide
     * @param {BaseItemResultRow[]} items */
    static ShowHideMarkerTables(hide, items) {
        const bodyRect = document.body.getBoundingClientRect();
        const disconnected = (/** @type {BaseItemResultRow} */ item) => !item.html().isConnected;
        const isVisible = (/** @type {BaseItemResultRow} */ item) => {
            if (disconnected(item)) return false;
            const rect = item.html().getBoundingClientRect();
            return rect.top < bodyRect.height && rect.y + rect.height > 0;
        };

        /** @type {Promise<void>[]} */
        const animations = [];

        const sortedItems = hide ? items.map((item, i, arr) => arr[arr.length - 1 - i]) : items;

        // Improve perf a bit by doing the following:
        // * If the row isn't visible at the time of execution, don't animate the expansion/contraction.
        // * For visible rows, stagger the expansion/contraction so we don't try animating 30 rows at once.
        //   With the current duration of 150ms, a 25ms timer will ensure we only have at most 6 rows
        //   animating at once. As an added benefit, I think the staggered approach looks cleaner.
        let foundVisible = false;
        let count = 0;
        let hiddenAgain = false;
        for (const item of sortedItems) {
            if (!foundVisible && !isVisible(item)) {
                animations.push(item.showHideMarkerTable(hide, true /*bulk*/, false /*animate*/));
                count = 1;
                continue;
            }

            if (disconnected(item)) {
                animations.push(item.showHideMarkerTable(hide, true /*bulk*/, false /*animate*/));
                continue;
            }

            foundVisible = true;

            let delay = count;
            const shouldAnimate = !hiddenAgain && isVisible(item);
            if (shouldAnimate) {
                ++count;
            } else {
                if (hide) {
                    delay = 0;
                }

                // No more rows after this should be visible, saving us some isVisible calculations
                hiddenAgain = true;
            }

            if (delay === 0) {
                animations.push(item.showHideMarkerTable(hide, true /*bulk*/, shouldAnimate));
            } else {
                animations.push(new Promise(r => {
                    setTimeout(async () => {
                        await item.showHideMarkerTable(hide, true /*bulk*/, shouldAnimate);
                        r();
                    }, delay * 25);
                }));
            }
        }

        return Promise.all(animations);
    }

    /**
     * When switching between small and large window modes, update the marker display and let
     * the marker table know the window changed size. */
    notifyWindowResize() {
        this.updateMarkerBreakdown();
        this.baseItem().markerTable().onWindowResize();
    }

    /**
     * @param {BaseItemResultRow} baseItem */
    static #RegisterBaseItem(baseItem) {
        if (!BaseItemResultRow.#registeredListener) {
            Log.verbose(`Setting up BaseItem UISectionChanged event listener.`);
            window.addEventListener(CustomEvents.UISectionChanged, () => BaseItemResultRow.#ClearBaseItems());
            BaseItemResultRow.#registeredListener = true;
        }

        BaseItemResultRow.#baseItems[baseItem.baseItem().metadataId] = baseItem;
    }

    static #ClearBaseItems() {
        BaseItemResultRow.#baseItems = {};
    }

    static #GetBaseItemFromMetadataId(metadataId) {
        return BaseItemResultRow.#baseItems[metadataId];
    }

    static #GetBaseItemFromHtml(html) {
        const metadataId = html?.getAttribute(Attributes.MetadataId);
        if (metadataId) {
            return BaseItemResultRow.#GetBaseItemFromMetadataId(metadataId);
        }
    }
}
