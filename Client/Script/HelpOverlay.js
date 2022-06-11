import { appendChildren, buildNode } from "./Common.js";
import Overlay from "./inc/Overlay.js";

/**
 * The text to display in the help overlay
 * @type {HTMLElement} */
const helpText = appendChildren(
    buildNode('div', { id : 'helpOverlayHolder' }),
    buildNode('h1', {}, 'Welcome to the Plex Intro Editor'),
    buildNode('p', {}, `
To begin, select a TV library from the dropdown below (if one is not already selected) and search for the 
show that you want to edit the intro markers for. After selecting a show and a season, click on an episode 
name to show the marker table (or Ctrl+click to show/hide markers for all episodes in the season). The table 
will allow you to add, edit, and delete its markers. Note that multiple markers can also be added for an 
episode, and all will trigger within Plex (tested on web, desktop, and AndroidTV clients), so can also be used 
to add things like recap or credit skips.`),
    buildNode('p', {}, `
Disclaimer: This interacts directly with your Plex database in a completely unsupported way. The author is in 
no way responsible for any database corruption that may occur both now or in the future if Plex modifies the way 
intros are detected and/or stored in the database. USE AT YOUR OWN RISK.`)
);

/** Invokes the help overlay */
function ShowHelpOverlay() {
    Overlay.show(helpText, 'OK');
}

export default ShowHelpOverlay;
