import { BulkMarkerResolveType } from '../../Shared/PlexTypes.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { MarkerEnum } from '../../Shared/MarkerType.js';

import { animate } from './AnimationHelpers.js';
import Overlay from './Overlay.js';
import ServerPausedOverlay from './ServerPausedOverlay.js';

/** @typedef {!import('../../Shared/PlexTypes').BulkDeleteResult} BulkDeleteResult */
/** @typedef {!import('../../Shared/PlexTypes').BulkRestoreResponse} BulkRestoreResponse */
/** @typedef {!import('../../Shared/PlexTypes').ChapterMap} ChapterMap */
/** @typedef {!import('../../Shared/PlexTypes').CustomBulkAddMap} CustomBulkAddMap */
/** @typedef {!import('../../Shared/PlexTypes').PurgeSection} PurgeSection */
/** @typedef {!import('../../Shared/PlexTypes').SerializedBulkAddResult} SerializedBulkAddResult */
/** @typedef {!import('../../Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMovieData} SerializedMovieData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedSeasonData} SerializedSeasonData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedShowData} SerializedShowData */
/** @typedef {!import('../../Shared/PlexTypes').ShiftResult} ShiftResult */
/** @typedef {!import('../../Shared/MarkerBreakdown').MarkerBreakdownMap} MarkerBreakdownMap */

const Log = new ContextualLog('ClientCommon');

/**
 * Removes all children from the given element.
 * @param {HTMLElement} ele The element to clear.
 */
function clearEle(ele) {
    while (ele.firstChild) {
        ele.removeChild(ele.firstChild);
    }
}

/**
 * Custom error class used to distinguish between errors
 * surfaced by an API call and all others. */
class FetchError extends Error {
    /**
     * @param {string} message
     * @param {string} stack */
    constructor(message, stack) {
        super(message);
        if (stack) {
            this.stack = stack;
        }
    }
}

/* eslint-disable max-len */
/**
 * Map of all available server endpoints.
 * Keep in sync with ServerCommands.#commandMap
 */
