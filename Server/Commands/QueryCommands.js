import { Log } from "../../Shared/ConsoleLog.js";
import { EpisodeData, MarkerData, SeasonData, ShowData } from "../../Shared/PlexTypes.js";

import LegacyMarkerBreakdown from "../LegacyMarkerBreakdown.js";
import { Config, MarkerCache, QueryManager, Thumbnails } from "../PlexIntroEditor.js";
import ServerError from "../ServerError.js";

/**
 * Classification of commands that queries the database for information, does not edit any underlying data
 */
class QueryCommands {
    constructor() {
        Log.tmi(`Setting up query commands.`);
    }

    /**
     * Retrieve an array of markers for all requested metadata ids.
     * @param {number[]} keys The metadata ids to lookup. */
     async queryIds(keys) {
        let markers = {};
        for (const key of keys) {
            markers[key] = [];
        }

        const rawMarkers = await QueryManager.getMarkersForEpisodes(keys);
        for (const rawMarker of rawMarkers) {
            markers[rawMarker.episode_id].push(new MarkerData(rawMarker));
        }

        return Promise.resolve(markers);
    }

    /**
     * Retrieve all TV libraries found in the database. */
    async getLibraries() {
        const rows = await QueryManager.getShowLibraries();
        let libraries = [];
        for (const row of rows) {
            libraries.push({ id : row.id, name : row.name });
        }

        return Promise.resolve(libraries);
    }

    /**
     * Retrieve all shows from the given library section.
     * @param {number} sectionId The section id of the library. */
    async getShows(sectionId) {
        const rows = await QueryManager.getShows(sectionId);
        let shows = [];
        for (const show of rows) {
            show.markerBreakdown = MarkerCache?.getShowStats(show.id);
            shows.push(new ShowData(show));
        }

        return Promise.resolve(shows);
    }

    /**
     * Retrieve all seasons for the show specified by the given metadataId.
     * @param {number} metadataId The metadata id of the a series.
     * @param {ServerResponse} res */
    async getSeasons(metadataId) {
        const rows = await QueryManager.getSeasons(metadataId);

        let seasons = [];
        for (const season of rows) {
            season.markerBreakdown = MarkerCache?.getSeasonStats(metadataId, season.id);
            seasons.push(new SeasonData(season));
        }

        return Promise.resolve(seasons);
    }

    /**
     * Retrieve all episodes for the season specified by the given metadataId.
     * @param {number} metadataId The metadata id for the season of a show. */
    async getEpisodes(metadataId) {
        const rows = await QueryManager.getEpisodes(metadataId);

        // There's definitely a better way to do this, but determining whether an episode
        // has thumbnails attached is asynchronous, so keep track of how many results have
        // come in, and only return once we've processed all rows.
        let waitingFor = rows.length;
        let episodes = [];
        return new Promise((resolve, _) => {
            rows.forEach((episode, index) => {
                const metadataId = episode.id;
                episodes.push(new EpisodeData(episode));

                if (Config.useThumbnails()) {
                    Thumbnails.hasThumbnails(metadataId).then(hasThumbs => {
                        episodes[index].hasThumbnails = hasThumbs;
                        --waitingFor;
                        if (waitingFor == 0) {
                            resolve(episodes);
                        }
                    }).catch(() => {
                        --waitingFor;
                        episodes[index].hasThumbnails = false;
                        if (waitingFor == 0) {
                            // We failed, but for auxillary thumbnails, so nothing to completely fail over.
                            resolve(episodes);
                        }
                    });
                }
            });

            if (!Config.useThumbnails()) {
                resolve(episodes);
            }
        });
    }

    /**
     * Gather marker information for all episodes in the given library,
     * returning the number of episodes that have X markers associated with it.
     * @param {number} sectionId The library section id to parse. */
    async allStats(sectionId) {
        // If we have global marker data, forego the specialized markerBreakdownCache
        // and build the statistics using the cache manager.
        if (Config.extendedMarkerStats()) {
            Log.verbose('Grabbing section data from the full marker cache.');

            const buckets = MarkerCache.getSectionOverview(sectionId);
            if (buckets) {
                return Promise.resolve(buckets);
            }

            // Something went wrong with our global cache. Fall back to markerBreakdownCache.
        }

        if (LegacyMarkerBreakdown.Cache[sectionId]) {
            Log.verbose('Found cached data, returning it');
            return Promise.resolve(LegacyMarkerBreakdown.Cache[sectionId]);
        }

        const rows = await QueryManager.markerStatsForSection(sectionId);

        let buckets = {};
        Log.verbose(`Parsing ${rows.length} tags`);
        let idCur = -1;
        let countCur = 0;
        for (const row of rows) {
            if (row.episode_id == idCur) {
                if (row.tag_id == QueryManager.markerTagId()) {
                    ++countCur;
                }
            } else {
                if (!buckets[countCur]) {
                    buckets[countCur] = 0;
                }

                ++buckets[countCur];
                idCur = row.episode_id;
                countCur = row.tag_id == QueryManager.markerTagId() ? 1 : 0;
            }
        }

        ++buckets[countCur];
        LegacyMarkerBreakdown.Cache[sectionId] = buckets;
        return Promise.resolve(buckets);
    }

    /**
     * Retrieve the marker breakdown (X episodes have Y markers) for a single show,
     * optionally with breakdowns for each season attached.
     * Only async to conform to command method signature.
     * @param {number} showId The metadata id of the show to grab the breakdown for.
     * @param {number} includeSeasons 1 to include season data, 0 to leave it out. */
    async getShowMarkerBreakdownTree(showId, includeSeasons) {
        if (!MarkerCache) {
            throw new ServerError(`We shouldn't be calling get_breakdown when extended marker stats are disabled.`, 400);
        }

        includeSeasons = includeSeasons != 0;
        let data = null;
        if (includeSeasons) {
            data = MarkerCache.getTreeStats(showId);
        } else {
            data = MarkerCache.getShowStats(showId);
            data = { showData: data, seasonData : {} };
        }

        if (!data) {
            throw new ServerError(`No marker data found for showId ${showId}.`, 400);
        }

        return Promise.resolve(data);
    }
}

export default QueryCommands;
