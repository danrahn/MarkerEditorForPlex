import BetterSqlite3 from 'better-sqlite3';

import ServerError from './ServerError.js';

/**
 * @typedef {number|string|boolean|null} DbScalarParameter
 * @typedef {(number|string|boolean|null)[]} DbArrayParameters
 * @typedef {{ _asRaw: Set<string>?, [parameter: string]: number|string|boolean|null }} DbDictParameters
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
     * @param {DbQueryParameters|null} parameters */
    #invoke(fn, parameters) {
        if (parameters === null || parameters === undefined) {
            return fn();
        }

        if (parameters instanceof Array) {
            return fn(...parameters);
        }

        if (typeof parameters === 'object') {
            return fn(SqliteDatabase.#normalizeNamedParameters(parameters));
        }

        return fn(parameters);
    }

    /**
     * better-sqlite3 expects named parameter object keys without a prefix,
     * while existing call sites generally provide '$name'.
     * TODO: Fixup call sites and remove this normalization step.
     * @param {DbDictParameters} parameters
     * @returns {{ [parameter: string]: number|string|boolean|null }} */
    static #normalizeNamedParameters(parameters) {
        /** @type {{ [parameter: string]: number|string|boolean|null }} */
        const normalized = {};
        for (const [parameter, value] of Object.entries(parameters)) {
            if (parameter === '_asRaw') {
                continue;
            }

            if (/^[$@:]/.test(parameter)) {
                normalized[parameter.substring(1)] = value;
            } else {
                normalized[parameter] = value;
            }
        }

        return normalized;
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
                newQuery += `'${parameter.replaceAll("'", "''")}'`;
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
                    escapedValue = `'${value.replaceAll("'", "''")}'`;
                } else if (typeof value === 'number') {
                    escapedValue = value.toString();
                } else if (typeof value === 'boolean') {
                    escapedValue = value ? '1' : '0';
                } else if (value === null) {
                    // Allow null, since that's more likely to be intentional than undefined.
                    escapedValue = 'NULL';
                } else {
                    throw new ServerError(
                        `Unable to parameterize query, only expected strings and numbers, found ${typeof value}`,
                        500);
                }
            }

            newQuery = newQuery.replaceAll(regexFind, escapedValue);
        }

        return newQuery;
    }
}

export default SqliteDatabase;