const ServerCommand = {
    /**
     * Add a marker to the Plex database
     * @param {string} type
     * @param {number} metadataId
     * @param {number} start
     * @param {number} end
     * @param {number} [final=0]
     * @returns {Promise<SerializedMarkerData>} */
    add : async (type, metadataId, start, end, final=0) => jsonRequest('add', { metadataId, start, end, type, final }),

    /**
     * Edit an existing marker with the given id.
     * @param {string} type marker type
     * @param {number} id
     * @param {number} start
     * @param {number} end
     * @param {number} [final=0]
     * @returns {Promise<SerializedMarkerData>} */
    edit : async (type, id, start, end, final=0) => jsonRequest('edit', { id, start, end, type, final }),

    /**
     * Delete the marker with the given id.
     * @param {number} id
     * @returns {Promise<SerializedMarkerData>} */
    delete : async (id) => jsonRequest('delete', { id }),

    /**
     * Retrieve all markers under the given metadata id that may be affected by a shift operation.
     * @param {number} id
     * @param {number} applyTo
     * @returns {Promise<ShiftResult>} */
    checkShift : async (id, applyTo) => jsonRequest('check_shift', { id, applyTo }),

    /**
     * Shift all markers under the given metadata by the given shift, unless they're in the ignored list
     * @param {number} id The metadata id of the item to shift markers for.
     * @param {number} startShift The number of milliseconds to shift marker starts (positive or negative).
     * @param {number} endShift The number of milliseconds to shift marker ends (positive or negative).
     * @param {number} applyTo The marker type(s) to apply the shift to.
     * @param {boolean} force False to abort if there are episodes with multiple markers, true to shift all markers regardless.
     * @param {number[]?} [ignored=[]] Array of marker ids to ignore when shifting.
     * @returns {Promise<ShiftResult>} */
    shift : async (id, startShift, endShift, applyTo, force, ignored=[]) => jsonRequest('shift', { id : id, startShift : startShift, endShift : endShift, applyTo : applyTo, force : force ? 1 : 0, ignored : ignored.join(',') }),

    /**
     * Query for all markers that would be deleted for the given metadata id.
     * @param {number} id
     * @returns {Promise<BulkDeleteResult>} */
    checkBulkDelete : async (id) => jsonRequest('bulk_delete', { id : id, dryRun : 1, applyTo : MarkerEnum.All, ignored : [] }),

    /**
     * Delete all markers associated with the given media item, except those specified in `ignored`.
     * @param {number} id
     * @param {number} applyTo The marker type(s) to apply the delete to.
     * @param {number[]} [ignored =[]] List of marker ids to not delete.
     * @returns {Promise<BulkDeleteResult>} */
    bulkDelete : async (id, applyTo, ignored=[]) => jsonRequest('bulk_delete', { id : id, dryRun : 0, applyTo : applyTo, ignored : ignored.join(',') }),

    /**
     * Retrieve episode and marker information relevant to a bulk_add operation.
     * @param {number} id Show/Season metadata id.
     * @returns {Promise<SerializedBulkAddResult>} */
    checkBulkAdd : async (id) => jsonRequest('bulk_add', { id : id, start : 0, end : 0, resolveType : BulkMarkerResolveType.DryRun, ignored : '', type : 'intro' }),

    /**
     * Bulk adds a marker to the given metadata id.
     * @param {string} markerType The type of marker (intro/credits)
     * @param {number} id Show/Season metadata id.
     * @param {number} start Start time of the marker, in milliseconds.
     * @param {number} end End time of the marker, in milliseconds.
     * @param {number} resolveType The BulkMarkerResolveType.
     * @param {number[]?} ignored The list of episode ids to ignore adding markers to.
     * @returns {Promise<SerializedBulkAddResult>} */
    bulkAdd : async (markerType, id, start, end, resolveType, ignored=[]) => jsonRequest('bulk_add', { id : id, start : start, end : end, type : markerType, resolveType : resolveType, ignored : ignored.join(',') }),

    /**
     * Bulk adds multiple markers with custom timestamps.
     * @param {number} markerType The type of marker (intro/credits)
     * @param {number} id The Show/Season metadata id.
     * @param {number} resolveType The BulkMarkerResolveType.
     * @param {CustomBulkAddMap} newMarkerData The new markers to add.
     * @returns {Promise<SerializedBulkAddResult>} */
    bulkAddCustom : async (markerType, id, resolveType, newMarkerData) => jsonBodyRequest('add_custom', { type : markerType, id : id, resolveType : resolveType, markers : JSON.stringify(newMarkerData) }),

    /**
     * Retrieve markers for all episodes ids in `keys`.
     * @param {number[]} keys The list of episode ids to grab the markers of.
     * @returns {Promise<{[metadataId: number]: SerializedMarkerData[]}>} */
    query : async (keys) => jsonRequest('query', { keys : keys.join(',') }),

    /**
     * Retrieve all Movie/TV library sections in the database.
     * @returns {Promise<{id: number, type : number, name: string}[]} */
    getSections : async () => jsonRequest('get_sections'),

    /**
     * Retrieve all shows in the given section.
     * @param {number} id
     * @returns {Promise<SerializedShowData[]|SerializedMovieData[]>} */
    getSection : async (id) => jsonRequest('get_section', { id }),

    /**
     * Retrieve all seasons in the given show.
     * @param {number} id
     * @returns {Promise<SerializedSeasonData[]>} */
    getSeasons : async (id) => jsonRequest('get_seasons', { id }),

    /**
     * Retrieve all episodes in the given season.
     * @param {number} id
     * @returns {Promise<SerializedEpisodeData>} */
    getEpisodes : async (id) => jsonRequest('get_episodes', { id }),

    /**
     * Return whether the given metadata item has thumbnails associated with it.
     * Only valid for episode/movie metadata ids.
     * @param {number} id
     * @returns {Promise<{hasThumbnails: boolean}>} */
    checkForThumbnails : async (id) => jsonRequest('check_thumbs', { id }),

    /**
     * Retrieve marker breakdown stats for the given section.
     * @param {number} id
     * @returns {Promise<{[episodesWithNMarkers: number]: number}>} */
    getMarkerStats : async (id) => jsonRequest('get_stats', { id }),

    /**
     * Retrieve the marker breakdown stats for a single show or movie.
     * @param {number} id
     * @param {boolean} includeSeasons True to include season data, false to leave it out (or if it's for a movie).
     * @returns {Promise<{mainData: MarkerBreakdownMap, seasonData?: { [seasonId: number]: MarkerBreakdownMap }}>} */
    getBreakdown : async (id, includeSeasons) => jsonRequest('get_breakdown', { id : id, includeSeasons : includeSeasons ? 1 : 0 }),


    /**
     * Retrieve the configuration settings relevant to the client application.
     * @returns {Promise<{userThumbnails: boolean, extendedMarkerStats: boolean, version: string }>} */
    getConfig : async () => jsonRequest('get_config'),

    /**
     * Set server-side log settings.
     * @param {number} level The log level.
     * @param {number} dark 1 to color messages for a dark console (if supported), 0 for light mode.
     * @param {number} trace 1 to log stack traces, 0 otherwise */
    logSettings : async (level, dark, trace) => jsonRequest('log_settings', { level, dark, trace }),


    /**
     * Check for markers that should exist for the given metadata id, but aren't in the Plex database.
     * @param {number} id The show/season/episode id.
     * @returns {Promise<SerializedMarkerData[]>} */
    purgeCheck : async (id) => jsonRequest('purge_check', { id }),

    /**
     * Find all purges in the given library section.
     * @param {number} sectionId
     * @returns {Promise<PurgeSection>} */
    allPurges : async (sectionId) => jsonRequest('all_purges', { sectionId }),

    /**
     * Restore the given purged markers associated with the given section.
     * @param {number[]} markerIds Array of purged marker ids to restore.
     * @param {number} sectionId
     * @param {number} resolveType
     * @returns {Promise<BulkRestoreResponse>} */
    restorePurge : async (markerIds, sectionId, resolveType) => jsonRequest('restore_purge', { markerIds : markerIds.join(','), sectionId : sectionId, resolveType : resolveType }),

    /**
     * Ignore the given purged markers associated with the given section.
     * @param {number[]} markerIds
     * @param {number} sectionId
     * @returns {Promise<void>} */
    ignorePurge : async (markerIds, sectionId) => jsonRequest('ignore_purge', { markerIds, sectionId }),

    /**
     * Irreversibly delete all markers of the given type from the given section.
     * @param {number} sectionId
     * @param {number} deleteType
     * @returns {Promise<{ deleted : number, backupDeleted : number, cacheDeleted : number }>} */
    sectionDelete : async (sectionId, deleteType) => jsonRequest('nuke_section', { sectionId, deleteType }),

    /**
     * Shutdown Marker Editor.
     * @returns {Promise<void>} */
    shutdown : async () => jsonRequest('shutdown'),
    /**
     * Restart Marker Editor.
     * @returns {Promise<void>} */
    restart : async () => jsonRequest('restart'),
    /**
     * Reload all markers from the database. Like restart, but doesn't also restart the HTTP server.
     * @returns {Promise<void>} */
    reload : async () => jsonRequest('reload'),
    /**
     * Suspend Marker Editor.
     * @returns {Promise<void>} */
    suspend : async () => jsonRequest('suspend'),
    /**
     * Resume a suspended Marker Editor.
     * @returns {Promise<void>} */
    resume : async () => jsonRequest('resume'),

    /**
     * Upload a database file and import the markers present into the given section.
     * @param {Object} database
     * @param {number} sectionId
     * @param {number} resolveType */
    importDatabase : async (database, sectionId, resolveType) => jsonBodyRequest('import_db', { database, sectionId, resolveType }),

    /**
     * Retrieve chapter data (if any) for the given media item (supports shows, seasons, episodes, and movies).
     * @param {number} metadataId
     * @returns {Promise<ChapterMap>} */
    getChapters : async (metadataId) => jsonRequest('get_chapters', { id : metadataId }),
};
/* eslint-enable */

