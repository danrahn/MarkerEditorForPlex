import { ServerConfigState } from '../../Shared/ServerConfig.js';

import { ServerEvents, waitForServerEvent } from '../ServerEvents.js';
import { ServerState, SetServerState } from '../ServerState.js';
import { Config } from '../MarkerEditorConfig.js';
import { PostCommands } from '../../Shared/PostCommands.js';
import { registerCommand } from './PostCommand.js';
import { sendJsonSuccess } from '../ServerHelpers.js';
import ServerError from '../ServerError.js';

/** @typedef {!import('http').ServerResponse} ServerResponse */

/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */
/** @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T> */

/**
 * Retrieve a subset of the app configuration that the frontend needs access to.
 * This is only async to conform with the command handler signature. */
function getConfig() {
    return Config.serialize();
}

/**
 * Validate a serialized config file.
 * @param {SerializedConfig} config */
function validateConfig(config) {
    return Config.validateConfig(config);
}

/**
 * Validate a single setting of the server configuration.
 * @param {string} setting
 * @param {string} value */
async function validateConfigValue(setting, value) {
    let asJson;
    try {
        asJson = JSON.parse(value);
    } catch (ex) {
        throw new ServerError(`Invalid configuration value. Expected JSON object, but couldn't parse it`, 400);
    }

    const checkedSetting = await Config.validateField(setting, asJson);
    return checkedSetting.serialize();
}

/**
 * Replace the current configuration with the given configuration, if valid.
 * @param {SerializedConfig} config
 * @param {ServerResponse} response */
async function setConfig(config, response) {
    const oldConfigState = Config.getValid();
    const newConfig = await Config.trySetConfig(config);
    switch (newConfig.config.state) {
        case ServerConfigState.FullReloadNeeded:
            await waitForServerEvent(ServerEvents.HardRestart, response, newConfig);
            break;
        case ServerConfigState.ReloadNeeded:
            await waitForServerEvent(ServerEvents.SoftRestart, response, newConfig);
            break;
        default:
            // If we were previously in a valid state, we can just mark the server as
            // running and return. Otherwise, we need to do a reload, since an invalid
            // state implies we haven't set up any of our core classes.
            if (oldConfigState === ServerConfigState.Valid) {
                SetServerState(ServerState.Running);
                sendJsonSuccess(response, newConfig);
            } else {
                await waitForServerEvent(ServerEvents.SoftRestart, response, newConfig);
            }
            break;
    }
}

/**
 * Register all commands related to server configuration. */
export function registerConfigCommands() {
    registerCommand(PostCommands.GetConfig, _ => getConfig());
    registerCommand(PostCommands.ValidateConfig, q => validateConfig(q.fc('config', JSON.parse)));
    registerCommand(PostCommands.ValidateConfigValue, q => validateConfigValue(q.s('setting'), q.s('value')));
    registerCommand(PostCommands.SetConfig, q => setConfig(q.fc('config', JSON.parse), q.response()), true /*ownsResponse*/);
}
