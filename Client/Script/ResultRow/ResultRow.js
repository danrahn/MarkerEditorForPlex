import { $$, appendChildren, buildNode, clickOnEnterCallback, plural } from '../Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { FilterDialog } from '../FilterDialog.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import { isSmallScreen } from '../WindowResizeEventHandler.js';
import { PlexClientState } from '../PlexClientState.js';
import { PurgedMarkers } from '../PurgedMarkerManager.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';

/** @typedef {!import('/Shared/PlexTypes').PlexData} PlexData */


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
    setHtml(html) { this.#html = html; }

    /** Build a row's HTML. Unimplemented in the base class. */
    buildRow() {}

    /** @returns {PlexData} The base media item associated with this row. */
    mediaItem() { return this.#mediaItem; }

    /** @returns The number of purged markers associated with this row. */
    getPurgeCount() { return PurgedMarkers.getPurgeCount(this.#mediaItem.metadataId); }

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
     * Determine whether we should load child seasons/episodes/marker tables when
     * clicking on the row. Returns false if the group has purged markers and the
     * user clicked on the marker info.
     * @param {MouseEvent} e */
    ignoreRowClick(e) {
        if (this.hasPurgedMarkers() && (
            e.target.classList.contains('episodeDisplayText')
            || (e.target.parentElement && e.target.parentElement.classList.contains('episodeDisplayText'))
            || this.isClickTargetInImage(e.target))) {
            return true; // Don't show/hide if we're repurposing the marker display.
        }

        return false;
    }

    /**
     * Determine if the given element is an image/svg, or belongs to an svg.
     * @param {Element} target */
    isClickTargetInImage(target) {
        switch (target.tagName.toLowerCase()) {
            case 'i':
                return !!$$('svg', target);
            case 'img':
            case 'svg':
                return true;
            default: {
                // Check whether we're in an SVG element. Use a tabbable row as a bailout condition.
                let parent = target;
                while (parent) {
                    const tag = parent.tagName.toLowerCase();
                    if (tag === 'svg') {
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
     * Handles basic arrow navigation for a show/episode (i.e. non-"base" item) result row.
     * @param {KeyboardEvent} e */
    onRowKeydown(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        if (e.ctrlKey || e.altKey || e.shiftKey) {
            return;
        }

        switch (e.key) {
            case 'Enter':
                return e.target.click();
            case 'ArrowUp':
            case 'ArrowDown':
            {
                const sibling = e.key === 'ArrowUp' ? e.target.previousSibling : e.target.nextSibling;
                if (sibling) {
                    e.preventDefault();
                    sibling.focus();
                }
                break;
            }
        }
    }

    /**
     * Adds a 'back' button to the given row. Used by 'selected' rows.
     * @param {HTMLElement} row The row to add the button to.
     * @param {string} buttonText The text of the button.
     * @param {() => void} callback The callback to invoke when the button is clicked. */
    addBackButton(row, buttonText, callback) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
            ButtonCreator.fullButton(buttonText, Icons.Back, ThemeColors.Primary, callback));
    }

    /**
     * Get the episode summary display, which varies depending on whether extended marker information is enabled.
     * @returns A basic 'X Episode(s)' string if extended marker information is disabled, otherwise a Span
     * that shows how many episodes have at least one marker, with tooltip text with a further breakdown of
     * how many episodes have X markers. */
    episodeDisplay() {
        const mediaItem = this.mediaItem();
        const baseText = plural(mediaItem.episodeCount, 'Episode');
        if (!ClientSettings.showExtendedMarkerInfo() || !mediaItem.markerBreakdown()) {
            // The feature isn't enabled or we don't have a marker breakdown. The breakdown can be null if the
            // user kept this application open while also adding episodes in PMS (which _really_ shouldn't be done).
            return baseText;
        }

        let atLeastOne = 0;
        // Tooltip should really handle more than plain text, but for now write the HTML itself to allow
        // for slightly larger text than the default.
        let tooltipText = `<span class="largerTooltip noBreak">${baseText}<hr>`;
        const breakdown = mediaItem.markerBreakdown();
        const intros = breakdown.itemsWithIntros();
        const credits = breakdown.itemsWithCredits();
        const items = breakdown.totalItems();
        tooltipText += `${intros} ${intros === 1 ? 'has' : 'have'} intros (${(intros / items * 100).toFixed(0)}%)<br>`;
        tooltipText += `${credits} ${credits === 1 ? 'has' : 'have'} credits (${(credits / items * 100).toFixed(0)}%)<hr>`;
        for (const [key, episodeCount] of Object.entries(mediaItem.markerBreakdown().collapsedBuckets())) {
            tooltipText += `${episodeCount} ${episodeCount === 1 ? 'has' : 'have'} ${plural(parseInt(key), 'marker')}<br>`;
            if (+key !== 0) {
                atLeastOne += episodeCount;
            }
        }

        if (atLeastOne === 0) {
            tooltipText = `<span class="largeTooltip">${baseText}<br>None have markers.</span>`;
        } else {
            const totalIntros = breakdown.totalIntros();
            const totalCredits = breakdown.totalCredits();
            tooltipText += `<hr>${totalIntros} total intro${totalIntros === 1 ? '' : 's'}<br>`;
            tooltipText += `${totalCredits} total credit${totalCredits === 1 ? '' : 's'}<br>`;
            tooltipText += this.hasPurgedMarkers() ? '<hr>' : '</span>';
        }

        // TODO: Is it worth making toFixed dynamic? I don't think so.
        const percent = (atLeastOne / mediaItem.episodeCount * 100).toFixed(isSmallScreen() ? 0 : 2);
        const innerText = buildNode('span', {}, `${atLeastOne}/${mediaItem.episodeCount} (${percent}%)`);

        if (this.hasPurgedMarkers()) {
            innerText.appendChild(purgeIcon());
            const purgeCount = this.getPurgeCount();
            const markerText = purgeCount === 1 ? 'marker' : 'markers';
            tooltipText += `<b>${purgeCount} purged ${markerText}</b><br>Click for details</span>`;
        }

        const mainText = buildNode('span', { class : 'episodeDisplayText' }, innerText);
        Tooltip.setTooltip(mainText, tooltipText);
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
}