/**
 * Generic method to make a request to the given endpoint that expects a JSON response.
 * @param {string} endpoint The URL to query.
 * @param {{[parameter: string]: any}} parameters URL parameters. */
async function jsonRequest(endpoint, parameters={}) {
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
async function jsonBodyRequest(endpoint, parameters={}) {
    const url = new URL(endpoint, window.location.href);
    const data = new FormData();
    for (const [key, value] of Object.entries(parameters)) {
        data.append(key, value);
    }

    return jsonPostCore(url, data);
}

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
        const response = await (await fetch(url, init)).json();
        Log.verbose(response, `Response from ${url}`);
        if (!response || response.Error) {

            // Global check to see if we failed because the server is suspended.
            // If so, show the undismissible 'Server Paused' overlay.
            if (response.Error && response.Error === 'Server is suspended') {
                Log.info('Action was not completed because the server is suspended.');
                ServerPausedOverlay.Show();
                // Return unfulfillable Promise. Gross, but since the user can't do anything anyway, we don't really care.
                return new Promise((_resolve, _reject) => {});
            }

            throw new FetchError(response ? response.Error : `Request to ${url} failed`);
        }

        return response;
    } catch (err) {
        throw new FetchError(err.message, err.stack);
    }
}

/**
 * Custom jQuery-like selector method.
 * If the selector starts with '#' and contains no spaces, return the result of `querySelector`,
 * otherwise return the result of `querySelectorAll`.
 * @param {DOMString} selector The selector to match.
 * @param {HTMLElement} ele The scope of the query. Defaults to `document`.
 */
