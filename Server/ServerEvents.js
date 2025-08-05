import { EventEmitter } from 'events';

export const ServerEvents = {
    /** @readonly Event triggered when a soft restart has been initiated. */
    SoftRestart : 'softRestart',
    /** @readonly Event triggered when a full restart has been initiated. */
    HardRestart : 'hardRestart',
    /** @readonly Event triggered when the server is suspended due to inactivity. */
    AutoSuspend : 'autoSuspend',
    /** @readonly Event triggered when the auto-suspend setting is changed. */
    AutoSuspendChanged : 'autoSuspendChanged',
    /** @readonly Event triggered when we want to clear out our thumbnail cache. */
    ReloadThumbnailManager : 'reloadThumbs',
    /** @readonly Event triggered when we should reload (or clear) cached marker stats. */
    ReloadMarkerStats : 'reloadStats',
    /** @readonly Event triggered when we should reload (or clear) the purged marker cache. */
    RebuildPurgedCache : 'rebuildPurges',
};

/**
 * EventEmitter responsible for all server-side eventing. */
export const ServerEventHandler = new EventEmitter();

/**
 * Calls all listeners for the given event, returning a promise that resolves when all listeners have completed.
 * @param {string} eventName The ServerEvent to trigger.
 * @param  {...any} [args] Additional arguments to pass to the event listener. */
export function waitForServerEvent(eventName, ...args) {
    /** @type {Promise<any>[]} */
    const promises = [];
    // emit() doesn't work for us, since it masks the listener return value (a promise),
    // so we can't wait for it. There are probably approaches that can use emit, but I think
    // the current approach does the best job of hiding away the implementation details.
    ServerEventHandler.listeners(eventName).forEach(listener => {
        promises.push(new Promise(resolve => {
            listener(...args, resolve);
        }));
    });

    return Promise.all(promises);
}
