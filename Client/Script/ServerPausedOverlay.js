import { errorResponseOverlay, jsonRequest } from "./Common.js";
import Overlay from "./inc/Overlay.js";

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
 * @param {MouseEvent} e The MouseEvent that triggered this function. */
async function onResume(e) {
    e.target.value = 'Resuming...';
    try {
        await jsonRequest('resume');
        window.location.reload();
    } catch (err) {
        e.target.value = 'Resume';
        errorResponseOverlay('Failed to resume.', err);
    }
}

export default ServerPausedOverlay;
