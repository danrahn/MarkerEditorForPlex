const Sqlite3 = require('sqlite3');

/** @typedef {Sqlite3.Database} SqliteDatabase */

/**
 * Create and return a connection to an Sqlite3 database.
 * Because sqlite3 is a CommonJS module, it can't be imported via ES modules. This
 * method acts as a bridge between the two conventions to allow the rest of the application
 * to benefit from ES modules.
 * @param {string} path The path to the database.
 * @param {(err: Error) => void} callback The callback to invoke after creating the database.
 * @returns The database connection */
function CreateDatabase(path, callback) {
    return new Sqlite3.Database(path, Sqlite3.OPEN_READWRITE, callback);
}

module.exports = CreateDatabase;
