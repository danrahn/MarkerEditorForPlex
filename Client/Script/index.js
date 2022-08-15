import { $, errorMessage, errorResponseOverlay, jsonRequest } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';

import SettingsManager from './ClientSettings.js';
import MarkerBreakdownManager from './MarkerBreakdownChart.js';
import PlexClientState from './PlexClientState.js';
import { PlexUI } from './PlexUI.js';
import PurgedMarkerManager from './PurgedMarkerManager.js';
import ShowHelpOverlay from './HelpOverlay.js';

window.Log = Log; // Let the user interact with the class to tweak verbosity/other settings.

window.addEventListener('load', setup);

/** Initial setup on page load. */
function setup()
{
    $('#helpBtn').addEventListener('click', ShowHelpOverlay);
    SettingsManager.Initialize();
    PlexClientState.Initialize();
    PlexUI.Initialize();

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
        config = await jsonRequest('get_config');
    } catch (err) {
        Log.warn(errorMessage(err), 'Unable to get app config, assuming everything is disabled. Server responded with');
    }

    const settings = SettingsManager.Get();
    settings.parseServerConfig(config);
    new PurgedMarkerManager(settings.backupEnabled() && settings.showExtendedMarkerInfo());

    try {
        PlexUI.Get().init(await jsonRequest('get_sections'));
    } catch (err) {
        errorResponseOverlay('Error getting libraries, please verify you have provided the correct database path and try again.', err);
        return;
    }
}
