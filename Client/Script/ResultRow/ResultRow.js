import { $, $$, appendChildren, buildNode, buildText, clickOnEnterCallback, plural, scrollAndFocus } from '../Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import Tooltip, { TooltipTextSize } from '../Tooltip.js';
import { Attributes } from '../DataAttributes.js';
import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { FilterDialog } from '../FilterDialog.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import { isSmallScreen } from '../WindowResizeEventHandler.js';
import { PlexClientState } from '../PlexClientState.js';
import { PurgedMarkers } from '../PurgedMarkerManager.js';
import { ThemeColors } from '../ThemeColors.js';

/** @typedef {!import('/Shared/PlexTypes').PlexData} PlexData */
/** @typedef {!import('../Tooltip.js').TooltipOptions} TooltipOptions */


/** @typedef {{ scrollTo?: HTMLElement, focusTo?: HTMLElement}} FocusNext */

const Log = new ContextualLog('ResultRow');

/**
 * ResultRow is the base class that all result rows inherit from in some capacity.
 * The current inheritance tree is outlined below:
 *
 *                                ResultRow
 *               ________________/ /  |  \ \____________________
 *              /         ________/   |   \______               \
 *             /         /            |         /                \
 *            /    BulkAction  SectionOptions  /                  \
 *           /                                /                    \
 *       BaseItem                        SeasonBase             ShowBase
 *      /        \                      /          \           /        \
 *  Episode     Movie               Season    SeasonTitle   Show     ShowTitle
 */

/**
 * Return a warning icon used to represent that a show/season/episode has purged markers.
 * @returns {HTMLImageElement} */
export function purgeIcon() {
    return appendChildren(buildNode('i', { tabindex : 0 }, 0, { keyup : clickOnEnterCallback }),
        getSvgIcon(Icons.Warn, ThemeColors.Orange, { class : 'purgedIcon' }));
}

/**
 * Returns a filter icon used to indicate that a season/episode list is hiding some
 * entries due to the current filter.
 * @returns {HTMLImageElement} */
export function filteredListIcon() {
    return appendChildren(buildNode('i'),
        getSvgIcon(Icons.Filter, ThemeColors.Orange, { width : 16, height : 16, class : 'filteredGroupIndicator' }));
}

/** Represents a single row of a show/season/episode in the results page. */
export class ResultRow {

    /**
     * Return a row indicating that there are no rows to show because
     * the active filter is hiding all of them. Clicking the row displays the filter UI.
     * @returns {HTMLElement} */
    static NoResultsBecauseOfFilterRow() {
        return buildNode(
            'div',
            { class : 'topLevelResult tabbableRow', tabindex : 0 },
            'No results with the current filter.',
            { click : () => new FilterDialog(PlexClientState.activeSectionType()).show(),
              keydown : clickOnEnterCallback });
    }

    /** The HTML of the row.
     * @type {HTMLElement} */
    #html;

    /** The base data associated with this row.
     * @type {PlexData} */
    #mediaItem;

    /** The class name of the row, if any.
     * @type {string} */
    #className;

    /**
     * @param {PlexData} mediaItem The base data associated with this row.
     * @param {string} className The class name of the row, if any. */
    constructor(mediaItem, className) {
        this.#mediaItem = mediaItem;
        this.#className = className;
    }

