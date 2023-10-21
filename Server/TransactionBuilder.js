import { ContextualLog } from '../Shared/ConsoleLog.js';

import DatabaseWrapper from './DatabaseWrapper.js';

/** @typedef {!import('./DatabaseWrapper').DbQueryParameters} DbQueryParameters */

const Log = new ContextualLog('SQLiteTxn');

class TransactionBuilder {
    /** @type {string[]} */
    #commands = [];
    /** @type {DatabaseWrapper} */
    #db;
    /** @type {string|undefined} */
    #cache;

    /**
     * @param {DatabaseWrapper} database */
    constructor(database) {
        this.#db = database;
    }

    /**
     * Adds the given statement to the current transaction.
     * @param {string} statement A single SQL query
     * @param {DbQueryParameters} parameters Query parameters */
    addStatement(statement, parameters=[]) {
        statement = statement.trim();
        if (statement[statement.length - 1] != ';') {
            statement += ';';
        }

        this.#commands.push(DatabaseWrapper.parameterize(statement, parameters));
        this.#cache = null;
    }

    empty() { return this.#commands.length == 0; }
    statementCount() { return this.#commands.length; }
    toString() {
        if (this.#cache) {
            return this.#cache;
        }

        this.#cache = `BEGIN TRANSACTION;\n`;
        for (const statement of this.#commands) {
            this.#cache += `${statement}\n`;
        }

        this.#cache += `COMMIT TRANSACTION;`;
        return this.#cache;
    }

    /**
     * Executes the current transaction.*/
    async exec() {
        Log.tmi(this.toString(), `Running transaction`);
        return this.#db.exec(this.toString());
    }
}

export default TransactionBuilder;
