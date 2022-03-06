/**
 * Contains classes that represent show, season, episode, and marker data.
 */

/**
 * @typedef {!import('../Server/MarkerCacheManager').MarkerBreakdownMap} MarkerBreakdownMap
 * @typedef {{[metadataId: number]: ShowData}} ShowMap A map of show metadata ids to the show itself.
 * @typedef {{[metadataId: number]: SeasonData}} SeasonMap A map of season metadata ids to the season itself.
 * @typedef {{[metadataId: number]: EpisodeData}} EpisodeMap A map of episode metadata ids to the episode itself.
 * @typedef {{metadataId : number, markerBreakdown? : MarkerBreakdownMap}} PlexDataBaseData
 */

/**
 * Retrieve an object to initialize the base PlexData of a derived class.
 * @param {object} item
 * @returns {PlexDataBaseData} */
function getBaseData(item) {
    if (!item) {
        return null;
    }

    return { metadataId : item.id, markerBreakdown : item.markerBreakdown };    
}

/**
 * Base class for a representation of a Plex item, containing
 * the handful of shared functions/fields.
 */
class PlexData {
    /**
     * The Plex metadata id for this item.
     * @type {number} */
    metadataId;

    /**
     * The breakdown of how many episodes have X markers.
     * @type {MarkerBreakdownMap} */
    markerBreakdown;

    /**
     * @param {PlexDataBaseData} [data]
     */
    constructor(data)
    {
        if (data) {
            this.metadataId = data.metadataId;
            this.markerBreakdown = data.markerBreakdown;
        }
    }

    /**
     * Restores a serialized version of this class by importing its properties into this instance.
     * @param {Object} json The serialized instance of a PlexData derivative.
     * @returns itself. */
     setFromJson(json) {
        Object.assign(this, json);
        return this;
    }
}

