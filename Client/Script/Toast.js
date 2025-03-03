import { $, $clear, $div } from './HtmlHelpers.js';
import { animate } from './AnimationHelpers.js';

/** @enum */
export const ToastType = {
    Error : 'errorToast',
    Warning : 'warnToast',
    Info : 'infoToast',
    Success : 'successToast',
};

/**
 * @typedef {Object} ToastTimingOptions
 * @property {Promise<void>} promise A promise that dismisses the toast once resolved.
 * @property {number} [minDuration=1000] The minimum amount of time the toast should be displayed.
 * @property {number} [dismissDelay=0] The amount of time to continue showing the toast after the promise resolves.
 * @property {Function} [onResolve] A callback to run when the promise resolves (but potentially before the toast is dismissed).
 */

function getColor(toastType, colorProperty) {
    // TODO: getComputedStyle isn't cheap, so this should be optimized if it becomes a bottleneck.
    const fullProperty = `--${toastType.substring(0, toastType.length - 5)}-${colorProperty}`;
    return getComputedStyle(document.documentElement).getPropertyValue(fullProperty);
}

function getBackgroundColor(toastType) {
    return getColor(toastType, 'background');
}

function getBorderColor(toastType) {
    return getColor(toastType, 'border');
}

/**
 * Encapsulates a toast message that can be shown to the user.
 */
export class Toast {
    /** @type {string} */
    #toastType = ToastType.Error;
    /** @type {HTMLElement} */
    #toastDiv;

    /**
     * @param {string} toastType The ToastType to create
     * @param {string|HTMLElement} message The message to display in the toast */
    constructor(toastType, message) {
        this.#toastType = toastType;
        this.#toastDiv = $div({ class : 'toast' }, message);
        this.#toastDiv.classList.add(toastType);
    }

    /**
     * @param {ToastTimingOptions} options Options specifying how long to show the toast and what to do when it's dismissed. */
    show(options) {
        const msg = this.#toastDiv;
        $('#toastContainer').appendChild(msg);

        // Hack based on known css padding/border heights to avoid getComputedStyle.
        const height = (msg.getBoundingClientRect().height - 32) + 'px';
        msg.style.height = height;
        options.minDuration ??= 1000;
        options.dismissDelay ??= 0;
        const initialSteps = [
            { opacity : 0 },
            { opacity : 1, offset : 1 },
        ];

        return animate(msg,
            initialSteps,
            { duration : 250 },
            async () => {
                // Opacity is reset after animation finishes, so make sure it stays visible.
                msg.style.opacity = 1;

                const start = Date.now();
                await options.promise;
                await options.onResolve?.();
                const remaining = Math.max(options.minDuration - (Date.now() - start), options.dismissDelay);
                if (remaining > 0) {
                    await new Promise(r => { setTimeout(r, remaining); });
                }

                const dismissSteps = [
                    { opacity : 1, height : height, overflow : 'hidden', padding : '15px' },
                    { opacity : 0, height : '0px', overflow : 'hidden', padding : '0px 15px 0px 15px', offset : 1 },
                ];

                await animate(msg, dismissSteps, { duration : 250 }, () => {
                    msg.remove();
                });
            }
        );
    }

    /**
     * @param {number} duration The timeout in ms. */
    showSimple(duration) {
        // This repeats some code, but the simple/complex paths are different enough that I think it makes sense.
        const msg = this.#toastDiv;
        $('#toastContainer').appendChild(msg);

        // Hack based on known css padding/border heights to avoid getComputedStyle.
        const height = (msg.getBoundingClientRect().height - 32) + 'px';
        msg.style.height = height;

        const steps = [
            { opacity : 0 },
            { opacity : 1, offset : 0.2 },
            { opacity : 1, offset : 0.8 },
            { height : height, overflow : 'hidden', padding : '15px', offset : 0.95 },
            { opacity : 0, height : '0px', overflow : 'hidden', padding : '0px 15px 0px 15px', offset : 1 },
        ];

        return animate(msg,
            steps,
            { duration },
            () => {
                msg.remove();
            });
    }

    /**
     * @param {string} newType */
    async changeType(newType) {
        await animate(this.#toastDiv, [
            { backgroundColor : getBackgroundColor(this.#toastType), borderColor : getBorderColor(this.#toastType) },
            { backgroundColor : getBackgroundColor(newType), borderColor : getBorderColor(newType), offset : 1 },
        ], { duration : 250 });

        this.#toastDiv.classList.remove(this.#toastType);
        this.#toastDiv.classList.add(newType);
        this.#toastType = newType;
    }

    /**
     * @param {string|HTMLElement} newMessage */
    setMessage(newMessage) {
        if (newMessage instanceof HTMLElement) {
            $clear(this.#toastDiv);
            this.#toastDiv.appendChild(newMessage);
        } else {
            this.#toastDiv.innerText = newMessage;
        }
    }
}
