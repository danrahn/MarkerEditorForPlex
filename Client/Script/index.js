import { BaseLog } from '/Shared/ConsoleLog.js';

import { ClientSettings, SettingsManager } from './ClientSettings.js';
import { errorMessage, errorResponseOverlay } from './ErrorHandling.js';
import { PlexUI, PlexUIManager } from './PlexUI.js';
import ButtonCreator from './ButtonCreator.js';
import HelpOverlay from './HelpOverlay.js';
import { PlexClientStateManager } from './PlexClientState.js';
import { PurgedMarkerManager } from './PurgedMarkerManager.js';
import { ResultSections } from './ResultSections.js';
import { ServerCommands } from './Commands.js';
import ServerPausedOverlay from './ServerPausedOverlay.js';
import { SetupWindowResizeEventHandler } from './WindowResizeEventHandler.js';
import { StickySettingsBase } from 'StickySettings';
import { ThumbnailMarkerEdit } from 'MarkerTable';
import Tooltip from './Tooltip.js';
import VersionManager from './VersionManager.js';

/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */

window.Log = BaseLog; // Let the user interact with the class to tweak verbosity/other settings.

window.addEventListener('load', init);

/** Initial setup on page load. */
function init() {
    HelpOverlay.SetupHelperListeners();
    StickySettingsBase.Setup(); // MUST be before SettingsManager
    SettingsManager.CreateInstance();
    PlexUIManager.CreateInstance();
    PlexClientStateManager.CreateInstance();
    ResultSections.CreateInstance();
    Tooltip.Setup();
    ButtonCreator.Setup();
    ThumbnailMarkerEdit.Setup();
    ServerPausedOverlay.Setup();
    SetupWindowResizeEventHandler();

    mainSetup();
}

/**
 * Kick off the initial requests necessary for the page to function:
 * * Get app config
 * * Get local settings
 * * Retrieve libraries */
async function mainSetup() {
    /** @type {SerializedConfig} */
    let config = {};
    try {
        config = await ServerCommands.getConfig();
    } catch (err) {
        BaseLog.warn(errorMessage(err), 'ClientCore: Unable to get app config, assuming everything is disabled. Server responded with');
    }

    if (!ClientSettings.parseServerConfig(config)) {
        // Don't continue if we were given an invalid config (or we need to run first-time setup)
        return;
    }

    // Even if extended marker stats are blocked in the UI, we can still enable "find all purges"
    // as long as we have the extended marker data available server-side (i.e. they're not blocked).
    PurgedMarkerManager.CreateInstance(!ClientSettings.extendedMarkerStatsBlocked());
    VersionManager.CheckForUpdates(config.version.value);

    try {
        PlexUI.init(await ServerCommands.getSections());
    } catch (err) {
        errorResponseOverlay('Error getting libraries, please verify you have provided the correct database path and try again.', err);
    }
}
