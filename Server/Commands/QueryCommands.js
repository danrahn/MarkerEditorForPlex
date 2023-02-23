import { Log } from "../../Shared/ConsoleLog.js";
import { EpisodeData, MarkerData, MarkerType, MovieData, SeasonData, SectionType, ShowData } from "../../Shared/PlexTypes.js";

import LegacyMarkerBreakdown from "../LegacyMarkerBreakdown.js";
import { MarkerCache } from "../MarkerCacheManager.js";
import { Config } from "../IntroEditorConfig.js";
import { PlexQueries } from "../PlexQueryManager.js";
import ServerError from "../ServerError.js";
import { Thumbnails } from "../ThumbnailManager.js";

/** @typedef {!import('../../Shared/PlexTypes').LibrarySection} LibrarySection */

/**
 * Classification of commands that queries the database for information, does not edit any underlying data
 */
class QueryCommands {
    constructor() {
        Log.tmi(`Setting up query commands.`);
    }

    /**
     * Retrieve an array of markers for all requested metadata ids.
     * Each key is expected to be the same media type (e.g. all movie ids, or all episode ids).
     * @param {number[]} keys The metadata ids to lookup. */
    static async queryIds(keys) {
        if (keys.length == 0) {
            throw new ServerError(`Marker query must have at least one metadata id to search for,`, 400);
        }

        let markers = {};
        for (const key of keys) {
            markers[key] = [];
        }

        const rawMarkers = await PlexQueries.getMarkersForItems(keys);
        for (const rawMarker of rawMarkers) {
            markers[rawMarker.parent_id].push(new MarkerData(rawMarker));
        }

        return markers;
    }

    /**
     * Retrieve all TV libraries found in the database.
     * @returns {Promise<LibrarySection[]>} */
    static async getLibraries() {
        return PlexQueries.getLibraries();
    }

    /**
     * Retrieve all movies/shows from the given library section.
     * @param {number} sectionId The section id of the library. */
    static async getLibrary(sectionId) {
        const sections = await PlexQueries.getLibraries();
        const section = sections.find(s => s.id == sectionId);
        if (!section) {
            Log.error(`Section id "${sectionId}" is not a valid movie or TV library`);
            return [];
        }

        switch (section.type) {
            case SectionType.Movie:
                return this.#getMovies(sectionId);
            case SectionType.TV:
                return this.#getShows(sectionId);
            default:
                throw new ServerError(`Section id "${sectionId}" is of an unknown type`, 400);
        }
    }

    /**
     * Retrieve all shows from the given library section.
     * @param {number} sectionId The section id of the library. */
    static async #getShows(sectionId) {
        const rows = await PlexQueries.getShows(sectionId);
        let shows = [];
        for (const show of rows) {
            show.markerBreakdown = MarkerCache?.getTopLevelStats(show.id);
            shows.push(new ShowData(show));
        }

