const Http = require('http');
const Fs = require('fs').promises;
const Mime = require('mime-types');
const Sqlite3 = require('sqlite3');
const Open = require('open');
const QueryParse = require('./QueryParse.js');
const ThumbnailManager = require('./ThumbnailManager.js').ThumbnailManager;
const zlib = require('zlib');

const Log = require('./inc/script/ConsoleLog.js');

let Config;
let Database;
let TagId;
try {
    Config = require('./config.json');

    // Set up the database, and make sure it's the right one.
    Database = new Sqlite3.Database(Config.database, Sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            Log.critical(err.message);
            Log.error(`Unable to open database. Are you sure "${Config.database}" exists?`);
            process.exit(1);
        } else {
            // Get the persistent tag_id for intro markers (which also acts as a validation check)
            Database.get("SELECT `id` FROM `tags` WHERE `tag_type`=12;", (err, row) => {
                if (err) {
                    Log.critical(err.message);
                    Log.error(`Are you sure "${Config.database}" is the Plex database, and has at least one existing intro marker?`);
                    process.exit(1);
                }

                TagId = row.id;
                createServer();
            });
        }
    });
} catch (ex) {
    Log.critical(ex.message);
    Log.error('Unable to read configuration. Note that backslashes must be escaped for Windows-style file paths (C:\\\\path\\\\to\\\\database.db)');
    process.exit(1);
}

Log.setLevel(getConfigLogLevel());

const Hostname = Config.host || 'localhost';
const Port = Config.port || 3232;
const Thumbnails = new ThumbnailManager(Database, Config.metadataPath);


/// <summary>
/// Creates the server, called after verifying the config file and database.
/// </summary>
function createServer() {
    const server = Http.createServer(serverMain);
    
    server.listen(Port, Hostname, () => {
        const url = `http://${Hostname}:${Port}`;
        Log.info(`Server running at ${url} (Ctrl+C to exit)`);
        if (Config.autoOpen) {
            Log.info('Launching browser...');
            Open(url);
        }
    });

    // Capture Ctrl+C and cleanly exit the process
    process.on('SIGINT', () => {
        Log.info('SIGINT detected, exiting...');
        if (Database) {
            Database.close();
        }

        process.exit(0);
    });
}

/// <summary>
/// Entrypoint for incoming connections to the server.
/// </summary>
function serverMain(req, res) {
    Log.verbose(`(${req.socket.remoteAddress || 'UNKNOWN'}) ${req.method}: ${req.url}`);
    const method = req.method?.toLowerCase();

    // Don't get into node_modules or parent directories
    if (req.url.toLowerCase().indexOf('node_modules') != -1 || req.url.indexOf('/..') != -1) {
        return jsonError(res, 403, `Cannot access ${req.url}: Forbidden`);
    }

    try {
        // Only serve static resources via GET, and only accept queries for JSON via POST.
        switch (method) {
            case 'get':
                return handleGet(req, res);
            case 'post':
                return handlePost(req, res);
            default:
                return jsonError(res, 405, `Unexpected method "${req.method?.toUpperCase()}"`);
        }
    } catch (e) {
        // Something's gone horribly wrong
        Log.error(e.toString(), `Exception thrown for ${req.url}`);
        return jsonError(res, 500, `The server was unable to process this request: ${e.toString()}`);
    }
}

/// <summary>
/// Maps a configured log level string to its underlying value
/// </summary>
function getConfigLogLevel() {
    switch(Config.logLevel.toLowerCase()) {
        case "tmi":
            return Log.Level.Tmi;
        case "verbose":
            return Log.Level.Verbose;
        case "info":
            return Log.Level.Info;
        case "warn":
            return Log.Level.Warn;
        case "error":
            return Log.Level.Error;
        default:
            Log.warn(`Invalid log level detected: ${Config.logLevel}. Defaulting to 'Info'`);
            return Log.Level.Info;
    }
}

