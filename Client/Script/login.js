import { $$, $br, $plainDivHolder, $text } from './HtmlHelpers.js';
import { BaseLog } from '/Shared/ConsoleLog.js';
import { errorToast } from './ErrorHandling.js';
import { ServerCommands } from './Commands.js';
import { SettingsManager } from './ClientSettings.js';

/** @typedef {!import('/Shared/ServerConfig').RawSerializedConfig} RawSerializedConfig */

window.Log = BaseLog; // Let the user interact with the class to tweak verbosity/other settings.

window.addEventListener('load', init);

/** Initial setup on page load. */
function init() {
    // SettingsManager is only needed for light/dark mode toggle.
    SettingsManager.CreateInstance(false /*settingsButton*/);
    new LoginManager();
}

/**
 * Class that handles a user's attempts to log in (or register for the first time).
 */
class LoginManager {
    /** @type {HTMLInputElement} */
    #unset = false;
    /** @type {HTMLInputElement} */
    #username = $$('#username');
    /** @type {HTMLInputElement} */
    #password = $$('#password');
    /** @type {HTMLInputElement} */
    #confirm = $$('#passwordConfirm');
    /** @type {HTMLInputElement} */
    #message = $$('#loginMessage');
    /** @type {HTMLInputElement} */
    #go = $$('#passwordGo');

    /** Tracks the number of login failures. */
    #failures = 0;

    /** Used to prevent multiple login attempts at the same time. */
    #loggingIn = false;

    constructor() {
        this.#init();
    }

    async #init() {
        try {
            this.#unset = (await ServerCommands.needsPassword()).value;
        } catch (ex) {
            errorToast('Server Error, check your authentication settings.');
            return;
        }

        this.#username.addEventListener('keyup', this.#onKeyup.bind(this));
        this.#password.addEventListener('keyup', this.#onKeyup.bind(this));
        this.#go.addEventListener('keyup', this.#onKeyup.bind(this));

        if (this.#unset) {
            // Config says auth is enabled, but it hasn't been configured yet.
            this.#confirm.addEventListener('keyup', this.#onKeyup.bind(this));
            $$('#confirmContainer').classList.remove('hidden');
            this.#message.innerText = 'Authentication is enabled, but a username/password is not set. Enter one below.';
            this.#message.classList.remove('hidden');
            this.#go.value = 'Set Authentication';
            this.#go.addEventListener('click', this.#setPassword.bind(this));
        } else {
            // Happy path - auth is enabled and a user/password has been set.
            this.#go.addEventListener('click', this.#tryLogin.bind(this));

            // If we've been redirected due to a 401/403, let the user know why they've been redirected.
            if (new URL(window.location.href).searchParams.has('expired')) {
                this.#message.innerText = 'Session expired, please log in again.';
                this.#message.classList.remove('hidden');
            }
        }
    }

    /**
     * Attempt to log in on 'Enter'
     * @param {KeyboardEvent} e */
    #onKeyup(e) {
        if (e.key === 'Enter') {
            this.#go.click();
        }
    }

    /**
     * Attempt to log in with the currently specified username and password.
     * On success, redirects to the main page. Shows an errorToast on failure. */
    async #tryLogin() {
        if (this.#loggingIn) {
            // Silently ignore.
            return;
        }

        const username = this.#username.value;
        const password = this.#password.value;
        if (!password) {
            errorToast('Password cannot be empty', 5000);
            return;
        }

        this.#loggingIn = true;
        try {
            await ServerCommands.login(username, password);
            window.location = 'login.html';
        } catch (ex) {
            ++this.#failures;
            if (this.#failures > 3) {
                // More than three failed attempts. Let the user know how to reset authentication
                // if they have access to the server files.
                errorToast($plainDivHolder(
                    $text(`Login failed: ${ex.message}`),
                    $br(), $br(),
                    $text(`If you don't remember your username or password, exit this application, ` +
                        `delete auth.db in the Backup directory, and restart.`)),
                5000);
            } else {
                errorToast(`Login failed: ${ex.message}`, 8000);
            }
        } finally {
            this.#loggingIn = false;
        }
    }

    /**
     * In the unhappy path where auth is enabled but a username/password has not been set,
     * attempt to set said username/password. */
    async #setPassword() {
        if (this.#loggingIn) {
            // Silently ignore.
            return;
        }

        const username = this.#username.value;
        if (!username || username.length !== username.replace(/\s/g, '').length) {
            errorToast('Username cannot contain whitespace.', 5000);
            return;
        }

        if (!this.#password.value) {
            errorToast('Password cannot be empty', 5000);
            return;
        }

        if (this.#password.value !== this.#confirm.value) {
            errorToast('Passwords do not match', 5000);
            return;
        }

        this.#loggingIn = true;
        try {
            await ServerCommands.changePassword(username, '' /*oldPass*/, this.#password.value);
            window.location = 'index.html';
        } catch (ex) {
            errorToast(`Setting password failed: ${ex.message}`, 5000);
        } finally {
            this.#loggingIn = false;
        }
    }
}
