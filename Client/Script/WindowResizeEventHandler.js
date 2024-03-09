import { BaseLog } from '../../Shared/ConsoleLog.js';

/**
 * Set of all registered event listeners.
 * @type {Set<(e: UIEvent) => void>}*/
const smallScreenListeners = new Set();

let smallScreenCached = false;

/**
 * Initializes the global window resize event listener, which acts as a wrapper around individually registered listeners. */
export function SetupWindowResizeEventHandler() {
    window.addEventListener('resize', (e) => {
        if (smallScreenCached === isSmallScreen()) {
            return;
        }

        BaseLog.verbose(`Window changed from small=${smallScreenCached} to ${!smallScreenCached}, ` +
            `triggering ${smallScreenListeners.size} listeners`);
        smallScreenCached = !smallScreenCached;
        for (const listener of smallScreenListeners) {
            listener(e);
        }
    });
}


/**  @returns Whether the current window size is considered small */
export function isSmallScreen() { return document.body.clientWidth < 768; }

/**
 * Adds an listener to the window resize event.
 * Ensures the event is only triggered when the small/large screen threshold is crossed.
 * @param {(e: Event) => void} callback */
export function addWindowResizedListener(callback) {
    smallScreenListeners.add(callback);
}