/// <summary>
/// Handle GET requests, used to serve static content like HTML/CSS/SVG.
/// </summary>
function handleGet(req, res) {
    let url = req.url;
    if (url == '/') {
        url = '/index.html';
    }

    if (url.startsWith('/i/')) {
        return getSvgIcon(url, res);
    } else if (url.startsWith('/t/')) {
        return getThumbnail(url, res);
    }

    let mimetype = Mime.lookup(url);
    if (!mimetype) {
        res.statusCode = 404;
        res.end('Bad MIME type!');
        return;
    }

    Fs.readFile(__dirname + url).then(contents => {
        returnCompressedData(res, 200, contents, mimetype);
    }).catch(err => {
        Log.warn(`Unable to serve ${url}: ${err.message}`);
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    });
}

/// <summary>
/// Retrieve an SVG icon requested with the given color: /i/[hex color]/icon.svg
/// </summary>
function getSvgIcon(url, res) {
    parts = url.split('/');
    if (parts.length !== 4) {
        return jsonError(res, 400, 'Invalid icon request.');
    }

    const color = parts[2];
    const icon = parts[3];

    // Expecting a 3 or 6 character hex string
    if (!/^[a-fA-F0-9]{3}$/.test(color) && !/^[a-fA-F0-9]{6}$/.test(color)) {
        return jsonError(res, 400, 'Invalid icon color.');
    }

    Fs.readFile(__dirname + '/inc/svg/' + icon).then(contents => {
        // Raw file has FILL_COLOR in place of hardcoded values. Replace
        // it with the requested hex color (after decoding the contents)
        if (Buffer.isBuffer(contents)) {
            contents = contents.toString('utf-8');
        }

        // Could send this back compressed, but most of these are so small
        // that it doesn't make a tangible difference.
        contents = contents.replace(/FILL_COLOR/g, `#${color}`);
        res.setHeader('Content-Type', 'image/svg+xml; charset=UTF-8');
        res.end(Buffer.from(contents, 'utf-8'));
    }).catch(err => {
        Log.error(err, 'Failed to read icon');
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    })
}

/// <summary>
/// Map endpoints to their corresponding functions. Also breaks out and validates expected query parameters.
/// </summary>
const EndpointMap = {
    query        : (params, res) => queryIds(params.custom('keys', (keys) => keys.split(',')), res),
    edit         : (params, res) => editMarker(...params.ints('id', 'start', 'end'), res),
    add          : (params, res) => addMarker(...params.ints('metadataId', 'start', 'end'), res),
    delete       : (params, res) => deleteMarker(params.i('id'), res),
    get_sections : (_     , res) => getLibraries(res),
    get_section  : (params, res) => getShows(params.i('id'), res),
    get_seasons  : (params, res) => getSeasons(params.i('id'), res),
    get_episodes : (params, res) => getEpisodes(params.i('id'), res),
    get_stats    : (params, res) => allStats(params.i('id'), res),
    get_config : (_, res) => jsonSuccess(res, Config),
};

/// <summary>
/// Handle POST requests, used to return JSON data queried by the client.
/// </summary>
function handlePost(req, res) {
    const url = req.url.toLowerCase();
    const endpointIndex = url.indexOf('?');
    const endpoint = endpointIndex == -1 ? url.substring(1) : url.substring(1, endpointIndex);
    const parameters = new QueryParse.Parser(req);
    if (EndpointMap[endpoint]) {
        try {
            return EndpointMap[endpoint](parameters, res);
        } catch (ex) {
            // Capture QueryParameterException and overwrite the 500 error we would otherwise return with 400
            if (ex instanceof QueryParse.QueryParameterException) {
                return jsonError(res, 400, ex.message);
            }

            throw ex;
        }
    }

    return jsonError(res, 404, `Invalid endpoint: ${endpoint}`);
}

/// <summary>
/// Helper method that returns the given HTTP status code alongside a JSON object with a single 'Error' field.
/// </summary>
function jsonError(res, code, error) {
    Log.error(error, 'Unable to complete request');
    returnCompressedData(res, code, JSON.stringify({ Error : error }), 'application/json');
}

/// <summary>
/// Helper method that returns a success HTTP status code alongside any data we want to return to the client.
/// </summary>
function jsonSuccess(res, data) {
    // TMI logging, post the entire response, for verbose just indicate we succeeded.
    if (Log.getLevel() <= Log.Level.Tmi) {
        Log.tmi(data ? JSON.stringify(data) : 'true', 'Success');
    } else {
        Log.verbose(true, 'Success')
    }

    returnCompressedData(res, 200, JSON.stringify(data || { success : true }), 'application/json');
}

