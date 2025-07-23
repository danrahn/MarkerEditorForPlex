import { BulkMarkerResolveType } from '/Shared/PlexTypes.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { CustomEvents } from './CustomEvents.js';
import FetchError from './FetchError.js';
import { MarkerEnum } from '/Shared/MarkerType.js';
import { PostCommands } from '/Shared/PostCommands.js';

/** @typedef {!import('/Shared/PlexTypes').BulkDeleteResult} BulkDeleteResult */
/** @typedef {!import('/Shared/PlexTypes').BulkRestoreResponse} BulkRestoreResponse */
/** @typedef {!import('/Shared/PlexTypes').ChapterMap} ChapterMap */
/** @typedef {!import('/Shared/PlexTypes').CustomBulkAddMap} CustomBulkAddMap */
/** @typedef {!import('/Shared/PlexTypes').ExtendedQueryInfo} ExtendedQueryInfo */
/** @typedef {!import('/Shared/PlexTypes').PurgeSection} PurgeSection */
/** @typedef {!import('/Shared/PlexTypes').SerializedBulkAddResult} SerializedBulkAddResult */
/** @typedef {!import('/Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('/Shared/PlexTypes').SerializedEpisodeAndMarkerData} SerializedEpisodeAndMarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMovieData} SerializedMovieData */
/** @typedef {!import('/Shared/PlexTypes').SerializedSeasonData} SerializedSeasonData */
/** @typedef {!import('/Shared/PlexTypes').SerializedShowData} SerializedShowData */
/** @typedef {!import('/Shared/PlexTypes').ShiftResult} ShiftResult */
/** @typedef {!import('/Shared/MarkerBreakdown').MarkerBreakdownMap} MarkerBreakdownMap */
/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */
/** @template T @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T> */

const Log = ContextualLog.Create('ServerCommands');

/**
 * Core method that makes a request to the server, expecting JSON in return.
 * @param {URL} url The fully built URL endpoint
 * @param {FormData} body The message body, if any. */
async function jsonPostCore(url, body=null) {
    const init = { method : 'POST', headers : { accept : 'application/json' } };
    if (body) {
        init.body = body;
    }

    try {
        const response = await fetch(url, init);
        if (!response.ok) {
            switch (response.status) {
                case 401:
                case 403:
                    // 401/403 always indicates an expired/invalid session.
                    // If we're not already at login.html, immediate redirect to it.
                    if (window.location.href.toLowerCase().indexOf('login.html') === -1) {
                        Log.warn('Authentication error, redirecting to login.');
                        window.location = '/login.html?expired=1';
                    }
                    break;
                default:
                    break;
            }
        }

        const result = await response.json();
        Log.verbose(result, `Response from ${url}`);
        if (!result || result.Error) {

            // Global check to see if we failed because the server is suspended.
            // If so, show the undismissible 'Server Paused' overlay.
            if (result.Error && result.Error === 'Server is suspended') {
                Log.info('Action was not completed because the server is suspended.');
                window.dispatchEvent(new Event(CustomEvents.ServerPaused));
                // Return unfulfillable Promise. Gross, but since the user can't do anything anyway, we don't really care.
                return new Promise((_resolve, _reject) => {});
            }

            throw new FetchError(result ? result.Error : `Request to ${url} failed`);
        }

        return result;
    } catch (err) {
        throw new FetchError(err.message, err.stack);
    }
}

/**
 * Generic method to make a request to the given endpoint that expects a JSON response.
 * @param {string} endpoint The URL to query.
 * @param {{[parameter: string]: any}} parameters URL parameters. */
function jsonRequest(endpoint, parameters={}) {
    const url = new URL(endpoint, window.location.href);
    for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.append(key, value);
    }

    return jsonPostCore(url);
}

/**
 * Similar to jsonRequest, but expects blob data and attaches parameters to the body instead of URL parameters.
 * @param {string} endpoint
 * @param {Object} parameters */
function jsonBodyRequest(endpoint, parameters={}) {
    const url = new URL(endpoint, window.location.href);
    const data = new FormData();
    for (const [key, value] of Object.entries(parameters)) {
        data.append(key, value);
    }

    return jsonPostCore(url, data);
}

/* eslint-disable max-len */
/**
 * Map of all available server endpoints.
 * Keep in sync with ServerCommands.#commandMap */
