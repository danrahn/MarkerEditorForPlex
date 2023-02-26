import { errorResponseOverlay, ServerCommand } from './Common.js';

import Overlay from './inc/Overlay.js';

/**
 * Static class that is responsible for displaying an undismissible overlay letting the user know
 * that the server is suspended, giving them the option to resume it.
 */
class ServerPausedOverlay {
    static Show() {
        Overlay.show(
            `Server is Paused. Press 'Resume' to reconnect to the Plex database.`,
            'Resume',
            onResume,
            false /*dismissible*/);
    }
}

/**
 * Attempts to resume the suspended server.
 * @param {HTMLElement} button The button that was clicked. */
async function onResume(_, button) {
    button.innerText = 'Resuming...';
    try {
        await ServerCommand.resume();
        window.location.reload();
    } catch (err) {
        button.innerText = 'Resume';
        errorResponseOverlay('Failed to resume.', err);
    }
}

export default ServerPausedOverlay;
