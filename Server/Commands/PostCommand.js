/** @typedef {!import('../QueryParse').QueryParser} QueryParser */

import ServerError from '../ServerError.js';

/** @typedef {(params: QueryParser) => Promise<any>} POSTCallback */

class PostCommand {
    #ownsResponse = false;
    /** @type {(params: QueryParser) => Promise<any>} */
    #handler;
    constructor(commandHandler, ownsResponse) {
        this.#handler = commandHandler;
        this.#ownsResponse = ownsResponse;
    }

    handler() { return this.#handler; }
    ownsResponse() { return this.#ownsResponse; }
}

/** @type {Map<string, PostCommand>} */
const RegisteredCommands = new Map();

/**
 * Register a new POST endpoint
 * @param {string} endpoint The endpoint to register
 * @param {POSTCallback} callback
 * @param {bool} [ownsResponse=false] */
export function registerCommand(endpoint, callback, ownsResponse=false) {
    RegisteredCommands.set(endpoint, new PostCommand(callback, ownsResponse));
}

/**
 * Get the PostCommand associated with the given endpoint.
 * @param {string} endpoint
 * @throws {ServerError} If the endpoint isn't registered. */
export function getPostCommand(endpoint) {
    if (!RegisteredCommands.has(endpoint)) {
        throw new ServerError(`Invalid endpoint: ${endpoint}`, 404);
    }

    return RegisteredCommands.get(endpoint);
}
