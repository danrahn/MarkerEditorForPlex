import Sqlite3 from 'sqlite3';

import ServerError from './ServerError.js';

/**
 * @typedef {(number|string|boolean|null)[]} DbArrayParameters
 * @typedef {{ _asRaw: Set<string>?, [parameter: string]: number|string|boolean|null }} DbDictParameters
 * @typedef {DbArrayParameters|DbDictParameters} DbQueryParameters
 */

/** @typedef {Sqlite3.Database} Database */

/**
 * Create and return a connection to an Sqlite3 database.
 * @param {string} path The path to the database.
 * @param {boolean} allowCreate Determines whether we're okay with creating a new database if it doesn't exist.
 * @returns {Promise<SqliteDatabase>} */
function OpenSqlite3Database(path, allowCreate) {
    const openFlags = Sqlite3.OPEN_READWRITE | (allowCreate ? Sqlite3.OPEN_CREATE : 0);
    return new Promise((resolve, _) => {
        const db = new Sqlite3.Database(path, openFlags, (err) => {
            if (err) { throw new ServerError(err.message, 500); }

            resolve(db);
        });
    });
}

/**
 * A wrapper around a Sqlite3 database that allows for async/await interaction,
 * something that can't be done with the base database as it's async
 * implementation is callback-based.
 */
class SqliteDatabase {
    /**
     * Return a new database wrapper for the database at the given path.
     * @param {string} path The path to the database.
     * @param {boolean} allowCreate Determines whether we're okay with create a new database if it doesn't exist.
     * @returns {Promise<SqliteDatabase>} */
    static async OpenDatabase(path, allowCreate) {
        return new SqliteDatabase(await OpenSqlite3Database(path, allowCreate));
    }

    /** @type {Database} */
    #db;

    /**
     * Construct a new database wrapper
     * @param {Database} database */
    constructor(database) {
        this.#db = database;
    }

    /**
     * Run the given query, returning no rows.
     * @param {string} query
     * @param {DbQueryParameters} [parameters=[]]
     * @returns {Promise<void>} */
    run(query, parameters=[]) {
        return this.#action(this.#db.run.bind(this.#db), query, parameters);
    }

    /**
     * Retrieves a single row from the given query.
     * @param {string} query
     * @param {DbQueryParameters} [parameters=[]]
     * @returns {Promise<any>} */
    get(query, parameters=[]) {
        return this.#action(this.#db.get.bind(this.#db), query, parameters);
    }

    /**
     * Retrieves all rows from the given query.
     * @param {string} query
     * @param {DbQueryParameters} parameters
     * @returns {Promise<any[]>} */
    all(query, parameters=[]) {
        return this.#action(this.#db.all.bind(this.#db), query, parameters);
    }

    /**
     * Execute the given statement(s).
     * @param {string} query
     * @returns {Promise<undefined>} */
    exec(query) {
        return this.#action(this.#db.exec.bind(this.#db), query, null /*parameters*/);
    }

    /** Closes the underlying database connection. */
    close() {
        return new Promise((resolve, _) => {
            this.#db.close((err) => {
                if (err) { throw ServerError.FromDbError(err); }

                resolve();
            });
        });
    }

    /**
     * Perform a database action and return a Promise
     * instead of dealing with callbacks.
     * @param {(sql : string, ...args : any) => Database} fn
     * @param {string} query
     * @param {DbQueryParameters|null} parameters
     * @returns {Promise<any>} */
    #action(fn, query, parameters=null) {
        return new Promise(resolve => {
            const callback = (err, result) => {
                if (err) { throw new ServerError.FromDbError(err); }

                resolve(result);
            };

            parameters === null ? fn(query, callback) : fn(query, parameters, callback);
        });
    }

    /**
     * Parameterize the given query. It is simple by design, and has known flaws if used outside
     * of the expected use-case, but it's slightly safer than writing raw queries and hoping for
     * the best, which is currently the case for exec, as it doesn't accept parameterized queries
     * @param {string} query Query with a '?' for each parameter.
     * @param {DbQueryParameters} parameters The parameters to insert. Only expects numbers and strings
     * @throws {ServerError} If there are too many or too few parameters, or if there's a non-number/string parameter. */
    static parameterize(query, parameters) {
        if (parameters instanceof Array) {
            return SqliteDatabase.#parameterizeArray(query, parameters);
        }

        if (!(parameters instanceof Object)) {
            throw new ServerError(`Cannot parameterize query, expected an array or object of parameters`);
        }

        return SqliteDatabase.#parameterizeNamed(query, parameters);
    }


    /**
     * Parameterize the given query of unnamed parameters.
     * @param {DbArrayParameters} parameters The parameters to insert. Only expects numbers and strings
     * @throws {ServerError} If there are too many or too few parameters, or if there's a non-number/string parameter. */
    static #parameterizeArray(query, parameters) {
        let startSearch = 0;
        let newQuery = '';
        for (const parameter of parameters) {
            const idx = query.indexOf('?', startSearch);
            if (idx === -1) {
                throw new ServerError(`Unable to parameterize query, not enough '?'!`, 500);
            }

            newQuery += query.substring(startSearch, idx);
            if (typeof parameter === 'string') {
                newQuery += `"${parameter.replaceAll('"', '""')}"`;
            } else if (typeof parameter === 'number') {
                newQuery += parameter.toString();
            } else if (typeof parameter === 'boolean') {
                newQuery += parameter ? '1' : '0';
            } else if (parameter === null) {
                // Allow null, since that's more likely to be intentional than undefined.
                newQuery += 'NULL';
            } else {
                throw new ServerError(
                    `Unable to parameterize query, only expected strings and numbers, found ${typeof parameter}`,
                    500);
            }

            startSearch = idx + 1;
        }

        if (startSearch < query.length) {
            if (query.indexOf('?', startSearch) !== -1) {
                throw new ServerError(`Unable to parameterize query, too many '?'!`, 500);
            }

            newQuery += query.substring(startSearch);
        }

        return newQuery;
    }

    /**
     * Parameterize the given query of named parameters.
     * @param {string} query The query with named parameter placeholders.
     * @param {DbDictParameters} parameters The parameters to insert. Only expects number, string, bool
     * @throws {ServerError} If there are too many or too few parameters, or if there's a non-number/string parameter. */
    static #parameterizeNamed(query, parameters) {
        let newQuery = query;
        let asRaw = new Set();
        if (parameters._asRaw) {
            asRaw = parameters._asRaw;
            delete parameters._asRaw;
        }

        for (const [parameter, value] of Object.entries(parameters)) {
            const regexFind = new RegExp(`\\${parameter}\\b`, 'g');
            if (!regexFind.test(newQuery)) {
                throw new ServerError(`Unable to parameterize query, parameter "${parameter}" not found!`, 500);
            }

            let escapedValue = value;
            if (!asRaw.has(parameter)) {
                if (typeof value === 'string') {
                    escapedValue = `"${value.replaceAll('"', '""')}"`;
                } else if (typeof value === 'number') {
                    escapedValue = value.toString();
                } else if (typeof value === 'boolean') {
                    escapedValue = value ? '1' : '0';
                } else if (value === null) {
                    // Allow null, since that's more likely to be intentional than undefined.
                    escapedValue = 'NULL';
                } else {
                    throw new ServerError(
                        `Unable to parameterize query, only expected strings and numbers, found ${typeof parameter}`,
                        500);
                }
            }

            newQuery = newQuery.replaceAll(regexFind, escapedValue);
        }

        return newQuery;
    }
}

export default SqliteDatabase;
