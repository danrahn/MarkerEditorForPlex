const http = require('http');
const fs = require('fs').promises;
const mime = require('mime-types');
const sqlite3 = require('sqlite3');
const URL = require('url');
const Open = require('open');

const Log = require('./inc/script/ConsoleLog.js');

let config;
let db;
try {
    config = require('./config.json');

    // Set up the database, and make sure it's the right one.
    db = new sqlite3.Database(config.database, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            Log.error(err.message);
            Log.error(`Unable to open database. Are you sure "${config.database}" exists?`);
            process.exit(1);
        } else {
            // One final check, make sure the metadata_items table exists
            db.get('SELECT id FROM metadata_items LIMIT 1', (err, _) => {
                if (err) {
                    Log.error(err.message);
                    Log.error(`Are you sure "${config.database}" is the Plex database?`);
                    process.exit(1);
                }

                createServer();
            });
        }
    });
} catch (ex) {
    Log.error(ex.message);
    Log.error('Unable to read configuration. Note that backslashes must be escaped for Windows-style file paths (C:\\\\path\\\\to\\\\database.db)');
    process.exit(1);
}

Log.setLevel(getConfigLogLevel());

const hostname = 'localhost';
const port = 3232;

function createServer() {
    const server = http.createServer((req, res) => {
        Log.verbose(`${req.method}: ${req.url}`);
        const method = req.method?.toLowerCase();
    
        if (req.url.toLowerCase().indexOf('node_modules') != -1 ||
            req.url.indexOf('..') != -1) {
            return error(404, res);
        }
    
        try {
            switch (method) {
                case 'get':
                    handleGet(req, res);
                    break;
                case 'post':
                    handlePost(req, res);
                    break;
                default:
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/plain');
                    res.end('Hello World\n');
                    break;
            }
        } catch (e) {
            // Something's gone horribly wrong
            Log.log(e.toString(), 'Critical exception', false, Log.Level.Critical);
            jsonError(res, 500, `The server was unable to process this request: ${e.toString()}`);
        }
    });
    
    server.listen(port, hostname, () => {
        const url = `http://${hostname}:${port}`;
        Log.info(`Server running at ${url} (Ctrl+C to exit)`);
        if (config.autoOpen) {
            Log.info('Launching browser...');
            Open(url);
        }
    });

    process.on('SIGINT', () => {
        Log.info('SIGINT detected, exiting...');
        if (db) {
            db.close();
        }

        process.exit(0);
    });
}

function getConfigLogLevel() {
    switch(config.logLevel.toLowerCase()) {
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
            Log.warn(`Invalid log level detected: ${config.logLevel}. Defaulting to 'Info'`);
            return Log.Level.Info;
    }
}

function error(code, res) {
    Log.error(code, 'Unable to process request');
    res.statusCode = code;
    res.end('Error');
}

function handleGet(req, res)
{
    let url = req.url;
    if (url == '/') {
        url = '/index.html';
    }

    if (url.startsWith('/i/')) {
        return getSvgIcon(url, res);
    }

    let mimetype = mime.lookup(url);
    if (!mimetype) {
        res.statusCode = 404;
        res.end('Bad MIME type!');
        return;
    }

    fs.readFile(__dirname + url).then(contents => {
        res.statusCode = 200;
        res.setHeader('Content-Type', mimetype);
        res.end(contents);
    }).catch(err => {
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

    fs.readFile(__dirname + '/inc/svg/' + icon).then(contents => {
        // Raw file has FILL_COLOR in place of hardcoded values. Replace
        // it with the requested hex color (after decoding the contents)
        if (Buffer.isBuffer(contents)) {
            contents = contents.toString('utf-8');
        }

        contents = contents.replace(/FILL_COLOR/g, `#${color}`);
        res.setHeader('Content-Type', 'image/svg+xml; charset=UTF-8');
        res.end(Buffer.from(contents, 'utf-8'));
    }).catch(err => {
        Log.error(err, 'Failed to read icon');
        res.statusCode = 404;
        res.end('Not Found: ' + err.code);
    })
}

function handlePost(req, res)
{
    if (req.url.startsWith('/query?')) {
        return queryIds(req, res);
    } else if (req.url.startsWith('/edit?')) {
        return editMarker(req, res);
    } else if (req.url.startsWith('/add?')) {
        return addMarker(req, res);
    } else if (req.url.startsWith('/delete?')) {
        return deleteMarker(req, res);
    } else if (req.url == '/get_sections') {
        return getLibraries(res);
    } else if (req.url.startsWith('/get_section?')) {
        return getShows(req, res);
    } else if (req.url.startsWith('/get_seasons?')) {
        return getSeasons(req, res);
    } else if (req.url.startsWith('/get_episodes?')) {
        return getEpisodes(req, res);
    }

    Log.warn(req.url, 'Invalid endpoint');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Error : 'Invalid endpoint' }));
}

function jsonError(res, code, error) {
    Log.error(error, 'Unable to complete request');
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Error : error }));
}

