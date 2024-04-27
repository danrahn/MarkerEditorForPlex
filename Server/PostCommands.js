/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */

import { GetServerState, ServerState } from './ServerState.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import { ContextualLog } from '../Shared/ConsoleLog.js';
import { getPostCommand } from './Commands/PostCommand.js';
import { getQueryParser } from './QueryParse.js';
import { registerConfigCommands } from './Commands/ConfigCommands.js';
import { registerCoreCommands } from './Commands/CoreCommands.js';
import { registerImportExportCommands } from './ImportExport.js';
import { registerPurgeCommands } from './Commands/PurgeCommands.js';
import { registerQueryCommands } from './Commands/QueryCommands.js';
import ServerError from './ServerError.js';

const Log = new ContextualLog('POSTCommands');

/** Subset of server commands that we accept when the config files doesn't exist or is in a bad state. */
const badStateWhitelist = new Set(['get_config', 'valid_config', 'valid_cfg_v', 'set_config']);

/**
 * Verify that the given endpoint is allowed given the current server state.
 * @param {string} endpoint */
function endpointAllowed(endpoint) {
    return GetServerState() !== ServerState.RunningWithoutConfig || badStateWhitelist.has(endpoint);
}

/**
 * Register all available POST endpoints. */
export function registerPostCommands() {
    Log.assert(GetServerState() === ServerState.FirstBoot, `We should only be calling setupTerminateHandlers on first boot!`);
    if (GetServerState() !== ServerState.FirstBoot) {
        return;
    }

    registerConfigCommands();
    registerCoreCommands();
    registerImportExportCommands();
    registerPurgeCommands();
    registerQueryCommands();
}

/**
 * Run the given command.
 * @param {string} endpoint
 * @param {IncomingMessage} request
 * @param {ServerResponse} response
 * @throws {ServerError} If the endpoint does not exist or the request fails. */
export async function runPostCommand(endpoint, request, response) {
    if (!endpointAllowed(endpoint)) {
        throw new ServerError(`Disallowed request during First Run experience: "${request.url}"`, 503);
    }

    try {
        const command = getPostCommand(endpoint);
        const handler = command.handler();
        const params = await getQueryParser(request, response);
        const result = await handler(params);
        if (!command.ownsResponse()) {
            sendJsonSuccess(response, result);
        }
    } catch (err) {
        // Default handler swallows exceptions and adds the endpoint to the json error message.
        err.message = `${request.url} failed: ${err.message}`;
        sendJsonError(response, err, err.code || 500);
    }
}
