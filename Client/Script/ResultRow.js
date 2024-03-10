import { $$, appendChildren, buildNode, clearEle, clickOnEnterCallback, plural } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { errorMessage, errorResponseOverlay } from './ErrorHandling.js';
import { FilterDialog, FilterSettings, SortConditions, SortOrder } from './FilterDialog.js';
import { UISection, UISections } from './ResultSections.js';
import BulkActionResultRow from './BulkActionResultRow.js';
import ButtonCreator from './ButtonCreator.js';
import { ClientSettings } from './ClientSettings.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import { isSmallScreen } from './WindowResizeEventHandler.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import { SeasonData } from '../../Shared/PlexTypes.js';
import SeasonResultRow from './SeasonResultRow.js';
import SectionOptionsResultRow from './SectionOptionsResultRow.js';
import { ServerCommands } from './Commands.js';
import { ThemeColors } from './ThemeColors.js';
import Tooltip from './Tooltip.js';

/** @typedef {!import('../../Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import('../../Shared/PlexTypes').ChapterMap} ChapterMap */
/** @typedef {!import('../../Shared/PlexTypes').MarkerAction} MarkerAction */
/** @typedef {!import('../../Shared/PlexTypes').MarkerDataMap} MarkerDataMap */
/** @typedef {!import('../../Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('../../Shared/PlexTypes').PlexData} PlexData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedSeasonData} SerializedSeasonData */
/** @typedef {!import('../../Shared/PlexTypes').ShowData} ShowData */
/** @typedef {!import('./ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('./PurgedMarkerCache').PurgedSeason} PurgedSeason */
/** @typedef {!import('./PurgedMarkerCache').PurgedShow} PurgedShow */


const Log = new ContextualLog('ResultRow');

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
class ResultRow {

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

/**
 * A result row for a single show in the library.
 */
class ShowResultRow extends ResultRow {
    /**
     * When this show is active, holds a map of season metadata ids to its corresponding SeasonResultRow
     * @type {{[metadataId: number]: SeasonResultRow}} */
    #seasons = {};

    /**
     * If this is the active show, this is the number of rows that are currently filtered out.
     * @type {number} */
    #seasonsFiltered = 0;

    /** @type {SectionOptionsResultRow} */
    #sectionTitle;

    /**
     * The placeholder {@linkcode ShowResultRow} that displays the show name/stats when in season view.
     * @type {ShowResultRow} */
    #showTitle;

    /**
     * Whether this is a "dummy" row when displaying seasons/episodes
     * @type {boolean} */
    #selected;

    /** @param {ShowData} show */
    constructor(show) {
        super(show, 'topLevelResult showResult');
    }

    /**
     * Return the underlying show data associated with this result row.
     * @returns {ShowData} */
    show() { return this.mediaItem(); }