function jsonSuccess(res, data) {
    // TMI logging, post the entire response, for verbose just indicate we succeeded.
    if (Log.getLevel() <= Log.Level.Tmi) {
        Log.tmi(data ? JSON.stringify(data) : 'true', 'Success');
    } else {
        Log.verbose(true, 'Success')
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data || { success : true }));
}

function queryIds(req, res) {
    const queryObject = URL.parse(req.url,true).query;
    let keys = queryObject.keys.split(',');

    let data = {};
    keys.forEach(key => {
        data[key] = [];
    });

    // First, get the persistent 'intro marker' id
    db.get("SELECT `id` FROM `tags` WHERE `tag_type`=12;", (err, row) => {
        if (err) {
            return jsonError(res, 400, 'Unable to find the correct tag_id');
        }

        const tag_id = row.id;
        let query = 'SELECT * FROM `taggings` WHERE `tag_id`=' + tag_id + ' AND (';
        keys.forEach(key => {
            const intKey = parseInt(key);
            if (isNaN(intKey)) {
                return jsonError(res, 400, `Invalid key given: ${key}`);
            }
            query += '`metadata_item_id`=' + intKey + ' OR ';
        });
        query = query.substring(0, query.length - 4) + ');';
        db.all(query, (err, rows) => {
            if (err) {
                return jsonError(res, 400, 'Unable to retrieve ids');
            }

            rows.forEach(row => {
                row.thumb_url += ' UTC';
                row.created_at += ' UTC';
                data[row.metadata_item_id].push(row);
            });

            jsonSuccess(res, data);
        });
    });
}

function editMarker(req, res) {
    const queryObject = URL.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    const startMs = parseInt(queryObject.start);
    const endMs = parseInt(queryObject.end);

    if (isNaN(id) || isNaN(startMs) || isNaN(endMs)) {
        return jsonError(res, 400, "invalid parameters");
    }

    db.get("SELECT * FROM `taggings` WHERE `id`=" + id + ";", (err, currentMarker) => {
        if (err || !currentMarker || currentMarker.text != 'intro') {
            return jsonError(res, 400, err | 'Intro marker not found');
        }

        const oldIndex = currentMarker.index;

        // Get all markers to adjust indexes if necessary
        db.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=?", [currentMarker.metadata_item_id, currentMarker.tag_id], (err, rows) => {
            if (err) {
                return jsonError(res, 400, err);
            }

            Log.verbose(`Markers for this episode: ${rows.length}`);

            let allMarkers = rows;
            allMarkers.sort((a, b) => a.index - b.index);
            allMarkers[oldIndex].time_offset = startMs;
            allMarkers[oldIndex].end_time_offset = endMs;
            allMarkers.sort((a, b) => a.time_offset - b.time_offset);
            let sameIndex = true;
            let newIndex = 0;

            for (let index = 0; index < allMarkers.length; ++index) {
                let marker = allMarkers[index];
                if (marker.end_time_offset >= startMs && marker.time_offset <= endMs && marker.id != id) {
                    // Overlap, this should be handled client-side
                    return jsonError(res, 400, 'Overlapping markers. The existing marker should be expanded to include this range instead.');
                }

                if (marker.id == id) {
                    newIndex = index;
                }

                marker.newIndex = index;
                sameIndex = sameIndex && marker.newIndex == marker.index;
            }

            // Use startMs.toString() to ensure we properly set '0' instead of a blank value if we're starting at the very beginning of the file
            db.run('UPDATE `taggings` SET `index`=?, `time_offset`=?, `end_time_offset`=?, `thumb_url`=CURRENT_TIMESTAMP WHERE `id`=?;', [newIndex, startMs.toString(), endMs, id], (err) => {
                if (err) {
                    return jsonError(res, 400, err);
                }

                for (const marker of allMarkers) {
                    if (marker.index != marker.newIndex) {

                        // Fire and forget. Fingers crossed this does the right thing.
                        db.run("UPDATE `taggings` SET `index`=? WHERE `id`=?;", [marker.newIndex, marker.id]);
                    }
                }
    
                return jsonSuccess(res, { metadata_id : currentMarker.metadata_item_id, marker_id : id, time_offset : startMs, end_time_offset : endMs, index : newIndex });
            });

        });
    });
}