/**
 * Information about a TV show in the Plex database.
 */
 class ShowData extends PlexData {
    // Note: It'd be nice for these fields (and those in the classes below) to be private
    // and accessed via getters only, but as these are stringified when sent from server
    // to client, JSON.stringify needs access to them.

    /**
     * The name of the show.
     * @type {string} */
    title;

    /**
     * The name of the show used for search purposes.
     * This is the lowercase name of the show with whitespace and punctuation removed.
     * @type {string} */
    searchTitle;

    /**
     * The sort title of the show if different from the title, otherwise an empty string.
     * The same transformations done to {@linkcode searchTitle} are done to `sortTitle`.
     * @type {string} */
    sortTitle;

    /**
     * The original title of the show, if any.
     * The same transformations done to {@linkcode searchTitle} are done to `originalTitle`.
     * @type {string} */
    originalTitle;

    /**
     * The number of seasons that exist in Plex for this show.
     * @type {number} */
    seasonCount;

    /**
     * The number of episodes that exist in Plex for this show.
     * @type {number} */
    episodeCount;

    /**
     * A map of season metadata ids to the season data
     * Only present client-side if this show is currently selected.
     * @type {SeasonMap} */
    #seasons = {};

    /**
     * Constructs ShowData based on the given database row, or an empty show if not provided.
     * @param {Object<string, any>} [show] */
    constructor(show) {
        super(getBaseData(show));
        if (!show) {
            return;
        }

        this.title = show.title;
        this.searchTitle = ShowData.#transformTitle(show.title);
        this.sortTitle = show.title.toLowerCase() != show.title_sort.toLowerCase() ? ShowData.#transformTitle(show.title_sort) : '';
        this.originalTitle = show.original_title ? ShowData.#transformTitle(show.original_title) : '';
        this.seasonCount = show.season_count;
        this.episodeCount = show.episode_count;
    }

    /**
     * Add the given season to our SeasonMap.
     * @param {SeasonData} season
     */
    addSeason(season) {
        this.#seasons[season.metadataId] = season;
    }

    /**
     * Retrieve a season of this show with the given metadataId, or
     * `undefined` if it doesn't exist or it isn't cached.
     * @param {number} metadataId
     */
    getSeason(metadataId) {
        return this.#seasons[metadataId];
    }

    /** Clears out this show's cache of seasons. */
    clearSeasons() {
        this.#seasons = {};
    }

    static #transformTitle(title) {
        return title.toLowerCase().replace(/[\s,'"_\-!?]/g, '');
    }
}

/**
 * Information about a season of a TV show in the Plex database.
 */
class SeasonData extends PlexData {
    /**
     * The season index. 0 == specials, 1 == season 1, etc.
     * @type {number} */
    index;

    /**
     * The title of the season, if any.
     * @type {string} */
    title;

    /**
     * The number of episodes in the season.
     * @type {number} */
    episodeCount;

    /**
     * A map of episode metadata ids to the episode in this season.
     * Only present client-side if this season is currently selected.
     * @type {EpisodeMap} */
    #episodes = {};

    /**
     * Constructs SeasonData based on the given database row, or an empty season if not provided.
     * @param {Object<string, any>} [season] */
    constructor(season) {
        super(getBaseData(season));
        if (!season) {
            return;
        }

        this.index = season.index;
        this.title = season.title;
        this.episodeCount = season.episode_count;
    }

    /**
     * Add the given episode to this season's EpisodeMap.
     * @param {EpisodeData} episode
     */
    addEpisode(episode) {
        this.#episodes[episode.metadataId] = episode;
    }

    /**
     * Retrieve the episode of this season with the given metadata id,
     * or `undefined` if the episode doesn't exist or it isn't cached.
     * @param {number} metadataId
     */
    getEpisode(metadataId) {
        return this.#episodes[metadataId];
    }

    /** Clear out this season's episode cache. */
    clearEpisodes() {
        this.#episodes = {};
    }
}

/**
 * Information about an episode of a TV show in the Plex database.
 */
class EpisodeData extends PlexData {
    /**
     * The name of the episode.
     * @type {string} */
    title;

    /**
     * The episode number of its season.
     * @type {number} */
    index;

    /**
     * The name of the season this episode belongs to.
     * @type {string} */
    seasonName;

    /**
     * The season number that this episode belongs to.
     * @type {number} */
    seasonIndex;

    /**
     * The name of the show this episode is a part of.
     * @type {string} */
    showName;

    /**
     * The length of the show, in milliseconds.
     * @type {number} */
    duration;

    /**
     * All markers for this episode, sorted from least to greatest index.
     * @type {MarkerData[]} */
    markers = [];

    /**
     * Indicates whether we found a preview thumbnail file for this episode.
     * @type {boolean} */
    hasThumbnails = false;

    /**
     * Creates a new EpisodeData from the given episode, if provided.
     * @param {Object<string, any>} [episode] */
    constructor(episode) {
        super(getBaseData(episode));
        if (!episode) {
            return;
        }

        this.title = episode.title;
        this.index = episode.index;
        this.seasonName = episode.season,
        this.seasonIndex = episode.season_index;
        this.showName = episode.show;
        this.duration = episode.duration;
    }

    /**
     * @returns The number of markers this episode has.
     */
    markerCount() {
        return this.markers.length;
    }

    /**
     * Add a new marker to this episode.
     * @param {MarkerData} newMarker The marker to add.
     * @param {HTMLElement} addRow The temporary row used to create the marker.
     * @param {HTMLElement} newRow The permanent row to add for the new marker.
     */
    addMarker(newMarker, addRow, newRow) {
        let tableBody = addRow.parentNode;
        tableBody.removeChild(addRow);

        if (this.markers.length == 0) {
            // This is the first marker for the episode, which means we also have
            // to remove the placeholder 'No markers found' row.
            tableBody.removeChild(tableBody.firstChild);
        }

        // After removing the temp row, but before adding the new row to the table, adjust
        // indexes so we have a 1:1 mapping between our marker array and what's in our table.
        for (let i = newMarker.index; i < this.markers.length; ++i) {
            let markerCurrent = this.markers[i];
            ++markerCurrent.index;
            if (tableBody) {
                tableBody.children[i].firstChild.innerText = markerCurrent.index.toString();
            }
        }

        tableBody.insertBefore(newRow, tableBody.children[newMarker.index]);

        this.markers.splice(newMarker.index, 0 /*deleteCount*/, newMarker);
    }

    /**
     * Edits the given marker for this episode.
     * @param {MarkerData} partialMarker The marker that has been edited.
     * Not a "real" marker, but a partial representation of one that has
     * all the fields required to successfully edit the real marker it represents.
     * @param {HTMLElement} editedRow The HTML row for the edited marker.
     */
    editMarker(partialMarker, editedRow) {
        const newIndex = partialMarker.index;
        let oldIndex = -1;
        // First loop - find the one we edited, modify its fields, and store its old index.
        for (let marker of this.markers) {
            if (marker.id == partialMarker.id) {
                oldIndex = marker.index;
                marker.index = newIndex;
                marker.start = partialMarker.start;
                marker.end = partialMarker.end;

                // This won't match the YYYY-MM-DD hh:mm:ssZ returned by the database, but
                // we just need a valid UTC string for client-side parsing.
                marker.modifiedDate = new Date().toUTCString();
                break;
            }
        }

        if (newIndex == oldIndex) {
            return; // Same position, no rearranging needed.
        }

        // Swap positions in the marker table.
        let tableBody = editedRow.parentElement;
        tableBody.removeChild(editedRow);
        tableBody.insertBefore(editedRow, tableBody.children[newIndex]);

        const lo = newIndex > oldIndex ? oldIndex : newIndex;
        const hi = newIndex > oldIndex ? newIndex : oldIndex;
        const between = (x) => x >= lo && x <= hi;

        // Second loop - Go through all markers and update their index as necessary.
        this.markers.forEach((marker, index) => {
            // Update table index
            const row = tableBody.children[index];
            row.children[0].innerText = index.toString();

            // Update marker index.
            if (marker.id == partialMarker.id) {
                return; // We already handled this.
            }

            if (between(marker.index)) {
                if (newIndex > marker.index) {
                    --marker.index;
                } else {
                    ++marker.index;
                }
            }
        });

        this.markers.sort((a, b) => a.index - b.index);
    }

    /**
     * Deletes a marker for this episode and updates the HTML marker table accordingly.
     * @param {MarkerData} deletedMarker The marker to delete. This is _not_ the same
     * marker that's in {@linkcode this.markers}, but a standalone copy.
     * @param {HTMLElement} deletedRow The HTML row for the deleted marker.
     * @param {HTMLElement} [dummyRow] A "fake" row to insert into the marker table
     * if we're deleting the last marker for the episode.
     */
    deleteMarker(deletedMarker, deletedRow, dummyRow) {
        let tableBody = deletedRow.parentNode;

        if (this.markers.length == 1) {
            tableBody.insertBefore(dummyRow, tableBody.firstChild);
        } else {
            // Update indexes if needed.
            for (let index = deletedMarker.index + 1; index < this.markers.length; ++index) {
                tableBody.children[index].firstChild.innerText = (index - 1).toString();
            }
        }

        tableBody.removeChild(deletedRow);

        this.markers.splice(deletedMarker.index, 1);
        this.markers.forEach((marker, index) => {
            marker.index = index;
        });
    }
}

/**
 * Information about a single marker for an episode of a TV show in the Plex database.
 */
class MarkerData extends PlexData {
    /**
     * The start of the marker, in milliseconds.
     * @type {number} */
    start;

    /**
     * The end of the marker, in milliseconds.
     * @type {number} */
    end;

    /**
     * The 0-based index of the marker.
     * @type {number} */
    index;

    /**
     * The date the marker was modified by the user.
     * @type {string} */
    modifiedDate;

    /**
     * Whether the user created this marker, or it's an edit of a marker Plex created.
     * @type {boolean} */
    createdByUser;

    /**
     * The date the marker was created.
     * @type {string} */
    createDate;

    /**
     * The Plex metadata id of the episode this marker is attached to.
     * @type {number} */
    metadataItemId;

    /**
     * The Plex taggings id for this marker.
     * @type {number} */
    id;

    /**
     * Creates a new MarkerData from the given marker, if provided.
     * @param {Object<string, any>} [marker] */
    constructor(marker) {
        super(null);
        if (!marker) {
            return;
        }

        this.start = marker.time_offset;
        this.end = marker.end_time_offset;
        this.index = marker.index;

        if (marker.thumb_url) {
            // Check to see if it has a 'user created' flag.
            // For legacy purposes, also check whether the create date equals the modified date,
            // as previous versions of this application didn't include the 'manually created' marker.
            this.createdByUser = marker.thumb_url[marker.thumb_url.length - 1] == '*' || marker.thumb_url == marker.created_at;

            // Modified date is stored as a UTC timestamp, but JS date functions don't know without the 'Z'.
            this.modifiedDate = marker.thumb_url.substring(0, marker.thumb_url.length - 1) + 'Z';
        } else {
            this.createdByUser = false;
            this.modifiedDate = '';
        }

        // Plex stores timestamps in local time for some reason, so only "convert" to UTC time
        // if the marker was created by the user.
        this.createDate = marker.created_at + (this.createdByUser ? 'Z' : '');

        this.metadataItemId = marker.metadata_item_id;
        this.id = marker.id;
    }
}

export { ShowData, SeasonData, EpisodeData, MarkerData }
