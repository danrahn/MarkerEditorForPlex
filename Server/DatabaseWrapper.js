import CreateDatabase from './CreateDatabase.cjs';
import ServerError from './ServerError.js';

/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */

/**
 * A wrapper around a Sqlite3 database that allows for async/await interaction,
 * something that can't be done with the base database as it's async
 * implementation is callback-based.
 */
class DatabaseWrapper {
    /**
     * Return a new database wrapper for the database at the given path.
     * @param {string} path The path to the database.
     * @param {boolean} allowCreate Determines whether we're okay with create a new database if it doesn't exist.
     * @returns {Promise<DatabaseWrapper>} */
    static async CreateDatabase(path, allowCreate) {
        return new DatabaseWrapper(await CreateDatabase(path, allowCreate));
    }

    /** @type {SqliteDatabase} */
    #db;

    /**
     * Construct a new database wrapper
     * @param {SqliteDatabase} database */
    constructor(database) {
        this.#db = database;
    }

    /**
     * Run the given query, returning no rows.
     * @param {string} query
     * @param {[*]} [parameters=[]]
     * @returns {Promise<void>} */
    async run(query, parameters=[]) {
        return this.#action(this.#db.run.bind(this.#db), query, parameters);
    }

    /**
     * Retrieves a single row from the given query.
     * @param {string} query
     * @param {[*]} [parameters=[]]
     * @returns {Promise<any>} */
    async get(query, parameters=[]) {
        return this.#action(this.#db.get.bind(this.#db), query, parameters);
    }

    /**
     * Retrieves all rows from the given query.
     * @param {string} query
     * @param {[*]} parameters
     * @returns {Promise{any[]}} */
    async all(query, parameters=[]) {
        return this.#action(this.#db.all.bind(this.#db), query, parameters);
    }

    /**
     * Execute the given statement(s).
     * @param {string} query
     * @returns {Promise<undefined>} */
    async exec(query) {
        return this.#action(this.#db.exec.bind(this.#db), query, null /*parameters*/);
    }

    /** Closes the underlying database connection. */
    async close() {
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
     * @param {*} parameters
     * @returns {Promise<any>} */
    async #action(fn, query, parameters=null) {
        return new Promise((resolve, _) => {
            const callback = (err, result) => {
                if (err) { throw ServerError.FromDbError(err); }

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
     * @param {[number|string]|{[parameter: string]: number|string}} parameters The parameters to insert. Only expects numbers and strings
     * @throws {ServerError} If there are too many or too few parameters, or if there's a non-number/string parameter. */
    static parameterize(query, parameters) {
        if (parameters instanceof Array) {
            return DatabaseWrapper.#parameterizeArray(query, parameters);
        } else {
            if (!(parameters instanceof Object)) {
                throw new ServerError(`Cannot parameterize query, expected an array or object of parameters`);
            }

            return DatabaseWrapper.#parameterizeNamed(query, parameters);
        }
    }


    /**
     * Parameterize the given query of unnamed parameters.
     * @param {[number|string]} parameters The parameters to insert. Only expects numbers and strings
     * @throws {ServerError} If there are too many or too few parameters, or if there's a non-number/string parameter. */
    static #parameterizeArray(query, parameters) {
        let startSearch = 0;
        let newQuery = '';
        for (const parameter of parameters) {
            const idx = query.indexOf('?', startSearch);
            if (idx == -1) {
                throw new ServerError(`Unable to parameterize query, not enough '?'!`, 500);
            }

            newQuery += query.substring(startSearch, idx);
            if (typeof parameter === 'string') {
                newQuery += `"${parameter.replaceAll('"', '""')}"`;
            } else if (typeof parameter === 'number') {
                newQuery += parameter.toString();
            } else if (typeof parameter === 'boolean') {
                newQuery += parameter ? '1' : '0';
            } else {
                throw new ServerError(`Unable to parameterize query, only expected strings and numbers, found ${typeof parameter}`, 500);
            }

            startSearch = idx + 1;
        }

        if (startSearch < query.length) {
            if (query.indexOf('?', startSearch) != -1) {
                throw new ServerError(`Unable to parameterize query, too many '?'!`, 500);
            }

            newQuery += query.substring(startSearch);
        }

        return newQuery;
    }

    /**
     * Parameterize the given query of named parameters.
     * @param {string} query The query with named parameter placeholders.
     * @param {{[parameterName: string]: number|string|boolean}} parameters The parameters to insert. Only expects number, string, bool
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
                throw new ServerError(`Unable to parameterize query, parameter "${parameter}" not found!`);
            }

            let escapedValue = value;
            if (!asRaw.has(parameter)) {
                if (typeof value === 'string') {
                    escapedValue = `"${value.replaceAll('"', '""')}"`;
                } else if (typeof value === 'number') {
                    escapedValue = value.toString();
                } else if (typeof value === 'boolean') {
                    escapedValue = value ? '1' : '0';
                } else {
                    // Allow null, since that's more likely to be intentional than undefined.
                    if (value === null) {
                        escapedValue = 'NULL';
                    } else {
                        throw new ServerError(
                            `Unable to parameterize query, only expected strings and numbers, found ${typeof parameter}`,
                            500);
                    }
                }
            }

            newQuery = newQuery.replaceAll(regexFind, escapedValue);
        }

        return newQuery;
    }
}

export default DatabaseWrapper;
