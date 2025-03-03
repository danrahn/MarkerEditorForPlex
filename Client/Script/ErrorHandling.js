import { $append, $br, $div } from './HtmlHelpers.js';
import { Toast, ToastType } from './Toast.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import FetchError from './FetchError.js';
import Overlay from './Overlay.js';

const Log = ContextualLog.Create('ErrorHandling');

/**
 * Displays an overlay for the given error
 * @param {string} message
 * @param {Error|string} err
 * @param {() => void} [onDismiss=Overlay.dismiss] */
export function errorResponseOverlay(message, err, onDismiss = Overlay.dismiss) {
    const errType = err instanceof FetchError ? 'Server Message' : 'Error';
    Overlay.show(
        $append(
            $div(),
            message,
            $br(), $br(),
            errType + ':',
            $br(),
            errorMessage(err)),
        'OK',
        onDismiss);
}


/**
 * Displays an error message in the top-left of the screen for a couple seconds.
 * @param {string|HTMLElement} message
 * @param {number} duration The timeout in ms. */
export function errorToast(message, duration=2500) {
    return new Toast(ToastType.Error, message).showSimple(duration);
}

/**
 * Return an error string from the given error.
 * In almost all cases, `error` will be either a JSON object with a single `Error` field,
 * or an exception of type {@link Error}. Handle both of those cases, otherwise return a
 * generic error message.
 *
 * NOTE: It's expected that all API requests call this on failure, as it's the main console
 *       logging method.
 * @param {string|Error} error
 * @returns {string} */
export function errorMessage(error) {
    if (error.Error) {
        Log.error(error);
        return error.Error;
    }

    if (error instanceof Error) {
        Log.error(error.message);
        Log.error(error.stack ? error.stack : '(Unknown stack)');

        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            // Special handling of what's likely a server-side exit.
            return error.toString() + '<br><br>The server may have exited unexpectedly, please check the console.';
        }

        return error.toString();
    }

    if (typeof error === 'string') {
        return error;
    }

    return 'I don\'t know what went wrong, sorry :(';
}

