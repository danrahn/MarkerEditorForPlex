import { $, errorMessage, jsonRequest } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';

import Overlay from './inc/Overlay.js';

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
function mainSetup() {
    let failureFunc = (response) => {
        Overlay.show(`Error getting libraries, please verify you have provided the correct database path and try again. Server Message:<br><br>${errorMessage(response)}`, 'OK');
    };

    let gotConfig = (config) => {
        const settings = SettingsManager.Get();
        settings.parseServerConfig(config);
        new PurgedMarkerManager(settings.backupEnabled() && settings.showExtendedMarkerInfo());

        const plexUI = PlexUI.Get();
        jsonRequest('get_sections', {}, plexUI.init.bind(plexUI), failureFunc);
    }

    let noConfig = () => {
        Log.warn('Unable to get app config, assume everything is disabled.');
        SettingsManager.Get().parseServerConfig({});
        const plexUI = PlexUI.Get();
        jsonRequest('get_sections', {}, plexUI.init.bind(plexUI), failureFunc);
    }

    jsonRequest('get_config', {}, gotConfig, noConfig);
}