/// <summary>
/// Attempt to send gzip compressed data to reduce network traffic, falling back to plain text on failure.
/// </summary>
function returnCompressedData(res, status, data, contentType) {
    zlib.gzip(data, (err, buffer) => {
        if (err) {
            Log.warn('Failed to compress data, sending uncompressed');
            res.writeHead(status, { 'Content-Type' : contentType });
            res.end(data);
            return;
        }

        res.writeHead(status, {
            'Content-Encoding' : 'gzip',
            'Content-Type' : contentType
        });

        res.end(buffer);
    })
}

/// <summary>
/// Return an array of markers for all requested metadata ids.
/// </summary>
function queryIds(keys, res) {
    let markers = {};
    keys.forEach(key => {
        markers[key] = [];
    });

    let query = 'SELECT * FROM `taggings` WHERE `tag_id`=' + TagId + ' AND (';
    keys.forEach(key => {
        const intKey = parseInt(key);
        if (isNaN(intKey)) {
            // Don't accept bad keys, but don't fail the entire operation either.
            Log.warn(key, 'Found bad key in queryIds, skipping');
            return;
        }

        query += '`metadata_item_id`=' + intKey + ' OR ';
    });

    query = query.substring(0, query.length - 4) + ');';
    Database.all(query, (err, rows) => {
        if (err) {
            return jsonError(res, 400, 'Unable to retrieve ids');
        }

        rows.forEach(row => {
            // Need to add 'Z' to timestamps
            if (row.thumb_url) row.thumb_url += 'Z';
            row.created_at += 'Z';
            markers[row.metadata_item_id].push(row);
        });

        return jsonSuccess(res, markers);
    });
}

/// <summary>
/// Edit an existing marker, and update index order as needed.
/// </summary>
function editMarker(markerId, startMs, endMs, res) {
    Database.get("SELECT * FROM `taggings` WHERE `id`=" + markerId + ";", (err, currentMarker) => {
        if (err || !currentMarker || currentMarker.text != 'intro') {
            return jsonError(res, 400, err | 'Intro marker not found');
        }

        const oldIndex = currentMarker.index;

        // Get all markers to adjust indexes if necessary
        Database.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=? ORDER BY `index` ASC", [currentMarker.metadata_item_id, currentMarker.tag_id], (err, rows) => {
            if (err) {
                return jsonError(res, 400, err);
            }

            Log.verbose(`Markers for this episode: ${rows.length}`);

            let allMarkers = rows;
            allMarkers[oldIndex].time_offset = startMs;
            allMarkers[oldIndex].end_time_offset = endMs;
            allMarkers.sort((a, b) => a.time_offset - b.time_offset);
            let newIndex = 0;

            for (let index = 0; index < allMarkers.length; ++index) {
                let marker = allMarkers[index];
                if (marker.end_time_offset >= startMs && marker.time_offset <= endMs && marker.id != markerId) {
                    // Overlap, this should be handled client-side
                    return jsonError(res, 400, 'Overlapping markers. The existing marker should be expanded to include this range instead.');
                }

                if (marker.id == markerId) {
                    newIndex = index;
                }

                marker.newIndex = index;
            }

            // Use startMs.toString() to ensure we properly set '0' instead of a blank value if we're starting at the very beginning of the file
            const query = 'UPDATE `taggings` SET `index`=?, `time_offset`=?, `end_time_offset`=?, `thumb_url`=CURRENT_TIMESTAMP WHERE `id`=?;';
            Database.run(query, [newIndex, startMs.toString(), endMs, markerId], (err) => {
                if (err) {
                    return jsonError(res, 400, err);
                }

                for (const marker of allMarkers) {
                    if (marker.index != marker.newIndex) {

                        // Fire and forget. Fingers crossed this does the right thing.
                        Database.run("UPDATE `taggings` SET `index`=? WHERE `id`=?;", [marker.newIndex, marker.id]);
                    }
                }
    
                return jsonSuccess(res, { metadata_id : currentMarker.metadata_item_id, marker_id : markerId, time_offset : startMs, end_time_offset : endMs, index : newIndex });
            });

        });
    });
}