export const ServerCommands = {
    /**
     * Add a marker to the Plex database
     * @param {string} type
     * @param {number} metadataId
     * @param {number} start
     * @param {number} end
     * @param {number} [final=0]
     * @returns {Promise<SerializedMarkerData>} */
    add : (type, metadataId, start, end, final = 0) => jsonRequest(PostCommands.AddMarker, { metadataId, start, end, type, final }),

    /**
     * Edit an existing marker with the given id.
     * @param {string} type marker type
     * @param {number} id
     * @param {number} start
     * @param {number} end
     * @param {number} [final=0]
     * @returns {Promise<SerializedMarkerData>} */
    edit : (type, id, start, end, final = 0) => jsonRequest(PostCommands.EditMarker, { id, start, end, type, final }),

    /**
     * Delete the marker with the given id.
     * @param {number} id
     * @returns {Promise<SerializedMarkerData>} */
    delete : (id) => jsonRequest(PostCommands.DeleteMarker, { id }),

    /**
     * Retrieve all markers under the given metadata id that may be affected by a shift operation.
     * @param {number} id
     * @param {number} applyTo
     * @returns {Promise<ShiftResult>} */
    checkShift : (id, applyTo) => jsonRequest(PostCommands.CheckShift, { id, applyTo }),

    /**
     * Shift all markers under the given metadata by the given shift, unless they're in the ignored list
     * @param {number} id The metadata id of the item to shift markers for.
     * @param {number} startShift The number of milliseconds to shift marker starts (positive or negative).
     * @param {number} endShift The number of milliseconds to shift marker ends (positive or negative).
     * @param {number} applyTo The marker type(s) to apply the shift to.
     * @param {boolean} force False to abort if there are episodes with multiple markers, true to shift all markers regardless.
     * @param {number[]?} [ignored=[]] Array of marker ids to ignore when shifting.
     * @returns {Promise<ShiftResult>} */
    shift : (id, startShift, endShift, applyTo, force, ignored = []) => jsonRequest(PostCommands.ShiftMarkers, { id : id, startShift : startShift, endShift : endShift, applyTo : applyTo, force : force ? 1 : 0, ignored : ignored.join(',') }),

    /**
     * Query for all markers that would be deleted for the given metadata id.
     * @param {number} id
     * @returns {Promise<BulkDeleteResult>} */
    checkBulkDelete : (id) => jsonRequest(PostCommands.BulkDelete, { id : id, dryRun : 1, applyTo : MarkerEnum.All, ignored : [] }),

    /**
     * Delete all markers associated with the given media item, except those specified in `ignored`.
     * @param {number} id
     * @param {number} applyTo The marker type(s) to apply the delete to.
     * @param {number[]} [ignored =[]] List of marker ids to not delete.
     * @returns {Promise<BulkDeleteResult>} */
    bulkDelete : (id, applyTo, ignored = []) => jsonRequest(PostCommands.BulkDelete, { id : id, dryRun : 0, applyTo : applyTo, ignored : ignored.join(',') }),

    /**
     * Retrieve episode and marker information relevant to a bulk_add operation.
     * @param {number} id Show/Season metadata id.
     * @returns {Promise<SerializedBulkAddResult>} */
    checkBulkAdd : (id) => jsonRequest(PostCommands.BulkAdd, { id : id, start : 0, end : 0, resolveType : BulkMarkerResolveType.DryRun, ignored : '', type : 'intro' }),

    /**
     * Bulk adds a marker to the given metadata id.
     * @param {string} markerType The type of marker (intro/credits)
     * @param {number} id Show/Season metadata id.
     * @param {number} start Start time of the marker, in milliseconds.
     * @param {number} end End time of the marker, in milliseconds.
     * @param {number} resolveType The BulkMarkerResolveType.
     * @param {number[]?} ignored The list of episode ids to ignore adding markers to.
     * @returns {Promise<SerializedBulkAddResult>} */
    bulkAdd : (markerType, id, start, end, resolveType, ignored = []) => jsonRequest(PostCommands.BulkAdd, { id : id, start : start, end : end, type : markerType, resolveType : resolveType, ignored : ignored.join(',') }),

    /**
     * Bulk adds multiple markers with custom timestamps.
     * @param {number} markerType The type of marker (intro/credits)
     * @param {number} id The Show/Season metadata id.
     * @param {number} resolveType The BulkMarkerResolveType.
     * @param {CustomBulkAddMap} newMarkerData The new markers to add.
     * @returns {Promise<SerializedBulkAddResult>} */
    bulkAddCustom : (markerType, id, resolveType, newMarkerData) => jsonBodyRequest(PostCommands.BulkAddCustom, { type : markerType, id : id, resolveType : resolveType, markers : JSON.stringify(newMarkerData) }),

    /**
     * Retrieve markers for all episodes ids in `keys`.
     * @param {number[]} keys The list of episode ids to grab the markers of.
     * @returns {Promise<{[metadataId: number]: SerializedMarkerData[]}>} */
    query : (keys) => jsonRequest(PostCommands.Query, { keys : keys.join(',') }),

    /**
     * Retrieve all Movie/TV library sections in the database.
     * @returns {Promise<{id: number, type : number, name: string}[]} */
    getSections : () => jsonRequest(PostCommands.GetLibraries),

    /**
     * Retrieve all shows in the given section.
     * @param {number} id
     * @returns {Promise<SerializedShowData[]|SerializedMovieData[]>} */
    getSection : (id) => jsonRequest(PostCommands.GetLibrary, { id }),

    /**
     * Retrieve all seasons in the given show.
     * @param {number} id
     * @returns {Promise<SerializedSeasonData[]>} */
    getSeasons : (id) => jsonRequest(PostCommands.GetSeasons, { id }),

    /**
     * Retrieve all episodes in the given season.
     * @param {number} id
     * @returns {Promise<SerializedEpisodeData[]>} */
    getEpisodes : (id) => jsonRequest(PostCommands.GetEpisodes, { id }),

    /**
     * Retrieve all episodes for the show associated with the given show,season, or episode id.
     * @param {number} id
     * @returns {Promise<SerializedEpisodeAndMarkerData[]>} */
    getAllEpisodes : (id) => jsonRequest(PostCommands.GetShowEpisodes, { id }),

    /**
     * Return whether the given metadata item has thumbnails associated with it.
     * Only valid for episode/movie metadata ids.
     * @param {number} id
     * @returns {Promise<{hasThumbnails: boolean}>} */
    checkForThumbnails : (id) => jsonRequest(PostCommands.CheckThumbs, { id }),

    /**
     * Retrieve marker breakdown stats for the given section.
     * @param {number} id
     * @returns {Promise<{[episodesWithNMarkers: number]: number}>} */
    getMarkerStats : (id) => jsonRequest(PostCommands.GetStats, { id }),

    /**
     * Retrieve the marker breakdown stats for a single show or movie.
     * @param {number} id
     * @param {boolean} includeSeasons True to include season data, false to leave it out (or if it's for a movie).
     * @returns {Promise<{mainData: MarkerBreakdownMap, seasonData?: { [seasonId: number]: MarkerBreakdownMap }}>} */
    getBreakdown : (id, includeSeasons) => jsonRequest(PostCommands.GetBreakdown, { id : id, includeSeasons : includeSeasons ? 1 : 0 }),


    /**
     * Retrieve the configuration settings relevant to the client application.
     * @returns {Promise<SerializedConfig>} */
    getConfig : () => jsonRequest(PostCommands.GetConfig),

    /**
     * Validates all the values in the config file.
     * @param {SerializedConfig} config
     * @returns {Promise<SerializedConfig>} */
    validateConfig : (config) => jsonBodyRequest(PostCommands.ValidateConfig, { config : JSON.stringify(config) }),

    /**
     * Validate the single setting value.
     * @param {string} setting
     * @param {TypedSetting<T>} value
     * @returns {Promise<TypedSetting<T>>} */
    validateConfigValue : (setting, value) => jsonBodyRequest(PostCommands.ValidateConfigValue, { setting, value }),

    /**
     * @param {SerializedConfig} config
     * @returns {Promise<{ success: boolean, message?: string, config?: SerializedConfig }>} */
    setServerConfig : (config) => jsonBodyRequest(PostCommands.SetConfig, { config : JSON.stringify(config) }),


    /**
     * Check for markers that should exist for the given metadata id, but aren't in the Plex database.
     * @param {number} id The show/season/episode id.
     * @returns {Promise<SerializedMarkerData[]>} */
    purgeCheck : (id) => jsonRequest(PostCommands.PurgeCheck, { id }),

    /**
     * Find all purges in the given library section.
     * @param {number} sectionId
     * @returns {Promise<PurgeSection>} */
    allPurges : (sectionId) => jsonRequest(PostCommands.AllPurges, { sectionId }),

    /**
     * Restore the given purged markers associated with the given section.
     * @param {{ restoreIds : number[], redeleteIds : { oldId : number, newId : number }[]}} restoreInfo Information on markers to restore.
     * @param {number} sectionId
     * @param {number} resolveType
     * @returns {Promise<BulkRestoreResponse>} */
    restorePurge : (restoreInfo, sectionId, resolveType) => jsonBodyRequest(PostCommands.RestorePurges, { restoreInfo : JSON.stringify(restoreInfo), sectionId : sectionId, resolveType : resolveType }),

    /**
     * Ignore the given purged markers associated with the given section.
     * @param {number[]} purgedIds
     * @param {number[]} readdedIds
     * @param {number} sectionId
     * @returns {Promise<void>} */
    ignorePurge : (purgedIds, readdedIds, sectionId) => jsonRequest(PostCommands.IgnorePurges, { purgedIds, readdedIds, sectionId }),

    /**
     * Irreversibly delete all markers of the given type from the given section.
     * @param {number} sectionId
     * @param {number} deleteType
     * @returns {Promise<{ deleted : number, backupDeleted : number, cacheDeleted : number }>} */
    sectionDelete : (sectionId, deleteType) => jsonRequest(PostCommands.Nuke, { sectionId, deleteType }),

    /**
     * Shutdown Marker Editor.
     * @returns {Promise<void>} */
    shutdown : () => jsonRequest(PostCommands.ServerShutdown),
    /**
     * Restart Marker Editor.
     * @returns {Promise<void>} */
    restart : () => jsonRequest(PostCommands.ServerRestart),
    /**
     * Reload all markers from the database. Like restart, but doesn't also restart the HTTP server.
     * @returns {Promise<void>} */
    reload : () => jsonRequest(PostCommands.ServerReload),
    /**
     * Suspend Marker Editor.
     * @returns {Promise<void>} */
    suspend : () => jsonRequest(PostCommands.ServerSuspend),
    /**
     * Resume a suspended Marker Editor.
     * @returns {Promise<void>} */
    resume : () => jsonRequest(PostCommands.ServerResume),

    /**
     * Upload a database file and import the markers present into the given section.
     * @param {Object} database
     * @param {number} sectionId
     * @param {number} resolveType */
    importDatabase : (database, sectionId, resolveType) => jsonBodyRequest(PostCommands.ImportDb, { database, sectionId, resolveType }),

    /**
     * Retrieve chapter data (if any) for the given media item (supports shows, seasons, episodes, and movies).
     * @param {number} metadataId
     * @returns {Promise<ChapterMap>} */
    getChapters : (metadataId) => jsonRequest(PostCommands.GetChapters, { id : metadataId }),

    /**
     * Retrieve all information relevant for marker table creation for a given movie/episode id.
     * @param {number} metadataId
     * @returns {Promise<ExtendedQueryInfo>} */
    extendedQuery : (metadataId) => jsonRequest(PostCommands.FullQuery, { id : metadataId }),

    /**
     * Attempt to log in with the given username and password.
     * @param {string} username
     * @param {string} password
     * @returns {Promise<{ success: boolean }>} */
    login : (username, password) => jsonBodyRequest(PostCommands.Login, { username, password }),

    /**
     * Log out of the current session.
     * @returns {Promise<{ success: boolean }>} */
    logout : () => jsonRequest(PostCommands.Logout),

    /**
     * Change the password for the given user.
     * Since currently one one user is supported, `username` MUST be the same as that user.
     * @param {string} username The user to change the password for
     * @param {string} oldPass The user's old password
     * @param {string} newPass The user's new password */
    changePassword : (username, oldPass, newPass) => jsonBodyRequest(PostCommands.ChangePassword, { username, oldPass, newPass }),

    /**
     * Check whether user authentication is enabled, but a password is not set.
     * @returns {Promise<{ value : boolean }>} */
    needsPassword : () => jsonRequest(PostCommands.NeedsPassword),
};
/* eslint-enable */