function $(selector, ele=document) {
    if (selector.indexOf('#') === 0 && selector.indexOf(' ') === -1) {
        return $$(selector, ele);
    }

    return ele?.querySelectorAll(selector);
}

/**
 * Like $, but forces a single element to be returned. i.e. querySelector.
 * @param {string} selector The query selector.
 * @param {HTMLElement} [ele=document] The scope of the query. Defaults to `document`.
 */
function $$(selector, ele=document) {
    return ele?.querySelector(selector);
}

/**
 * Helper method to create DOM elements.
 * @param {string} type The TAG to create.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options={}] Additional options
 */
function buildNode(type, attrs, content, events, options={}) {
    const ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events, options);
}

/**
 * Helper method to create DOM elements with the given namespace (e.g. SVGs).
 * @param {string} ns The namespace to create the element under.
 * @param {string} type The type of element to create.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 */
function buildNodeNS(ns, type, attrs, content, events, options={}) {
    const ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events, options);
}

/**
 * "Private" core method for buildNode and buildNodeNS, that handles both namespaced and non-namespaced elements.
 * @param {HTMLElement} ele The HTMLElement to attach the given properties to.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options]
 */
function _buildNode(ele, attrs, content, events, options) {
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            ele.setAttribute(key, value);
        }
    }

    if (events) {
        for (const [event, func] of Object.entries(events)) {
            /** @type {EventListener[]} */
            let handlers = func;
            if (!(func instanceof Array)) {
                handlers = [func];
            }

            for (const handler of handlers) {
                if (options.thisArg) {
                    ele.addEventListener(event, handler.bind(options.thisArg, ele));
                } else {
                    ele.addEventListener(event, handler);
                }
            }
        }
    }

    if (content) {
        if (content instanceof Element) {
            ele.appendChild(content);
        } else {
            ele.innerHTML = content;
        }
    }

    return ele;
}

/**
 * Helper to append multiple children to a single element at once.
 * @param {HTMLElement} parent Parent element to append children to.
 * @param {...HTMLElement} elements Elements to append this this `HTMLElement`
 * @returns {HTMLElement} `parent`
 */
function appendChildren(parent, ...elements) {
    for (const element of elements) {
        if (element) {
            parent.appendChild(element);
        }
    }

    return parent;
}


/**
 * Return an error string from the given error.
 * In almost all cases, `error` will be either a JSON object with a single `Error` field,
 * or an exception of type {@link Error}. Handle both of those cases, otherwise return a
 * generic error message.
 *
 * NOTE: It's expected that all API requests call this on failure, as it's the main console
 *       logging method.
 * @param {string|Error} error
 * @returns {string}
 */
function errorMessage(error) {
    if (error.Error) {
        Log.error(error);
        return error.Error;
    }

    if (error instanceof Error) {
        Log.error(error.message);
        Log.error(error.stack ? error.stack : '(Unknown stack)');

        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            // Special handling of what's likely a server-side exit.
            return error.toString() + '<br><br>The server may have exited unexpectedly, please check the console.';
        }

        return error.toString();
    }

    if (typeof error === 'string') {
        return error;
    }

    return 'I don\'t know what went wrong, sorry :(';
}

/**
 * Displays an error message in the top-left of the screen for a couple seconds.
 * @param {string} message */
function errorToast(message) {
    const msg = buildNode('div', { class : 'errorToast' }, message);
    document.body.appendChild(msg);
    return animate(msg,
        [
            { opacity : 0 },
            { opacity : 1, offset : 0.2 },
            { opacity : 1, offset : 0.8 },
            { opacity : 0, offset : 1 },
        ],
        { duration : 2500 },
        () => {
            document.body.removeChild(msg);
        }
    );
}

/**
 * Return 'n text' if n is 1, otherwise 'n texts'.
 * @param {number} n The number of items.
 * @param {string} text The type of item.
 */
function plural(n, text) {
    return `${n} ${text}${n === 1 ? '' : 's'}`;
}

/**
 * Pads 0s to the front of `val` until it reaches the length `pad`.
 * @param {number} val The value to pad.
 * @param {number} pad The minimum length of the string to return. */
