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
        const queryObject = url.parse(req.url,true).query;
        let keys = queryObject.keys.split(',');

        let data = {};
        keys.forEach(key => {
            data[key] = [];
        });
        let db = new sqlite3.Database(config.database);

        // First, get the persistent 'intro marker' id
        db.all("SELECT `id` FROM `tags` WHERE `tag_type`=12;", (err, rows) => {
            const tag_id = rows[0].id;
            let query = 'SELECT * FROM `taggings` WHERE `tag_id`=' + tag_id + ' AND (';
            keys.forEach(key => {
                query += '`metadata_item_id`=' + key + ' OR ';
            });
            query = query.substring(0, query.length - 4) + ');';
            db.all(query, (err, rows) => {
                rows.forEach(row => {
                    data[row.metadata_item_id].push(row);
                });

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
            });
        });
        db.close();
        return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end('{ "success" : true }');
}
