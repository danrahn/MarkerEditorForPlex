import { createServer } from 'http';
import { execFileSync } from 'child_process';

/** @typedef {!import('http').Server} Server */

// In packaged binaries, process.pkg is set. Keep the built.cjs check for compatibility.
const looksLikeBinary = !!process.pkg || process.argv[1]?.includes('built.cjs');

/**
 * Returns whether this application is running as a binary. Returns false if running from source. */
export function isBinary() {
    return looksLikeBinary;
}

/**
 * Verifies that we can find ffmpeg in our path */
export function testFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version']);
        return true;
    } catch (_err) {
        return false;
    }
}

/** @type {Promise<void>[]} */
const HostPortTestQueue = [];

/**
 * Determine if the given host/port is in use.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ valid: boolean, errorCode?: string, failedConnection?: string }>}*/
export async function testHostPort(host, port, ...hostsAndPorts) {
    const promise = testHostPortCore(host, port, ...hostsAndPorts);
    if (HostPortTestQueue.length > 0) {
        await HostPortTestQueue[HostPortTestQueue.length - 1];
    }

    HostPortTestQueue.push(promise);
    const result = await promise;
    HostPortTestQueue.splice(HostPortTestQueue.indexOf(promise), 1);
    return result;
}

/**
 * Determine if the given host/port is in use.
 * @param {string} host
 * @param {number} port
 * @param {(string|number)[]} hostsAndPorts
 * @returns {Promise<{ valid: boolean, errorCode?: string, failedConnection?: string }>}*/
async function testHostPortCore(host, port, ...hostsAndPorts) {
    if (!host && !port) {
        return { valid : true };
    }

    /** @type {Server[]} */
    const servers = [];
    if (hostsAndPorts.length % 2 !== 0) {
        return { valid : false, errorCode : 'Invalid arguments passed to testHostPort' };
    }

    /** @type {(listenHost: string, listenPort: number) => Promise<{ valid: boolean, errorCode?: string, failedConnection?: string}>} */
    const listenTest = (listenHost, listenPort) => {
        const serverPing = createServer();
        servers.push(serverPing);
        return new Promise(resolve => {
            serverPing.listen(listenPort, listenHost, () => {
                resolve({ valid : true });
            }).on('error', err => {
                serverPing.close(_ => resolve({ valid : false, errorCode : err.code, failedConnection : `${listenHost}:${listenPort}` }));
            });
        });
    };

    const promises = [listenTest(host, port)];
    for (let i = 0; i < hostsAndPorts.length; ++i) {
        promises.push(listenTest(hostsAndPorts[i++], hostsAndPorts[i]));
    }

    const results = await Promise.all(promises);
    const firstError = results.find(r => !r.valid);

    for (const server of servers) {
        server.close(_ => {}); // Swallow any close() errors.
    }

    return firstError || results[0];
}
