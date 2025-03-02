import { $, $append, $br, $div } from './HtmlHelpers.js';
import { animate } from './AnimationHelpers.js';
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
 * Displays a warning message in the top-left of the screen for a couple seconds.
 * @param {string|HTMLElement} message
 * @param {number|Promise<void>} duration The timeout in ms, or a promise that dismisses the toast once resolved. */
export function warnToast(message, duration=2500) {
    return toast(message, 'warnToast', duration);
}

/**
 * Displays an error message in the top-left of the screen for a couple seconds.
 * @param {string|HTMLElement} message
 * @param {number|Promise<void>} duration The timeout in ms, or a promise that dismisses the toast once resolved.  */
export function errorToast(message, duration=2500) {
    return toast(message, 'errorToast', duration);
}

/**
 * @param {string|Element} message The message to display
 * @param {string} className The type of toast
 * @param {number|Promise<void>} timeout The timeout in ms, or a promise that dismisses the toast once resolved. */
function toast(message, className, timeout=2500) {
    const msg = $div({ class : 'toast' }, message);
    msg.classList.add(className);
    const container = $('#toastContainer');
    container.appendChild(msg);

    // Hack based on known css padding/border heights to avoid getComputedStyle.
    const height = (msg.getBoundingClientRect().height - 32) + 'px';
    msg.style.height = height;

    const customWait = typeof timeout !== 'number';
    const animateDuration = customWait ? 250 : timeout; // Custom durations might be quick, so show it quickly.

    const finalStep = { opacity : 0, height : '0px', overflow : 'hidden', padding : '0px 15px 0px 15px', offset : 1 };
    let steps = [];
    if (customWait) {
        steps = [{ opacity : 0 }, { opacity : 1, offset : 1 }];
    } else {
        steps = [
            { opacity : 0 },
            { opacity : 1, offset : 0.2 },
            { opacity : 1, offset : 0.8 },
            { height : height, overflow : 'hidden', padding : '15px', offset : 0.95 },
            finalStep,

        ];
    }

    return animate(msg,
        steps,
        { duration : animateDuration },
        async () => {
            if (customWait) {
                // Opacity is reset after animation finishes, so make sure it stays visible.
                msg.style.opacity = 1;
                await timeout;
                const dismissSteps = [
                    { opacity : 1, height : height, overflow : 'hidden', padding : '15px' },
                    finalStep ];
                await animate(msg, dismissSteps, { duration : 250 }, () => {
                    container.removeChild(msg);
                });
            } else {
                container.removeChild(msg);
            }

        }
    );
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

