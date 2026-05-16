import { ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';

/** @typedef {!import('./SqliteDatabase.js').default} SqliteDatabase */
/** @typedef {!import('./SqliteDatabase.js').DbQueryParameters} DbQueryParameters */

/** @typedef {{ statement: string, parameters: DbQueryParameters }} DbTransactionCommand */

const Log = ContextualLog.Create('SQLiteTxn');

class TransactionBuilder {
    /** @type {DbTransactionCommand[]} */
    #commands = [];
    /** @type {SqliteDatabase} */
    #db;
    /** @type {string|undefined} */
    #cache;

    /**
     * @param {SqliteDatabase} database */
    constructor(database) {
        this.#db = database;
    }

    /**
     * Adds the given statement to the current transaction.
     * @param {string} statement A single SQL query
     * @param {DbQueryParameters} parameters Query parameters */
    addStatement(statement, parameters=[]) {
        statement = statement.trim();
        if (statement[statement.length - 1] !== ';') {
            statement += ';';
        }

        this.#commands.push({ statement, parameters });
        this.#cache = null;
    }

    empty() { return this.#commands.length === 0; }
    reset() { this.#commands = []; this.#cache = null; }
    statementCount() { return this.#commands.length; }
    toString() {
        if (this.#cache) {
            return this.#cache;
        }

        this.#cache = `BEGIN TRANSACTION;\n`;
        for (const command of this.#commands) {
            this.#cache += `${command.statement}\n`;

            if (command.parameters instanceof Array ? command.parameters.length > 0 : !!command.parameters) {
                this.#cache += `-- Parameters: ${JSON.stringify(command.parameters)}\n`;
            }
        }

        this.#cache += `COMMIT TRANSACTION;`;
        return this.#cache;
    }

    /**
     * Executes the current transaction.*/
    exec() {
        if (this.empty()) {
            return;
        }

        if (Log.getLevel() <= ConsoleLog.Level.TMI) {
            Log.tmi(this.toString(), `Running transaction`);
        }

        /** @type {Map<string, import('better-sqlite3').Statement>} */
        const statementCache = new Map();

        this.#db.exec(`BEGIN TRANSACTION;`);
        try {
            for (const command of this.#commands) {
                let statement = statementCache.get(command.statement);
                if (!statement) {
                    statement = this.#db.prepare(command.statement);
                    statementCache.set(command.statement, statement);
                }

                this.#db.runPrepared(statement, command.parameters);
            }

            this.#db.exec(`COMMIT TRANSACTION;`);
        } catch (err) {
            try {
                this.#db.exec(`ROLLBACK TRANSACTION;`);
            } catch (rollbackErr) {
                Log.warn(rollbackErr.message, `Rollback failed after transaction error.`);
            }

            throw err;
        }
    }
}

export default TransactionBuilder;