function addMarker(req, res) {
    const queryObject = URL.parse(req.url, true).query;
    const metadataId = parseInt(queryObject.metadataId);
    const startMs = parseInt(queryObject.start);
    const endMs = parseInt(queryObject.end);

    if (isNaN(metadataId) || isNaN(startMs) || isNaN(endMs)) {
        return jsonError(res, 400, "Invalid parameters");
    }

    if (startMs >= endMs) {
        return jsonError(res, 400, "Start time must be less than end time.");
    }

    db.get("SELECT `id` FROM `tags` WHERE `tag_type`=12;", (err, row) => {
        if (err) {
            return jsonError(res, 400, 'Unable to find the correct tag_id');
        }

        const tagId = row.id;
        db.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=? ORDER BY `index` ASC;", [metadataId, tagId], (err, rows) => {
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
            
            db.run("INSERT INTO `taggings` (`metadata_item_id`, `tag_id`, `index`, `text`, `time_offset`, `end_time_offset`, `thumb_url`, `created_at`, `extra_data`) " +
                        "VALUES (?, ?, ?, 'intro', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'pv%3Aversion=5')", [metadataId, tagId, newIndex, startMs, endMs], (err) => {
                if (err) {
                    return jsonError(res, 400, err);
                }

                // Insert succeeded, update indexes of other markers if necessary
                for (const marker of allMarkers) {
                    if (marker.index != marker.newIndex) {

                        // Fire and forget. Fingers crossed this does the right thing.
                        db.run("UPDATE `taggings` SET `index`=? WHERE `id`=?;", [marker.newIndex, marker.id]);
                    }
                }

                // Return our new values directly from the table
                db.get("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=? AND `time_offset`=?;", [metadataId, tagId, startMs], (err, row) => {
                    if (err) {
                        // We still succeeded, but failed to get the right data after it was inserted?
                        return jsonSuccess(res);
                    }

                    // Times are stored as UTC, but don't say they are.
                    row.thumb_url += ' UTC';
                    row.created_at += ' UTC';

                    jsonSuccess(res, row);
                });
            });
        });
    });
}

function deleteMarker(req, res) {
    const queryObject = URL.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    if (isNaN(id)) {
        return jsonError(res, 400, "Invalid marker ID");
    }

    db.get("SELECT * FROM `taggings` WHERE `id`=?", [id], (err, row) => {
        if (err || !row || row.text != 'intro') {
            return jsonError(res, 400, "Could not find intro marker");
        }

        db.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=?;", [row.metadata_item_id, row.tag_id], (err, rows) => {
            if (err) {
                return jsonError(res, 400, "Could not retrieve intro markers for possible rearrangement");
            }

            let deleteIndex = 0;
            for (const row of rows) {
                if (row.id == id) {
                    deleteIndex = row.index;
                }
            }

            const allMarkers = rows;

            // Now that we're done rearranging, delete the original tag.
            db.run("DELETE FROM `taggings` WHERE `id`=?", [id], (err) => {
                if (err) {
                    return jsonError(res, 500, 'Failed to delete intro marker');
                }

                // If deletion was successful, now we can check to see whether we need to rearrange indexes to keep things contiguous
                if (deleteIndex < rows.length - 1) {

                    // Fire and forget, hopefully it worked, but it _shouldn't_ be the end of the world if it doesn't.
                    for (const marker of allMarkers) {
                        if (marker.index > deleteIndex) {
                            db.run("UPDATE `taggings` SET `index`=? WHERE `id`=?;", [marker.index - 1, marker.id]);
                        }
                    }
                }
                return jsonSuccess(res, { metadata_id : row.metadata_item_id, marker_id : id });
            });
        });
    });
}

function getLibraries(res) {
    db.all("Select `id`, `name` FROM `library_sections` WHERE `section_type`=?", [2], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve library sections.");
        }

        let result = [];
        for (const row of rows) {
            result.push({ id : row.id, name : row.name });
        }

        return jsonSuccess(res, result);
    });
}

function getShows(req, res) {
    const queryObject = URL.parse(req.url, true).query;
    const id = parseInt(queryObject.id);

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

    db.all(query, [id], (err, rows) => {
        if (err) {
            return jsonError(res, 400, `Could not retrieve shows from the database`);
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

function getSeasons(req, res) {
    const queryObject = URL.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    const query =
'SELECT seasons.id, seasons.title, seasons.`index`, COUNT(episodes.id) AS episode_count FROM metadata_items seasons\n\
     INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.id\n\
     WHERE seasons.parent_id=?\n\
 GROUP BY seasons.id\n\
 ORDER BY seasons.`index` ASC;'

    db.all(query, [id], (err, rows) => {
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

function getEpisodes(req, res) {
    const queryObject = URL.parse(req.url, true).query;
    const id = parseInt(queryObject.id);

    // Grab episodes for the given season.
    // Multiple joins to grab the season name, show name, and episode duration (MIN so that we don't go beyond the length of the shortest episode version to be safe).
    const query = `
SELECT e.title AS title, e.\`index\` AS \`index\`, e.id AS id, p.title AS season, p.\`index\` AS season_index, g.title AS show, MIN(m.duration) AS duration, COUNT(e.id) AS parts FROM metadata_items e
    INNER JOIN metadata_items p ON e.parent_id=p.id
    INNER JOIN metadata_items g ON p.parent_id=g.id
    INNER JOIN media_items m ON e.id=m.metadata_item_id
WHERE e.parent_id=?
GROUP BY e.id;`;

    db.all(query, [id], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve episodes from the database.");
        }

        let episodes = [];
        for (const episode of rows) {
            episodes.push({
                title : episode.title,
                index : episode.index,
                seasonName : episode.season,
                seasonIndex : episode.season_index,
                showName : episode.show,
                metadataId : episode.id,
                duration : episode.duration,
            });
        }

        return jsonSuccess(res, episodes);
    });
}