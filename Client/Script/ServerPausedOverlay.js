import { errorMessage, jsonRequest } from "./Common.js";
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
function onResume(e) {
    e.target.value = 'Resuming...';
    const successFunc = () => {
        window.location.reload();
    };

    const failureFunc = (response) => {
        e.target.value = 'Resume';
        Overlay.setMessage(`Failed to resume: ${errorMessage(response)}`);
    }

    jsonRequest('resume', {}, successFunc, failureFunc);
}

export default ServerPausedOverlay;
