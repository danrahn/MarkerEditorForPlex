import BetterSqlite3 from 'better-sqlite3';

import ServerError from './ServerError.js';

/**
 * @typedef {number|string|boolean|null} DbScalarParameter
 * @typedef {(number|string|boolean|null)[]} DbArrayParameters
 * @typedef {{ [parameter: string]: number|string|boolean|null }} DbDictParameters
 * @typedef {DbArrayParameters|DbDictParameters|DbScalarParameter} DbQueryParameters
 */

/** @typedef {import('better-sqlite3').Database} Database */

/**
 * Create and return a connection to an sqlite database.
 * @param {string} path The path to the database.
 * @param {boolean} allowCreate Determines whether we're okay with creating a new database if it doesn't exist.
 * @returns {Database} */
function OpenSqliteDatabase(path, allowCreate) {
    try {
        return new BetterSqlite3(path, { fileMustExist : !allowCreate });
    } catch (err) {
        throw ServerError.FromDbError(err);
    }
}

/**
 * A wrapper around an sqlite database that preserves an async/await API
 * for callers while using a synchronous driver internally.
 */
class SqliteDatabase {
    /**
     * Return a new database wrapper for the database at the given path.
     * @param {string} path The path to the database.
     * @param {boolean} allowCreate Determines whether we're okay with create a new database if it doesn't exist.
     * @returns {Promise<SqliteDatabase>} */
    static OpenDatabase(path, allowCreate) {
        return Promise.resolve(new SqliteDatabase(OpenSqliteDatabase(path, allowCreate)));
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
        return this.#action(query, parameters, 'run');
    }

    /**
     * Retrieves a single row from the given query.
     * @param {string} query
     * @param {DbQueryParameters} [parameters=[]]
     * @returns {Promise<any>} */
    get(query, parameters=[]) {
        return this.#action(query, parameters, 'get');
    }

    /**
     * Retrieves all rows from the given query.
     * @param {string} query
     * @param {DbQueryParameters} parameters
     * @returns {Promise<any[]>} */
    all(query, parameters=[]) {
        return this.#action(query, parameters, 'all');
    }

    /**
     * Execute the given statement(s).
     * @param {string} query
     * @returns {Promise<undefined>} */
    exec(query) {
        return this.#action(query, null /*parameters*/, 'exec');
    }

    /** Closes the underlying database connection. */
    close() {
        try {
            this.#db.close();
            return Promise.resolve();
        } catch (err) {
            return Promise.reject(ServerError.FromDbError(err));
        }
    }

    /**
     * Perform a database action and return a Promise, which was helpful when we were
     * using the callback-based node-sqlite, but now is just to preserve promise semantics for callers.
     * TODO: Consider removing the promise wrapper, since better-sqlite3 is synchronous and this just adds overhead.
     * @param {string} query
     * @param {DbQueryParameters|null} parameters
     * @param {'run'|'get'|'all'|'exec'} action
     * @returns {Promise<any>} */
    #action(query, parameters, action) {
        return new Promise((resolve, reject) => {
            try {
                if (action === 'exec') {
                    this.#db.exec(query);
                    resolve(undefined);
                    return;
                }

                const statement = this.#db.prepare(query);
                const execute = statement[action].bind(statement);
                const result = this.#invoke(execute, parameters);
                resolve(action === 'run' ? undefined : result);
            } catch (err) {
                reject(ServerError.FromDbError(err));
            }
        });
    }

    /**
     * Invoke the given statement with normalized parameter input.
     * @param {(...args: any[]) => any} fn
     * @param {DbQueryParameters|null|undefined} parameters */
    #invoke(fn, parameters) {
        if (parameters === undefined) {
            return fn();
        }

        if (parameters instanceof Array) {
            return fn(...parameters.map(SqliteDatabase.#normalizeParameterValue));
        }

        if (parameters !== null && typeof parameters === 'object') {
            return fn(SqliteDatabase.#normalizeNamedParameters(parameters));
        }

        return fn(SqliteDatabase.#normalizeParameterValue(parameters));
    }

    /**
     * Convert JavaScript values to SQLite-compatible bind values.
     * @param {DbScalarParameter} value
     * @returns {number|string|null} */
    static #normalizeParameterValue(value) {
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }

        return value;
    }

    /**
     * better-sqlite3 expects named parameter object keys without a prefix,
     * while existing call sites generally provide '$name'.
     * TODO: Fixup call sites and remove this normalization step.
     * @param {DbDictParameters} parameters
     * @returns {{ [parameter: string]: number|string|boolean|null }} */
    static #normalizeNamedParameters(parameters) {
        /** @type {{ [parameter: string]: number|string|null }} */
        const normalized = {};
        for (const [parameter, value] of Object.entries(parameters)) {
            if (/^[$@:]/.test(parameter)) {
                normalized[parameter.substring(1)] = SqliteDatabase.#normalizeParameterValue(value);
            } else {
                normalized[parameter] = SqliteDatabase.#normalizeParameterValue(value);
            }
        }

        return normalized;
    }
}

export default SqliteDatabase;
