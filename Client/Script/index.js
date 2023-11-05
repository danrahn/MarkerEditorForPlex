import { errorMessage, errorResponseOverlay, ServerCommand } from './Common.js';
import { BaseLog } from '../../Shared/ConsoleLog.js';

import { ClientSettings, SettingsManager } from './ClientSettings.js';
import { PlexUI, PlexUIManager } from './PlexUI.js';
import HelpOverlay from './HelpOverlay.js';
import MarkerBreakdownManager from './MarkerBreakdownChart.js';
import { PlexClientStateManager } from './PlexClientState.js';
import { PurgedMarkerManager } from './PurgedMarkerManager.js';
import Tooltip from './inc/Tooltip.js';
import VersionManager from './VersionManager.js';

window.Log = BaseLog; // Let the user interact with the class to tweak verbosity/other settings.

window.addEventListener('load', setup);

/** Initial setup on page load. */
function setup() {
    HelpOverlay.SetupHelperListeners();
    SettingsManager.CreateInstance();
    PlexClientStateManager.CreateInstance();
    PlexUIManager.CreateInstance();
    Tooltip.Setup();

    // MarkerBreakdownManager is self-contained - we don't need anything from it,
    // and it doesn't need anything from us, so no need to keep a reference to it.
    new MarkerBreakdownManager();
    mainSetup();
}

/**
 * Kick off the initial requests necessary for the page to function:
 * * Get app config
 * * Get local settings
 * * Retrieve libraries */
async function mainSetup() {
    let config = {};
    try {
        config = await ServerCommand.getConfig();
    } catch (err) {
        BaseLog.warn(errorMessage(err), 'ClientCore: Unable to get app config, assuming everything is disabled. Server responded with');
    }

    ClientSettings.parseServerConfig(config);
    PurgedMarkerManager.CreateInstance(ClientSettings.showExtendedMarkerInfo());
    VersionManager.CheckForUpdates(config.version);

    try {
        PlexUI.init(await ServerCommand.getSections());
    } catch (err) {
        errorResponseOverlay('Error getting libraries, please verify you have provided the correct database path and try again.', err);
    }
}