/// <summary>
/// Adds the given marker to the database, rearranging indexes as necessary.
/// </summary>
function addMarker(metadataId, startMs, endMs, res) {
    if (startMs >= endMs) {
        return jsonError(res, 400, "Start time must be less than end time.");
    }

    Database.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=? ORDER BY `index` ASC;", [metadataId, TagId], (err, rows) => {
        if (err) {
            return jsonError(res, 400, err.message);
        }

        let allMarkers = rows;
        let newIndex = 0;
        let foundNewIndex = false;
        for (let marker of allMarkers) {
            if (foundNewIndex) {
                marker.newIndex = marker.index + 1;
                continue;
            }

            if (marker.end_time_offset >= startMs && marker.time_offset <= endMs) {
                // Overlap, this should be handled client-side
                return jsonError(res, 400, 'Overlapping markers. The existing marker should be expanded to include this range instead.');
            }

            if (marker.time_offset > startMs) {
                newIndex = marker.index;
                foundNewIndex = true;
                marker.newIndex = marker.index + 1;
            } else {
                marker.newIndex = marker.index;
            }
        }

        if (!foundNewIndex) {
            newIndex = allMarkers.length;
        }
        
        Database.run("INSERT INTO `taggings` (`metadata_item_id`, `tag_id`, `index`, `text`, `time_offset`, `end_time_offset`, `thumb_url`, `created_at`, `extra_data`) " +
                    "VALUES (?, ?, ?, 'intro', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'pv%3Aversion=5')", [metadataId, TagId, newIndex, startMs, endMs], (err) => {
            if (err) {
                return jsonError(res, 400, err);
            }

            // Insert succeeded, update indexes of other markers if necessary
            for (const marker of allMarkers) {
                if (marker.index != marker.newIndex) {

                    // Fire and forget. Fingers crossed this does the right thing.
                    Database.run("UPDATE `taggings` SET `index`=? WHERE `id`=?;", [marker.newIndex, marker.id]);
                }
            }

            // Return our new values directly from the table
            Database.get("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=? AND `time_offset`=?;", [metadataId, TagId, startMs], (err, row) => {
                if (err) {
                    // We still succeeded, but failed to get the right data after it was inserted?
                    return jsonSuccess(res);
                }

                // Times are stored as UTC, but don't say they are.
                row.thumb_url += 'Z';
                row.created_at += 'Z';

                jsonSuccess(res, row);
            });
            
            updateMarkerBreakdownCache(metadataId, allMarkers.length, 1 /*delta*/);
        });
    });
}

/// <summary>
/// Removes the given marker from the database, rearranging indexes as necessary.
/// </summary>
function deleteMarker(markerId, res) {
    Database.get("SELECT * FROM `taggings` WHERE `id`=?", [markerId], (err, row) => {
        if (err || !row || row.text != 'intro') {
            return jsonError(res, 400, "Could not find intro marker");
        }

        Database.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=?;", [row.metadata_item_id, row.tag_id], (err, rows) => {
            if (err) {
                return jsonError(res, 400, "Could not retrieve intro markers for possible rearrangement");
            }

            let deleteIndex = 0;
            for (const row of rows) {
                if (row.id == markerId) {
                    deleteIndex = row.index;
                }
            }

            const allMarkers = rows;

            // Now that we're done rearranging, delete the original tag.
            Database.run("DELETE FROM `taggings` WHERE `id`=?", [markerId], (err) => {
                if (err) {
                    return jsonError(res, 500, 'Failed to delete intro marker');
                }

                // If deletion was successful, now we can check to see whether we need to rearrange indexes to keep things contiguous
                if (deleteIndex < rows.length - 1) {

                    // Fire and forget, hopefully it worked, but it _shouldn't_ be the end of the world if it doesn't.
                    for (const marker of allMarkers) {
                        if (marker.index > deleteIndex) {
                            Database.run("UPDATE `taggings` SET `index`=? WHERE `id`=?;", [marker.index - 1, marker.id]);
                        }
                    }
                }

                updateMarkerBreakdownCache(row.metadata_item_id, rows.length, -1 /*delta*/);

                return jsonSuccess(res, { metadata_id : row.metadata_item_id, marker_id : markerId });
            });
        });
    });
}

