import { pbkdf2Sync, randomBytes } from 'crypto';

import { AuthDB } from './AuthDatabase.js';
import ServerError from '../ServerError.js';
import { UserTableName } from './AuthenticationConstants.js';

/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('./AuthenticationConstants').DBUser} DBUser */

/**
 * @typedef {{
 *  username: string,
 *  salt: string,
 *  iterations: number,
 *  algorithm: string,
 *  hash: string,
 * }} PasswordInfo
 */

/* (Overkill?) auth parameters. */

const SALT_LEN = 64;
const SALT_ITERATIONS = 10_000;
const HASH_KEY_LEN = 128;
const HASH_ALG = 'sha512';

/** @readonly @type {UserAuthentication} */ // readonly in the sense that external classes should not be modifying it.
export let User;

/**
 * Class that handles simple single-user authentication.
 */
export class UserAuthentication {
    /** Create the singleton UserAuthentication object. */
    static async Initialize() {
        if (User) {
            return User;
        }

        User = new UserAuthentication();
        await User.#init();
        return User;
    }

    /** The (normalized) username required to log into a session. Currently only a single user is supported. */
    #username = '';

    /**
     * Verify authorization management. */
    async #init() {
        if (!AuthDB || !AuthDB.db()) {
            throw new ServerError(`UserAuthentication initialized before authentication database. Cannot continue.`, 500);
        }

        /** @type {DBUser[]} */
        const allUsers = await AuthDB.db().all(`SELECT * FROM ${UserTableName};`);

        // We only expect one user (for now?)
        if (allUsers.length > 1) {
            throw new ServerError(`Found more than one user in the database. That's not expected! You may need to delete auth.db.`, 500);
        }

        if (allUsers.length !== 1) {
            return; // No user has been created.
        }

        this.#username = allUsers[0].username;

    }

    /**
     * Verify that the given username and password matches what's in the authentication database.
     * @param {string} username
     * @param {string} password */
    login(username, password) {
        if (!this.passwordSet()) {
            throw new ServerError(`Cannot verify password when it has not been set up yet!`, 500);
        }

        if (username.toLowerCase() !== this.usernameNorm()) {
            return false;
        }

        return this.loginInternal(password);
    }

    /**
     * Verify that the given password matches our single user's password.
     * If there is ever a need for multiple users, this _must_ go away.
     * @param {string} password */
    async loginInternal(password) {
        if (!password) {
            return false;
        }

        /** @type {DBUser} */
        const userInfo = await AuthDB.db().get(`SELECT * FROM ${UserTableName} WHERE user_norm=?;`, this.usernameNorm());

        const [salt, iterations, algorithm, hash] = userInfo.password.split('/');

        // Key length is half the hash length, since it takes two hex characters to represent a single key byte.
        return hash === pbkdf2Sync(password, salt, parseInt(iterations, 16), hash.length / 2, algorithm).toString('hex');
    }

    /**
     * Change the current password (or set one for the first time)
     * @param {string} username
     * @param {string} oldPassword
     * @param {string} newPassword
     * @returns {Promise<boolean>} False if the old password does not match.*/
    async changePassword(username, oldPassword, newPassword) {
        if (this.passwordSet() && !this.login(username, oldPassword)) {
            return false;
        }

        const salt = randomBytes(SALT_LEN).toString('hex');
        const hash = pbkdf2Sync(newPassword, salt, SALT_ITERATIONS, HASH_KEY_LEN, HASH_ALG).toString('hex');
        const iterations = SALT_ITERATIONS.toString(16);
        const pass = `${salt}/${iterations}/${HASH_ALG}/${hash}`;

        if (this.passwordSet()) {
            await AuthDB.db().run(`UPDATE ${UserTableName} SET password=? WHERE user_norm=?`, [pass, this.usernameNorm()]);
        } else {
            // Initial setup.
            this.#username = username;
            await AuthDB.db().run(
                `INSERT INTO ${UserTableName} (username, user_norm, password) VALUES (?, ?, ?)`,
                [username, this.usernameNorm(), pass]
            );
        }

        return true;
    }

    /**
     * Remove the current user's password. This will result in the user being asked to (re-)set up a username/password. */
    async removePassword() {
        // Just wipe out the table, since we should only have one user anyway.
        await AuthDB.db().run(`DELETE FROM ${UserTableName};`);
        this.#username = '';
    }

    /**
     * Username for authentication */
    username() { return this.#username; }

    /**
     * Returns the normalized (lowercase) username. */
    usernameNorm() { return this.#username.toLowerCase(); }

    /**
     * Whether a password has been set. Should only be false if the user has not gone through first-time setup. */
    passwordSet() { return !!this.username(); }

    /**
     * Return whether the given request is from an authenticated session.
     * @param {ExpressRequest} request
     * @returns {boolean} */
    signedIn(request) {
        return !!request?.session?.authenticated;
    }
}
