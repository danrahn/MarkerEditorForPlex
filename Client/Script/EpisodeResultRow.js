import { $$, appendChildren, buildNode, pad0, plural } from './Common.js';
import BaseItemResultRow from './BaseItemResultRow.js';
import { ClientSettings } from './ClientSettings.js';
import { isSmallScreen } from './WindowResizeEventHandler.js';
import { PlexClientState } from './PlexClientState.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import { purgeIcon } from './ResultRow.js';
import Tooltip from './Tooltip.js';

/** @typedef {!import('../../../Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import ('../ClientDataExtensions').ClientEpisodeData} ClientEpisodeData */

/**
 * A result row for a single episode of a show.
 */
export default class EpisodeResultRow extends BaseItemResultRow {
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
        const row = buildNode('div');
        appendChildren(row,
            appendChildren(
                buildNode('div',
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
                        ]
                    }),
                appendChildren(buildNode('div', { class : 'episodeName' }),
                    this.getExpandArrow(),
                    buildNode('span', { class : 'episodeRowTitle' }, this.#displayTitle())
                ),
                this.#buildMarkerText()
            ),
            ep.markerTable().table(),
            buildNode('hr', { class : 'episodeSeparator' })
        );

        this.setHtml(row);
        return row;
    }

    /**
     * Adjust episode title text depending on the new screen size. */
    updateTitleOnWindowResize() {
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
        if (!e.ctrlKey || e.key !== 'Enter') {
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
        const text = buildNode('span', {}, smallScreen ? markerCount.toString() : plural(markerCount, 'Marker'));
        if (smallScreen) {
            text.classList.add('smallScreenMarkerCount');
        }

        if (hasPurges) {
            text.appendChild(purgeIcon());
        }

        const main = buildNode('div', { class : 'episodeDisplayText' }, text);
        if (!hasPurges) {
            return main;
        }

        const purgeCount = this.getPurgeCount();
        const markerText = purgeCount === 1 ? 'marker' : 'markers';
        Tooltip.setTooltip(main, `Found ${purgeCount} purged ${markerText}.<br>Click for details.`);
        main.addEventListener('click', this.#onEpisodePurgeClick.bind(this));
        // Explicitly set no title so it doesn't interfere with the tooltip
        main.title = '';
        return main;
    }

    /** Launches the purge table overlay. */
    #onEpisodePurgeClick() {
        PurgedMarkers.showSingleEpisode(this.episode().metadataId, $$('.tabbableRow', this.html()));
    }

    /**
     * Expand or collapse the marker table for the clicked episode.
     * If the user ctrl+clicks the episode, expand/contract for all episodes.
     * @param {MouseEvent} e */
    #showHideMarkerTableEvent(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        const expanded = this.episode().markerTable().isVisible();
        if (e.ctrlKey) {
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
