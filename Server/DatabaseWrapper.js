import ServerError from "./ServerError.js"

/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */

/**
 * A wrapper around a Sqlite3 database that allows for async/await interaction,
 * something that can't be done with the base database as it's async
 * implementation is callback-based.
 */
class DatabaseWrapper {
    /** @type {SqliteDatabase} */
    #db;

    /**
     * Construct a new database wrapper
     * @param {SqliteDatabase} database */
    constructor(database) {
        this.#db = database;
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
            }
            parameters === null ? fn(query, callback) : fn(query, parameters, callback);
        });
    }
}

export default DatabaseWrapper;
