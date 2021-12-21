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
    if (req.url == '/config.json') {
        handleGet(req, res);
        return;
    }

    if (req.url.startsWith('/query?')) {
        return queryIds(req, res);
    } else if (req.url.startsWith('/edit?')) {
        return editMarker(req, res);
    } else if (req.url.startsWith('/add?')) {
        return addMarker(req, res);
    } else if (req.url.startsWith('/delete?')) {
        return deleteMarker(req, res);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end('{ "success" : true }');
}

function jsonError(res, code, error) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Error : error }));
}

function jsonSuccess(res) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success : true }));
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
    let id = parseInt(queryObject.id);
    let startMs = parseInt(queryObject.start);
    let endMs = parseInt(queryObject.end);

    if (isNaN(id) || isNaN(startMs) || isNaN(endMs)) {
        return jsonError(res, 400, "invalid parameters");
    }

    let db = new sqlite3.Database(config.database);
    db.get("SELECT * FROM `taggings` WHERE `id`=" + id + ";", (err, row) => {
        if (err || !row || row.text != 'intro') {
            return jsonError(res, 400, err | 'Intro marker not found');
        }

        // Use startMs.toString() to ensure we properly set '0' instead of a blank value if we're starting at the very beginning of the file
        db.run('UPDATE `taggings` SET `time_offset`=?, `end_time_offset`=?, `thumb_url`=CURRENT_TIMESTAMP WHERE `id`=?;', [startMs.toString(), endMs, id], (err) => {
            if (err) {
                return jsonError(res, 400, err);
            }

            return jsonSuccess(res);
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

            // There shouldn't be any gaps, but be safe and just use max + 1
            let index = 0;
            rows.forEach(row => {
                console.log(row);
                index = Math.max(index, row.index + 1);
            });
            
            db.run("INSERT INTO `taggings` (`metadata_item_id`, `tag_id`, `index`, `text`, `time_offset`, `end_time_offset`, `thumb_url`, `created_at`, `extra_data`) " +
                        "VALUES (?, ?, ?, 'intro', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'pv%3Aversion=5')", [metadataId, tagId, index, startMs, endMs], (err) => {
                if (err) {
                    return jsonError(res, 400, err);
                }

                // Return our new values directly from the table
                db.get("SELECT * FROM `taggings` WHERE `metadata_item_id`=? AND `tag_id`=? AND `index`=?;", [metadataId, tagId, index], (err, row) => {
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

        db.run("DELETE FROM `taggings` WHERE `id`=?", [id], (err) => {
            if (err) {
                return jsonError(res, 500, 'Failed to delete intro marker');
            }

            return jsonSuccess(res);
        });
    });
}