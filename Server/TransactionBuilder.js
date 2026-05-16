import { ContextualLog } from '../Shared/ConsoleLog.js';

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
    async exec() {
        if (this.empty()) {
            return;
        }

        Log.tmi(this.toString(), `Running transaction`);

        await this.#db.exec(`BEGIN TRANSACTION;`);
        try {
            for (const command of this.#commands) {
                await this.#db.run(command.statement, command.parameters);
            }

            await this.#db.exec(`COMMIT TRANSACTION;`);
        } catch (err) {
            try {
                await this.#db.exec(`ROLLBACK TRANSACTION;`);
            } catch (rollbackErr) {
                Log.warn(rollbackErr.message, `Rollback failed after transaction error.`);
            }

            throw err;
        }
    }
}

export default TransactionBuilder;