    /**
     * Creates a DOM element for this show.
     * Each entry contains three columns - the show name, the number of seasons, and the number of episodes.
     * @param {boolean} [selected=false] True if this row is selected and should be treated like
     * a header opposed to a clickable entry. */
    buildRow(selected=false) {
        this.#selected = selected;
        if (this.html()) {
            Log.warn('buildRow has already been called for this SeasonResultRow, that shouldn\'t happen');
            return this.html();
        }

        const show = this.show();
        const titleNode = buildNode('div', {}, show.title);
        if (show.originalTitle) {
            titleNode.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${show.originalTitle})`));
        }

        const customColumn = buildNode('div', { class : 'showResultSeasons' }, plural(show.seasonCount, 'Season'));
        const row = this.buildRowColumns(titleNode, customColumn, selected ? null : this.#showClick.bind(this));
        if (selected) {
            this.addBackButton(row, 'Back to results', async () => {
                UISections.clearSections(UISection.Seasons | UISection.Episodes);
                await UISections.hideSections(UISection.Seasons | UISection.Episodes);
                UISections.showSections(UISection.MoviesOrShows);
            });

            row.classList.add('dynamicText');
        }

        this.setHtml(row);
        return row;
    }

    /**
     * Returns the callback invoked when clicking on the marker count when purged markers are present. */
    getPurgeEventListener() {
        return this.#onShowPurgeClick.bind(this);
    }

    /**
     * Launches the purge overlay for this show. */
    #onShowPurgeClick() {
        // For dummy rows, set focus back to the first tabbable row, as the purged icon might not exist anymore
        const focusBack = this.#selected ? $$('.tabbableRow', this.html().parentElement) : this.html();
        PurgedMarkers.showSingleShow(this.show().metadataId, focusBack);
    }

    /**
     * Updates various UI states after purged markers are restored/ignored.
     * @param {PurgedShow} unpurged */
    notifyPurgeChange(unpurged) {
        const needsUpdate = [];
        for (const [seasonId, seasonRow] of Object.entries(this.#seasons)) {
            // Only need to update if the season was affected
            const unpurgedSeason = unpurged.get(seasonId);
            if (!unpurgedSeason) {
                continue;
            }

            needsUpdate.push(seasonRow);
        }

        /*async*/ PlexClientState.updateNonActiveBreakdown(this, needsUpdate);
    }

    /**
     * Update marker breakdown data after a bulk update.
     * @param {{[seasonId: number]: MarkerData[]}} changedMarkers */
    notifyBulkAction(changedMarkers) {
        const needsUpdate = [];
        for (const [seasonId, seasonRow] of Object.entries(this.#seasons)) {
            // Only need to update if the season was affected
            if (changedMarkers[seasonId]) {
                needsUpdate.push(seasonRow);
            }
        }

        return PlexClientState.updateNonActiveBreakdown(this, needsUpdate);
    }

    /** Update the UI after a marker is added/deleted, including our placeholder show row. */
    updateMarkerBreakdown() {
        if (this.#showTitle) { this.#showTitle.updateMarkerBreakdown(); }

        super.updateMarkerBreakdown();
    }

    /** Click handler for clicking a show row. Initiates a request for season details.
     * @param {MouseEvent} e */
    async #showClick(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        if (!PlexClientState.setActiveShow(this)) {
            Overlay.show('Unable to retrieve data for that show. Please try again later.');
            return;
        }

        // Gather purge data before continuing
        try {
            await PurgedMarkers.getPurgedShowMarkers(this.show().metadataId);
        } catch (err) {
            Log.warn(errorMessage(err), `Unable to get purged marker info for show ${this.show().title}`);
        }

        /*async*/ this.#getSeasons();
    }

    /** Get season details for this show */
    async #getSeasons() {
        const show = this.show();
        try {
            this.#showSeasons(await ServerCommands.getSeasons(show.metadataId));
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the seasons for ${show.title}`, err);
        }
    }

    /**
     * Takes the seasons retrieved for a show and creates and entry for each season.
     * @param {SerializedSeasonData[]} seasons List of serialized {@linkcode SeasonData} seasons for a given show. */
    async #showSeasons(seasons) {
        await UISections.hideSections(UISection.MoviesOrShows);
        UISections.clearAndShowSections(UISection.Seasons);

        const addRow = row => UISections.addRow(UISection.Seasons, row);
        if (ClientSettings.showExtendedMarkerInfo()) {
            this.#sectionTitle = new SectionOptionsResultRow();
            addRow(this.#sectionTitle.buildRow());
        }

        this.#showTitle = new ShowResultRow(this.show());
        addRow(this.#showTitle.buildRow(true /*selected*/));
        addRow(new BulkActionResultRow(this.show()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        this.#seasonsFiltered = 0;
        /** @type {HTMLElement?} */
        let firstRow = undefined;

        // Two loops:
        // Loop to create SeasonResultRows
        // Sort result rows based on current sort order
        // Loop to apply filter/add rows to the table
        for (const serializedSeason of seasons) {
            const season = new SeasonData().setFromJson(serializedSeason);
            const seasonRow = new SeasonResultRow(season, this);
            this.#seasons[season.metadataId] = seasonRow;
        }

        const sortedSeasons = this.#sortedSeasons();
        for (const seasonRow of sortedSeasons) {
            if (FilterSettings.shouldFilter(seasonRow.season().markerBreakdown())) {
                ++this.#seasonsFiltered;
            } else {
                const rowHtml = seasonRow.buildRow();
                firstRow ??= rowHtml;
                addRow(rowHtml);
            }

            PlexClientState.addSeason(seasonRow.season());
        }


        if (!firstRow) {
            firstRow = ResultRow.NoResultsBecauseOfFilterRow();
            addRow(firstRow);
        }

        firstRow.focus();

        this.#onFilterStatusChanged();
    }

    /**
     * Retrieve the season rows sorted based on our current sort settings. */
    #sortedSeasons() {
        const seasons = Object.values(this.#seasons);
        seasons.sort((a, b) => {
            const indexFallback = (left, right) => left.season().index - right.season().index;
            const asc = SortOrder.asc(FilterSettings.sortOrder);
            if (FilterSettings.sortBy === SortConditions.Alphabetical) {
                return asc ? indexFallback(a, b) : indexFallback(b, a);
            }

            if (FilterSettings.sortBy < SortConditions.MarkerCount || FilterSettings.sortBy > SortConditions.CreditsMarkerCount) {
                Log.warn(`sortedSeasons - Unexpected sort by condition "${FilterSettings.sortBy}", defaulting to index-based`);
                return indexFallback(a, b);
            }

            // TODO: share with PlexClientState.#defaultSort/#sortedEpisodes
            const filterMethod = FilterSettings.sortBreakdownMethod();
            let aMarkers = a.season().markerBreakdown()[filterMethod]();
            let bMarkers = b.season().markerBreakdown()[filterMethod]();
            if (SortOrder.percentage(FilterSettings.sortOrder)) {
                aMarkers /= a.season().episodeCount;
                bMarkers /= b.season().episodeCount;
            }

            if (aMarkers === bMarkers) {
                return indexFallback(a, b);
            }

            return (aMarkers - bMarkers) * (asc ? 1 : -1);
        });

        return seasons;
    }

    /**
     * Update what rows are visible based on the new filter. */
    onFilterApplied() {
        UISections.clearSections(UISection.Seasons);
        const addRow = row => UISections.addRow(UISection.Seasons, row);
        addRow(this.#sectionTitle.html());
        addRow(this.#showTitle.html());
        addRow(new BulkActionResultRow(this.show()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        const seasons = this.#sortedSeasons();
        this.#seasonsFiltered = 0;
        let anyShowing = false;
        for (const season of seasons) {
            if (FilterSettings.shouldFilter(season.season().markerBreakdown())) {
                ++this.#seasonsFiltered;
            } else {
                addRow(season.html() || season.buildRow());
                anyShowing = true;
            }
        }

        if (!anyShowing) {
            addRow(ResultRow.NoResultsBecauseOfFilterRow());
        }

        this.#onFilterStatusChanged();
        this.#sectionTitle?.updateFilterTooltip();
    }

    /**
     * Updates the 'X Season(s)' header with a filter icon if any seasons are hidden by the current filter. */
    #onFilterStatusChanged() {
        if (!this.#showTitle) {
            return;
        }

        const seasons = $$('.showResultSeasons', this.#showTitle.html());
        if (!seasons) {
            return;
        }

        const baseText = plural(this.show().seasonCount, 'Season');

        // Clear any existing tooltip to be safe
        Tooltip.removeTooltip(seasons);
        if (this.#seasonsFiltered === 0) {
            seasons.innerHTML = baseText;
        } else {
            Tooltip.setTooltip(seasons, `Current filter is hiding ${plural(this.#seasonsFiltered, 'season')}.`);
            clearEle(seasons);
            seasons.appendChild(filteredListIcon());
            seasons.appendChild(buildNode('span', {}, baseText));
        }
    }
}

export { ResultRow, ShowResultRow };
