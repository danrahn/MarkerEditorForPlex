/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('express').Response} ExpressResponse */

import { GetServerState, ServerState } from './ServerState.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import { Config } from './Config/MarkerEditorConfig.js';
import { ContextualLog } from '../Shared/ConsoleLog.js';
import { getPostCommand } from './Commands/PostCommand.js';
import { getQueryParser } from './QueryParse.js';
import { PostCommands } from '../Shared/PostCommands.js';
import { registerAuthCommands } from './Commands/AuthenticationCommands.js';
import { registerConfigCommands } from './Commands/ConfigCommands.js';
import { registerCoreCommands } from './Commands/CoreCommands.js';
import { registerImportExportCommands } from './ImportExport.js';
import { registerPurgeCommands } from './Commands/PurgeCommands.js';
import { registerQueryCommands } from './Commands/QueryCommands.js';
import ServerError from './ServerError.js';
import { User } from './Authentication/Authentication.js';

const Log = ContextualLog.Create('POSTCommands');

/** Subset of server commands that we accept when the config files doesn't exist or is in a bad state. */
const badStateWhitelist = new Set([
    PostCommands.GetConfig,
    PostCommands.ValidateConfig,
    PostCommands.ValidateConfigValue,
    PostCommands.SetConfig]
);

/** Subset of server commands that are accepted when the user is not signed in (and auth is enabled). */
const noAuthWhitelist = new Set([
    PostCommands.Login,
    PostCommands.NeedsPassword,
]);

/**
 * Verify that the given endpoint is allowed given the current server state.
 * @param {string} endpoint
 * @param {ExpressRequest} request */
function throwIfBadEndpoint(endpoint, request) {
    if (Config.useAuth() && !User.signedIn(request)) {
        // Only exception - change_password if a password isn't set yet.
        if (!noAuthWhitelist.has(endpoint) && (endpoint !== PostCommands.ChangePassword || User.passwordSet())) {
            throw new ServerError(`${endpoint} is not allowed without authentication`, 401);
        }
    }

    // Like above, allow change_password if a password isn't set, as that may be part of the initial setup.
    if (GetServerState() === ServerState.RunningWithoutConfig
        && !badStateWhitelist.has(endpoint)
        && (endpoint !==  PostCommands.ChangePassword || User.passwordSet())) {
        throw new ServerError(`Disallowed request during First Run experience: "${endpoint}"`, 503);
    }
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
    registerAuthCommands();
}

/**
 * Run the given command.
 * @param {string} endpoint
 * @param {ExpressRequest} request
 * @param {ExpressResponse} response
 * @throws {ServerError} If the endpoint does not exist or the request fails. */
export async function runPostCommand(endpoint, request, response) {
    throwIfBadEndpoint(endpoint, request);

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
        sendJsonError(response, err, +err.code || 500);
    }
}
