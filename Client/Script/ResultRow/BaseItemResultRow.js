import { $, $$ } from '../Common.js';
import { ClientMovieData } from '../ClientDataExtensions.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import { ResultRow } from './ResultRow.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';

/** @typedef {!import('../ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */


const Log = new ContextualLog('BaseItemRow');

/**
 * Class with functionality shared between "base" media types, i.e. movies and episodes.
 */
export class BaseItemResultRow extends ResultRow {
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
            this.#markerCountKey = MarkerBreakdown.keyFromMarkerCount(
                mediaItem.markerBreakdown().totalIntros(),
                mediaItem.markerBreakdown().totalCredits());
        }
    }

    /** @returns {MediaItemWithMarkerTable} */
    baseItem() { return this.mediaItem(); }

    currentKey() { return this.#markerCountKey; }
    /** @param {number} key */
    setCurrentKey(key) { this.#markerCountKey = key; }

    /**
     * Handles common keyboard input on rows with marker tables.
     * @param {KeyboardEvent} e */
    onBaseItemResultRowKeydown(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        // Like clicking, ctrl+arrow expands/collapses all.
        if (e.ctrlKey) {
            switch (e.key) {
                case 'ArrowRight':
                    return this.showHideMarkerTables(false /*hide*/);
                case 'ArrowLeft':
                    return this.showHideMarkerTables(true /*hide*/);
            }
        }

        if (e.altKey || e.shiftKey || e.ctrlKey) {
            return;
        }

        switch (e.key) {
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
                // Note: this is async for movies. If this ever changes to have additional
                // logic, make sure that's accounted for.
                return this.showHideMarkerTable(false /*hide*/);
            case 'ArrowLeft':
                return this.showHideMarkerTable(true /*hide*/);
            case 'ArrowUp':
            case 'ArrowDown':
            {
                const parentSibling = e.key === 'ArrowUp' ?
                    e.target.parentElement.previousSibling :
                    e.target.parentElement.nextSibling;
                const sibling = $$('.tabbableRow', parentSibling);
                if (sibling) {
                    e.preventDefault();
                    sibling.focus();
                }
                break;
            }
            case 'h':
            {
                /** @type {HTMLElement} */
                const child = $$('.tabbableRow', e.target.parentElement.parentElement);
                child?.scrollIntoView({ behavior : 'smooth', block : 'nearest' });
                return child?.focus({ preventScroll : true });
            }
            case 'e':
            {
                /** @type {HTMLElement} */
                const rows = $('.tabbableRow', e.target.parentElement.parentElement);
                if (rows) {
                    rows[rows.length - 1].scrollIntoView({ behavior : 'smooth', block : 'nearest' });
                    rows[rows.length - 1].focus({ preventScroll : true });
                }
                break;
            }
        }
    }

    /**
     * Returns the expand/contract arrow element */
    getExpandArrow() {
        return getSvgIcon(Icons.Arrow, ThemeColors.Primary, { class : 'markerExpand collapsed' });
    }

    /**
     * Rotates the expand/contract arrow after showing/hiding the marker table.
     * @param {boolean} hide Whether the marker table is being hidden */
    updateExpandArrow(hide) {
        $$('.markerExpand', this.html()).classList[hide ? 'add' : 'remove']('collapsed');
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
        let count = 0;
        const bodyRect = document.body.getBoundingClientRect();
        const isVisible = (/** @type {BaseItemResultRow} */ episode) => {
            const rect = episode.html().getBoundingClientRect();
            return rect.top < bodyRect.height && rect.y + rect.height > 0;
        };

        /** @type {Promise<void>[]} */
        const animations = [];

        // Improve perf a bit by doing the following:
        // * If the row isn't visible at the time of execution, don't animate the expansion/contraction.
        // * For visible rows, stagger the expansion/contraction so we don't try animating 30 rows at once.
        //   With the current duration of 150ms, a 25ms timer will ensure we only have at most 6 rows
        //   animating at once. As an added benefit, I think the staggered approach looks cleaner.
        for (const item of items) {
            const delay = count++;
            if (isVisible(item)) {
                animations.push(new Promise(r => {
                    setTimeout(() => { item.showHideMarkerTable(hide, true /*bulk*/); r(); }, delay * 25);
                }));
            } else {
                animations.push(item.showHideMarkerTable(hide, true /*bulk*/, false /*animate*/));
            }
        }

        return Promise.all(animations);
    }
}