function pad0(val, pad) {
    val = val.toString();
    return '0'.repeat(Math.max(0, pad - val.length)) + val;
}

/**
 * Convert milliseconds to a user-friendly [h:]mm:ss.000 string.
 * @param {number} ms */
function msToHms(ms) {
    let seconds = ms / 1000;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    seconds = Math.floor(seconds) % 60;
    const thousandths = ms % 1000;
    let time = pad0(minutes, 2) + ':' + pad0(seconds, 2) + '.' + pad0(thousandths, 3);
    if (hours > 0) {
        time = hours + ':' + time;
    }

    return time;
}

/**
 * Regex capturing a valid [hh:]mm:ss.000 input. */
const hmsRegex = new RegExp('' +
    /^(?<negative>-)?/.source +
    /(?:(?<hours>\d{1,3}):)?/.source +
    /(?:(?<minutes>0\d|[1-5]\d):)?/.source +
    /(?<seconds>0\d|[1-5]\d)/.source +
    /\.?(?<milliseconds>\d+)?$/.source);

/**
 * @typedef {Object} HmsGroups
 * @property {string?} negative Whether the value is negative (valid for e.g. bulk shift)
 * @property {string?} hours The number of hours. Note that this group will actually hold minutes if hours are not present.
 * @property {string?} minutes The number of minutes. Note that this group is only populated if hours are not present.
 * @property {string}  seconds The number of seconds.
 * @property {string?} milliseconds The decimal value, if any.
*/

/**
 * Parses [hh]:mm:ss.000 input into milliseconds (or the integer conversion of string milliseconds).
 * @param {string} value The time to parse
 * @returns The number of milliseconds indicated by `value`. */
function timeToMs(value, allowNegative=false) {
    let ms = 0;
    if (value.indexOf(':') === -1) {
        if (value.indexOf('.') === -1) {
            // Raw milliseconds
            return parseInt(value);
        }

        // Assume sections.milliseconds
        return parseInt(parseFloat(value) * 1000);
    }

    const result = hmsRegex.exec(value);
    if (!result || (!allowNegative && result.groups.negative)) {
        return NaN;
    }

    /** @type {HmsGroups} */
    const groups = result.groups;

    if (groups.milliseconds) {
        ms = parseInt(groups.milliseconds.substring(0, 3)); // Allow extra digits, but ignore them
        switch (groups.milliseconds.length) {
            case 1:
                ms *= 100;
                break;
            case 2:
                ms *= 10;
                break;
            default:
                break;
        }
    }

    if (groups.seconds) {
        ms += parseInt(groups.seconds) * 1000;
    }

    if (groups.minutes) {
        // Be stricter than the regex itself and force two digits
        // if we have an hours value.
        if (groups.hours && groups.minutes.length !== 2) {
            return NaN;
        }

        ms += parseInt(groups.minutes) * 60 * 1000;
    }

    if (groups.hours) {
        // Because the above regex isn't great, if we have mm:ss.000, hours
        // will be populated but minutes won't. This catches that and adds
        // hours as minutes instead.
        if (groups.minutes) {
            // Normal hh:mm
            ms += parseInt(groups.hours) * 60 * 60 * 1000;
        } else {
            ms += parseInt(groups.hours) * 60 * 1000;
        }
    }

    return ms * (groups.negative ? -1 : 1);
}

/* eslint-disable quote-props */ // Quotes are cleaner here
/**
 * Map of time input shortcut keys that will increase/decrease the time by specific values.
 *
 * Values are functions, as there are also two 'special' keys, '\' and '|' (Shift+\), which
 * rounds the current value to the nearest second/tenth of a second.
 *
 * The logic behind the values is that '-' and '=' are the "big" changes, and shift ('_', '+')
 * makes it even bigger, while '[' and ']' are the "small" changes, so shift ('{',  '}')
 * makes it even smaller. Combined with Alt, this gives us the ability to change the timings
 * by 5m, 1m, 50s, 10s, 5s, 1s, 0.5s, or .1s without manually typing specific numbers. */
const adjustKeys = {
    '_'  : -60000, // Shift+-
    '+'  :  60000, // Shift+=
    '-'  : -10000, // -
    '='  :  10000, // +
    '['  :  -1000, // [
    ']'  :   1000,
    '{'  :   -100,
    '}'  :    100,
};
/* eslint-enable */