/// <summary>
/// Return all TV libraries found in the database.
/// </summary>
function getLibraries(res) {
    Database.all("Select `id`, `name` FROM `library_sections` WHERE `section_type`=?", [2], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve library sections.");
        }

        let libraries = [];
        for (const row of rows) {
            libraries.push({ id : row.id, name : row.name });
        }

        return jsonSuccess(res, libraries);
    });
}

/// <summary>
/// Retrieve all shows from the give library section.
/// </summary>
function getShows(sectionId, res) {
    // Create an inner table that contains all unique seasons across all shows, with episodes per season attached,
    // and join that to a show query to roll up the show, the number of seasons, and the number of episodes all in a single row
    const query =
'SELECT shows.`id`, shows.title, shows.title_sort, shows.original_title, COUNT(shows.`id`) AS season_count, SUM(seasons.`episode_count`) AS episode_count FROM metadata_items shows\n\
 INNER JOIN (\n\
     SELECT seasons.`id`, seasons.`parent_id` AS show_id, COUNT(episodes.`id`) AS episode_count FROM metadata_items seasons\n\
     INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.`id`\n\
     WHERE seasons.library_section_id=? AND seasons.metadata_type=3\n\
     GROUP BY seasons.id) seasons\n\
 WHERE shows.metadata_type=2 AND shows.`id`=seasons.show_id\n\
 GROUP BY shows.`id`;';

    Database.all(query, [sectionId], (err, rows) => {
        if (err) {
            return jsonError(res, 400, `Could not retrieve shows from the database: ${err.message}`);
        }

        let shows = [];
        for (const show of rows) {
            shows.push({
                title : show.title,
                titleSearch : show.title.toLowerCase().replace(/[\s,'"_\-!?]/g, ''),
                sort : show.title.toLowerCase() != show.title_sort.toLowerCase() ? show.title_sort.toLowerCase().replace(/[\s,'"_\-!?]/g, '') : '',
                original : show.original_title ? show.original_title.toLowerCase().replace(/[\s,'"_\-!?]/g, '') : '',
                seasons : show.season_count,
                episodes : show.episode_count,
                metadataId : show.id,
            });
        }

        return jsonSuccess(res, shows);
    });
}

/// <summary>
/// Return all seasons for the show specified by the given metadataId.
// </summary>
function getSeasons(metadataId, res) {
    const query =
'SELECT seasons.id, seasons.title, seasons.`index`, COUNT(episodes.id) AS episode_count FROM metadata_items seasons\n\
     INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.id\n\
     WHERE seasons.parent_id=?\n\
 GROUP BY seasons.id\n\
 ORDER BY seasons.`index` ASC;'

    Database.all(query, [metadataId], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve seasons from the database.");
        }

        let seasons = [];
        for (const season of rows) {
            seasons.push({
                index : season.index,
                title : season.title,
                episodes : season.episode_count,
                metadataId : season.id,
            });
        }

        return jsonSuccess(res, seasons);
    })
}

/// <summary>
/// Get all episodes for the season specified by the given metadataId.
// </summary>
function getEpisodes(metadataId, res) {
    // Grab episodes for the given season.
    // Multiple joins to grab the season name, show name, and episode duration (MIN so that we don't go beyond the length of the shortest episode version to be safe).
    const query = `
SELECT e.title AS title, e.\`index\` AS \`index\`, e.id AS id, p.title AS season, p.\`index\` AS season_index, g.title AS show, MIN(m.duration) AS duration, COUNT(e.id) AS parts FROM metadata_items e
    INNER JOIN metadata_items p ON e.parent_id=p.id
    INNER JOIN metadata_items g ON p.parent_id=g.id
    INNER JOIN media_items m ON e.id=m.metadata_item_id
WHERE e.parent_id=?
GROUP BY e.id;`;

    Database.all(query, [metadataId], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve episodes from the database.");
        }

        // There's definitely a better way to do this, but determining whether an episode
        // has thumbnails attached is asynchronous, so keep track of how many results have
        // come in, and only return once we've processed all rows.
        let waitingFor = rows.length;
        let episodes = [];
        rows.forEach((episode, index) => {
            const metadataId = episode.id;
            episodes.push({
                title : episode.title,
                index : episode.index,
                seasonName : episode.season,
                seasonIndex : episode.season_index,
                showName : episode.show,
                metadataId : metadataId,
                duration : episode.duration,
            });

            if (Config.useThumbnails) {
                Thumbnails.hasThumbnails(metadataId).then(hasThumbs => {
                    episodes[index].hasThumbnails = hasThumbs;
                    --waitingFor;
                    if (waitingFor == 0) {
                        return jsonSuccess(res, episodes);
                    }
                }).catch(() => {
                    --waitingFor;
                    episodes[index].hasThumbnails = false;
                });
            }
        });

        if (!Config.useThumbnails) {
            return jsonSuccess(res, episodes);
        }
    });
}

let markerBreakdownCache = {};

/// <summary>
/// Gather marker information for all episodes in the given library,
/// returning the number of episodes that have X markers associated with it.
/// </summary>
function allStats(sectionId, res) {
    if (markerBreakdownCache[sectionId]) {
        Log.verbose('Found cached data, returning it');
        return jsonSuccess(res, markerBreakdownCache[sectionId]);
    }

    // Note that the method below of grabbing _all_ tags for an episode and discarding
    // those that aren't intro markers is faster than doing an outer join on a temporary
    // taggings table that only includes markers
    const query = `
SELECT e.id AS episode_id, m.tag_id AS tag_id FROM metadata_items e
LEFT JOIN taggings m ON e.id=m.metadata_item_id
WHERE e.library_section_id=? AND e.metadata_type=4
ORDER BY e.id ASC;`;
    Database.all(query, [sectionId], (err, rows) => {
        if (err) {
            return jsonError(res, 400, err.message);
        }

        let buckets = {};
        Log.verbose(`Parsing ${rows.length} tags`);
        let idCur = -1;
        let countCur = 0;
        for (const row of rows) {
            if (row.episode_id == idCur) {
                if (row.tag_id == TagId) {
                    ++countCur;
                }
            } else {
                if (!buckets[countCur]) {
                    buckets[countCur] = 0;
                }

                ++buckets[countCur];
                idCur = row.episode_id;
                countCur = row.tag_id == TagId ? 1 : 0;
            }
        }

        ++buckets[countCur];
        markerBreakdownCache[sectionId] = buckets;
        return jsonSuccess(res, buckets);
    });
}

/// <summary>
/// Ensure our marker bucketing stays up to date after the user adds or deletes markers.
/// </summary>
function updateMarkerBreakdownCache(metadataId, oldMarkerCount, delta) {
    Database.get('SELECT library_section_id FROM metadata_items WHERE id=?', [metadataId], (err, row) => {
        if (err) {
            Log.warn(`Unable to determine the section id of metadata item ${metadataId}, wiping cache to ensure things stay in sync`);
            markerBreakdownCache = {};
            return;
        }

        const section = row.library_section_id;
        if (!markerBreakdownCache[section]) {
            return;
        }

        markerBreakdownCache[section][oldMarkerCount] -= 1;
        markerBreakdownCache[section][oldMarkerCount + delta] += 1;
    });
}

/// <summary>
/// Return a thumbnail for the episode and timestamp denoted by the url, /t/metadataId/timestampInSeconds
/// </summary>
function getThumbnail(url, res) {
    const badRequest = (res) => { res.statusCode = 400; res.end(); };
    if (!Config.useThumbnails) {
        return badRequest(res);
    }
    const split = url.split('/');
    if (split.length != 4) {
        return badRequest(res);
    }

    const metadataId = parseInt(split[2]);
    const timestamp = parseInt(split[3]);
    if (isNaN(metadataId) || isNaN(timestamp)) {
        return badRequest();
    }

    Thumbnails.getThumbnail(metadataId, timestamp).then(data => {
        res.writeHead(200, { 'Content-Type' : 'image/jpeg', 'Content-Length' : data.length });
        res.end(data);
    });
}