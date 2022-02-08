const http = require('http');
const fs = require('fs').promises;
const mime = require('mime-types');
const sqlite3 = require('sqlite3');
const url = require('url');

const config = require('./config.json');

const hostname = 'localhost';
const port = 3232;

const server = http.createServer((req, res) => {
    console.log(`${req.method}: ${req.url}`);
    const method = req.method?.toLowerCase();

    if (req.url.toLowerCase().indexOf('node_modules') != -1
        || req.url.lastIndexOf('/') > 0) {
        return error(404, res);
    }

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
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}`);
});

function error(code, res) {
    res.statusCode = code;
    res.end('Error');
}

function handleGet(req, res)
{
    let url = req.url;
    if (url == '/') {
        url = '/index.html';
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

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Error : 'Invalid endpoint' }));
}

function jsonError(res, code, error) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Error : error }));
}

function jsonSuccess(res, data) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data || { success : true }));
}

function queryIds(req, res) {
    const queryObject = url.parse(req.url,true).query;
    let keys = queryObject.keys.split(',');

    let data = {};
    keys.forEach(key => {
        data[key] = [];
    });
    let db = new sqlite3.Database(config.database);

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
                data[row.metadata_item_id].push(row);
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        });
    });
    db.close();
}

function editMarker(req, res) {
    const queryObject = url.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    const startMs = parseInt(queryObject.start);
    const endMs = parseInt(queryObject.end);

    if (isNaN(id) || isNaN(startMs) || isNaN(endMs)) {
        return jsonError(res, 400, "invalid parameters");
    }

    let db = new sqlite3.Database(config.database);
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

            console.log(`Markers for this episode: ${rows.length}`);

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
    
                return jsonSuccess(res, { time_offset : startMs, end_time_offset : endMs, index : newIndex });
            });

        });
    });
    db.close();
}

function addMarker(req, res) {
    // TODO: Do marker indexes have to be in order from earliest to latest? Should probably order/UPDATE regardless so it's cleaner.
    // TODO: Client-side, detect if a new marker overlaps with another, and ask if they want to expand the existing marker instead (and check multiple overlaps)
    const queryObject = url.parse(req.url, true).query;
    const metadataId = parseInt(queryObject.metadataId);
    const startMs = parseInt(queryObject.start);
    const endMs = parseInt(queryObject.end);

    if (isNaN(metadataId) || isNaN(startMs) || isNaN(endMs)) {
        return jsonError(res, 400, "Invalid parameters");
    }

    if (startMs >= endMs) {
        return jsonError(res, 400, "Start time must be less than end time.");
    }

    let db = new sqlite3.Database(config.database);
    db.get("SELECT `id` FROM `tags` WHERE `tag_type`=12;", (err, row) => {
        if (err) {
            return jsonError(res, 400, 'Unable to find the correct tag_id');
        }

        const tagId = row.id;
        db.all("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=?", [metadataId, tagId], (err, rows) => {
            if (err) {
                return jsonError(res, 400, err);
            }

            let allMarkers = rows;
            let newIndex = 0;
            allMarkers.sort((a, b) => a.time_offset - b.time_offset);
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

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(row));
                });
            });
        });
    });
    db.close();
}

function deleteMarker(req, res) {
    // TODO: Recheck indexes on delete and adjust if necessary to avoid gaps.
    const queryObject = url.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    if (isNaN(id)) {
        return jsonError(res, 400, "Invalid marker ID");
    }

    let db = new sqlite3.Database(config.database);
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
                return jsonSuccess(res);
            });
        });
    });
}

function getLibraries(res) {
    let db = new sqlite3.Database(config.database);
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
    const queryObject = url.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    let db = new sqlite3.Database(config.database);
    db.all("SELECT `id`, `title`, `title_sort`, `original_title` FROM `metadata_items` WHERE `library_section_id`=? AND `metadata_type`=?;", [id, 2], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve shows from the database");
        }

        let shows = [];
        for (const show of rows) {
            shows.push({
                title : show.title,
                titleSearch : show.title.toLowerCase().replace(/[\s,'"_\-!?]/g, ''),
                sort : show.title.toLowerCase() != show.title_sort.toLowerCase() ? show.title_sort.toLowerCase().replace(/[\s,'"_\-!?]/g, '') : '',
                original : show.original_title ? show.original_title.toLowerCase().replace(/[\s,'"_\-!?]/g, '') : '',
                metadataId : show.id,
            });
        }

        return jsonSuccess(res, shows);
    });
}

function getSeasons(req, res) {
    const queryObject = url.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    let db = new sqlite3.Database(config.database);
    db.all("SELECT `id`, `title`, `index` FROM `metadata_items` WHERE `parent_id`=? ORDER BY `index` ASC;", [id], (err, rows) => {
        if (err) {
            return jsonError(res, 400, "Could not retrieve seasons from the database.");
        }

        let seasons = [];
        for (const season of rows) {
            seasons.push({
                index : season.index,
                title : season.title,
                metadataId : season.id,
            });
        }

        return jsonSuccess(res, seasons);
    })
}

function getEpisodes(req, res) {
    const queryObject = url.parse(req.url, true).query;
    const id = parseInt(queryObject.id);
    let db = new sqlite3.Database(config.database);
    const query = `
SELECT e.title AS title, e.\`index\` AS \`index\`, e.id AS id, p.title AS season, p.\`index\` AS season_index, g.title AS show FROM metadata_items e
    INNER JOIN metadata_items p ON e.parent_id=p.id
    INNER JOIN metadata_items g ON p.parent_id = g.id
WHERE e.parent_id=?;`;
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
            });
        }

        return jsonSuccess(res, episodes);
    });
}