import { $$, $append, $br, $div, $divHolder, $hr, $span } from '../HtmlHelpers.js';
import { ctrlOrMeta, plural } from '../Common.js';
import { errorMessage, errorToast } from '../ErrorHandling.js';
import { Attributes } from '../DataAttributes.js';
import { BaseItemResultRow } from './BaseItemResultRow.js';
import { ClientSettings } from '../ClientSettings.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { CustomEvents } from '../CustomEvents.js';
import { isSmallScreen } from '../WindowResizeEventHandler.js';
import { PlexClientState } from '../PlexClientState.js';
import { PurgedMarkers } from '../PurgedMarkerManager.js';
import { purgeIcon } from './ResultRow.js';
import { ServerCommands } from '../Commands.js';
import Tooltip from '../Tooltip.js';
import TooltipBuilder from '../TooltipBuilder.js';

/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('../ClientDataExtensions').ClientMovieData} ClientMovieData */


const Log = ContextualLog.Create('MovieRow');

/**
 * A result row for a single movie.
 */
export class MovieResultRow extends BaseItemResultRow {

    /** @type {boolean} */
    #markersGrabbed = false;

    /**
     * @param {ClientMovieData} mediaItem */
    constructor(mediaItem) {
        super(mediaItem, 'topLevelResult baseItemResult');
        this.#markersGrabbed = this.movie().markerTable()?.hasRealData();
    }
    /**
     * Return the underlying episode data associated with this result row.
     * @returns {ClientMovieData} */
    movie() { return this.mediaItem(); }

    isMovie() { return true; }

    /**
     * Builds a row for an episode of the form '> MovieName (year) | X Marker(s)'
     * with a collapsed marker table that appears when this row is clicked. */
    buildRow() {
        const mov = this.movie();
        // Create a blank marker table if we haven't already, and only load when the marker table is shown
        const tableExists = !!mov.markerTable();
        const tableInitialized = tableExists && mov.markerTable().table();
        if (!tableExists) {
            mov.createMarkerTable(this);
        }

        const titleText = 'Click to expand/contract.';
        const titleNode = $div({ class : 'movieName', title : titleText });
        titleNode.appendChild(this.getExpandArrow());
        titleNode.appendChild($span(mov.title));
        if (mov.originalTitle) {
            titleNode.appendChild($span(` (${mov.originalTitle})`, { class : 'resultRowAltTitle' }));
        }

        titleNode.appendChild($span(` (${mov.year})`));
        if (mov.edition) {
            titleNode.appendChild($span(` [${mov.edition}]`, { class : 'resultRowAltTitle' }));
        }

        const row = $divHolder({ [Attributes.MetadataId] : mov.metadataId },
            $append(
                $div(
                    { class : 'baseItemResult tabbableRow', tabindex : 0 },
                    0,
                    {
                        click : this.#showHideMarkerTableEvent.bind(this),
                        keydown : this.onBaseItemResultRowKeydown.bind(this),
                        longpress : this.showHideMarkerTablesAfterLongPress.bind(this),
                    }),
                $div({ class : 'movieName', title : titleText }, titleNode),
                this.#buildMarkerText()
            ),
            $hr({ class : 'episodeSeparator' })
        );

        this.setHtml(row);

        // If the table has been initialized, it has the wrong parent. Move it over to
        // this row, and ensure the visibility is correct.
        if (tableExists) {
            mov.markerTable().setParent(this);

            if (tableInitialized) {
                this.html().insertBefore(mov.markerTable().table(), $$('.episodeSeparator', this.html()));
                this.showHideMarkerTable(!mov.markerTable().isVisible());
            }
        }

        this.register();
        return row;
    }

    /**
     * Builds the "X Marker(s)" span for this movie, including a tooltip if purged markers are present.
     * @returns {HTMLElement} */
    #buildMarkerText() {
        const movie = this.movie();
        const hasPurges = this.hasPurgedMarkers();
        let text;
        const tooltip = new TooltipBuilder();

        // Three scenarios to find the number of markers:
        // realMarkerCount == -1: we don't know how many markers we have, add '?' with a title
        // Extended stats disabled and no markers grabbed, but we have a realMarkerCount - use it
        // All other scenarios: use the actual marker table count.
        if (!ClientSettings.showExtendedMarkerInfo() && this.movie().realMarkerCount === -1) {
            text = $span('? Marker(s)');
            tooltip.addRaw('Click on the row to load marker counts.');
        } else {
            let markerCount = 0;
            if (!ClientSettings.showExtendedMarkerInfo() && !this.#markersGrabbed) {
                markerCount = movie.realMarkerCount;
            } else {
                markerCount = movie.markerTable().markerCount();
            }

            const smallScreen = isSmallScreen();
            text = $span(smallScreen ? markerCount.toString() : plural(markerCount, 'Marker'));
            if (smallScreen) {
                text.classList.add('smallScreenMarkerCount');
            }
        }

        if (hasPurges) {
            text.appendChild(purgeIcon());
        }

        const main = $div({ class : 'episodeDisplayText' }, text);
        if (!hasPurges) {
            if (!tooltip.empty()) {
                Tooltip.setTooltip(main, tooltip.get());
            }

            return main;
        }

        if (!tooltip.empty()) {
            tooltip.addLine($br());
        }

        const purgeCount = this.getPurgeCount();
        const markerText = purgeCount === 1 ? 'marker' : 'markers';
        tooltip.addRaw(`Found ${purgeCount} purged ${markerText}.`, $br(), `Click for details.`);
        Tooltip.setTooltip(main, tooltip.get());
        main.addEventListener('click', this.#onMoviePurgeClick.bind(this));
        // Explicitly set no title so it doesn't interfere with the tooltip
        main.title = '';
        return main;
    }

