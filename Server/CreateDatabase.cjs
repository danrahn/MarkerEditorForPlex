const Sqlite3 = require('sqlite3');

/** @typedef {Sqlite3.Database} SqliteDatabase */

/**
 * Create and return a connection to an Sqlite3 database.
 * Because sqlite3 is a CommonJS module, it can't be imported via ES modules. This
 * method acts as a bridge between the two conventions to allow the rest of the application
 * to benefit from ES modules.
 * @param {string} path The path to the database.
 * @param {boolean} allowCreate Determines whether we're okay with creating a new database if it doesn't exist.
 * @returns {Promise<Sqlite3.Database>} */
async function CreateDatabase(path, allowCreate) {
    const openFlags = Sqlite3.OPEN_READWRITE | (allowCreate ? Sqlite3.OPEN_CREATE : 0);
    return new Promise((resolve, _) => {
        let db = new Sqlite3.Database(path, openFlags, (err) => {
            if (err) { err.code = 500; throw err; } // To avoid ServerError.js import from cjs module
            resolve(db);
        });
    });
}

module.exports = CreateDatabase;
