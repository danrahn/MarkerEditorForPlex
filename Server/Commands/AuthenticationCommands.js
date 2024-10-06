import { Config } from '../MarkerEditorConfig.js';
import { PostCommands } from '../../Shared/PostCommands.js';
import { registerCommand } from './PostCommand.js';
import ServerError from '../ServerError.js';
import { User } from '../Authentication/Authentication.js';

/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('express-session')} Session */
/** @typedef {Session.Session & Partial<Session.SessionData>} ExpressSession */

/**
 * Attempts to log into marker editor.
 * @param {string} password
 * @param {ExpressSession} session */
async function login(username, password, session) {
    if (!Config.useAuth() || !User.passwordSet()) {
        throw new ServerError('Unexpected call to /login - authentication is disabled or not set up.', 400);
    }

    if (!(await User.login(username, password))) {
        throw new ServerError('Incorrect username or password', 401);
    }

    session.authenticated = true;
}

/**
 * Log out of the current session.
 * @param {ExpressRequest} request
 * @param {ExpressResponse} response */
function logout(request, response) {
    if (!Config.useAuth() || !User.passwordSet() || !request.session.authenticated) {
        throw new ServerError('Unexpected call to /logout - user is not signed in.', 400);
    }

    return new Promise(resolve => {
        request.session.destroy(err => {
            response.clearCookie('markereditor.sid');
            if (err) {
                throw new ServerError(`Failed to logout: ${err.message}`, 500);
            }

            resolve();
        });
    });
}

/**
 * Change the current single-user password.
 * @param {string} username
 * @param {string} oldPassword
 * @param {string} newPassword
 * @param {ExpressRequest} request */
async function changePassword(username, oldPassword, newPassword, request) {
    // This can also enable auth if no password is set and oldPassword is blank.
    if (!Config.useAuth() && oldPassword !== '') {
        throw new ServerError('Unexpected call to /change_password, authentication is not enabled.', 400);
    }

    const firstSet = !request.session?.authenticated && !User.passwordSet();
    if (!request.session?.authenticated && User.passwordSet()) {
        throw new ServerError('Cannot change password when not logged in.', 403);
    }

    if (!newPassword) {
        throw new ServerError('New password cannot be empty.', 400);
    }

    if (oldPassword === newPassword) {
        throw new ServerError('New password cannot match old password.', 400);
    }

    if (!(await User.changePassword(username, oldPassword, newPassword))) {
        throw new ServerError('Old password does not match.', 403);
    }

    if (firstSet) {
        // eslint-disable-next-line require-atomic-updates
        if (request.session) {
            request.session.authenticated = true;
        }
    }
}

/**
 * Check whether user authentication is enabled, but a password is not set.
 * @returns {{ value: boolean }} */
function needsPassword() {
    return {
        value : Config.useAuth() && !User.passwordSet()
    };
}

/** Register authentication related commands. */
export function registerAuthCommands() {
    registerCommand(PostCommands.Login, q => login(q.fs('username'), q.fs('password'), q.r().session));
    registerCommand(PostCommands.Logout, q => logout(q.r(), q.response()));
    registerCommand(PostCommands.ChangePassword, q => changePassword(q.fs('username'), q.fs('oldPass'), q.fs('newPass'), q.r()));
    registerCommand(PostCommands.NeedsPassword, _q => needsPassword());
}
