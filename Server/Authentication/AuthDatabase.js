import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { authSchemaUpgrades, authSchemaVersion } from './AuthenticationConstants.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import SqliteDatabase from '../SqliteDatabase.js';

const Log = ContextualLog.Create('AuthDB');

/** @readonly @type {AuthDatabase} */
export let AuthDB;

/**
 * This class owns the creation and lifetime of the authentication database, which holds
 * active sessions, user information, and old session secrets.
 */
export class AuthDatabase {
    /**
     * Create a connection to the authentication database, creating the database if it does not exist.
     * @param {string} dataRoot The path to the root of this application. */
    static async Initialize(dataRoot) {
        if (AuthDB) {
            return AuthDB;
        }

        AuthDB = new AuthDatabase();
        await AuthDB.#init(dataRoot);
    }

    /**
     * Close the connection to the authentication DB. */
    static async Close() {
        const auth = AuthDB;
        AuthDB = null;
        await auth?.db()?.close();
    }

    /** @type {SqliteDatabase} */
    #db;

    /**
     * Initialize (and create if necessary) the authentication database.
     * @param {string} dataRoot */
    async #init(dataRoot) {
        if (this.#db) {
            await this.#db.close();
        }

        const dbRoot = join(dataRoot, 'Backup');
        if (!existsSync(dbRoot)) {
            mkdirSync(dbRoot);
        }

        const dbPath = join(dbRoot, 'auth.db');
        const db = await SqliteDatabase.OpenDatabase(dbPath, true /*allowCreate*/);
        this.#db = db;
        let version = 0;
        try {
            version = (await db.get('SELECT version FROM schema_version;'))?.version || 0;
        } catch (err) {
            Log.info('Version information not found in auth DB, starting from scratch.');
        }

        await this.#upgradeSchema(version);
    }

    /**
     * Attempts to upgrade the database schema if it's not the latest version.
     * @param {number} currentSchema */
    async #upgradeSchema(currentSchema) {
        while (currentSchema < authSchemaVersion) {
            Log.info(`Upgrade auth db schema from ${currentSchema} to ${currentSchema + 1}`);
            await this.#db.exec(authSchemaUpgrades[currentSchema]);
            if (currentSchema === 0) {
                return;
            }

            ++currentSchema;
        }
    }

    db() { return this.#db; }
}
