import DatabaseWrapper from "./DatabaseWrapper.js";

class TransactionBuilder {
    /** @type {string[]} */
    #commands = [];
    /** @type {DatabaseWrapper} */
    #db;
    /** @type {string} */
    #cache;

    /**
     * @param {DatabaseWrapper} database */
    constructor(database) {
        this.#db = database;
    }

    /**
     * Adds the given statement to the current transaction.
     * @param {string} statement A single SQL query
     * @param {[*]} parameters Query parameters */
    addStatement(statement, parameters) {
        statement = statement.trim();
        if (statement[statement.length - 1] != ';') {
            statement += ';';
        }

        this.#commands.push(DatabaseWrapper.parameterize(statement, parameters));
        this.#cache = null;
    }

    empty() { return this.#commands.length == 0; }
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
        return this.#db.exec(this.toString());
    }
}

export default TransactionBuilder;
