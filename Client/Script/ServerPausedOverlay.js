import { CustomEvents } from './CustomEvents.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import Overlay from './Overlay.js';
import { ServerCommands } from './Commands.js';

/**
 * Static class that is responsible for displaying an undismissible overlay letting the user know
 * that the server is suspended, giving them the option to resume it.
 */
class ServerPausedOverlay {
    static Setup() {
        window.addEventListener(CustomEvents.ServerPaused, ServerPausedOverlay.Show);
    }

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
        await ServerCommands.resume();
        window.location.reload();
    } catch (err) {
        button.innerText = 'Resume';
        errorResponseOverlay('Failed to resume.', err);
    }
}

export default ServerPausedOverlay;
