import { BaseItemResultRow } from './BaseItemResultRow.js';
import { purgeIcon } from './ResultRow.js';

import { $$, $append, $div, $divHolder, $hr, $span } from '../HtmlHelpers.js';
import { ctrlOrMeta, pad0, plural } from '../Common.js';
import { Attributes } from '../DataAttributes.js';
import { ClientSettings } from '../ClientSettings.js';
import { isSmallScreen } from '../WindowResizeEventHandler.js';
import { PlexClientState } from '../PlexClientState.js';
import { PurgedMarkers } from '../PurgedMarkerManager.js';
import Tooltip from '../Tooltip.js';
import TooltipBuilder from '../TooltipBuilder.js';

/** @typedef {!import('/Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import ('../ClientDataExtensions').ClientEpisodeData} ClientEpisodeData */
/** @typedef {!import('./SeasonResultRow').SeasonResultRow} SeasonResultRow */

/**
 * A result row for a single episode of a show.
 */
export class EpisodeResultRow extends BaseItemResultRow {
    /**
     * The parent {@linkcode SeasonResultRow}, used to communicate that marker tables of all
     * episodes in the season need to be shown/hidden.
     * @type {SeasonResultRow} */
    #seasonRow;

    constructor(episode, seasonRow) {
        super(episode, 'baseItemResult');
        this.#seasonRow = seasonRow;
    }

    /**
     * Return the underlying episode data associated with this result row.
     * @returns {ClientEpisodeData} */
    episode() { return this.mediaItem(); }

    /**
     * Builds a row for an episode of the form '> ShowName - SXXEYY - EpisodeName | X Marker(s)'
     * with a collapsed marker table that appears when this row is clicked.
     * @param {Object} markerData an array of serialized {@linkcode MarkerData} for the episode.
     * @param {ChapterData[]} chapters */
    buildRow(markerData, chapters = []) {
        const ep = this.episode();
        ep.createMarkerTable(this, markerData, chapters);
        const titleText = 'Click to expand/contract. Control+Click to expand/contract all';
        const row = $div({ class : 'resultRow', [Attributes.MetadataId] : ep.metadataId });
        $append(row,
            $append(
                $div(
                    {
                        class : 'baseItemResult tabbableRow',
                        title : titleText,
                        tabindex : 0
                    },
                    0,
                    {
                        click : this.#showHideMarkerTableEvent.bind(this),
                        keydown : [
                            this.onBaseItemResultRowKeydown.bind(this),
                            this.#onEpisodeRowKeydown.bind(this)
                        ],
                        longpress : this.showHideMarkerTablesAfterLongPress.bind(this),
                    }),
                $divHolder({ class : 'episodeName' },
                    this.getExpandArrow(),
                    $span(this.#displayTitle(), { class : 'episodeRowTitle' })
                ),
                this.#buildMarkerText()
            ),
            ep.markerTable().table(),
            $hr({ class : 'episodeSeparator' })
        );

        this.setHtml(row);
        this.register();
        return row;
    }

    /**
     * Adjust marker details and episode title text depending on the new screen size. */
    notifyWindowResize() {
        super.notifyWindowResize();
        $$('.episodeRowTitle', this.html()).innerText = this.#displayTitle();
    }

    /**
     * Return the episode title text depending on the screen size. Small screens
     * omit the show name. */
    #displayTitle() {
        const ep = this.episode();
        const sXeY = `S${pad0(ep.seasonIndex, 2)}E${pad0(ep.index, 2)}`;
        const base = `${sXeY} - ${ep.title || 'Episode ' + ep.index}`;
        if (isSmallScreen()) {
            return base;
        }

        return `${ep.showName} - ${base}`;
    }

    /**
     * @param {MouseEvent} e */
    #onEpisodeRowKeydown(e) {
        // Only difference between the base event is that Ctrl+Enter shows/hides all tables
        if (!ctrlOrMeta(e) || e.key !== 'Enter') {
            return;
        }

        this.showHideMarkerTables(this.episode().markerTable().isVisible());
    }

    /**
     * Show/hide all marker tables for the current season.
     * @param {boolean} hide */
    showHideMarkerTables(hide) {
        this.#seasonRow.showHideMarkerTables(hide);
    }

    /**
     * Builds the "X Marker(s)" span for this episode, including a tooltip if purged markers are present.
     * @returns {HTMLElement} */
    #buildMarkerText() {
        const episode = this.episode();
        const hasPurges = this.hasPurgedMarkers();
        const smallScreen = isSmallScreen();
        const markerCount = episode.markerTable().markerCount();
        const text = $span(smallScreen ? markerCount.toString() : plural(markerCount, 'Marker'));
        if (smallScreen) {
            text.classList.add('smallScreenMarkerCount');
        }

        if (hasPurges) {
            text.appendChild(purgeIcon());
        }

        const main = $div({ class : 'episodeDisplayText' }, text);
        if (!hasPurges) {
            return main;
        }

        const purgeCount = this.getPurgeCount();
        const markerText = purgeCount === 1 ? 'marker' : 'markers';
        Tooltip.setTooltip(main, new TooltipBuilder(`Found ${purgeCount} purged ${markerText}.`, `Click for details.`).get());
        main.addEventListener('click', this.#onEpisodePurgeClick.bind(this));
        // Explicitly set no title so it doesn't interfere with the tooltip
        main.title = '';
        return main;
    }

    /** Launches the purge table overlay.
     * @param {MouseEvent} e */
    #onEpisodePurgeClick(e) {
        if (this.isInfoIcon(e.target)) {
            return;
        }

        PurgedMarkers.showSingleEpisode(this.episode().metadataId, $$('.tabbableRow', this.html()));
    }

    /**
     * Expand or collapse the marker table for the clicked episode.
     * If the user ctrl+clicks the episode, expand/contract for all episodes.
     * @param {MouseEvent} e */
    #showHideMarkerTableEvent(e) {
        if (this.ignoreRowClick(e.target)) {
            return;
        }

        const expanded = this.episode().markerTable().isVisible();
        if (ctrlOrMeta(e)) {
            this.#seasonRow.showHideMarkerTables(expanded);
        } else {
            this.showHideMarkerTable(expanded);
        }
    }

    /** Scroll the marker table into view */
    scrollTableIntoView() {
        this.episode().markerTable().table().scrollIntoView({ behavior : 'smooth', block : 'nearest' });
    }

    /**
     * Updates the marker statistics both in the UI and the client state. */
    updateMarkerBreakdown() {
        // Don't bother updating in-place, just recreate and replace.
        const newNode = this.#buildMarkerText();
        const oldNode = $$('.episodeDisplayText', this.html());
        oldNode.replaceWith(newNode);

        const newKey = this.episode().markerTable().markerKey();
        const delta = newKey - this.currentKey();
        if (ClientSettings.showExtendedMarkerInfo()) {
            PlexClientState.updateBreakdownCache(this.episode(), delta);
        }

        this.setCurrentKey(newKey);
    }
}
