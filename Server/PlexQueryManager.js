import { join } from 'path';
import { statSync } from 'fs';

import { BulkMarkerResolveType, EpisodeAndMarkerData, EpisodeData, MarkerConflictResolution, MarkerData } from '../Shared/PlexTypes.js';
import { ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';
import { MarkerEnum, MarkerType } from '../Shared/MarkerType.js';

import MarkerEditCache from './MarkerEditCache.js';
import { MediaAnalysisWriter } from './MediaAnalysisWriter.js';
import ServerError from './ServerError.js';
import SqliteDatabase from './SqliteDatabase.js';
import TransactionBuilder from './TransactionBuilder.js';

/** @typedef {!import('../Shared/PlexTypes').BulkAddResultEntry} BulkAddResultEntry */
/** @typedef {!import('../Shared/PlexTypes').BulkAddResult} BulkAddResult */
/** @typedef {!import('../Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import('../Shared/PlexTypes').ChapterMap} ChapterMap */
/** @typedef {!import('../Shared/PlexTypes').CustomBulkAddMap} CustomBulkAddMap */
/** @typedef {!import('../Shared/PlexTypes').LibrarySection} LibrarySection */
/** @typedef {!import('../Shared/PlexTypes').MarkerAction} MarkerAction */
/** @typedef {!import('./SqliteDatabase').DbDictParameters} DbDictParameters */

/**
 * @typedef {{ id : number, index : number, start : number, end : number, modified_date : number|null, created_at : number,
 *             parent_id : number, season_id : number, show_id : number, section_id : number, parent_guid : string,
 *             marker_type : string, final : number, user_created : boolean, extra_data?: string }} RawMarkerData
 *
 * @typedef {{ id: number, title: string, title_sort: string, original_title: string, season_count: number,
 *             episode_count: number }} RawShowData
 *
 * @typedef {{ id: number, title: string, index: number, episode_count: number }} RawSeasonData
 *
 * @typedef {{ title: string, index: number, id: number, season: string, season_index: number,
 *             show: string, duration: number, parts: number}} RawEpisodeData
 *
 * @typedef {{ id: number, title: string, title_sort: string, original_title: string, year: number,
 *             edition: string, duration: number }} RawMovieData
 *
 * @typedef {(err: Error?, rows: any[]) => void} MultipleRowQuery
 * @typedef {(err: Error?, rows: RawMarkerData[])} MultipleMarkerQuery
 * @typedef {(err: Error?, row: any) => void} SingleRowQuery
 * @typedef {(err: Error?, row: RawMarkerData) => void} SingleMarkerQuery
 * @typedef {(err: Error?) => void} NoResultQuery
 * @typedef {{ metadata_type : number, section_id : number}} MetadataItemTypeInfo
 * @typedef {{ markers : RawMarkerData[], typeInfo : MetadataItemTypeInfo }} MarkersWithTypeInfo
 * @typedef {{ marker: RawMarkerData, newData: { newStart: number, newEnd: number,
 *             newType: string, newFinal: number, newModified: number }}} ModifiedMarkerDetails
 *
 * @typedef {{newMarkers: RawMarkerData[], identicalMarkers: RawMarkerData[], deletedMarkers: RawMarkerData[],
 *            modifiedMarkers: ModifiedMarkerDetails[], ignoredActions: MarkerAction[]}} BulkRestoreResult
 *
 * @typedef {{ start: number, end: number, marker_type: string, final: number, modified_at: number|null }} MinimalMarkerAction
 */


const Log = ContextualLog.Create('PlexDB');

/**
 * extra_data string for different marker types
 * @enum */
const ExtraData = {
    /** @readonly Intro marker */
    Intro           : '{"pv:version":"5","url":"pv%3Aversion=5"}',
    /** @readonly Non-final credit marker */
    Credits         : '{"pv:version":"4","url":"pv%3Aversion=4"}',
    /** @readonly Final credit marker (goes to the end of the media item) */
    CreditsFinal    : '{"pv:final":"1","pv:version":"4","url":"pv%3Afinal=1&pv%3Aversion=4"}',
    /** @readonly Ads/commercials have no extra_data */
    Ad      : null,

    /** @readonly extra_data for PMS <1.40 */
    Legacy : {
        /** @readonly Pre PMS 1.40 Intro marker */
        Intro        : 'pv%3Aversion=5',
        /** @readonly Pre PMS 1.40 non-final credits marker */
        Credits      : 'pv%3Aversion=4',
        /** @readonly Pre PMS 1.40 final credits marker (goes to the end of the media item) */
        CreditsFinal : 'pv%3Afinal=1&pv%3Aversion=4',
        /** @readonly Commercials have no extra_data */
        Ad           : null,
    },

    /**
     * Convert marker type string and final flag to ExtraData type
     * @param {string} markerType Value from MarkerType
     * @param {number} final */
    get : (markerType, final) => {
        const data = ExtraData.isLegacy ? ExtraData.Legacy : ExtraData;
        switch (markerType) {
            case MarkerType.Intro:
                return data.Intro;
            case MarkerType.Ad:
                return data.Ad;
            default:
                return final ? data.CreditsFinal : data.Credits;
        }
    },

    /** Determines whether the user is running an older version of PMS, before extra_data's JSON conversion. Set on boot. */
    isLegacy : false,
};

/**
 * Types of media items
 * @enum */
const MetadataType = {
    /** @readonly */ Invalid : 0,
    /** @readonly */ Movie   : 1,
    /** @readonly */ Show    : 2,
    /** @readonly */ Season  : 3,
    /** @readonly */ Episode : 4,
    /** @readonly */ Artist  : 8,
    /** @readonly */ Album   : 9,
    /** @readonly */ Track   : 10,
};

const MetadataBaseTypes = [MetadataType.Movie, MetadataType.Episode];

/** Helper class used to align RawMarkerData and MarkerAction fields that are
 *  relevant for restoring purged markers. */
class TrimmedMarker {
    static #newMarkerId = -1;
    /** @type {number} */ id;
    /** @type {number} */ parent_id;
    /** @type {number} */ start;
    /** @type {number} */ end;
    /** @type {number} */ index;
    /** @type {number} */ newIndex;
    /** @type {string} */ marker_type;
    /** @type {number} */ final;
    /** @type {number|null} */ modified_date;
    /** @type {boolean} */ user_created;
    /** @type {number} */ created_at;
    /** @type {boolean} */ #isRaw = false;
    /** @type {RawMarkerData} */ #raw;
    getRaw() {
        if (!this.#isRaw) { throw new ServerError('Attempting to access a non-existent raw marker', 500); }

        return this.#raw;
    }

    constructor(id, pid, start, end, index, markerType, final, modified_date, user_created, created_at) {
        this.id = id; this.parent_id = pid; this.start = start; this.end = end; this.index = index;
        this.newIndex = -1; this.marker_type = markerType; this.final = final ? 1 : 0; this.modified_date = modified_date;
        this.user_created = !!user_created; this.created_at = created_at;
    }

    /** Return whether this is an existing marker */
    existing() { return this.id !== TrimmedMarker.#newMarkerId; }

    /** @param {RawMarkerData} marker */
    static fromRaw(marker) {
        const trimmed = new TrimmedMarker(marker.id, marker.parent_id, marker.start, marker.end, marker.index,
            marker.marker_type, marker.final, marker.modified_date, marker.user_created, marker.created_at);
        trimmed.#raw = marker;
        trimmed.#isRaw = true;
        return trimmed;
    }

    /** @param {MarkerAction} action */
    static fromBackup(action) {
        // For the purposes of TrimmedMarker usage, we'll consider the modified date to be either the
        // modified date or the recorded_at date if that's unavailable
        const modifiedAt = action.modified_at || action.recorded_at;
        return new TrimmedMarker(TrimmedMarker.#newMarkerId, action.parent_id, action.start, action.end, -1,
            action.marker_type, action.final, modifiedAt, action.user_created, action.created_at);
    }
}

/**
 * Singleton PlexQueryManager instance.
 * @type {PlexQueryManager}
 * @readonly */
let Instance;

/**
 * The PlexQueryManager handles the underlying queries made to the Plex database to retrieve
 * library, season, show, episode, and marker data.
 */
class PlexQueryManager {
    /**
     * The tag id in the database that represents a marker.
     * @type {number} */
    #markerTagId;

    /** @type {SqliteDatabase} */
    #database;

    /** @type {boolean} */
    #writeExtraData;

    /** The default fields to return for an individual marker, which includes the episode/season/show/section id. */
    #extendedEpisodeMarkerFields = `
    taggings.id,
    taggings.\`index\`,
    taggings.text AS marker_type,
    taggings.time_offset AS start,
    taggings.end_time_offset AS end,
    taggings.created_at,
    taggings.extra_data,
    episodes.id AS parent_id,
    seasons.id AS season_id,
    seasons.parent_id AS show_id,
    seasons.library_section_id AS section_id,
    episodes.guid AS parent_guid
FROM taggings
    INNER JOIN metadata_items episodes ON taggings.metadata_item_id = episodes.id
    INNER JOIN metadata_items seasons ON episodes.parent_id = seasons.id
`;

    /** The default fields to return for an individual movie marker. */
    #extendedMovieMarkerFields = `
    taggings.id,
    taggings.\`index\`,
    taggings.text AS marker_type,
    taggings.time_offset AS start,
    taggings.end_time_offset AS end,
    taggings.created_at,
    taggings.extra_data,
    movies.id AS parent_id,
    -1 AS season_id,
    -1 AS show_id,
    movies.guid AS parent_guid,
    movies.library_section_id AS section_id
FROM taggings
    INNER JOIN metadata_items movies ON taggings.metadata_item_id = movies.id
`;

    /**
     * Creates a new PlexQueryManager instance. This show always be used opposed to creating
     * a PlexQueryManager directly via 'new'.
     * @param {string} databasePath The path to the Plex database. */
    static async CreateInstance(databasePath) {
        if (Instance) {
            Log.warn(`Query manager already initialized, we shouldn't be initializing it again`);
            await Instance.close();
        }

        Log.info(`Verifying database ${databasePath}...`);
        const dbInfo = statSync(databasePath, { throwIfNoEntry : false });
        if (!dbInfo) {
            throw new ServerError(`Database file "${databasePath}" could not be found.`);
        }

        if (dbInfo.isDirectory()) {
            Log.warn(`Provided database path is a folder, expected the database itself. ` +
                `Looking for database file in "${databasePath}"`);

            const potentialDbPath = join(databasePath, 'com.plexapp.plugins.library.db');
            const dbInfoMaybe = statSync(potentialDbPath, { throwIfNoEntry : false });
            if (!dbInfoMaybe || !dbInfoMaybe.isFile()) {
                Log.error(`Did not find expected database file in "${databasePath}", cannot continue`);
                throw new ServerError('Database file not found.', 500);
            }

            databasePath = potentialDbPath;
        }

        Log.tmi(`File exists. Making sure it's a database.`);

        /** @type {SqliteDatabase} */
        let db;
        try {
            db = await SqliteDatabase.OpenDatabase(databasePath, false /*fAllowCreate*/);
        } catch (err) {
            Log.error(`Unable to open database. Are you sure "${databasePath}" exists?`);
            throw ServerError.FromDbError(err);
        }

        Log.tmi(`Opened database, making sure it looks like the Plex database`);
        try {
            Log.tmi(`Checking tags table for marker tag_type`);
            const row = await db.get('SELECT id FROM tags WHERE tag_type=12;');
            if (!row) {
                // What's the path forward if/when Plex adds custom extensions to the `taggings` table?
                // Probably some gross solution that invokes shell commands to Plex SQLite.
                Log.error(`PlexQueryManager: tags table exists, but didn't find marker tag. Plex SQLite is required to modify`);
                Log.error(`                  this table, so we cannot continue. Either ensure at least one movie/episode has a`);
                Log.error(`                  marker, or manually run the following using Plex SQLite:`);
                Log.error();
                /* eslint-disable-next-line max-len */
                Log.error(`    INSERT INTO tags (tag_type, created_at, updated_at) VALUES (12, (strftime('%s','now')), (strftime('%s','now')));`);
                Log.error();
                Log.error(`See https://support.plex.tv/articles/repair-a-corrupted-database/ for more information on Plex`);
                Log.error(`SQLite and the database location.`);
                throw new ServerError(`Plex database must contain at least one marker.`, 500);
            }

            Log.tmi(`Checking taggings table for extra_data to determine PMS version.`);

            // Need to check extra_data of a marker to determine whether we should use plain text or JSON strings
            // for markers' extra_data.
            const marker = await db.get('SELECT extra_data FROM taggings WHERE tag_id=?', [row.id]);
            if (!marker) {
                Log.warn('No existing markers found. Assuming PMS >=1.40. If you are not running PMS >= 1.40, DO NOT ADD CUSTOM MARKERS.');
            } else if (marker.extra_data && marker.extra_data[0] !== '{') {
                Log.verbose('PMS < 1.40 detected, falling back to legacy extra_data (non-JSON)');
                ExtraData.isLegacy = true;
            } else {
                Log.verbose('PMS >= 1.40 detected, using JSON for extra_data');
            }

            Log.info('Database verified');
            // Something's gone terribly wrong if we've initiated multiple calls to CreateInstance/Close
            // eslint-disable-next-line require-atomic-updates
            Instance = new PlexQueryManager(db, row.id);
            return Instance;
        } catch (err) {
            Log.error(`Are you sure "${databasePath}" is the Plex database, and has at least one existing marker?`);
            if (err instanceof Error && err.message?.startsWith('SQLITE_CANTOPEN')) {
                Log.error(`\tNOTE: This might be caused by attempting to open a database stored on a network drive.`);
            }

            throw ServerError.FromDbError(err);
        }
    }

    /**
     * Determines if the given file path is likely a Plex database.
     * @param {string} databasePath */
    static async SmellsLikePlexDB(databasePath) {
        const stats = statSync(databasePath, { throwIfNoEntry : false });
        if (!stats || !stats.isFile()) {
            return false;
        }

        try {
            const db = await SqliteDatabase.OpenDatabase(databasePath, false /*fAllowCreate*/);
            const row = await db.get('SELECT id FROM tags WHERE tag_type=12;');
            db.close();
            if (!row) {
                return false;
            }
        } catch (err) {
            return false;
        }

        return true;
    }

    /** Close the query connection. */
    static async Close() {
        await Instance?.close();

        // Something's gone terribly wrong if we've initiated multiple calls to CreateInstance/Close
        // eslint-disable-next-line require-atomic-updates
        Instance = null;
    }

    /**
     * Initializes the query manager. Should only be called via the static CreateInstance.
     * @param {SqliteDatabase} database
     * @param {markerTagId} markerTagId The database tag id that represents markers. */
    constructor(database, markerTagId) {
        this.#database = database;
        this.#markerTagId = markerTagId;
    }

    /** On process exit, close the database connection. */
    async close() {
        Log.verbose(`Shutting down Plex database connection...`);
        if (this.#database) {
            try {
                await this.#database.close();
                Log.verbose('Shut down Plex database connection.');
            } catch (err) {
                Log.error('Database close failed', err.message);
            }

            this.#database = null;
        }
    }

    markerTagId() { return this.#markerTagId; }
    database() { return this.#database; }
    async checkWriteExtraData(writeExtraData) {
        if (writeExtraData && (ExtraData.isLegacy || !(await MediaAnalysisWriter.hasExpectedData(this.#database)))) {
            this.#writeExtraData = false;
            Log.error('Cannot enable writeExtraData with legacy extra_data format. Disabling.');
            return false;
        }

        this.#writeExtraData = writeExtraData;
        return true;
    }

    /** Retrieve all movie and TV show libraries in the database.
     *
     * Fields returned: `id`, `name`.
     * @returns {Promise<LibrarySection[]>} */
    getLibraries() {
        return this.#database.all('SELECT id, section_type AS type, name FROM library_sections WHERE section_type=1 OR section_type=2');
    }

    /**
     * Retrieve all movies in the given library section.
     * @param {number} sectionId
     * @returns {Promise<RawMovieData[]>} */
    getMovies(sectionId) {
        const movieQuery = `
SELECT movies.id AS id,
        movies.title AS title,
        movies.title_sort AS title_sort,
        movies.original_title AS original_title,
        movies.year AS year,
        movies.edition_title AS edition,
        MAX(files.duration) AS duration
  FROM metadata_items movies
  INNER JOIN media_items files ON movies.id=files.metadata_item_id
  WHERE movies.metadata_type=1 AND movies.library_section_id=?
  GROUP BY movies.id;
        `;
        return this.#database.all(movieQuery, [sectionId]);
    }

    /**
     * Retrieve all shows in the given library section.
     *
     * Fields returned: `id`, `title`, `title_sort`, `original_title`, `season_count`, `episode_count`.
     * Requires the caller to validate that the given section id is a TV show library.
     * @param {number} sectionId
     * @returns {Promise<RawShowData[]>} */
    getShows(sectionId) {
        // Create an inner table that contains all unique seasons across all shows, with episodes per season attached,
        // and join that to a show query to roll up the show, the number of seasons, and the number of episodes all in a single row
        const query = `
SELECT
    shows.id,
    shows.title,
    shows.title_sort,
    shows.original_title,
    COUNT(shows.id) AS season_count,
    SUM(seasons.episode_count) AS episode_count
FROM metadata_items shows
    INNER JOIN (
        SELECT seasons.id, seasons.parent_id AS show_id, COUNT(episodes.id) AS episode_count FROM metadata_items seasons
        INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.id
        WHERE seasons.library_section_id=? AND seasons.metadata_type=3
        GROUP BY seasons.id
    ) seasons
WHERE shows.metadata_type=2 AND shows.id=seasons.show_id
GROUP BY shows.id;`;

        return this.#database.all(query, [sectionId]);
    }

    /**
     * Retrieve all seasons in the given show.
     *
     * Fields returned: `id`, `title`, `index`, `episode_count`.
     * @param {number} showMetadataId
     * @returns {Promise<RawSeasonData[]>} */
    getSeasons(showMetadataId) {
        const query = `
SELECT
    seasons.id,
    seasons.title,
    seasons.\`index\`,
    COUNT(episodes.id) AS episode_count
FROM metadata_items seasons
    INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.id
WHERE seasons.parent_id=? AND seasons.metadata_type=3
GROUP BY seasons.id
ORDER BY seasons.\`index\` ASC;`;

        return this.#database.all(query, [showMetadataId]);
    }

    /**
     * Retrieve all episodes in the given season.
     *
     * Fields returned: `title`, `index`, `id`, `season`, `season_index`, `show`, `duration`, `parts`.
     * @param {number} seasonMetadataId
     * @returns {Promise<RawEpisodeData[]>} */
    getEpisodes(seasonMetadataId) {
        return this.#getEpisodesCore(seasonMetadataId, `p.id`);
    }

    /**
     * Retrieve all episodes in the show associated with the given show, season, or episode id, along with their marker information.
     * @param {number} metadataId */
    async getAllEpisodes(metadataId) {
        const typeInfo = await this.#mediaTypeFromId(metadataId);
        let showId = metadataId;
        switch (typeInfo.metadata_type) {
            case MetadataType.Show:
                break;
            case MetadataType.Season:
                showId = await this.#database.get(`SELECT parent_id FROM metadata_items WHERE id=?;`, [metadataId]);
                break;
            case MetadataType.Episode:
                showId = (await this.#database.get(
                    `SELECT p.parent_id AS show_id FROM metadata_items p
                     INNER JOIN metadata_items e on e.parent_id=p.id WHERE e.id=?;`, [metadataId])).show_id;
                break;
            default:
                throw new ServerError(`Item ${metadataId} is not an episode, season, or series`, 400);
        }

        const episodes = await this.getEpisodesAuto(showId);
        const markerInfo = await this.getMarkersAuto(showId);
        const markerMap = {};
        for (const marker of markerInfo.markers) {
            (markerMap[marker.parent_id] ??= []).push(marker);
        }

        const result = [];
        for (const episode of episodes) {
            const serialized = new EpisodeAndMarkerData(episode, markerMap[episode.id] ?? []);
            result.push(serialized);
        }

        return result;
    }

    /**
     * Return all episodes for the given show, season, or episode id.
     * @param {number} metadataId
     * @returns {Promise<RawEpisodeData[]>} */
    async getEpisodesAuto(metadataId) {
        const typeInfo = await this.#mediaTypeFromId(metadataId);
        let where = '';
        switch (typeInfo.metadata_type) {
            case MetadataType.Show   : where = `g.id`; break;
            case MetadataType.Season : where = `p.id`; break;
            case MetadataType.Episode: where = `e.id`; break;
            default:
                throw new ServerError(`Item ${metadataId} is not an episode, season, or series`, 400);
        }

        return this.#getEpisodesCore(metadataId, where);
    }

    #getEpisodesCore(metadataId, whereClause) {
        // Multiple joins to grab the season name, show name, and episode duration (MAX so that we capture
        // the longest available episode, as Plex seems fine with ends beyond the media's length).
        const query = `
SELECT
    e.title AS title,
    e.\`index\` AS \`index\`,
    e.id AS id,
    p.title AS season,
    p.\`index\` AS season_index,
    g.title AS show,
    MAX(m.duration) AS duration,
    COUNT(e.id) AS parts
FROM metadata_items e
    INNER JOIN metadata_items p ON e.parent_id=p.id
    INNER JOIN metadata_items g ON p.parent_id=g.id
    INNER JOIN media_items m ON e.id=m.metadata_item_id
WHERE ${whereClause}=? AND e.metadata_type=4
GROUP BY e.id
ORDER BY e.\`index\` ASC;`;

        return this.#database.all(query, [metadataId]);
    }

    /**
     * Retrieve episode info for each of the episode ids in `episodeMetadataIds`
     * @param {number[]} episodeMetadataIds
     * @param {number} metadataId The parent id for all episodes
     * @returns {Promise<RawEpisodeData[]>}*/
    getEpisodesFromList(episodeMetadataIds) {
        if (episodeMetadataIds.length === 0) {
            Log.warn('Why are we calling getEpisodesFromList with an empty list?');
            return [];
        }

        const validIds = episodeMetadataIds.filter(id => !isNaN(id));
        if (validIds.length !== episodeMetadataIds.length) {
            const invalidCount = episodeMetadataIds.length - validIds.length;
            const invalidIds = episodeMetadataIds.filter(isNaN);
            Log.warn(`getEpisodesFromList: ${invalidCount} invalid episode ids found (${invalidIds.join(', ')}), skipping them`);
        }

        const query = `
    SELECT
        e.title AS title,
        e.\`index\` AS \`index\`,
        e.id AS id,
        p.title AS season,
        p.\`index\` AS season_index,
        g.title AS show,
        MAX(m.duration) AS duration,
        COUNT(e.id) AS parts
    FROM metadata_items e
        INNER JOIN metadata_items p ON e.parent_id=p.id
        INNER JOIN metadata_items g ON p.parent_id=g.id
        INNER JOIN media_items m ON e.id=m.metadata_item_id
    WHERE e.id IN (${validIds.join(',')})
    GROUP BY e.id
    ORDER BY e.\`index\` ASC;`;

        return this.#database.all(query);
    }

    /**
     * Retrieve movie info for each of the movie ids in `movieMetadataIds`
     * @param {number[]} movieMetadataIds
     * @returns {Promise<RawMovieData[]>}*/
    getMoviesFromList(movieMetadataIds) {

        const query = `
    SELECT movies.id AS id,
        movies.title AS title,
        movies.title_sort AS title_sort,
        movies.original_title AS original_title,
        movies.year AS year,
        movies.edition_title AS edition,
        MAX(files.duration) AS duration
    FROM metadata_items movies
    INNER JOIN media_items files ON movies.id=files.metadata_item_id
    WHERE movies.id IN (${movieMetadataIds.join(',')})
    GROUP BY movies.id
    ORDER BY movies.title_sort ASC;`;
        return this.#database.all(query);
    }

    /**
     * Retrieve episode info for an episode with the given guid, if any.
     * @param {string} guid
     * @returns {Promise<{ id: number, season_id: number, show_id: number }>} */
    getEpisodeFromGuid(guid) {
        const query = `
    SELECT
        e.id AS id,
        p.id AS season_id,
        p.parent_id AS show_id
    FROM metadata_items e
        INNER JOIN metadata_items p on e.parent_id=p.id
    WHERE e.guid=?;`;
        return this.#database.get(query, [guid]);
    }

    /**
     * Retrieve the movie id for a movie with the given guid, if any.
     * @param {string} guid
     * @returns {Promise<{ id: number, season_id: -1, show_id: -1 }>} */
    async getMovieFromGuid(guid) {
        const movie = await this.#database.get(`SELECT movie.id AS id FROM metadata_items movie WHERE movie.guid=?;`, [guid]);
        return movie ? { id : movie.id, season_id : -1, show_id : -1 } : movie;
    }

    /**
     * Retrieve guids for all "base" items in a given section (i.e. movies or episodes)
     * @param {number} sectionId
     * @returns {Promise<{ [metadataId: number]: string }>} */
    async baseGuidsForSection(sectionId) {
        let sectionType = (await this.#database.get(`SELECT section_type FROM library_sections WHERE id=?`, [sectionId])).section_type;
        switch (sectionType) {
            case MetadataType.Movie:
                break;
            case MetadataType.Show:
                sectionType = MetadataType.Episode;
                break;
            default:
                throw new ServerError(`baseGuidsForSection: Unexpected library type ${sectionType}`, 500);
        }

        const query = `SELECT id, guid FROM metadata_items WHERE library_section_id=? AND metadata_type=?;`;
        const items = await this.#database.all(query, [sectionId, sectionType]);
        const dict = {};
        for (const item of items) {
            dict[item.id] = item.guid;
        }

        return dict;
    }

    /**
     * Does some post-processing on the given marker data to extract relevant fields.
     * @param {RawMarkerData[]|RawMarkerData} markerData */
    #postProcessExtendedMarkerFields(markerData) {
        const markerArray = markerData ? (markerData instanceof Array) ? markerData : [markerData] : [];
        for (const marker of markerArray) {
            // extra_data should never be null, but better safe than sorry
            marker.final = marker.extra_data?.indexOf('final=1') === -1 ? 0 : 1;

            // TODO: With newly added/edited markers, our cache is not yet updated,
            // so there's a brief period where these values are incorrect, and we rely
            // on the MarkerBackupManager to modify them as soon as the real values
            // are known. Something should probably be done here instead so we aren't
            // returning data that we know is incorrect.
            marker.user_created = MarkerEditCache.getUserCreated(marker.id);
            marker.modified_date = MarkerEditCache.getModifiedAt(marker.id);
            delete marker.extra_data;
        }

        return markerArray;
    }

    /**
     * Retrieve all markers for the given mediaIds, which should all be either episodes
     * or movies (and not mixed).
     * @param {number[]} metadataIds
     * @returns {Promise<RawMarkerData[]>}*/
    async getMarkersForItems(metadataIds) {
        const metadataType = await this.#validateSameMetadataTypes(metadataIds);
        if (metadataType === MetadataType.Invalid) {
            throw new ServerError(`getMarkersForItems can only accept metadata ids that are the same metadata_type`, 400);
        }

        switch (metadataType) {
            case MetadataType.Movie:
                return this.#getMarkersForEpisodesOrMovies(metadataIds, this.#extendedMovieMarkerFields);
            case MetadataType.Episode:
                return this.#getMarkersForEpisodesOrMovies(metadataIds, this.#extendedEpisodeMarkerFields);
            default:
            {
                const typeString = Object.keys(MetadataType).find(k => MetadataType[k] === metadataType);
                throw new ServerError(`getMarkersForItems only expects movie or episode ids, found ${typeString}.`, 400);
            }
        }
    }

    /**
     * Retrieve episodes or movies for the given media ids.
     * @param {number[]} mediaIds
     * @param {string} extendedFields */
    async #getMarkersForEpisodesOrMovies(mediaIds, extendedFields) {
        const validIds = mediaIds.filter(id => !isNaN(id));
        if (validIds.length !== mediaIds.length) {
            const invalidCount = mediaIds.length - validIds.length;
            const invalidIds = mediaIds.filter(isNaN);
            Log.warn(`getMarkersForEpisodesOrMovies: ${invalidCount} invalid media ids found (${invalidIds.join(', ')}), skipping them`);
        }

        const query = `
            SELECT ${extendedFields}
            WHERE taggings.tag_id=? AND metadata_item_id IN (${validIds.join(',')})
            ORDER BY taggings.time_offset ASC;`;

        return this.#postProcessExtendedMarkerFields(await this.#database.all(query, [this.#markerTagId]));
    }

    /**
     * Retrieve all markers for the given section.
     * @param {number} sectionId
     * @param {number} mediaType
     * @returns {Promise<RawMarkerData[]>} */
    #getMarkersForSection(sectionId, mediaType) {
        const fields = this.#extendedFieldsFromMediaType(mediaType);
        const markerQuery =
            `SELECT ${fields} WHERE taggings.tag_id=$tagId AND section_id=$sectionId ORDER BY taggings.time_offset ASC;`;
        const parameters = {
            $tagId : this.#markerTagId,
            $sectionId : sectionId,
        };

        return this.#database.all(markerQuery, parameters);
    }

    /**
     * Retrieve all markers for a single episode.
     * @param {number} metadataId
     * @param {number} [baseType] */
    async getBaseTypeMarkers(metadataId, baseType=undefined) {
        if (!baseType) {
            baseType = (await this.#mediaTypeFromId(metadataId)).metadata_type;
        }

        if (MetadataBaseTypes.indexOf(baseType) === -1) {
            throw new ServerError(`Attempting to get markers for a base type that isn't actually a base type (${baseType})`, 500);
        }

        return this.#getMarkersForMetadataItem(metadataId, `taggings.metadata_item_id`, this.#extendedFieldsFromMediaType(baseType));
    }

    /**
     * Retrieve all markers for a single season.
     * @param {number} seasonId */
    getSeasonMarkers(seasonId) {
        return this.#getMarkersForMetadataItem(seasonId, `seasons.id`, this.#extendedEpisodeMarkerFields);
    }

    /**
     * Retrieve all markers for a single show.
     * @param {number} showId */
    getShowMarkers(showId) {
        return this.#getMarkersForMetadataItem(showId, `seasons.parent_id`, this.#extendedEpisodeMarkerFields);
    }

    /**
     * Retrieve all markers tied to the given metadataId.
     * @param {number} metadataId
     * @returns {Promise<MarkersWithTypeInfo>} */
    async getMarkersAuto(metadataId) {
        const typeInfo = await this.#mediaTypeFromId(metadataId);
        let where = '';
        switch (typeInfo.metadata_type) {
            case MetadataType.Movie  : where = `movies.id`; break;
            case MetadataType.Show   : where = `seasons.parent_id`; break;
            case MetadataType.Season : where = `seasons.id`; break;
            case MetadataType.Episode: where = `taggings.metadata_item_id`; break;
            default:
                throw new ServerError(`Item ${metadataId} is not an episode, season, or series`, 400);
        }

        const markers = await this.#getMarkersForMetadataItem(metadataId, where, this.#extendedFieldsFromMediaType(typeInfo.metadata_type));
        return { markers, typeInfo };
    }

    /**
     * Retrieve the media type and section id for item with the given metadata id.
     * @param {number} metadataId
     * @returns {Promise<MetadataItemTypeInfo>} */
    async #mediaTypeFromId(metadataId) {
        const row = await this.#database.get(
            'SELECT metadata_type, library_section_id AS section_id FROM metadata_items WHERE id=?;',
            [metadataId]);

        if (!row) {
            throw new ServerError(`Metadata item ${metadataId} not found in database.`, 400);
        }

        return row;
    }

    /**
     * Ensure that the list of metadata ids all point to the same media type.
     * @param {number[]} metadataIds
     * @returns {Promise<number>} */
    async #validateSameMetadataTypes(metadataIds) {
        if (metadataIds.length === 0) {
            return MetadataType.Invalid;
        }

        const invalidKeys = metadataIds.filter(isNaN);
        if (invalidKeys.length > 0) {
            Log.warn(`Invalid metadata id(s) found in validateSameMetadataTypes: ${invalidKeys.join(', ')}`);
            return MetadataType.Invalid;
        }

        const query = `SELECT metadata_type, library_section_id AS section_id FROM metadata_items
            WHERE id IN (${metadataIds.join(',')});`;

        /** @type {MetadataItemTypeInfo[]} */
        const items = await this.#database.all(query);
        if (items.length !== metadataIds.length) {
            Log.warn(`validateSameMetadataTypes: ${metadataIds.length - items.length} metadata ids do not exist in the database.`);
            return MetadataType.Invalid;
        }

        const metadataType = items[0].metadata_type;
        for (const item of items) {
            if (item.metadata_type !== metadataType) {
                Log.warn(`validateSameMetadataTypes: Metadata ids have different metadata types.`);
                return MetadataType.Invalid;
            }
        }

        return metadataType;
    }

    /**
     * Retrieve the media type and section id for the item associated with the given marker.
     * @param {number} markerId
     * @returns {Promise<MetadataItemTypeInfo>} */
    async #mediaTypeFromMarkerId(markerId) {
        const row = await this.#database.get(
            `SELECT metadata_type, library_section_id AS section_id
            FROM metadata_items
            INNER JOIN taggings ON taggings.metadata_item_id=metadata_items.id
            WHERE taggings.id=?`, [markerId]);
        if (!row) {
            throw new ServerError(`Marker ${markerId} not found in database.`, 400);
        }

        return row;
    }

    /**
     * Retrieve all markers tied to the given metadataId.
     * @param {number} metadataId
     * @param {string} whereClause The field to match against `metadataId`.
     * @param {string} extendedFields The SELECTed fields to retrieve.
     * @returns {Promise<RawMarkerData[]>} */
    async #getMarkersForMetadataItem(metadataId, whereClause, extendedFields) {
        return this.#postProcessExtendedMarkerFields(await this.#database.all(
            `SELECT ${extendedFields}
            WHERE ${whereClause}=? AND taggings.tag_id=?
            ORDER BY taggings.time_offset ASC;`,
            [metadataId, this.#markerTagId]));
    }

    /**
     * Retrieve a single marker with the given marker id.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} markerId
     * @returns {Promise<RawMarkerData>} */
    async getSingleMarker(markerId) {
        const markerFields = this.#extendedFieldsFromMediaType((await this.#mediaTypeFromMarkerId(markerId)).metadata_type);
        const marker = this.#postProcessExtendedMarkerFields(await this.#database.get(
            `SELECT ${markerFields} WHERE taggings.id=? AND taggings.tag_id=?;`,
            [markerId, this.#markerTagId]));
        Log.assert(marker.length === 1, `getSingleMarker should return a single marker, found ${marker.length}`);
        return marker[0];
    }

    /**
     * Given a list of marker IDs, return a list of their full marker data.
     * @param {number[]} markerIds */
    async getMarkersFromIds(markerIds) {
        if (markerIds.length < 1) {
            return [];
        }

        const markerFields = this.#extendedFieldsFromMediaType((await this.#mediaTypeFromMarkerId(markerIds[0])).metadata_type);
        const query = `SELECT ${markerFields} WHERE taggings.id IN (${markerIds.join(',')}) AND taggings.tag_id=?;`;
        return this.#postProcessExtendedMarkerFields(await this.#database.all(query, [this.#markerTagId]));
    }

    /**
     * Given a MetadataType, determine what fields to include when
     * querying for markers.
     * @param {number} mediaType
     * @returns {string} */
    #extendedFieldsFromMediaType(mediaType) {
        switch (mediaType) {
            case MetadataType.Movie:
                return this.#extendedMovieMarkerFields;
            case MetadataType.Show:
            case MetadataType.Season:
            case MetadataType.Episode:
                return this.#extendedEpisodeMarkerFields;
            default:
                throw new ServerError(`Unexpected media type ${mediaType}`, 400);
        }
    }

    /**
     * Add a marker to the database, taking care of reindexing if necessary.
     * @param {number} metadataId The metadata id of the item to add the marker to.
     * @param {number} startMs Start time, in milliseconds.
     * @param {number} endMs End time, in milliseconds.
     * @param {string} markerType The type of marker
     * @param {number} final Whether this marker should be marked final. Only applies to Credits
     * @returns {Promise<{ allMarkers: RawMarkerData[], newMarker: RawMarkerData}>} */
    async addMarker(metadataId, startMs, endMs, markerType, final) {
        // Ensure metadataId is a base type, it doesn't make sense to add one to any other media type
        const typeInfo = await this.#mediaTypeFromId(metadataId);
        if (MetadataBaseTypes.indexOf(typeInfo.metadata_type) === -1) {
            throw new ServerError(`Attempting to add marker to a media item that's not a base type!`, 400);
        }

        const allMarkers = await this.getBaseTypeMarkers(metadataId);
        const newIndex = this.#reindexForAdd(allMarkers, startMs, endMs, markerType);
        if (newIndex === -1) {
            throw new ServerError('Overlapping markers. The existing marker should be expanded to include this range instead.', 400);
        }

        if (final && newIndex !== allMarkers.length - 1) {
            throw new ServerError(`Attempting to make a new marker final, but it won't be the last marker of the episode.`, 400);
        }

        // Use a transaction to share common add statement with bulk operations
        const transaction = new TransactionBuilder(this.#database);
        this.#addMarkerStatement(
            transaction,
            metadataId,
            newIndex,
            startMs,
            endMs,
            markerType,
            final);

        if (this.#writeExtraData) {
            await this.#addRewriteStatement(transaction, metadataId, allMarkers);
        }

        await transaction.exec();

        // Insert succeeded, update indexes of other markers if necessary
        await this.reindex(metadataId);

        const newMarker = await this.#getNewMarker(metadataId, startMs, endMs, typeInfo.metadata_type);
        return { allMarkers, newMarker };
    }

    /**
     * Helper that adds an 'add marker' statement to the given transaction.
     * @param {TransactionBuilder} transaction
     * @param {number} episodeId The episode to add the marker to.
     * @param {number} newIndex New marker's index in the list of existing markers.
     * @param {number} startMs Start time of the new marker, in milliseconds.
     * @param {number} endMs End time of the new marker, in milliseconds.
     * @param {string} markerType The type of marker (intro/credits)
     * @param {number} final Whether this is the last credits marker that goes to the end of the episode
     * @param {number} [createdAt] What to set as the 'created at' time. Used by bulkRestore to restore original timestamps. */
    #addMarkerStatement(transaction, episodeId, newIndex, startMs, endMs, markerType, final, createdAt=undefined) {
        const validNumber = (n, name) => {
            if (isNaN(newIndex) || (!newIndex && newIndex !== 0)) {
                const realValue = n === undefined ? 'undefined' : n === null ? 'null' : n === '' ? '[Empty String]' : n;
                Log.error(`Not adding marker, expected a number for parameter ${name}, found "${realValue}"`);
                return false;
            }

            return true;
        };

        // The caller should have validated most of this already, but be extra sure we don't add invalid data
        if (!validNumber(episodeId, 'episodeId')
            || !validNumber(newIndex, 'newIndex')
            || !validNumber (startMs, 'startMs')
            || !validNumber(endMs, 'endMs')) {
            throw new ServerError(`Unable to add one or more markers, invalid parameters given`, 500);
        }

        if (Object.values(MarkerType).indexOf(markerType) === -1) {
            Log.error(`Not adding marker, unexpected type "${markerType}"`);
            throw new ServerError(`Unable to add one or more markers, invalid marker type given (${markerType})`, 500);
        }

        const asRaw = new Set();
        const created_at = isNaN(createdAt) ? `(strftime('%s','now'))` : createdAt;
        if (isNaN(createdAt)) {
            asRaw.add('$createdAt');
        }

        const addQuery =
            'INSERT INTO taggings ' +
                '(metadata_item_id, tag_id, `index`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data) ' +
            'VALUES ' +
                `($metadataId, $tagId, $index, $text, $startMs, $endMs, "", $createdAt, $extraData);`;

        /** @type {DbDictParameters} */
        const parameters = {
            $metadataId : episodeId,
            $tagId : this.#markerTagId,
            $index : newIndex,
            $text : markerType,
            $startMs : startMs,
            $endMs : endMs,
            $createdAt : created_at,
            $extraData : ExtraData.get(markerType, final),
            _asRaw : asRaw,
        };

        transaction.addStatement(addQuery, parameters);
    }

    /**
     * @param {TransactionBuilder} transaction
     * @param {number} metadataId
     * @param {MarkerData[]} allMarkers */
    async #addRewriteStatement(transaction, metadataId, allMarkers) {
        if (ExtraData.isLegacy || !this.#writeExtraData) {
            return;
        }

        for (const extraData of await (new MediaAnalysisWriter(metadataId, this.#database)).getExtraData(allMarkers)) {
            transaction.addStatement(extraData.query, extraData.parameters);
        }
    }

    /**
     * Restore multiple markers at once.
     * NOTE: This method is shared between purge restoration and marker import. If changes are made,
     *       make sure the data types line up.
     * @param {{ [episodeId: number] : MarkerAction[] }} actions Map of episode IDs to the list of markers to restore for that episode
     * @param {number} sectionId The section ID we're restoring markers for
     * @param {number} sectionType The type of section we're restoring for (i.e. TV or movie)
     * @param {number} resolveType How to resolve conflicts with existing markers.
     * @returns {Promise<BulkRestoreResult>} */
    /* eslint-disable-next-line complexity */ // TODO: eslint is right, this is massive and should be broken up.
    async bulkRestore(actions, sectionId, sectionType, resolveType) {
        /** @type {RawMarkerData[]} */
        let markerList;
        try {
            const keys = Object.keys(actions).map(eid => parseInt(eid));
            markerList = await this.getMarkersForItems(keys, sectionId);
        } catch (err) {
            throw new ServerError(`Unable to retrieve existing markers to correlate marker restoration:\n\n${err.message}`, 500);
        }

        // One query + postprocessing is faster than a query for each episode
        /** @type {{ [parent_id: string|number] : TrimmedMarker[] }} */
        const existingMarkers = {};
        for (const marker of markerList) {
            Log.tmi(marker, 'Adding existing marker');
            (existingMarkers[marker.parent_id] ??= []).push(TrimmedMarker.fromRaw(marker));
        }

        let expectedInserts = 0;
        const identicalMarkers = [];
        let potentialRestores = 0;

        /** @type {Set<MarkerAction>} */
        const ignoredActions = new Set();
        /** @type {RawMarkerData[]} */
        const toDelete = [];
        /** @type {{[id: number]: ModifiedMarkerDetails}} */
        const toModify = {};
        const transaction = new TransactionBuilder(this.#database);
        for (const [baseItemId, markerActions] of Object.entries(actions)) {
            markerActions.sort((a, b) => a.start - b.start);
            /** @type {MinimalMarkerAction} */
            let lastAction = { start : -2, end : -1, marker_type : 'intro', final : 0, modified_at : 0 };
            // Need a first loop to trim our actions based on overlap with ourselves
            for (const action of markerActions) {
                if (action.start <= lastAction.start ? action.end >= lastAction.start : action.start <= lastAction.end) {
                    // Regardless of how things overlap, we always ignore the current marker,
                    // for the reasons outlined below:
                    ignoredActions.add(action);
                    switch (resolveType) {
                        case MarkerConflictResolution.Ignore:
                            // Making the first marker take precedence gives us a better chance to
                            // restore the most markers possible.
                            // "|A  [B  A| {C  B]  C}" will become "|A  A| {C  C}" and not "{C  C}"
                            break;
                        case MarkerConflictResolution.Merge:
                            // Just extend the last marker, making it the new "tracker" in the backup database.
                            // Credits/final takes precedence over intro/non-final
                            lastAction.start = Math.min(lastAction.start, action.start);
                            lastAction.end = Math.max(lastAction.end, action.end);
                            lastAction.marker_type =
                                action.marker_type === MarkerType.Credits ? MarkerType.Credits : lastAction.marker_type;
                            lastAction.final ||= action.final;
                            lastAction.modified_at = Math.max(lastAction.modified_at, action.modified_at) || null;
                            break;
                        case MarkerConflictResolution.Overwrite:
                            // Similar to Ignore.
                            break;
                        default:
                            break;
                    }
                }

                lastAction = action;
            }

            // Second loop for overlap with existing markers.
            for (const action of markerActions) {
                if (ignoredActions.has(action)) {
                    continue; // We're already ignoring this one.
                }

                /** @type {(m: TrimmedMarker) => boolean} */
                const getOverlapping = m => action.start <= m.start ? action.end >= m.start : action.start <= m.end;

                ++potentialRestores;
                existingMarkers[baseItemId] ??= [];

                // Now check for overlap with existing markers.
                const overlappingMarkers = existingMarkers[baseItemId].filter(getOverlapping);
                let identical = false;
                for (const overlappingMarker of overlappingMarkers) {
                    // If they're identical, ignore no matter the resolution strategy
                    identical = action.start === overlappingMarker.start && action.end === overlappingMarker.end;
                    if (identical) {
                        if (identicalMarkers.length === 10) {
                            Log.verbose('Too many identical markers, moving reporting to TMI');
                        }

                        if (identicalMarkers.length >= 10) {
                            Log.tmi(action, `Ignoring marker that is identical to an existing marker`);
                        } else {
                            Log.verbose(action, `Ignoring marker that is identical to an existing marker`);
                        }

                        // Add to identicalMarkers, but not to ignoredActions. The idea being that for
                        // identicalMarkers we pretend that we restored it with the existing marker, but
                        // we pretend like we explicitly ignored actions in ignoredActions.
                        identicalMarkers.push(overlappingMarker.getRaw());
                        break;
                    }

                    switch (resolveType) {
                        case MarkerConflictResolution.Ignore:
                            ignoredActions.add(action);
                            continue;
                        case MarkerConflictResolution.Merge:
                        {
                            let newModified = null;
                            if (action.modified_at !== null || action.recorded_at !== null || overlappingMarker.modified_date !== null) {
                                newModified = Math.max(
                                    action.modified_at || action.recorded_at || 0,
                                    overlappingMarker.modified_date || 0)
                                    || null;
                            }

                            toModify[overlappingMarker.id] = {
                                marker : overlappingMarker.getRaw(),
                                newData : {
                                    newStart    : Math.min(action.start, overlappingMarker.start),
                                    newEnd      : Math.max(action.end, overlappingMarker.end),
                                    newType     : action.marker_type ===
                                                    MarkerType.Credits ? MarkerType.Credits : overlappingMarker.marker_type,
                                    newFinal    : overlappingMarker.final || action.final,
                                    newModified : newModified,
                                }
                            };

                            ignoredActions.add(action);
                            continue;
                        }
                        case MarkerConflictResolution.Overwrite:
                        {
                            // Delete. However, potentially change the action type if the overlapping marker is a
                            // credits marker, since it's very likely that we're overwriting an automatically created
                            // credits marker with a manually added intro marker that was added before credits were supported.
                            // However, don't override "final", since that might have been a manual operation to prevent the
                            // marker from triggering the PostPlay screen.
                            action.marker_type = overlappingMarker.marker_type === MarkerType.Credits ?
                                MarkerType.Credits :
                                action.marker_type;

                            toDelete.push(overlappingMarker.getRaw());
                            const existingIndex = existingMarkers[baseItemId].indexOf(overlappingMarker);
                            if (~existingIndex) {
                                existingMarkers[baseItemId].splice(existingIndex, 1 /*deleteCount*/);
                            } else {
                                Log.warn(`How did we process a marker that's not in the existingMarkers map?`);
                            }
                            break;
                        }
                        default:
                            break;
                    }
                }

                if (ignoredActions.has(action) || identical) {
                    continue;
                }

                // If we're here, we've passed all checks and want to restore the action.
                Log.tmi(action, 'Adding marker to restore');
                existingMarkers[baseItemId].push(TrimmedMarker.fromBackup(action));
            }

            // TODO: indexRemove: just +1 to existing length
            existingMarkers[baseItemId].sort((a, b) => a.start - b.start).forEach((marker, index) => {
                marker.newIndex = index;
            });

            for (const marker of Object.values(existingMarkers[baseItemId])) {
                if (marker.existing()) {
                    continue;
                }

                ++expectedInserts;
                this.#addMarkerStatement(transaction,
                    parseInt(baseItemId),
                    marker.newIndex,
                    marker.start,
                    marker.end,
                    marker.marker_type,
                    marker.final,
                    marker.created_at);
            }

            // Adjust marker index if necessary.
            for (const marker of Object.values(existingMarkers[baseItemId])) {
                if (marker.index !== marker.newIndex && marker.existing()) {
                    Log.tmi(`Found marker to reindex (was ${marker.index}, now ${marker.newIndex})`);
                    transaction.addStatement('UPDATE taggings SET `index`=? WHERE id=?;', [marker.newIndex, marker.id]);
                }
            }
        }

        if (identicalMarkers.length > 10 && Log.getLevel() >= ConsoleLog.Level.Verbose) {
            Log.verbose(`Found ${identicalMarkers.length - 10} additional identical markers that are being ignored.`);
        }

        for (const marker of toDelete) {
            transaction.addStatement('DELETE FROM taggings WHERE id=?;', [marker.id]);
        }

        for (const markerInfo of Object.values(toModify)) {
            const newData = markerInfo.newData;
            // Index is taken care of further down below.
            transaction.addStatement(
                'UPDATE taggings SET text=?, time_offset=?, end_time_offset=?, extra_data=? WHERE id=?',
                [newData.newType,
                    newData.newStart,
                    newData.newEnd,
                    ExtraData.get(newData.newType, newData.newFinal),
                    markerInfo.marker.id]
            );
        }

        if (expectedInserts === 0) {
            Log.assert(
                ignoredActions.size > 0,
                `bulkRestore: no inserts expected, but we aren't blocking any actions.`);
            if (toDelete.length === 0 && Object.keys(toModify).length === 0) {
                // This is only expected if every marker we tried to restore already exists. In that case just
                // immediately return without any new markers, since we didn't add any.
                const isExpected = identicalMarkers.length + ignoredActions.size === potentialRestores;
                Log.assert(isExpected, `bulkRestore: identicalMarkers == potentialRestores`);
                Log.warn(`bulkRestore: no markers to restore, did they all match against an existing marker?`);
                return {
                    newMarkers : [],
                    identicalMarkers : identicalMarkers,
                    deletedMarkers : [],
                    modifiedMarkers : [],
                    ignoredActions : Array.from(ignoredActions)
                };
            }
        }

        Log.tmi('Built full restore query:\n' + transaction.toString());

        try {
            transaction.exec();
        } catch (err) {
            throw ServerError.FromDbError(err);
        }

        Log.verbose('Successfully restored markers to Plex database');

        // All markers were added successfully. Now query them all to return back to the backup manager
        // so it can update caches accordingly.
        // If this throws, the server really should restart. We added the markers successfully,
        // but we can't update our caches since we couldn't retrieve them.
        const newMarkers = await this.#newMarkersAfterBulkInsert(existingMarkers, sectionId, sectionType);

        if (newMarkers.length !== expectedInserts) {
            Log.warn(`Expected to find ${expectedInserts} new markers, found ${newMarkers.length} instead.`);
        }

        return {
            newMarkers : this.#postProcessExtendedMarkerFields(newMarkers),
            identicalMarkers : identicalMarkers,
            deletedMarkers : toDelete,
            modifiedMarkers : Object.values(toModify),
            ignoredActions  : Array.from(ignoredActions)
        };
    }

    /**
     * @param {{ [parent_id: string|number] : TrimmedMarker[] }} existingMarkers
     * @param {number} sectionId
     * @param {number} sectionType
     * @returns {Promise<RawMarkerData[]>} */
    async #newMarkersAfterBulkInsert(existingMarkers, sectionId, sectionType) {
        const toQuery = Object.values(existingMarkers);
        if (toQuery.length > 150) {
            // If we have more than 150 markers, get all section markers and then filter,
            // since we don't want want to hit SQLite's condition limit, and it's faster than
            // running hundreds of individual queries.
            const allMarkers = await this.#getMarkersForSection(sectionId, sectionType);
            const filtered = [];
            /** @type {{[parentId: number]: {[start: number]: Set<number>}}} */
            const filterSet = {};
            let existingCount = 0;
            let newCount = 0;
            for (const markerArr of toQuery) {
                for (const trimmedMarker of markerArr) {
                    if (trimmedMarker.existing()) {
                        ++existingCount;
                        continue;
                    }

                    filterSet[trimmedMarker.parent_id] ??= {};
                    filterSet[trimmedMarker.parent_id][trimmedMarker.start] ??= new Set();
                    filterSet[trimmedMarker.parent_id][trimmedMarker.start].add(trimmedMarker.end);
                    ++newCount;
                }
            }

            Log.info(`Expecting ${newCount} new markers against ${existingCount} existing.`);
            for (const marker of allMarkers) {
                if (filterSet[marker.parent_id] && filterSet[marker.parent_id][marker.start]?.has(marker.end)) {
                    filtered.push(marker);
                }
            }

            return filtered;
        }

        const params = [this.#markerTagId];
        let query = `SELECT ${this.#extendedFieldsFromMediaType(sectionType)} WHERE taggings.tag_id=? AND (`;
        for (const newMarkers of Object.values(existingMarkers)) {
            for (const newMarker of newMarkers) {
                if (newMarker.existing()) {
                    continue;
                }

                query += '(taggings.metadata_item_id=? AND taggings.time_offset=? AND taggings.end_time_offset=?) OR ';
                params.push(newMarker.parent_id, newMarker.start, newMarker.end);
            }
        }

        query = query.substring(0, query.length - 4) + ')';
        return params.length === 1 ? [] : await this.#database.all(query, params);
    }

    /**
     * Finds the new indexes for the given markers, given the start and end time of the
     * new marker to be inserted. New indexes are stored in the marker's `newIndex` field,
     * and the index for the new marker is returned directly. If overlapping markers are
     * not allowed, -1 is returned if overlap is detected.
     *
     * TODO: indexRemove: With the introduction of credits, it's apparent that the index
     * itself doesn't matter, it just needs to be 0 to N, making this step unnecessary.
     * Is it worth ripping out?
     * @param {RawMarkerData[]} markers
     * @param {number} newStart The start time of the new marker, in milliseconds.
     * @param {number} newEnd The end time of the new marker, in milliseconds.
     * @returns {number} The new marker index, or -1 if the reindex results in overlap. */
    #reindexForAdd(markers, newStart, newEnd, markerType) {
        const pseudoData = { start : newStart, end : newEnd, marker_type : markerType };
        markers.push(pseudoData);
        markers.sort((a, b) => a.start - b.start).forEach((marker, index) => {
            marker.newIndex = index;
        });

        pseudoData.index = pseudoData.newIndex;
        const newIndex = pseudoData.newIndex;
        const startOverlap = newIndex !== 0 && markers[newIndex - 1].end >= pseudoData.start;
        const endOverlap = newIndex !== markers.length - 1 && markers[newIndex + 1].start <= pseudoData.end;
        return (startOverlap || endOverlap) ? -1 : newIndex;
    }

    /**
     * Updates the start/end/update time of the marker with the given id.
     * @param {number} markerId
     * @param {number} index The marker's new index in the marker table.
     * @param {number} startMs The new start time, in milliseconds.
     * @param {number} endMs The new end time, in milliseconds.
     * @param {string} markerType The type of marker (intro/credits)
     * @param {number} final Whether this Credits marker goes to the end of the media item.
     * @returns {Promise<void>} */
    editMarker(markerId, index, startMs, endMs, markerType, final) {
        return this.#database.run(
            'UPDATE taggings SET `index`=?, text=?, time_offset=?, end_time_offset=?, extra_data=? WHERE id=?;',
            [index, markerType, startMs, endMs, ExtraData.get(markerType, final), markerId]);
    }

    /**
     * Delete the given marker from the database.
     * @param {number} markerId
     * @returns {Promise<void>} */
    deleteMarker(markerId) {
        return this.#database.run('DELETE FROM taggings WHERE id=?;', [markerId]);
    }

    /**
     * Retrieve a marker that was just added to the database.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} metadataId The metadata id of the item the marker belongs to.
     * @param {number} startMs The start time of the new marker.
     * @param {number} endMs The end time of the new marker.
     * @param {number} baseType The type of item this marker is attached to (movie/episode)
     * @returns {Promise<RawMarkerData>} */
    async #getNewMarker(metadataId, startMs, endMs, baseType) {
        const fields = this.#extendedFieldsFromMediaType(baseType);
        const marker = this.#postProcessExtendedMarkerFields(await this.#database.get(
            `SELECT ${fields} WHERE metadata_item_id=? AND tag_id=? AND taggings.time_offset=? AND taggings.end_time_offset=?;`,
            [metadataId, this.#markerTagId, startMs, endMs]));
        if (marker.length !== 1) {
            Log.warn(`Expected a single marker in #getNewMarker, found ${marker.length}`);
        }

        return marker[0];
    }

    /**
     * Retrieve all base items (episodes/movies) and their markers (if any) in the given section.
     *
     * Fields returned: `parent_id`, `tag_id`
     * @param {number} sectionId
     * @returns {Promise<{parent_id: number, tag_id: number, marker_type: string}[]>} */
    async markerStatsForSection(sectionId) {
        const baseType = await this.#baseItemTypeFromSection(sectionId);
        // Note that the query below that grabs _all_ tags for an item and discarding
        // those that aren't markers is faster than doing an outer join on a
        // temporary taggings table that only includes markers
        const query = `
        SELECT b.id AS parent_id, m.tag_id AS tag_id, m.text AS marker_type FROM metadata_items b
            LEFT JOIN taggings m ON b.id=m.metadata_item_id
        WHERE b.library_section_id=? AND b.metadata_type=?
        ORDER BY b.id ASC;`;

        return this.#database.all(query, [sectionId, baseType]);
    }

    /**
     * Retrieve the base item type for a given section, i.e. the media type
     * that can actually have markers associated with it.
     * @param {number} sectionId
     * @returns {Promise<number>} */
    async #baseItemTypeFromSection(sectionId) {
        const sectionType = (await this.#database.get(`SELECT section_type FROM library_sections WHERE id=?`, [sectionId])).section_type;
        switch (sectionType) {
            case MetadataType.Movie:
                return sectionType;
            case MetadataType.Show:
                return MetadataType.Episode;
            default:
                throw new ServerError(`baseGuidsForSection: Unexpected library type ${sectionType}`, 500);
        }
    }

    /**
     * Return the ids and UUIDs for all sections in the database.
     * @returns {Promise<{ id: number, uuid: string, section_type: number }[]>} */
    sectionUuids() {
        return this.#database.all('SELECT id, uuid, section_type FROM library_sections;');
    }

    /**
     * Shift the given markers by the given offset
     * @param {{[episodeId: number]: RawMarkerData[]}} markers The markers to shift
     * @param {RawEpisodeData[]} episodeData
     * @param {number} startShift The time to shift marker starts by, in milliseconds
     * @param {number} endShift The time to shift marker ends by, in milliseconds */
    async shiftMarkers(markers, episodeData, startShift, endShift) {
        const episodeIds = Object.keys(markers).map(eid => parseInt(eid));
        /** @type {{ [episodeId: number|string]: number }} */
        const limits = {};
        for (const episode of episodeData) {
            limits[episode.id] = episode.duration;
        }

        const transaction = new TransactionBuilder(this.#database);
        let expectedShifts = 0;
        for (const episodeMarkers of Object.values(markers)) {
            for (const marker of episodeMarkers) {
                ++expectedShifts;
                const maxDuration = limits[marker.parent_id];
                if (!maxDuration) {
                    throw new ServerError(`Unable to find max episode duration, ` +
                        `the episode id ${marker.parent_id} doesn't appear to be valid.`, 400);
                }

                const newStart = Math.max(0, Math.min(marker.start + startShift, maxDuration));
                const newEnd = Math.max(0, Math.min(marker.end + endShift, maxDuration));
                if (newStart === newEnd) {
                    // Shifted entirely outside of the episode? We should have already checked for that.
                    throw new ServerError(`Attempting to shift marker (${marker.start}-${marker.end}) by ${startShift}${endShift} ` +
                        `puts it outside the bounds of the episode (0-${maxDuration})!`, 400);
                }

                transaction.addStatement(
                    'UPDATE taggings SET time_offset=?, end_time_offset=? WHERE id=?',
                    [newStart, newEnd, marker.id]
                );
            }
        }

        await transaction.exec();
        const newMarkers = await this.getMarkersForItems(episodeIds);
        // No ignored markers, no need to prune
        if (newMarkers.length === expectedShifts) {
            return newMarkers;
        }

        const pruned = [];
        for (const marker of newMarkers) {
            if (markers[marker.parent_id] && markers[marker.parent_id].find(x => x.id === marker.id)) {
                pruned.push(marker);
            }
        }

        return pruned;
    }

    /**
     * Ensure the indexes for the markers under the given show/season/episode metadataId are in order.
     * TODO: removeIndex: find callers, do we ever actually need a full reindex? Delete is the only scenario,
     *       and in that case we can get away with "index -= N"
     * @param {number} metadataId */
    async reindex(metadataId) {
        const markerInfo = await this.getMarkersAuto(metadataId);
        /** @type {{[episodeId: number]: RawMarkerData[]}} */
        const episodeMap = {};
        for (const marker of markerInfo.markers) {
            (episodeMap[marker.parent_id] ??= []).push(marker);
        }

        const transaction = new TransactionBuilder(this.#database);
        for (const markerGroup of Object.values(episodeMap)) {
            markerGroup.sort((a, b) => a.start - b.start).forEach((marker, index) => {
                marker.newIndex = index;
            });

            for (const marker of markerGroup) {
                if (marker.newIndex !== marker.index) {
                    transaction.addStatement('UPDATE taggings SET `index`=? WHERE id=?;', [marker.newIndex, marker.id]);
                    marker.index = marker.newIndex;
                }
            }
        }

        if (!transaction.empty()) {
            Log.verbose(`reindex: Reindexing ${transaction.statementCount()} markers.`);
            await transaction.exec();
        }

        return markerInfo;
    }

    /**
     * Delete all markers with the given ids.
     * @param {RawMarkerData[]} markers */
    bulkDelete(markers) {
        const transaction = new TransactionBuilder(this.#database);
        for (const marker of markers) {
            transaction.addStatement(`DELETE FROM taggings WHERE id=?;`, [marker.id]);
        }

        return transaction.exec();
    }

    /**
     * A "simple" bulk add operation, where each episode is given the same start and end timestamp.
     * @param {MarkersWithTypeInfo} markerData Existing markers for the given metadata id.
     * @param {number} metadataId Metadata id for the item that encompasses all episodes associated with this action.
     * @param {number} baseStart Marker start, in milliseconds
     * @param {number} baseEnd Marker end, in milliseconds
     * @param {string} markerType Type of marker (intro/credits)
     * @param {number} resolveType The `BulkMarkerResolveType`
     * @param {number[]} ignored List of episode ids to skip. */
    async bulkAddSimple(markerData, metadataId, baseStart, baseEnd, markerType, resolveType, ignored=[]) {
        /** @type {CustomBulkAddMap} */
        const bulkMarkerAddData = {};

        /** @type {(offset: number, episode: RawEpisodeData) => number} */
        const realTimestamp = (offset, episode) =>
            (offset < 0 || Object.is(offset, -0)) ? episode.duration + offset : offset;

        const episodeData = await this.getEpisodesAuto(metadataId);
        const ignoredEpisodes = new Set(ignored);
        for (const episode of episodeData) {
            if (!ignoredEpisodes.has(episode.id)) {
                bulkMarkerAddData[episode.id] = { start : realTimestamp(baseStart, episode), end : realTimestamp(baseEnd, episode) };
            }
        }

        return this.#bulkAddCore(metadataId, markerData.markers, bulkMarkerAddData, episodeData, markerType, resolveType);
    }

    /**
     * A custom bulk add operation, where each episode can have customized start and end timestamps.
     * @param {MarkersWithTypeInfo} markerData Existing markers for the given metadata id.
     * @param {number} metadataId Metadata id for the item that encompasses all episodes associated with this action.
     * @param {string} markerType Type of marker (intro/credits)
     * @param {number} resolveType The `BulkMarkerResolveType`
     * @param {CustomBulkAddMap} newMarkers The map of episode ids to the custom start/end timestamps. */
    async bulkAddCustom(markerData, metadataId, markerType, resolveType, newMarkers) {
        const existingMarkers = markerData.markers;
        const episodeData = await this.getEpisodesAuto(metadataId);
        return this.#bulkAddCore(metadataId, existingMarkers, newMarkers, episodeData, markerType, resolveType);
    }

    /**
     * Core operation that adds markers to multiple episodes, with multiple overlapping marker resolution strategies.
     * @param {number} metadataId Metadata id for the item that encompasses all episodes associated with this action.
     * @param {RawMarkerData[]} existingMarkers Existing markers for all episodes that belong to `metadataId`.
     * @param {CustomBulkAddMap} newMarkers The map of episode ids to the new markers to add.
     * @param {RawEpisodeData[]} episodeData The episode data for all items under the given metadata id
     * @param {string} markerType Type of marker (intro/credits)
     * @param {number} resolveType The `BulkMarkerResolveType`
     * @returns {Promise<BulkAddResult>} */
    /* eslint-disable-next-line complexity */ // TODO: eslint is right, this is massive and should be broken up.
    async #bulkAddCore(metadataId, existingMarkers, newMarkers, episodeData, markerType, resolveType) {
        const ignoredEpisodes = new Set();

        // Only need to iterate over episodes that we're attempting to add a marker to,
        // which isn't necessary the same as the ids of episodeData.
        const episodeIds = new Set(Object.keys(newMarkers).map(eid => parseInt(eid)));
        /** @type {{[episodeId: number]: BulkAddResultEntry}} */
        const episodeMarkerMap = {};
        for (const episode of episodeData) {
            // Add data even for ignored markers, purely to make client-side reporting easier.
            episodeMarkerMap[episode.id] = { episodeData : new EpisodeData(episode), existingMarkers : [] };
            if (!episodeIds.has(episode.id)) {
                ignoredEpisodes.add(episode.id);
            }
        }

        existingMarkers.forEach(m => episodeMarkerMap[m.parent_id].existingMarkers.push(new MarkerData(m)));
        Object.values(episodeMarkerMap).forEach(ed => ed.existingMarkers.sort((a, b) => a.start - b.start));

        // For dry runs, we just return all episodes and their associated markers (if any)
        if (resolveType === BulkMarkerResolveType.DryRun) {
            return {
                applied : false,
                episodeMap : episodeMarkerMap
            };
        }

        // Pass 1: Check new markers for invalid bounds (e.g. due to bad "offset from end" timestamps)
        // Not caught in bulkAddSimple/bulkAddCustom directly because we want to return the episode map.
        for (const marker of Object.values(newMarkers)) {
            const negative = marker.start < 0 || marker.end < 0;
            const flipped = marker.start >= marker.end;
            if (negative || flipped) {
                let msg = negative ?
                    `At least one marker's start or end is negative` :
                    `At least one marker's start time is greater than its end time`;

                msg += `. Check the customization table.`;
                return {
                    applied : false,
                    notAppliedReason : msg,
                    episodeMap : episodeMarkerMap,
                };
            }
        }

        // Pass 2: Check existing markers for overlap
        for (const marker of existingMarkers) {
            const newMarker = newMarkers[marker.parent_id];
            if (!newMarker) {
                // Ignored episode.
                continue;
            }

            if (newMarker.start <= marker.start ? newMarker.end >= marker.start : newMarker.start <= marker.end) {
                // Conflict.
                if (resolveType === BulkMarkerResolveType.Fail) {
                    // Still a success, because the user _wants_ this to fail.
                    return {
                        applied : false,
                        notAppliedReason : 'At least one marker overlaps with an existing marker. Check the customization table.',
                        episodeMap : episodeMarkerMap
                    };
                }

                if (resolveType === BulkMarkerResolveType.Ignore) {
                    episodeIds.delete(marker.parent_id);
                    delete newMarkers[marker.parent_id];
                    ignoredEpisodes.add(marker.parent_id);
                }
            }
        }

        // Set of RawMarkerData ids that were edited. Map from RawMarkerData after reindex to map to episodeMap.editedMarkers
        const mergeEdited = new Set();
        // Set of episodeIds that have a normal add. Correlate after reindex with start and end time, map to episodeMap.addedMarkers
        const plainAdd = new Set();
        const transaction = new TransactionBuilder(this.#database);

        // Pass 3: Apply new markers and adjust them as necessary
        for (const episodeId of episodeIds) {
            const newMarker = newMarkers[episodeId];
            const newStart = newMarker.start;
            const duration = episodeMarkerMap[episodeId].episodeData.duration;
            const newEnd = Math.min(duration, newMarker.end);
            // bool vs number shouldn't matter, since it only really matters for backup db purposes, but be consistent.
            const final = (markerType === MarkerType.Credits && newMarker.end >= duration) ? 1 : 0;
            const episodeMarkers = episodeMarkerMap[episodeId].existingMarkers;
            if (!episodeMarkers || episodeMarkers.length === 0) {
                this.#addMarkerStatement(transaction, episodeId, 0 /*newIndex*/, newStart, newEnd, markerType, final);
                plainAdd.add(episodeId);
                episodeMarkerMap[episodeId].isAdd = true;
                continue;
            }

            // Process merges and envelops.
            const existingCount = episodeMarkers.length;
            for (let i = 0; i < existingCount; ++i) {
                const episodeMarker = episodeMarkers[i];
                if (episodeMarker.end < newStart) {
                    if (i === existingCount - 1) {
                        // We're adding beyond the last marker
                        this.#addMarkerStatement(transaction, episodeId, existingCount, newStart, newEnd, markerType, final);
                        plainAdd.add(episodeId);
                        episodeMarkerMap[episodeId].isAdd = true;
                    }

                    continue;
                }

                if (newStart <= episodeMarker.start ? newEnd >= episodeMarker.start : newStart <= episodeMarker.end) {
                    // If we have a conflict here, we better be merging or overwriting.
                    const isMerge = resolveType === BulkMarkerResolveType.Merge;
                    if (!isMerge && resolveType !== BulkMarkerResolveType.Overwrite) {
                        throw new ServerError(`Attempted to touch existing markers during a bulk add when the user didn't request it`, 500);
                    }

                    let endAdj = Math.max(newEnd, episodeMarker.end);
                    while (i < existingCount - 1 && episodeMarkers[i + 1].start <= endAdj) {
                        // Merge next marker into existing, deleting next marker.
                        const nextMarker = episodeMarkers[++i];
                        endAdj = Math.max(endAdj, nextMarker.end);
                        transaction.addStatement(`DELETE FROM taggings WHERE id=?;`, [nextMarker.id]);
                        (episodeMarkerMap[episodeId].deletedMarkers ??= []).push(nextMarker);
                    }

                    if (resolveType === BulkMarkerResolveType.Merge) {
                        episodeMarker.start = Math.min(newStart, episodeMarker.start);
                        episodeMarker.end = endAdj;
                        transaction.addStatement(
                            `UPDATE taggings SET time_offset=?, end_time_offset=? WHERE id=?;`,
                            [episodeMarker.start, episodeMarker.end, episodeMarker.id]);
                        episodeMarkerMap[episodeId].isAdd = false;
                        mergeEdited.add(episodeMarker.id);
                        break;
                    } else {
                        transaction.addStatement(`DELETE FROM taggings WHERE id=?;`, [episodeMarker.id]);
                        (episodeMarkerMap[episodeId].deletedMarkers ??= []).push(episodeMarker);
                    }
                }

                this.#addMarkerStatement(transaction, episodeId, i, newStart, newEnd, markerType, final);
                episodeMarkerMap[episodeId].isAdd = true;
                plainAdd.add(episodeId);
                break;
            }
        }

        // Clear existing markers and refill with reindexed markers
        Object.values(episodeMarkerMap).forEach(eg => eg.existingMarkers = []);

        await transaction.exec();
        const adjustedMarkers = (await this.reindex(metadataId)).markers;
        for (const marker of adjustedMarkers) {
            const markerData = new MarkerData(marker);
            const eid = marker.parent_id;
            if (mergeEdited.has(marker.id)) {
                episodeMarkerMap[eid].changedMarker = markerData;
            } else if (plainAdd.has(eid) && marker.start === newMarkers[eid]?.start) {
                // End may be truncated, so only check for start. All the checks above should guarantee
                // that only checking the start is unique.
                episodeMarkerMap[eid].changedMarker = markerData;
            }

            episodeMarkerMap[eid].existingMarkers.push(markerData);
        }

        Object.values(episodeMarkerMap).forEach(eg => eg.existingMarkers.sort((a, b) => a.start - b.start));
        return {
            applied : true,
            episodeMap : episodeMarkerMap,
            ignoredEpisodes : Array.from(ignoredEpisodes)
        };
    }

    /**
     * Deletes all markers of the given type from the given section, both
     * manually modified and Plex-generated markers.
     * @param {number} section
     * @param {number} deleteType
     * @returns {Promise<number>} */
    async nukeSection(section, deleteType) {
        let whereClause = `WHERE m.library_section_id=? AND taggings.tag_id=? AND (`;
        const params = [section, this.#markerTagId];

        let markerTypeFilter = '';
        for (const markerType of Object.values(MarkerType)) {
            if (MarkerEnum.typeMatch(markerType, deleteType)) {
                markerTypeFilter += ` OR taggings.text=?`;
                params.push(markerType);
            }
        }

        if (markerTypeFilter.length === 0) {
            throw new ServerError(`Server delete type ${deleteType} does not match any known marker types.`, 400);
        }

        markerTypeFilter = markerTypeFilter.substring(4);
        whereClause += markerTypeFilter + ')';

        // Determine how many markers we're deleting, purely for reporting
        const countQuery =
`SELECT COUNT(*) AS count FROM taggings
 INNER JOIN metadata_items m ON m.id=taggings.metadata_item_id
 ${whereClause};`;
        const deleteCount = (await this.#database.get(countQuery, params)).count;

        const deleteQuery = `
DELETE FROM taggings
WHERE metadata_item_id in (SELECT id FROM metadata_items WHERE library_section_id=?)
    AND tag_id=?
    AND (${markerTypeFilter});`;

        Log.info(`Attempting to delete ${deleteCount} markers for section ${section}.`);
        Log.tmi(params, deleteQuery + `\nParams`);
        await this.#database.run(deleteQuery, params);
        return deleteCount;
    }

    /**
     * In previous versions of this application, the thumb_url column of the taggings table
     * was commandeered to indicate when a marker had been last modified, and whether the marker
     * was user-created. Remove that and rely on our own marker actions database. */
    async removeThumbUrlHack() {
        const hackCountQuery = `SELECT COUNT(*) AS count FROM taggings WHERE tag_id=? AND LENGTH(thumb_url) > 0;`;
        const count = (await this.#database.get(hackCountQuery, [this.#markerTagId])).count;
        Log.info(`removeThumbUrlHack - Removing ${count} hacked thumb_url entries.`);
        const query = `UPDATE taggings SET thumb_url="" WHERE tag_id=? AND LENGTH(thumb_url) > 0;`;
        await this.#database.run(query, [this.#markerTagId]);
    }

    /**
     * Retrieve chapters.
     * @param {number} metadataId
     * @returns {Promise<ChapterMap>} */
    async getMediaChapters(metadataId) {
        let query = `
SELECT media_parts.extra_data AS extra_data, b.id AS id FROM media_parts
INNER JOIN media_items ON media_parts.media_item_id=media_items.id
INNER JOIN metadata_items b ON media_items.metadata_item_id=b.id`;

        let where = '';
        const mediaInfo = await this.#mediaTypeFromId(metadataId);
        switch (mediaInfo.metadata_type) {
            case MetadataType.Show:
                query += `\nINNER JOIN metadata_items p ON b.parent_id=p.id`;
                where = `p.parent_id`;
                break;
            case MetadataType.Season:
                where = `b.parent_id`;
                break;
            case MetadataType.Episode:
                where = `b.id`;
                break;
            case MetadataType.Movie:
                where = `b.id`;
                break;
            default: throw new ServerError(`Unexpected metadata type ${mediaInfo.metadata_type} in getMediaChapters`, 400);
        }

        query += ` WHERE ${where}=?;`;

        // TODO: Better multi-version/stacked items. Currently, the last media item we parse
        // that has chapter data wins.
        const data = (await this.#database.all(query, [metadataId]));
        if (!data) {
            throw new ServerError(`No underlying media items found for metadata id ${metadataId}`, 400);
        }

        /** @type {ChapterMap} */
        const result = {};
        for (const baseItem of data) {
            const baseId = baseItem.id;
            if (!baseItem.extra_data) {
                // Last version wins, but don't overwrite with empty data if we already have something set.
                result[baseId] ??= [];
                continue;
            }

            try {
                /** @type {{ name : string, start : number, end : number }[]} */
                const rawChapters = this.#getChapterJson(baseItem.extra_data);
                if (!rawChapters || rawChapters.length === 0) {
                    result[baseId] ??= [];
                    continue;
                }

                /** @type {ChapterData[]} */
                const chapters = [];
                for (const chapter of rawChapters) {
                    const start = parseInt(chapter.start * 1000); // Stored as decimal seconds, convert to ms.

                    // If the start of a chapter is the end of the previous chapter, decrease
                    // the previous end to avoid overlap.
                    if (chapters.length && start === chapters[chapters.length - 1].end) {
                        --chapters[chapters.length - 1].end;
                    }

                    chapters.push({
                        name : chapter.name,
                        index : chapters.length,
                        start : start,
                        end : parseInt(chapter.end * 1000)
                    });
                }


                result[baseId] = chapters;
            } catch (e) {
                throw new ServerError(`Unexpected chapter data, could not convert to object`, 500);
            }
        }

        return result;
    }

    /**
     * Parse chapter data from the given extraData
     * @param {string} extraData
     * @returns {{ name : string, start : number, end : number }[]?} */
    #getChapterJson(extraData) {
        if (!ExtraData.isLegacy) {
            try {
                const chapters = JSON.parse(extraData)['pv:chapters'];
                if (chapters) {
                    return JSON.parse(chapters).Chapters?.Chapter;
                }
            } catch (ex) {
                Log.warn('getChapterJson - Expected PMS >=1.40 to have JSON chapter data, but it could not be found.');
            }
        }

        const chapterStart = extraData.indexOf('pv%3Achapters=');
        if (chapterStart === -1) {
            return;
        }

        let chapterEnd = extraData.indexOf('&', chapterStart);
        if (chapterEnd === -1) {
            chapterEnd = extraData.length;
        }

        return JSON.parse(decodeURIComponent(extraData.substring(chapterStart + 14, chapterEnd))).Chapters?.Chapter;
    }
}

export { PlexQueryManager, Instance as PlexQueries, ExtraData, MetadataType };