    /** @returns the `HTMLElement` associated with this row. */
    html() { return this.#html; }

    /**
     * Sets the HTML for this row.
     * @param {HTMLElement} html */
    setHtml(html) {
        this.#html = html;
        this.#html.classList.add('dynamicText');
        this.#html.classList.add('resultRow');
    }

    /** Build a row's HTML. Unimplemented in the base class. */
    buildRow() {}

    /** @returns {PlexData} The base media item associated with this row. */
    mediaItem() { return this.#mediaItem; }

    /** @returns The number of purged markers associated with this row. */
    getPurgeCount() { return PurgedMarkers.getPurgeCount(this.#mediaItem?.metadataId); }

    /** @returns Whether this media item has any purged markers. */
    hasPurgedMarkers() { return this.getPurgeCount() > 0; }

    /** @returns {() => void} An event callback that will invoke the purge overlay if purged markers are present. */
    getPurgeEventListener() { Log.error(`Classes must override getPurgeEventListener.`); return () => {}; }

    /** Updates the marker breakdown text ('X/Y (Z.ZZ%)) and tooltip, if necessary. */
    updateMarkerBreakdown() {
        // No updates necessary if extended breakdown stats aren't enabled
        if (!ClientSettings.showExtendedMarkerInfo()) {
            return;
        }

        const span = $$('.showResultEpisodes span', this.#html);
        if (!span) {
            Log.warn('Could not find marker breakdown span, can\'t update.');
            return;
        }

        span.replaceWith(this.episodeDisplay());
    }

    /**
     * Updates the episode display text, even if extended marker info is disabled, as
     * we might want to show/hide the purged marker icon. */
    updatePurgeDisplay() {
        $$('.showResultEpisodes span', this.#html).replaceWith(this.episodeDisplay());
    }

    /**
     * Determine whether we should load child seasons/episodes/marker tables when
     * clicking on the row. Returns false if the group has purged markers and the
     * user clicked on the marker info.
     * @param {EventTarget} target */
    ignoreRowClick(target) {
        if (!(target instanceof Element)) {
            return false;
        }

        if (this.hasPurgedMarkers() && (
            target.classList.contains('episodeDisplayText')
            || (target.parentElement && target.parentElement.classList.contains('episodeDisplayText'))
            || this.isClickTargetInImage(target))) {
            return true; // Don't show/hide if we're repurposing the marker display.
        }

        let parent = target;
        while (parent && !(parent instanceof HTMLSpanElement)) {
            if (parent.classList.contains('markerInfoIcon')) {
                return true;
            }

            parent = parent.parentElement;
        }

        return false;
    }

    /**
     * Determine if the given element is an image/svg, or belongs to an svg.
     * @param {Element} target */
    isClickTargetInImage(target) {
        switch (target.tagName.toUpperCase()) {
            case 'I':
                return !!$$('svg', target);
            case 'IMG':
            case 'SVG':
                return true;
            default: {
                // Check whether we're in an SVG element. Use a tabbable row as a bailout condition.
                let parent = target;
                while (parent) {
                    if (parent.tagName.toUpperCase() === 'SVG') {
                        return true;
                    } else if (parent.hasAttribute('tabIndex')) {
                        return false;
                    }

                    parent = parent.parentElement;
                }

                return false;
            }
        }
    }

    /**
     * Create and return the main content of the marker row.
     * @param {HTMLElement} titleColumn The first/title column of the row.
     * @param {HTMLElement} [customColumn=null] The second row, which is implementation specific.
     * @param {() => void} [clickCallback=null] The callback to invoke, if any, when the row is clicked. */
    buildRowColumns(titleColumn, customColumn, clickCallback=null) {
        const events = { keydown : this.onRowKeydown.bind(this) };
        const properties = {};
        let className = this.#className;
        if (clickCallback) {
            events.click = clickCallback;
            className += ' tabbableRow';
            properties.tabindex = 0;
        }

        properties.class = className;
        titleColumn.classList.add('resultTitle');

        return appendChildren(buildNode('div', properties, 0, events),
            titleColumn,
            customColumn,
            buildNode('div', { class : 'showResultEpisodes' }, this.episodeDisplay()));
    }

    /**
     * Handles basic arrow navigation for all result rows and headers that aren't  "base" items.
     * Movie and Episode rows have their own similar, but more complex logic since marker tables
     * are also thrown into the mix.
     * @param {KeyboardEvent} e */
    onRowKeydown(e) {
        if (this.ignoreRowClick(e.target)) {
            return;
        }

        if (e.altKey) {
            return;
        }

        /** @type {HTMLElement} */
        const thisRow = this.html();
        const thisTabbable = thisRow.classList.contains('tabbableRow');

        switch (e.key) {
            case 'Enter':
                if (!e.ctrlKey && thisTabbable) {
                    return thisRow.click();
                }
                break;
            case 'ArrowUp':
            case 'ArrowDown':
            {
                this.#handleArrowUpDown(e);
                break;
            }
            case 'ArrowLeft':
            case 'ArrowRight':
            {
                if (thisTabbable || e.shiftKey) {
                    return;
                }

                this.#scrollAndFocus(e, thisRow, this.#getNextRowNavElement(e, e.key === 'ArrowLeft', e.target));
                break;
            }
        }
    }

    /**
     * Select the next focus target, if any, based on an up or down arrow keypress.
     * @param {KeyboardEvent} e */
    #handleArrowUpDown(e) {
        const thisRow = this.html();
        const thisTabbable = thisRow.classList.contains('tabbableRow');
        const up = e.key === 'ArrowUp';
        /** @type {HTMLElement} */
        const sibling = up ? thisRow.previousSibling : thisRow.nextSibling;
        /** @type {FocusNext} */
        const focusTarget = { scrollTo : null, focusTo : null };

        // Ctrl+Click is limited to tabbable rows.
        // Ctrl+Shift+Click goes all the way to the first focusable item.
        if (e.ctrlKey && (e.shiftKey || (up && thisTabbable && !sibling.classList.contains('tabbableRow')))) {
            this.getFirstNavElement(!up, up ? sibling.parentElement.firstChild : sibling.parentElement.lastChild, focusTarget);
        } else if (e.ctrlKey) {
            this.#getNextTabbableRow(up, focusTarget);
        } else if (!e.shiftKey) {
            this.getFirstNavElement(up, sibling, focusTarget);
        }

        this.#scrollAndFocus(e, focusTarget.scrollTo, focusTarget.focusTo);
    }

    /**
     * Retrieve the nearest tabbable row from this row.
     * @param {boolean} up Whether we're navigating up or down.
     * @param {FocusNext} focusResult */
    #getNextTabbableRow(up, focusResult) {
        const tabbableRows = $('.tabbableRow', this.html().parentElement);
        const nextRow = (up || !this.html().classList.contains('tabbableRow')) ? tabbableRows[0] : tabbableRows[tabbableRows.length - 1];
        focusResult.scrollTo = nextRow;
        focusResult.focusTo = nextRow;
    }

    /**
     * Find the closest nav target to the given start, either a tabbable row or a navigable input.
     * Public, as it's used by BaseItemResultRow, but should be treated as protected.
     * @param {boolean} up
     * @param {HTMLElement} start
     * @param {FocusNext} focusResult */
    getFirstNavElement(up, start, focusResult) {
        let row = start;
        while (row) {
            const tabbable = row.classList.contains('tabbableRow') ? row : $$('.tabbableRow', row);
            if (tabbable) {
                focusResult.scrollTo = row;
                focusResult.focusTo = tabbable;
                return;
            }

            const navEle = this.#getNavElements(row)[0];
            if (navEle) {
                focusResult.scrollTo = row;
                focusResult.focusTo = navEle;
                return;
            }

            row = up ? row.previousSibling : row.nextSibling;
        }
    }

    /**
     * Return all valid navigation targets inside of the  given element.
     * @param {HTMLElement} container */
    #getNavElements(container) {
        return Array.from($(`[${Attributes.TableNav}]`, container)).filter(navItem => {
            if (navItem.disabled) {
                return false;
            }

            let parent = navItem;
            while (parent) {
                if (parent.classList.contains('hidden') || parent.classList.contains('disabled')) {
                    return false;
                }

                parent = parent.parentElement;
            }

            return true;
        });
    }

    /**
     * Scroll the given scroll target into view and set
     * focus to the given element, if focusTarget is valid.
     * @param {KeyboardEvent} e The initiating event.
     * @param {HTMLElement} scrollTarget The element to scroll into view.
     * @param {HTMLElement} focusTarget The element to set focus to. */
    #scrollAndFocus(e, scrollTarget, focusTarget) {
        if (focusTarget) {
            scrollAndFocus(e, scrollTarget, focusTarget);
        }
    }

    /**
     * Find the next item to set focus to in this row.
     * @param {KeyboardEvent} e The initiating event.
     * @param {boolean} left Whether we're moving left or right.
     * @param {HTMLElement} currentFocus The element that currently has focus. */
    #getNextRowNavElement(e, left, currentFocus) {
        const navItems = this.#getNavElements(this.html());
        if (e.ctrlKey) {
            return navItems[left ? 0 : navItems.length - 1];
        }

        return navItems[Math.max(0, Math.min(navItems.indexOf(currentFocus) + (left ? -1 : 1), navItems.length - 1))];
    }

    /**
     * Adds a 'back' button to the given row. Used by 'selected' rows.
     * @param {HTMLElement} row The row to add the button to.
     * @param {string} buttonText The text of the button.
     * @param {() => void} callback The callback to invoke when the button is clicked. */
    addBackButton(row, buttonText, callback) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
            ButtonCreator.fullButton(buttonText, Icons.Back, ThemeColors.Primary, callback, { [Attributes.TableNav] : 'back' }));
    }

    /**
     * Get the episode summary display, which varies depending on whether extended marker information is enabled.
     * @returns A basic 'X Episode(s)' string if extended marker information is disabled, otherwise a Span
     * that shows how many episodes have at least one marker, with tooltip text with a further breakdown of
     * how many episodes have X markers. */
    episodeDisplay() {
        const mediaItem = this.mediaItem();
        const baseText = plural(mediaItem.episodeCount, 'Episode');
        const purgeTooltip = withStats => {
            const purgeCount = this.getPurgeCount();
            const markerText = purgeCount === 1 ? 'marker' : 'markers';
            return `${withStats ? '' : '<span>'}<b>${purgeCount} purged ${markerText}</b><br>Click for details</span>`;
        };

        /** @type {TooltipOptions} */
        const ttOptions = {
            textSize : TooltipTextSize.Larger,
            noBreak : true,
        };

        if (!ClientSettings.showExtendedMarkerInfo() || !mediaItem.markerBreakdown()) {
            // The feature isn't enabled or we don't have a marker breakdown. The breakdown can be null if the
            // user kept this application open while also adding episodes in PMS (which _really_ shouldn't be done).

            if (!this.hasPurgedMarkers()) {
                // For episodeDisplay updating, be consistent and wrap base text in a div.
                return buildNode('span', {}, baseText);
            }

            // Still want purge icon if necessary
            const purgeText = buildNode('span', {}, baseText);
            purgeText.appendChild(purgeIcon());

            const mainText = buildNode('span', { class : 'episodeDisplayText' }, purgeText, { click : this.getPurgeEventListener() });
            Tooltip.setTooltip(mainText, purgeTooltip(false /*withStats*/), ttOptions);
            return mainText;
        }

        let atLeastOne = 0;

        // Tooltip should really handle more than plain text, but for now write the HTML itself to allow
        // for slightly larger text than the default.
        let tooltipText = `<span>${baseText}<hr>`;
        const breakdown = mediaItem.markerBreakdown();
        const intros = breakdown.itemsWithIntros();
        const credits = breakdown.itemsWithCredits();
        const ads = breakdown.itemsWithAds();
        const items = breakdown.totalItems();
        /** @type {(n: number) => 'has' | 'have'} */
        const hasHave = (n) => n === 1 ? 'has' : 'have';
        tooltipText += `${intros} ${hasHave(intros)} intros (${(intros / items * 100).toFixed(0)}%)<br>`;
        tooltipText += `${credits} ${hasHave(credits)} credits (${(credits / items * 100).toFixed(0)}%)${ads < 1 ? '<hr>' : '<br>'}`;

        // Only add ad data if there's at least one, since the average user without a DVR won't have many/any.
        if (ads > 0) tooltipText += `${ads} ${hasHave(ads)} ads (${(ads / items * 100).toFixed(0)}%)<hr>`;
        for (const [key, episodeCount] of Object.entries(mediaItem.markerBreakdown().collapsedBuckets())) {
            tooltipText += `${episodeCount} ${episodeCount === 1 ? 'has' : 'have'} ${plural(parseInt(key), 'marker')}<br>`;
            if (+key !== 0) {
                atLeastOne += episodeCount;
            }
        }

        if (atLeastOne === 0) {
            tooltipText = `<span class="largeTooltip">${baseText}<br>None have markers.</span>`;
            ttOptions.noBreak = false;
        } else {
            const totalIntros = breakdown.totalIntros();
            const totalCredits = breakdown.totalCredits();
            const totalAds = breakdown.totalAds();
            tooltipText += `<hr>${plural(totalIntros, 'total intro')}<br>`;
            tooltipText += `${plural(totalCredits, 'total credit')}<br>`;
            if (totalAds > 0) tooltipText += `${plural(totalAds, 'total ad')}<br>`;
            tooltipText += this.hasPurgedMarkers() ? '<hr>' : '</span>';
        }

        const smallScreen = isSmallScreen();
        const percent = (atLeastOne / mediaItem.episodeCount * 100).toFixed(smallScreen ? 0 : 2);
        let displayText = `${atLeastOne}/${mediaItem.episodeCount} `;
        if (smallScreen) {
            displayText = appendChildren(buildNode('span', { class : 'episodeDisplayHolder' }),
                buildText(displayText),
                buildNode('i',
                    { class : 'markerInfoIcon' },
                    getSvgIcon(Icons.Info, ThemeColors.Primary, { height : 12 }),
                    { click : () => { if (Tooltip.active()) { Tooltip.dismiss(); } } }));
        } else {
            displayText += `(${percent}%)`;
            displayText = buildNode('span', {}, displayText);
        }

        if (this.hasPurgedMarkers()) {
            displayText.appendChild(purgeIcon());
            tooltipText += purgeTooltip(true /*withStats*/);
        }

        const mainText = buildNode('span', { class : 'episodeDisplayText' }, displayText);
        Tooltip.setTooltip(mainText, tooltipText, ttOptions);
        if (this.hasPurgedMarkers()) {
            mainText.addEventListener('click', this.getPurgeEventListener());
        }

        return mainText;
    }

    /**
     * Inserts a small loading icon into a result row.
     * @param {string} attachTo The query selector to retrieve the element to add the loading icon to. */
    insertInlineLoadingIcon(attachTo) {
        const stats = $$(attachTo, this.html());
        const load = stats ? ButtonCreator.loadingIcon(18, { class : 'inlineLoadingIcon' }) : null;
        stats?.insertBefore(load, stats.firstChild);
    }

    /**
     * Removes the inline loading icon from the result row, if any.
     * NOTE: assumes only a single loading icon exists in the row at one time. */
    removeInlineLoadingIcon() {
        const icon = $$('.inlineLoadingIcon', this.html());
        icon?.parentElement.removeChild(icon);
    }

    /**
     * Return whether the given target is part of the marker info icon.
     * @param {Element} target */
    isInfoIcon(target) {
        let ele = target;
        while (ele) {
            if (ele.tagName === 'I') {
                return ele.classList.contains('markerInfoIcon');
            }

            if (ele.classList.contains('resultRow')) {
                return false;
            }

            ele = ele.parentElement;
        }

        return false;
    }
}