        return shows;
    }

    /**
     * Retrieve all movies from the given library section.
     * @param {number} sectionId
     * @returns {Promise<MovieData[]>} */
    static async #getMovies(sectionId) {
        const rows = await PlexQueries.getMovies(sectionId);
        let movies = [];
        for (const movie of rows) {
            movie.markerBreakdown = MarkerCache?.getTopLevelStats(movie.id);
            movies.push(new MovieData(movie));
        }

        return movies;
    }

    /**
     * Retrieve all seasons for the show specified by the given metadataId.
     * @param {number} metadataId The metadata id of the a series. */
    static async getSeasons(metadataId) {
        const rows = await PlexQueries.getSeasons(metadataId);

        let seasons = [];
        for (const season of rows) {
            season.markerBreakdown = MarkerCache?.getSeasonStats(metadataId, season.id);
            seasons.push(new SeasonData(season));
        }

        return seasons;
    }

    /**
     * Retrieve all episodes for the season specified by the given metadataId.
     * @param {number} metadataId The metadata id for the season of a show.
     * @returns {Promise<EpisodeData[]>} */
    static async getEpisodes(metadataId) {
        const rows = await PlexQueries.getEpisodes(metadataId);

        // There's definitely a better way to do this, but determining whether an episode
        // has thumbnails attached is asynchronous, so keep track of how many results have
        // come in, and only return once we've processed all rows.
        let waitingFor = rows.length;
        /** @type {EpisodeData[]} */
        let episodes = [];
        return new Promise((resolve, _) => {
            const useThumbnails = Config.useThumbnails();
            rows.forEach((episode, index) => {
                const metadataId = episode.id;
                episodes.push(new EpisodeData(episode));

                if (useThumbnails) {
                    Thumbnails.hasThumbnails(metadataId).then(hasThumbs => {
                        episodes[index].hasThumbnails = hasThumbs;
                        --waitingFor;
                        if (waitingFor == 0) {
                            resolve(episodes);
                        }
                    }).catch((err) => {
                        Log.warn(err.message, `Failed to determine if episode has thumbnails`);
                        Log.verbose(err.stack ? err.stack : '[Stack not available]');
                        --waitingFor;
                        episodes[index].hasThumbnails = false;
                        if (waitingFor == 0) {
                            // We failed, but for auxillary thumbnails, so nothing to completely fail over.
                            resolve(episodes);
                        }
                    });
                }
            });

            if (!useThumbnails) {
                resolve(episodes);
            }
        });
    }

    /**
     * Check whether the item with the given metadata has thumbnails associated with it.
     * Only applicable to episode and movie ids.
     * @param {number} metadataId */
    static async checkForThumbs(metadataId) {
        return { hasThumbnails : await Thumbnails.hasThumbnails(metadataId) };
    }

    /**
     * Gather marker information for all episodes in the given library,
     * returning the number of episodes that have X markers associated with it.
     * @param {number} sectionId The library section id to parse. */
    static async allStats(sectionId) {
        // If we have global marker data, forego the specialized markerBreakdownCache
        // and build the statistics using the cache manager.
        if (Config.extendedMarkerStats()) {
            Log.verbose('Grabbing section data from the full marker cache.');

            const buckets = MarkerCache.getSectionOverview(sectionId);
            if (buckets) {
                return buckets;
            }

            // Something went wrong with our global cache. Fall back to markerBreakdownCache.
        }

        if (LegacyMarkerBreakdown.Cache[sectionId]) {
            Log.verbose('Found cached data, returning it');
            return LegacyMarkerBreakdown.Cache[sectionId];
        }

        const rows = await PlexQueries.markerStatsForSection(sectionId);

        let buckets = {};
        Log.verbose(`Parsing ${rows.length} tags`);
        let idCur = rows.length > 0 ? rows[0].parent_id : -1;
        let countCur = 0;
        // See MarkerBreakdown.js
        const bucketDelta = (markerType) => markerType == MarkerType.Intro ? 1 : (1 << 16);
        for (const row of rows) {
            if (row.parent_id == idCur) {
                if (row.tag_id == PlexQueries.markerTagId()) {
                    // See MarkerBreakdown.js
                    countCur += bucketDelta(row.marker_type);
                }
            } else {
                buckets[countCur] ??= 0;
                ++buckets[countCur];
                idCur = row.parent_id;
                countCur = row.tag_id == PlexQueries.markerTagId() ? bucketDelta(row.marker_type) : 0;
            }
        }

        ++buckets[countCur];
        LegacyMarkerBreakdown.Cache[sectionId] = buckets;
        return buckets;
    }

    /**
     * Retrieve the marker breakdown (X episodes have Y markers) for a single top-level item (show/movie),
     * optionally with breakdowns for each season attached.
     * Only async to conform to command method signature.
     * @param {number} metadataId The metadata id of the show/movie to grab the breakdown for.
     * @param {number} includeSeasons 1 to include season data, 0 to leave it out. Ignored if metadataId is a movie. */
    static async getMarkerBreakdownTree(metadataId, includeSeasons) {
        if (!MarkerCache) {
            throw new ServerError(`We shouldn't be calling get_breakdown when extended marker stats are disabled.`, 400);
        }

        includeSeasons = includeSeasons != 0;
        let data = null;
        if (includeSeasons) {
            data = MarkerCache.getTreeStats(metadataId);
        } else {
            data = MarkerCache.getTopLevelStats(metadataId);
            data = { showData: data, seasonData : {} };
        }

        if (!data) {
            throw new ServerError(`No marker data found for showId ${metadataId}.`, 400);
        }

        return data;
    }
}

export default QueryCommands;
