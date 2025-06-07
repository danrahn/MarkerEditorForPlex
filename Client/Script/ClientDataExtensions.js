import { $$ } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { EpisodeData, MarkerData, MovieData } from '/Shared/PlexTypes.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import { MarkerTable } from 'MarkerTable';

/** @typedef {!import('/Shared/PlexTypes').PlexData} PlexData */
/** @typedef {!import('./ResultRow/EpisodeResultRow').EpisodeResultRow} EpisodeResultRow */
/** @typedef {!import('./ResultRow/MovieResultRow').MovieResultRow} MovieResultRow */

const Log = ContextualLog.Create('ClientData');

/**
 * @typedef {Object} BaseItemCommon
 * @property {number} duration The duration of this media item, in milliseconds.
 * @property {boolean?} hasThumbnails Whether thumbnails are available for this item.
 * @property {() => MarkerTable} markerTable
 *
 * @typedef {PlexData & BaseItemCommon} MediaItemWithMarkerTable Defines the fields common
 *  between base Plex data types (Episodes and Movies).
 */

/**
 * An extension of the client/server-agnostic MovieData to include client-specific functionality (connecting with the marker table)
 *
 * NOTE: This should really be shared with ClientEpisodeData, but to do that correctly, we need multiple inheritance, which isn't
 *       possible in JS. We want MovieData's base fields, and ClientEpisodeData wants EpisodeData's base fields, but both client
 *       classes want client-specific methods that can't be added to the distinct base types. There are some hacks that could be
 *       used, but I've opted to duplicate the code for now.
 */
class ClientMovieData extends MovieData {

    /**
     * The UI representation of the markers
     * @type {MarkerTable} */
    #markerTable = null;

    /** @param {Object<string, any>} [movie] */
    constructor(movie) {
        super(movie);
    }

    /**
     * Creates the marker table for this movie. Note that for movies, we don't fully initialize the marker
     * table yet for performance reasons, only grabbing the real marker data when the user explicitly
     * clicks on a particular movie.
     * @param {MovieResultRow} parentRow The UI associated with this movie. */
    createMarkerTable(parentRow) {
        if (this.#markerTable !== null) {
            // This is expected if the result has appeared in multiple search results.
            // Assume we're in a good state and ignore this, but reset the parent and make
            // sure the table is in its initial hidden state.
            this.#markerTable.setParent(parentRow);
            $$('table', this.#markerTable.table())?.classList.add('hidden');
            return;
        }

        // Marker breakdown is currently overkill for movies, since it only ever has a single item inside of it.
        // If intros/credits are ever separated though, this will do the right thing.
        this.#markerTable = MarkerTable.CreateLazyInitMarkerTable(parentRow, parentRow.currentKey());
    }

    /**
     * @param {SerializedMarkerData} serializedMarkers
     * @param {ChapterData[]} chapters The chapters (if any) associated with this movie. */
    initializeMarkerTable(serializedMarkers, chapters) {
        if (this.#markerTable === null) {
            Log.error(`Can't initialize marker table if it hasn't been created yet.`);
            return;
        }

        const markers = [];
        for (const marker of serializedMarkers) {
            markers.push(new MarkerData().setFromJson(marker));
        }

        this.#markerTable.lazyInit(markers, chapters);
    }

    /** @returns {MarkerTable} */
    markerTable() { return this.#markerTable; }
}

/**
 * An extension of the client/server-agnostic EpisodeData to include client-specific functionality
 */
class ClientEpisodeData extends EpisodeData {

    /**
     * The UI representation of the markers
     * @type {MarkerTable} */
    #markerTable = null;

    /** @param {Object<string, any>} [episode] */
    constructor(episode) {
        super(episode);
    }

    /**
     * Creates the marker table for this episode.
     * @param {EpisodeResultRow} parentRow The UI associated with this episode.
     * @param {SerializedMarkerData[]} serializedMarkers Map of episode ids to an array of
     * serialized {@linkcode MarkerData} for the episode.
     * @param {ChapterData[]} chapters Chapter data for this episode. */
    createMarkerTable(parentRow, serializedMarkers, chapters) {
        if (this.#markerTable !== null) {
            Log.warn('The marker table already exists, we shouldn\'t be creating a new one!');
        }

        const markers = [];
        for (const marker of serializedMarkers) {
            markers.push(new MarkerData().setFromJson(marker));
        }

        parentRow.setCurrentKey(markers.reduce((acc, marker) => acc + MarkerBreakdown.deltaFromType(1, marker.markerType), 0));
        this.#markerTable = MarkerTable.CreateMarkerTable(markers, parentRow, chapters);
    }

    /** @returns {MarkerTable} */
    markerTable() { return this.#markerTable; }
}

export { ClientEpisodeData, ClientMovieData };
