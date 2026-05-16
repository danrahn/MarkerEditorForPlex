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
    static Initialize(dataRoot) {
        if (AuthDB) {
            return AuthDB;
        }

        AuthDB = new AuthDatabase();
        AuthDB.#init(dataRoot);
    }

    /**
     * Close the connection to the authentication DB. */
    static Close() {
        const auth = AuthDB;
        AuthDB = null;
        auth?.db()?.close();
    }

    /** @type {SqliteDatabase} */
    #db;

    /**
     * Initialize (and create if necessary) the authentication database.
     * @param {string} dataRoot */
    #init(dataRoot) {
        if (this.#db) {
            this.#db.close();
        }

        const dbRoot = join(dataRoot, 'Backup');
        if (!existsSync(dbRoot)) {
            mkdirSync(dbRoot);
        }

        const dbPath = join(dbRoot, 'auth.db');
        const db = SqliteDatabase.OpenDatabase(dbPath, true /*allowCreate*/);
        this.#db = db;
        let version = 0;
        try {
            version = db.get('SELECT version FROM schema_version;')?.version || 0;
        } catch (err) {
            Log.info('Version information not found in auth DB, starting from scratch.');
        }

        this.#upgradeSchema(version);
    }

    /**
     * Attempts to upgrade the database schema if it's not the latest version.
     * @param {number} currentSchema */
    #upgradeSchema(currentSchema) {
        while (currentSchema < authSchemaVersion) {
            Log.info(`Upgrade auth db schema from ${currentSchema} to ${currentSchema + 1}`);
            this.#db.exec(authSchemaUpgrades[currentSchema]);
            if (currentSchema === 0) {
                return;
            }

            ++currentSchema;
        }
    }

    db() { return this.#db; }
}
