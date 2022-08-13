/** External dependencies */
import { promises as Fs } from 'fs';
import { createServer, IncomingMessage, Server as httpServer, ServerResponse } from 'http';
import { contentType, lookup } from 'mime-types';
import Open from 'open';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** Server dependencies */
import MarkerBackupManager from './MarkerBackupManager.js';
import MarkerCacheManager from './MarkerCacheManager.js';
import PlexIntroEditorConfig from './PlexIntroEditorConfig.js';
import PlexQueryManager from './PlexQueryManager.js';
import QueryParser from './QueryParse.js';
import ThumbnailManager from './ThumbnailManager.js';
/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */

/** Server+Client shared dependencies */
import { Log, ConsoleLog } from './../Shared/ConsoleLog.js';
import { MarkerData, ShowData, SeasonData, EpisodeData } from './../Shared/PlexTypes.js';
import { sendCompressedData, sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import ServerError from './ServerError.js';

/**
 * HTTP server instance.
 * @type {httpServer} */
let Server;

/**
 * User configuration.
 * @type {PlexIntroEditorConfig} */
let Config;

/**
 * Manages retrieving preview thumbnails for episodes.
 * @type {ThumbnailManager}
 */
let Thumbnails;

/**
 * Manages basic marker information for the entire database.
 * @type {MarkerCacheManager}
 */
let MarkerCache = null;

/**
 * Manages executing queries to the Plex database.
 * @type {PlexQueryManager}
 */
let QueryManager;

/**
 * Records marker actions in a database to be restored if Plex removes them, or reverted
 * if changes in Plex's marker schema causes these markers to break the database.
 * @type {MarkerBackupManager} */
let BackupManager;

/**
 * Set of possible server states. */
const ServerState = {
    /** Server is booting up. */
    FirstBoot : 0,
    /** Server is booting up after a restart. */
    ReInit : 1,
    /** Server is running normally. */
    Running : 2,
    /** Server is in a suspended state. */
    Suspended : 3,
    /** The server is in the process of shutting down. Either permanently or during a restart. */
    ShuttingDown : 4,
}

/**
 * Indicates whether we're in the middle of shutting down the server, and
 * should therefore immediately fail all incoming requests.
 * @type {number} */
let CurrentState = ServerState.FirstBoot;

/** @returns The current ServerState of the server. */
function getState() { return CurrentState; }

/** Global flag indicating if the server is running tests. */
let IsTest = false;

/** The root of the project, which is one directory up from the 'Server' folder we're currently in. */
const ProjectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Initializes and starts the server */
async function run() {
    setupTerminateHandlers();
    const testData = checkTestData();
    Config = new PlexIntroEditorConfig(ProjectRoot, testData);

    // Set up the database, and make sure it's the right one.
    QueryManager = await PlexQueryManager.CreateInstance(Config.databasePath(), Config.pureMode());
    if (Config.backupActions()) {
        BackupManager = await MarkerBackupManager.CreateInstance(QueryManager, IsTest ? join(ProjectRoot, 'Test') : ProjectRoot);
    } else {
        Log.warn('Marker backup not enabled. Any changes removed by Plex will not be recoverable.');
    }

    Thumbnails = new ThumbnailManager(QueryManager.database(), Config.metadataPath());
    if (Config.extendedMarkerStats()) {
        MarkerCache = new MarkerCacheManager(QueryManager.database(), QueryManager.markerTagId());
        try {
            await MarkerCache.buildCache();
            await BackupManager?.buildAllPurges(MarkerCache);
        } catch (err) {
            Log.error(err.message, 'Failed to build marker cache:');
            Log.error('Continuing to server creating, but extended marker statistics will not be available.');
            Config.disableExtendedMarkerStats();
            MarkerCache = null;
        }
    }

    Log.info('Creating server...');
    launchServer();
}

export { run, ServerState, getState };

/** Set up process listeners that will shut down the process
 * when it encounters an unhandled exception or SIGINT. */
function setupTerminateHandlers() {
    // Only need to do this on first boot, not if we're restarting/resuming
    if (CurrentState != ServerState.FirstBoot) {
        return;
    }

    // If we encounter an unhandled exception, handle it somewhat gracefully and exit the process.
    process.on('uncaughtException', (err) => {
        Log.critical(err.message);
        Log.verbose(err.stack ? err.stack : '(Could not find stack trace)');
        Log.error('The server ran into an unexpected problem, exiting...');
        cleanupForShutdown();
        process.exit(1);
    });

    // Capture Ctrl+C (and other interrupts) and cleanly exit the process
    const signalCallback = (sig) => handleClose(sig);
    process.on('SIGINT', signalCallback);
    process.on('SIGQUIT', signalCallback);
    process.on('SIGTERM', signalCallback);

    // On Windows, Ctrl+Break immediately shuts down without cleanup
    process.on('SIGBREAK', () => {
        Log.warn('Ctrl+Break detected, shutting down immediately.');
        process.exit(1);
    });
}

/**
 * Shut down the server and exit the process (if we're not restarting).
 * @param {String} signal The signal that initiated this shutdown.
 * @param {boolean} [restart=false] Whether we should restart the server after closing */
function handleClose(signal, restart=false) {
    CurrentState = ServerState.ShuttingDown;
    Log.info(`${signal} detected, exiting...`);
    cleanupForShutdown();
    const exitFn = (error, restart) => {
        if (restart) {
            Log.info('Restarting server...');
            CurrentState = ServerState.ReInit;
            Server = null;
            run();
        } else if (!IsTest) {
            // Gross, but integration tests does its own killing
            // of the process.
            Log.info('Exiting process.');
            process.exit(error ? 1 : 0);
        }
    };

    if (Server) {
        Server.close((err) => {
            if (err) {
                Log.error(err, 'Failed to cleanly shut down HTTP server');
            } else {
                Log.info('Successfully shut down HTTP server.');
            }

            exitFn(err, restart);
        });
    } else {
        // Didn't even get to server creation, immediately terminate/restart
        exitFn(0, restart);
    }
}

/** Properly close out open resources in preparation for shutting down the process. */
function cleanupForShutdown() {
    QueryManager?.close();
    QueryManager = null;
    BackupManager?.close();
    BackupManager = null;
    MarkerCache = null;
    Thumbnails = null;
    Config = null;

    // Either we failed to resume the server, or we got a shutdown request in the middle of
    // resuming. Send a failure response now so the server can close cleanly.
    if (ResumeResponse) {
        sendJsonError(ResumeResponse, new ServerError(`Failed to resume server.`, 500));
        ResumeResponse = null;
    }
}

/**
 * Shuts down the server after a user-initiated shutdown request.
 * @param {ServerResponse} res */
function userShutdown(res) {
    sendJsonSuccess(res);
    handleClose('User Shutdown');
}

/** Restarts the server after a user-initiated restart request.
 * @param {ServerResponse} res */
function userRestart(res) {
    sendJsonSuccess(res);
    handleClose('User Restart', true /*restart*/);
}

/** Suspends the server, keeping the HTTP server running, but disconnects from the Plex database. */
function userSuspend(res) {
    Log.verbose('Attempting to pause the server');
    if (CurrentState != ServerState.Running) {
        return sendJsonError(res, new ServerError('Server is either already suspended or shutting down.', 400))
    }

    CurrentState = ServerState.Suspended;
    cleanupForShutdown();
    Log.info('Server successfully suspended.');
    sendJsonSuccess(res);
}

/**
 * The response to our resume event. Kept at the global scope
 * to avoid passing it through the mess of init callbacks initiated by `run()`.
 * @type {ServerResponse} */
let ResumeResponse;

/**
 * Resumes the server after being disconnected from the Plex database.
 * @param {ServerResponse} res */
function userResume(res) {
    Log.verbose('Attempting to resume the server');
    if (CurrentState != ServerState.Suspended) {
        Log.verbose(`userResume: Server isn't suspended (${CurrentState})`);
        return sendJsonSuccess(res, { message : 'Server is not suspended' });
    }

    if (ResumeResponse) {
        Log.verbose('userResume: Already in a resume operation');
        return sendJsonSuccess(res, { message : 'Server is already resuming.' });
    }

    ResumeResponse = res;

    run();
}

/** Creates the server. Called after verifying the config file and database. */
function launchServer() {
    if (!shouldCreateServer()) {
        return;
    }

    Server = createServer(serverMain);

    Server.listen(Config.port(), Config.host(), () => {
        const url = `http://${Config.host()}:${Config.port()}`;
        Log.info(`Server running at ${url} (Ctrl+C to exit)`);
        if (Config.autoOpen() && CurrentState == ServerState.FirstBoot) {
            Log.info('Launching browser...');
            Open(url);
        }

        CurrentState = ServerState.Running;
    });
}

/**
 * Return whether we should attempt to create the server. Will only return false
 * if we're resuming from a previous suspension.
 * @returns {boolean} */
function shouldCreateServer() {
    if (!Server) {
        return true;
    }

    if (CurrentState != ServerState.Suspended) {
        Log.warn('Calling launchServer when server already exists!');
    }

    CurrentState = ServerState.Running;
    if (ResumeResponse) {
        sendJsonSuccess(ResumeResponse, { message : 'Server resumed' });
        ResumeResponse = null;
    }

    return false;
}

/**
 * Entrypoint for incoming connections to the server.
 * @type {Http.RequestListener}
 */
function serverMain(req, res) {
    Log.verbose(`(${req.socket.remoteAddress || 'UNKNOWN'}) ${req.method}: ${req.url}`);
    const method = req.method?.toLowerCase();

    if (CurrentState == ServerState.ShuttingDown) {
        Log.warn('Got a request when attempting to shut down the server, returning 503.');
        if (method == 'get') {
            // GET methods don't return JSON
            res.statusCode = 503;
            return res.end();
        }

        return sendJsonError(res, new ServerError('Server is shutting down', 503));
    }

    // Don't get into node_modules or parent directories
    if (req.url.toLowerCase().indexOf('node_modules') != -1 || req.url.indexOf('/..') != -1) {
        return sendJsonError(res, new ServerError(`Cannot access ${req.url}: Forbidden`, 403));
    }

    try {
        // Only serve static resources via GET, and only accept queries for JSON via POST.
        switch (method) {
            case 'get':
                return handleGet(req, res);
            case 'post':
                return handlePost(req, res);
            default:
                return sendJsonError(res, new ServerError(`Unexpected method "${req.method?.toUpperCase()}"`, 405));
        }
    } catch (e) {
        e.message = `Exception thrown for ${req.url}: ${e.message}`;
        sendJsonError(res, e, e.code || 500);
    }
}

/**
 * Handle GET requests, used to serve static content like HTML/CSS/SVG.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
function handleGet(req, res) {
    let url = req.url;
    if (url == '/') {
        url = '/index.html';
    }

    if (url.startsWith('/i/')) {
        return getSvgIcon(url, res);
    } else if (url.startsWith('/t/')) {
        if (CurrentState == ServerState.Suspended) {
            // We're disconnected from the backing data, can't return anything.
            res.statusCode = 400;
            res.end(`Server is suspended, can't retrieve thumbnail.`);
            return;
        }

        return getThumbnail(url, res);
    }

    let mimetype = contentType(lookup(url));
    if (!mimetype) {
        res.statusCode = 404;
        res.end('Bad MIME type!');
        return;
    }

    Fs.readFile(ProjectRoot + url).then(contents => {
        sendCompressedData(res, 200, contents, mimetype);
    }).catch(err => {
        Log.warn(`Unable to serve ${url}: ${err.message}`);
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    });
}

/**
 * Retrieve an SVG icon requested with the given color.
 * @param {string} url The svg url of the form /i/[hex color]/[icon].svg.
 * @param {ServerResponse} res
 */
function getSvgIcon(url, res) {
    let parts = url.split('/');
    if (parts.length !== 4) {
        return sendJsonError(res, new ServerError('Invalid icon request.', 400));
    }

    const color = parts[2];
    const icon = parts[3];

    // Expecting a 3 or 6 character hex string
    if (!/^[a-fA-F0-9]{3}$/.test(color) && !/^[a-fA-F0-9]{6}$/.test(color)) {
        return sendJsonError(res, new ServerError(`Invalid icon color: "${color}"`, 400));
    }

    Fs.readFile(ProjectRoot + '/SVG/' + icon).then(contents => {
        // Raw file has FILL_COLOR in place of hardcoded values. Replace
        // it with the requested hex color (after decoding the contents)
        if (Buffer.isBuffer(contents)) {
            contents = contents.toString('utf-8');
        }

        // Could send this back compressed, but most of these are so small
        // that it doesn't make a tangible difference.
        contents = contents.replace(/FILL_COLOR/g, `#${color}`);
        res.setHeader('Content-Type', contentType('image/svg+xml'));
        res.setHeader('x-content-type-options', 'nosniff');
        res.end(Buffer.from(contents, 'utf-8'));
    }).catch(err => {
        Log.error(err, 'Failed to read icon');
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    })
}

/**
 * Map endpoints to their corresponding functions. Also breaks out and validates expected query parameters.
 * @type {{[endpoint: string]: (params : QueryParser) => Promise<any>}}
 */
const EndpointMap = {
    query         : async (params) => await queryIds(params.ia('keys')),
    edit          : async (params) => await editMarker(...params.ints('id', 'start', 'end', 'userCreated')),
    add           : async (params) => await addMarker(...params.ints('metadataId', 'start', 'end')),
    delete        : async (params) => await deleteMarker(params.i('id')),
    get_sections  : async (_     ) => await getLibraries(),
    get_section   : async (params) => await getShows(params.i('id')),
    get_seasons   : async (params) => await getSeasons(params.i('id')),
    get_episodes  : async (params) => await getEpisodes(params.i('id')),
    get_stats     : async (params) => await allStats(params.i('id')),
    get_config    : async (_     ) => await getConfig(),
    log_settings  : async (params) => await setLogSettings(...params.ints('level', 'dark', 'trace')),
    purge_check   : async (params) => await purgeCheck(params.i('id')),
    all_purges    : async (params) => await allPurges(params.i('sectionId')),
    restore_purge : async (params) => await restoreMarkers(params.ia('markerIds'), params.i('sectionId')),
    ignore_purge  : async (params) => await ignorePurgedMarkers(params.ia('markerIds'), params.i('sectionId')),
    get_breakdown : async (params) => await getShowMarkerBreakdownTree(...params.ints('id', 'includeSeasons')),
};

/**
 * Map of server actions (shutdown/restart/etc) to their corresponding functions.
 * Split from EndpointMap as some of these require direct access to the ServerResponse.
 * @type {[endpoint: string]: (res : ServerResponse) => void} */
const ServerActionMap = {
    shutdown : (res) => userShutdown(res),
    restart  : (res) => userRestart(res),
    suspend  : (res) => userSuspend(res),
    resume   : (res) => userResume(res),
};

/**
 * Handle POST requests, used to return JSON data queried by the client.
 * @param {IncomingMessage} req
 * @param {ServerResponse} res */
async function handlePost(req, res) {
    const url = req.url.toLowerCase();
    const endpointIndex = url.indexOf('?');
    const endpoint = endpointIndex == -1 ? url.substring(1) : url.substring(1, endpointIndex);
    if (CurrentState == ServerState.Suspended && (endpoint != 'resume' && endpoint != 'shutdown')) {
        return sendJsonError(res, new ServerError('Server is suspended', 503));
    }

    if (ServerActionMap[endpoint]) {
        return ServerActionMap[endpoint](res);
    }

    const parameters = new QueryParser(req);
    if (!EndpointMap[endpoint]) {
        return sendJsonError(res, new ServerError(`Invalid endpoint: ${endpoint}`, 404));
    }

    try {
        const response = await EndpointMap[endpoint](parameters);
        sendJsonSuccess(res, response);
    } catch (err) {
        // Default handler swallows exceptions and adds the endpoint to the json error message.
        err.message = `${req.url} failed: ${err.message}`;
        sendJsonError(res, err, err.code || 500);
    }
}

/**
 * Retrieve an array of markers for all requested metadata ids.
 * @param {number[]} keys The metadata ids to lookup. */
async function queryIds(keys) {
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
 * Edit an existing marker, and update index order as needed.
 * @param {number} markerId The id of the marker to edit.
 * @param {number} startMs The start time of the marker, in milliseconds.
 * @param {number} endMs The end time of the marker, in milliseconds.
 * @param {ServerResponse} res
 * @throws {ServerError} */
async function editMarker(markerId, startMs, endMs, userCreated) {
    checkMarkerBounds(startMs, endMs);

    const currentMarker = await QueryManager.getSingleMarker(markerId);
    if (!currentMarker) {
        throw new ServerError('Intro marker not found', 400);
    }

    const oldIndex = currentMarker.index;

    // Get all markers to adjust indexes if necessary
    const allMarkers = await QueryManager.getEpisodeMarkers(currentMarker.episode_id);
    Log.verbose(`Markers for this episode: ${allMarkers.length}`);

    allMarkers[oldIndex].start = startMs;
    allMarkers[oldIndex].end = endMs;
    allMarkers.sort((a, b) => a.start - b.start);
    let newIndex = 0;

    for (let index = 0; index < allMarkers.length; ++index) {
        let marker = allMarkers[index];
        if (marker.end >= startMs && marker.start <= endMs && marker.id != markerId) {
            // Overlap, this should be handled client-side
            const message = `Marker edit (${startMs}-${endMs}) overlaps with existing marker ${marker.start}-${marker.end}`;
            throw new ServerError(`${message}. The existing marker should be expanded to include this range instead.`, 400);
        }

        if (marker.id == markerId) {
            newIndex = index;
        }

        marker.newIndex = index;
    }

    // Make the edit, then adjust indexes
    await QueryManager.editMarker(markerId, newIndex, startMs, endMs, userCreated);
    for (const marker of allMarkers) {
        if (marker.index != marker.newIndex) {
            // No await, just fire and forget.
            // TODO: In some extreme case where an episode has dozens of
            // markers, it would be much more efficient to make this a transaction
            // instead of individual queries.
            QueryManager.updateMarkerIndex(marker.id, marker.newIndex);
        }
    }

    const newMarker = new MarkerData(currentMarker);
    const oldStart = newMarker.start;
    const oldEnd = newMarker.end;
    newMarker.start = startMs;
    newMarker.end = endMs;
    await BackupManager?.recordEdit(newMarker, oldStart, oldEnd);
    return Promise.resolve(newMarker);
}

/**
 * Adds the given marker to the database, rearranging indexes as necessary.
 * @param {number} metadataId The metadata id of the episode to add a marker to.
 * @param {number} startMs The start time of the marker, in milliseconds.
 * @param {number} endMs The end time of the marker, in milliseconds.
 * @param {ServerResponse} res
 * @throws {ServerError} */
async function addMarker(metadataId, startMs, endMs) {
    checkMarkerBounds(startMs, endMs);

    const addResult = await QueryManager.addMarker(metadataId, startMs, endMs);
    const allMarkers = addResult.allMarkers;
    const newMarker = addResult.newMarker;
    const markerData = new MarkerData(newMarker);
    updateMarkerBreakdownCache(markerData, allMarkers.length - 1, 1 /*delta*/);
    MarkerCache?.addMarkerToCache(newMarker);
    await BackupManager?.recordAdd(markerData);
    return Promise.resolve(markerData);
}

/**
 * Checks whether the given startMs-endMs bounds are valid, throwing
 * a ServerError on failure.
 * @param {number} startMs
 * @param {number} endMs
 * @throws {ServerError} */
function checkMarkerBounds(startMs, endMs) {
    if (startMs >= endMs) {
        throw new ServerError(`Start time (${startMs}) must be less than end time (${endMs}).`, 400);
    }

    if (startMs < 0) {
        throw new ServerError(`Start time (${startMs}) cannot be negative.`, 400);
    }
}

/**
 * Removes the given marker from the database, rearranging indexes as necessary.
 * @param {number} markerId The marker id to remove from the database. */
async function deleteMarker(markerId) {
    const markerToDelete = await QueryManager.getSingleMarker(markerId);
    if (!markerToDelete) {
        throw new ServerError("Could not find intro marker", 400);
    }

    const allMarkers = await QueryManager.getEpisodeMarkers(markerToDelete.episode_id);
    let deleteIndex = 0;
    for (const marker of allMarkers) {
        if (marker.id == markerId) {
            deleteIndex = marker.index;
        }
    }

    // Now that we're done rearranging, delete the original tag.
    await QueryManager.deleteMarker(markerId);

    // If deletion was successful, now we can check to see whether we need to rearrange indexes to keep things contiguous
    if (deleteIndex < allMarkers.length - 1) {

        // Fire and forget, hopefully it worked, but it _shouldn't_ be the end of the world if it doesn't.
        for (const marker of allMarkers) {
            if (marker.index > deleteIndex) {
                QueryManager.updateMarkerIndex(marker.id, marker.index - 1);
            }
        }
    }

    const deletedMarker = new MarkerData(markerToDelete);
    MarkerCache?.removeMarkerFromCache(markerId);
    updateMarkerBreakdownCache(deletedMarker, allMarkers.length, -1 /*delta*/);
    await BackupManager?.recordDelete(deletedMarker);
    return Promise.resolve(deletedMarker);
}

/**
 * Retrieve all TV libraries found in the database. */
async function getLibraries() {
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
async function getShows(sectionId) {
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
async function getSeasons(metadataId) {
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
async function getEpisodes(metadataId) {
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
 * Map of section IDs to a map of marker counts X to the number episodes that have X markers.
 * @type {Object.<number, Object.<number, number>}
 */
let markerBreakdownCache = {};

/**
 * Gather marker information for all episodes in the given library,
 * returning the number of episodes that have X markers associated with it.
 * @param {number} sectionId The library section id to parse. */
async function allStats(sectionId) {
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

    if (markerBreakdownCache[sectionId]) {
        Log.verbose('Found cached data, returning it');
        return Promise.resolve(markerBreakdownCache[sectionId]);
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
    markerBreakdownCache[sectionId] = buckets;
    return Promise.resolve(buckets);
}

/**
 * Ensure our marker bucketing stays up to date after the user adds or deletes markers.
 * @param {MarkerData} marker The marker that changed.
 * @param {number} oldMarkerCount The old marker count bucket.
 * @param {number} delta The change from the old marker count, -1 for marker removals, 1 for additions. */
function updateMarkerBreakdownCache(marker, oldMarkerCount, delta) {
    const section = marker.sectionId;
    if (!markerBreakdownCache[section]) {
        return;
    }

    if (!(oldMarkerCount in markerBreakdownCache[section])) {
        Log.warn(`updateMarkerBreakdownCache: no bucket for oldMarkerCount. That's not right!`);
        markerBreakdownCache[section][oldMarkerCount] = 1; // Bring it down to zero I guess.
    }

    markerBreakdownCache[section][oldMarkerCount] -= 1;

    const newMarkerCount = oldMarkerCount + delta;
    if (!(newMarkerCount in markerBreakdownCache[section])) {
        markerBreakdownCache[section][newMarkerCount] = 0;
    }

    markerBreakdownCache[section][newMarkerCount] += 1;
}

/**
 * Retrieve a thumbnail for the episode and timestamp denoted by the url, /t/metadataId/timestampInSeconds
 * @param {string} url The url specifying the thumbnail to retrieve.
 * @param {ServerResponse} res
 */
function getThumbnail(url, res) {
    /** @param {ServerResponse} res */
    const badRequest = (res) => { res.statusCode = 400; res.end(); };

    if (!Config.useThumbnails()) {
        return badRequest(res);
    }

    const split = url.split('/');
    if (split.length != 4) {
        return badRequest(res);
    }

    const metadataId = parseInt(split[2]);
    const timestamp = parseInt(split[3]);
    if (isNaN(metadataId) || isNaN(timestamp)) {
        return badRequest(res);
    }

    Thumbnails.getThumbnail(metadataId, timestamp).then(data => {
        res.writeHead(200, {
            'Content-Type' : 'image/jpeg',
            'Content-Length' : data.length,
            'x-content-type-options' : 'nosniff'
        });
        res.end(data);
    }).catch((err) => {
        Log.error(err, 'Failed to retrieve thumbnail');
        res.statusCode = 500, res.end();
    });
}

/**
 * Retrieve a subset of the app configuration that the frontend needs access to.
 * This is only async to conform with the command handler signature. */
async function getConfig() {
    return Promise.resolve({
        useThumbnails : Config.useThumbnails(),
        extendedMarkerStats : Config.extendedMarkerStats(),
        backupActions : Config.backupActions()
    });
}

/**
 * Set the server log properties, inherited from the client.
 * @param {number} newLevel The new log level.
 * @param {number} darkConsole Whether to adjust log colors for a dark background.
 * @param {number} traceLogging Whether to also print a stack trace for each log entry.*/
async function setLogSettings(newLevel, darkConsole, traceLogging) {
    const logLevelString = Object.keys(ConsoleLog.Level).find(l => ConsoleLog.Level[l] == newLevel);
    if (logLevelString === undefined) {
        Log.warn(newLevel, 'Attempting to set an invalid log level, ignoring');
        // If the level is invalid, don't adjust anything else either.
        throw new ServerError(`Invalid Log level: ${newLevel}`, 400);
    }

    if (newLevel != Log.getLevel() || darkConsole != Log.getDarkConsole() || traceLogging != Log.getTrace()) {
        // Force the message.
        Log.setLevel(ConsoleLog.Level.Info);
        const newSettings = { Level : newLevel, Dark : darkConsole, Trace : traceLogging };
        Log.info(newSettings, 'Changing log settings due to client request');
        Log.setLevel(newLevel);
        Log.setDarkConsole(darkConsole);
        Log.setTrace(traceLogging);
    }

    return Promise.resolve();
}


/**
 * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
 * @param {number} metadataId The episode/season/show id*/
 async function purgeCheck(metadataId) {
    checkBackupManagerEnabled();

    const markers = await BackupManager.checkForPurges(metadataId);
    Log.info(markers, `Found ${markers.length} missing markers:`);
    return Promise.resolve(markers);
}

/**
 * Find all purged markers for the given library section.
 * @param {number} sectionId The library section */
async function allPurges(sectionId) {
    checkBackupManagerEnabled();

    const purges = await BackupManager.purgesForSection(sectionId);
    return Promise.resolve(purges);
}

/**
 * Attempts to restore the last known state of the markers with the given ids.
 * @param {number[]} oldMarkerIds
 * @param {number} sectionId */
async function restoreMarkers(oldMarkerIds, sectionId) {
    checkBackupManagerEnabled();

    const restoredMarkerData = await BackupManager.restoreMarkers(oldMarkerIds, sectionId);
    const restoredMarkers = restoredMarkerData.restoredMarkers;
    const existingMarkers = restoredMarkerData.existingMarkers;

    if (restoredMarkers.length == 0) {
        Log.verbose(`PlexIntroEditor::restoreMarkers: No markers to restore, likely because they all already existed.`);
    }

    let markerData = [];
    Log.tmi(`Adding ${restoredMarkers.length} to marker cache.`);
    for (const restoredMarker of restoredMarkers) {
        MarkerCache?.addMarkerToCache(restoredMarker);
        markerData.push(new MarkerData(restoredMarker));
    }

    let existingMarkerData = [];
    for (const existingMarker of existingMarkers) {
        existingMarkerData.push(new MarkerData(existingMarker));
    }

    return Promise.resolve({ newMarkers : markerData, existingMarkers : existingMarkerData });
}

/**
 * Ignores the purged markers with the given ids, preventing the user from seeing them again.
 * @param {number[]} oldMarkerIds
 * @param {number} sectionId */
async function ignorePurgedMarkers(oldMarkerIds, sectionId) {
    checkBackupManagerEnabled();

    await BackupManager.ignorePurgedMarkers(oldMarkerIds, sectionId);
    return Promise.resolve();
}

/**
 * Throw a ServerError if the backup manager is not enabled. */
function checkBackupManagerEnabled() {
    if (!BackupManager || !Config.backupActions()) {
        throw new ServerError('Action is not enabled due to configuration settings.', 400);
    }
}

/**
 * Retrieve the marker breakdown (X episodes have Y markers) for a single show,
 * optionally with breakdowns for each season attached.
 * Only async to conform to command method signature.
 * @param {number} showId The metadata id of the show to grab the breakdown for.
 * @param {number} includeSeasons 1 to include season data, 0 to leave it out.
 * @param {ServerResponse} res */
async function getShowMarkerBreakdownTree(showId, includeSeasons, res) {
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


/**
 * Returns test override data specified in the command line, if any.
 * @returns {{isTest: boolean, configOverride : string?}} */
 function checkTestData() {
    let testData = {
        isTest : false,
        configOverride : null,
    };

    if (process.argv.indexOf('--test') != -1) {
        testData.isTest = true;
        IsTest = true;
    }

    const configIndex = process.argv.indexOf('--config_override');
    if (configIndex != -1) {
        if (process.argv.length <= configIndex - 1) {
            Log.critical('Invalid config override file detected, aborting...');
            cleanupForShutdown();
            process.exit(1);
        }

        testData.configOverride = process.argv[configIndex + 1];
    }

    return testData;
}