/**
 * Round `c` to the nearest `f`, with a maximum value of `m`
 * @param {number} c Current ms value
 * @param {number} m Maximum value
 * @param {number} f Truncation factor
 * @returns {number} */
const roundDelta = (c, m, f, r=c % f) => r === 0 ? 0 : -r + ((m - c < f - r) || (r < (f / 2)) ? 0 : f);

/**
 * Map of "special" time input shortcuts that requires additional parameters
 * @type {{[key: string]: (currentMs: number, maxValue: number, altKey: boolean) => number}} */
const truncationKeys = {
    '\\' : (c, m, a) => roundDelta(c, m, a ? 5000 : 1000),
    '|'  : (c, m, a) => roundDelta(c, m, a ? 500 : 100)
};

/**
 * A common input handler that allows incremental
 * time changes with keyboard shortcuts.
 * @param {MouseEvent} e */
function timeInputShortcutHandler(e, maxDuration=NaN, allowNegative=false) {
    if (e.key.length === 1 && !e.ctrlKey && !/[\d:.]/.test(e.key)) {
        // Some time inputs (like bulk shift) allow negative values,
        // so don't override '-' if we're at the start of the input.
        if (allowNegative && e.key === '-' && e.target.selectionStart === 0) {
            return;
        }

        e.preventDefault();
        if (!adjustKeys[e.key] && !truncationKeys[e.key]) {
            return;
        }

        const simpleKey = e.key in adjustKeys;
        const max = isNaN(maxDuration) ? Number.MAX_SAFE_INTEGER : maxDuration;
        const min = allowNegative ? (isNaN(maxDuration) ? Number.MIN_SAFE_INTEGER : -maxDuration) : 0;
        const currentValue = e.target.value;

        // Default to HMS, but keep ms if that's what's currently being used
        const needsHms = currentValue.length === 0 || /[.:]/.test(currentValue);

        // Alt multiplies by 5, so 100ms becomes 500, 1 minutes becomes 5, etc.
        const currentValueMs = timeToMs(currentValue || '0');
        if (isNaN(currentValueMs)) {
            return; // Don't try to do anything with invalid input
        }

        let timeDiff = 0;
        if (simpleKey) {
            timeDiff = adjustKeys[e.key] * (e.altKey ? 5 : 1);
        } else {
            timeDiff = truncationKeys[e.key](currentValueMs, max, e.altKey);
        }

        const newTime = Math.min(max, Math.max(min, currentValueMs + timeDiff));
        const newValue = needsHms ? msToHms(newTime) : newTime;

        // execCommand will make this undo-able, but is deprecated.
        // Fall back to direct substitution if necessary.
        try {
            e.target.select();
            document.execCommand('insertText', false, newValue);
        } catch (ex) {
            e.target.value = needsHms ? msToHms(newTime) : newTime;
        }
    }
}

/**
 * General callback to treat 'Enter' on a given element as a click.
 * @param {KeyboardEvent} e */
function clickOnEnterCallback(e) {
    if (e.ctrlKey || e.shiftKey || e.altKey || e.key !== 'Enter') {
        return;
    }

    e.target.click();
}

/**
 * Displays an overlay for the given error
 * @param {string} message
 * @param {Error|string} err
 * @param {() => void} [onDismiss=Overlay.dismiss] */
function errorResponseOverlay(message, err, onDismiss=Overlay.dismiss) {
    const errType = err instanceof FetchError ? 'Server Message' : 'Error';
    Overlay.show(
        appendChildren(
            buildNode('div'),
            document.createTextNode(message),
            buildNode('br'),
            buildNode('br'),
            document.createTextNode(errType + ':'),
            buildNode('br'),
            document.createTextNode(errorMessage(err))),
        'OK',
        onDismiss);
}

/**
 * Waits for the given condition to be true, timing out after a specified number of milliseconds.
 * @param {() => boolean} condition The condition to test until it returns true.
 * @param {number} timeout Number of milliseconds before giving up. */
async function waitFor(condition, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { clearInterval(interval); reject(new Error('hit waitFor timeout')); }, timeout);
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                clearTimeout(timer);
                resolve();
            }
        }, 50);
    });
}

export {
    $,
    $$,
    appendChildren,
    buildNode,
    buildNodeNS,
    clearEle,
    clickOnEnterCallback,
    errorMessage,
    errorToast,
    errorResponseOverlay,
    msToHms,
    pad0,
    plural,
    roundDelta,
    ServerCommand,
    timeInputShortcutHandler,
    timeToMs,
    waitFor,
};
