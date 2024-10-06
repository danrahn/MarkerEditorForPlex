import { Store } from 'express-session';

import { AuthDB } from './AuthDatabase.js';
import { Config } from '../MarkerEditorConfig.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import ServerError from '../ServerError.js';
import { SessionSecretTableName } from './AuthenticationConstants.js';

/** @typedef {!import('express-session').Session} Session */
/** @typedef {!import('express-session').SessionData} SessionData */

/**
 * @typedef {Object} SessionStoreOptions
 * @property {boolean?} clear Whether to clear expired sessions after a given interval
 * @property {number?} clearIntervalMs The interval to check for cleared sessions, in milliseconds.
 */

/** @typedef {(err?: any) => void} EmptyStoreCallback */
/** @typedef {(err: any, session?: import('express-session').SessionData | null) => void} StoreCallbackWithSession */

const Log = new ContextualLog('SessionStore');

const doNothing = () => {};


// By default, check for expired sessions every 10 minutes
const ExpireCheckDefaultInterval = 600_000;

/**
 * A simple sqlite3 session store. Based on better-sqlite3-session-store, but I don't want
 * to have dependencies on multiple sqlite3 implementations and I'm too lazy to convert
 * existing usage to better-sqlite3.
 */
export default class Sqlite3Store extends Store {
    /** @type {SessionStoreOptions} */
    #options;

    /**
     * @param {SessionStoreOptions} options */
    static CreateInstance(options) {
        const store = new Sqlite3Store(options);
        return store;
    }

    /**
     * Retrieve a list of ~recent session secrets, used to validate sessions that were created
     * outside of the current process.
     * @returns {Promise<string[]>} */
    static async oldSecrets() {
        // Only grab secrets from the last 7 days (and opportunistically prune them). This will
        // invalidate older sessions if the server has restarted, but that's not the end of the world.
        const oneWeekAgo = Math.floor(new Date().getTime() / 1000) - (86_400 * 7);
        await AuthDB.db().run(`DELETE FROM ${SessionSecretTableName} WHERE created_at < ?;`, [oneWeekAgo]);
        return (await AuthDB.db().all(`SELECT key FROM ${SessionSecretTableName};`)).map(secret => secret.key);
    }

    /**
     * Sets this process's secret that will be used to validate new sessions.
     * @param {string} newSecret */
    static async setNewSecret(newSecret) {
        await AuthDB.db().run(`INSERT INTO ${SessionSecretTableName} (key) VALUES (?)`, [newSecret]);
    }

    /**
     * @param {SessionStoreOptions} options */
    constructor(options) {
        super();

        if (!AuthDB || !AuthDB.db()) {
            throw new ServerError(`Cannot initialize session store without session db.`, 500);
        }

        this.#options = {
            clear : options.clear === undefined ? true : options.clear,
            clearIntervalMs : options.intervalMs || ExpireCheckDefaultInterval,
        };

        if (this.#options.clear) {
            setInterval(this.#clearExpiredSessions.bind(this), this.#options.clearIntervalMs);
        }
    }

    /**
     * @param {string} sessionId
     * @param {Session} session
     * @param {EmptyStoreCallback} callback */
    async set(sessionId, session, callback=doNothing) {
        const maxAge = session.cookie?.maxAge || this.#expire(); // One day default
        const expireTime = Math.floor(new Date(new Date().getTime() + maxAge).getTime() / 1000);
        try {
            await this.#db().run(`INSERT OR REPLACE INTO sessions VALUES(?, ?, ?)`, [sessionId, JSON.stringify(session), expireTime ]);
        } catch (ex) {
            callback(ex);
            return;
        }

        callback();
    }

    /**
     * Retrieve an existing session
     * @param {string} sessionId
     * @param {(err?: any, session?: SessionData| null) => null} callback */
    async get(sessionId, callback=doNothing) {
        let session;
        try {
            session = await this.#db().get(
                `SELECT session FROM sessions WHERE session_id=? AND strftime('%s', 'now') < expire`, [sessionId]);
        } catch (ex) {
            callback(ex);
        }

        callback(null, session ? JSON.parse(session.session) : null);
    }

    /**
     * Destroy the session with the given sessionId
     * @param {string} sessionId
     * @param {EmptyStoreCallback} callback */
    async destroy(sessionId, callback=doNothing) {
        try {
            await this.#db().run(`DELETE FROM sessions WHERE session_id=?`, [sessionId]);
        } catch (ex) {
            callback(ex);
            return;
        }

        callback();
    }

    /**
     * Retrieve all sessions, valid or otherwise.
     * @param {(err?: any, obj?: SessionData[] | { [sid: string]: SessionData} | null) => void} callback */
    async all(callback=doNothing) {
        let sessions;
        try {
            sessions = await this.#db().all(`SELECT * from sessions`);
        } catch (ex) {
            callback(ex);
            return;
        }

        callback(null, sessions);
    }

    /**
     * Retrieve the current number of sessions in the database, valid or otherwise.
     * @param {(err?: any, length?: number) => void} callback */
    async length(callback=doNothing) {
        let result;
        try {
            result = await this.#db().get(`SELECT COUNT(*) as count FROM sessions;`);
        } catch (ex) {
            callback(ex);
            return;
        }

        callback(null, result.count);
    }

    /**
     * Delete all sessions, valid or otherwise.
     * @param {EmptyStoreCallback} callback */
    async clear(callback=doNothing) {
        try {
            await this.#db().run(`DELETE FROM sessions;`);
        } catch (ex) {
            callback(ex);
            return;
        }

        callback();
    }

    /**
     * Update the expiration time of the given session.
     * @param {string} sessionId
     * @param {SessionData} session
     * @param {EmptyStoreCallback} callback */
    async touch(sessionId, session, callback=doNothing) {
        const expireTime = new Date(session?.cookie?.expires || (new Date().getTime() + this.#expire())).getTime();
        try {
            await this.#db().run(
                `UPDATE sessions SET expire=? WHERE session_id=? AND strftime('%s', 'now') < expire;`,
                [sessionId, Math.floor(expireTime / 1000)]
            );
        } catch (ex) {
            callback(ex);
        }

        callback();
    }

    /**
     * Delete all sessions in the database that have expired. */
    async #clearExpiredSessions() {
        if (!this.#db()) {
            return;
        }

        try {
            await this.#db().run(`DELETE FROM sessions WHERE strftime('%s', 'now') > expire`);
        } catch (ex) {
            Log.warn(`Failed to clear expired sessions: ${ex.message}`);
        }
    }

    #expire() { return Config.authSessionTimeout() * 1000; }

    #db() { return AuthDB?.db(); }
}