    /**
     * Launches the purge table overlay.
     * @param {MouseEvent} e */
    #onMoviePurgeClick(e) {
        if (this.isInfoIcon(e.target)) {
            return;
        }

        PurgedMarkers.showSingleMovie(this.movie().metadataId, $$('.tabbableRow', this.html()));
    }

    /**
     * Updates various UI states after purged markers are restored/ignored
     * @param {MarkerData[]?} newMarkers New markers that were added as the result of a restoration, or null if there weren't any
     * @param {MarkerData[]?} deletedMarkers
     * @param {MarkerData[]?} modifiedMarkers */
    notifyPurgeChange(newMarkers, deletedMarkers, modifiedMarkers) {
        for (const marker of (newMarkers || [])) {
            this.movie().markerTable().addMarker(marker, null /*oldRow*/);
        }

        for (const marker of (deletedMarkers || [])) {
            this.movie().markerTable().deleteMarker(marker);
        }

        for (const marker of (modifiedMarkers || [])) {
            this.movie().markerTable().editMarker(marker, true /*forceReset*/);
        }
    }

    /**
     * Expand or collapse the marker table for the clicked episode.
     * If the user ctrl+clicks the episode, expand/contract for all episodes.
     * @param {MouseEvent} e */
    async #showHideMarkerTableEvent(e) {
        if (this.ignoreRowClick(e.target)) {
            return;
        }

        await this.#verifyMarkerTableInitialized();
        const expanded = this.movie().markerTable().isVisible();
        if (ctrlOrMeta(e)) {
            this.showHideMarkerTables(expanded);
        } else {
            this.showHideMarkerTable(expanded);
        }
    }

    /**
     * Ensures we have the right marker data (and a marker table) before attempting
     * to show the marker table. */
    async #verifyMarkerTableInitialized() {
        if (this.#markersGrabbed) {
            return;
        }

        this.insertInlineLoadingIcon('.episodeDisplayText');
        const mov = this.movie();
        const metadataId = mov.metadataId;
        this.#markersGrabbed = true;
        try {
            const movieInfo = await ServerCommands.extendedQuery(metadataId);
            mov.hasThumbnails = movieInfo.hasThumbnails;

            movieInfo.markers.sort((a, b) => a.start - b.start);
            mov.realMarkerCount = movieInfo.markers.length;

            // Gather purge data before continuing
            try {
                await PurgedMarkers.getPurgedMovieMarkers(metadataId);
                if (ClientSettings.extendedMarkerStatsBlocked()) {
                    window.dispatchEvent(new CustomEvent(CustomEvents.PurgedMarkersChanged));
                }

            } catch (err) {
                Log.warn(errorMessage(err), `Unable to get purged marker info for movie ${mov.title}`);
            }

            if (!movieInfo.chapters) {
                Log.warn(`Chapter query didn't return any data for ${metadataId}, that's not right!`);
                movieInfo.chapters = [];
            }

            mov.initializeMarkerTable(movieInfo.markers, movieInfo.chapters);
            this.html().insertBefore(mov.markerTable().table(), $$('.episodeSeparator', this.html()));
        } catch (ex) {
            this.#markersGrabbed = false;
            throw ex;
        } finally {
            this.removeInlineLoadingIcon();
        }
    }

    /**
     * Expands or contracts the marker table for this row.
     * @param {boolean} hide
     * @param {boolean} bulk
     * @param {boolean} animate Whether to animate the visibility change. NOTE: even if set to true,
     *                          the row won't be animated if we think it's off-screen. */
    async showHideMarkerTable(hide, bulk = false, animate = true) {
        if (!hide) {
            await this.#verifyMarkerTableInitialized();
        }

        return super.showHideMarkerTable(hide, bulk, animate);
    }

    /**
     * Show or hide all marker tables for the currently listed movies. This can fail if there
     * are too many movies to expand that don't have marker information yet.
     * @param {boolean} hide Whether to hide or show all marker tables. */
    showHideMarkerTables(hide) {
        /** @type {MovieResultRow[]} */
        const movies = PlexClientState.getActiveSearchRows();
        if (!hide) {
            // Check how many requests for markers we'll have to make if we try
            // to expand everything. If it's greater than 100, ignore the bulk request.
            let needInit = 0;
            for (const movie of movies) {
                if (!movie.movie().markerTable().hasRealData()) {
                    ++needInit;
                }
            }

            if (needInit > 100) {
                Log.info(`Got a request to expand over 100 movies that don't have marker info, ignoring it and just expanding this row.`);
                errorToast(`Too many items, can't expand them all.`);
                return this.showHideMarkerTable(hide);
            }
        }

        return BaseItemResultRow.ShowHideMarkerTables(hide, PlexClientState.getActiveSearchRows());
    }


    /** Scroll the marker table into view */
    scrollTableIntoView() {
        this.movie().markerTable().table().scrollIntoView({ behavior : 'smooth', block : 'nearest' });
    }

    /**
     * Updates the marker statistics both in the UI and the client state. */
    updateMarkerBreakdown() {
        // Don't bother updating in-place, just recreate and replace.
        const newNode = this.#buildMarkerText();
        const oldNode = $$('.episodeDisplayText', this.html());
        oldNode.replaceWith(newNode);

        const newKey = this.movie().markerTable().markerKey();
        const oldKey = this.currentKey();
        // Note: No need to propagate changes up like for episodes, since
        //       we're already at the top of the chain. The section-wide
        //       marker chart queries the server directly every time.
        const breakdown = this.movie().markerBreakdown();
        if (!breakdown) {
            // Extended stats not enabled.
            this.movie().realMarkerCount = this.movie().markerTable().markerCount();
            return;
        }

        breakdown.delta(oldKey, newKey - oldKey);
        this.setCurrentKey(newKey);
    }
}
