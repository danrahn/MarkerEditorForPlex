import BetterSqlite3 from 'better-sqlite3';

import ServerError from './ServerError.js';

/**
 * @typedef {number|string|boolean|null} DbScalarParameter
 * @typedef {(number|string|boolean|null)[]} DbArrayParameters
 * @typedef {{ [parameter: string]: number|string|boolean|null }} DbDictParameters
 * @typedef {DbArrayParameters|DbDictParameters|DbScalarParameter} DbQueryParameters
 * @typedef {string|number|object|boolean|null|undefined} AnythingButAPromise
 */

/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('better-sqlite3').Statement} Statement */

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
 * A wrapper around an sqlite database.
 *
 * Callers can still use async/await with this API, but methods now execute
 * synchronously and return values directly.
 */
class SqliteDatabase {
    /**
     * Return a new database wrapper for the database at the given path.
     * @param {string} path The path to the database.
     * @param {boolean} allowCreate Determines whether we're okay with create a new database if it doesn't exist.
     * @returns {SqliteDatabase} */
    static OpenDatabase(path, allowCreate) {
        return new SqliteDatabase(OpenSqliteDatabase(path, allowCreate));
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
     * @returns {void} */
    run(query, parameters=[]) {
        return this.#action(query, parameters, 'run');
    }

    /**
     * Retrieves a single row from the given query.
     * @param {string} query
     * @param {DbQueryParameters} [parameters=[]]
     * @returns {AnythingButAPromise} */
    get(query, parameters=[]) {
        return this.#action(query, parameters, 'get');
    }

    /**
     * Retrieves all rows from the given query.
     * @param {string} query
     * @param {DbQueryParameters} parameters
     * @returns {AnythingButAPromise[]} */
    all(query, parameters=[]) {
        return this.#action(query, parameters, 'all');
    }

    /**
     * Execute the given statement(s).
     * @param {string} query
     * @returns {undefined} */
    exec(query) {
        return this.#action(query, null /*parameters*/, 'exec');
    }

    /**
     * Prepare the given statement for repeated execution.
     * @param {string} query
     * @returns {Statement} */
    prepare(query) {
        try {
            return this.#db.prepare(query);
        } catch (err) {
            throw ServerError.FromDbError(err);
        }
    }

    /**
     * Execute a pre-prepared statement with the given parameters.
     * @param {Statement} statement
     * @param {DbQueryParameters|undefined} [parameters=[]] */
    runPrepared(statement, parameters=[]) {
        try {
            this.#invoke(statement.run.bind(statement), parameters);
        } catch (err) {
            throw ServerError.FromDbError(err);
        }
    }

    /** Closes the underlying database connection. */
    close() {
        try {
            this.#db.close();
        } catch (err) {
            throw ServerError.FromDbError(err);
        }
    }

    /**
     * Perform a database action.
     * @param {string} query
     * @param {DbQueryParameters|null} parameters
     * @param {'run'|'get'|'all'|'exec'} action
     * @returns {*} */
    #action(query, parameters, action) {
        try {
            if (action === 'exec') {
                this.#db.exec(query);
                return undefined;
            }

            const statement = this.#db.prepare(query);
            const execute = statement[action].bind(statement);
            const result = this.#invoke(execute, parameters);
            return action === 'run' ? undefined : result;
        } catch (err) {
            throw ServerError.FromDbError(err);
        }
    }

    /**
     * Invoke the given statement with normalized parameter input.
     * @param {(...args: any[]) => *} fn
     * @param {DbQueryParameters|null|undefined} parameters */
    #invoke(fn, parameters) {
        if (parameters === undefined) {
            return fn();
        }

        if (parameters instanceof Array) {
            return fn(...parameters.map(SqliteDatabase.#normalizeParameterValue));
        }

        if (parameters !== null && typeof parameters === 'object') {
            /** @type {DbDictParameters} */
            const normalized = {};
            for (const [parameter, value] of Object.entries(parameters)) {
                normalized[parameter] = SqliteDatabase.#normalizeParameterValue(value);
            }

            return fn(normalized);
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
}

export default SqliteDatabase;
