import { appendChildren, buildNode } from "./Common.js";
import Overlay from "./inc/Overlay.js";

/**
 * The text to display in the help overlay
 * @type {HTMLElement} */
const helpText = appendChildren(
    buildNode('div', { id : 'helpOverlayHolder' }),
    buildNode('h1', {}, 'Welcome to Intro Editor for Plex'),
    buildNode('p', {}, `
For help with the configuration and usage of ths app, see the 
<a href="https://github.com/danrahn/IntroEditorForPlex/wiki" target="_blank" rel="noreferrer">wiki on GitHub</a>.`),
    buildNode('p', { style : 'margin-top: 30px' }, `
Disclaimer: This interacts directly with your Plex database in a way that is not officially supported. While it should
be safe to perform various create/update/delete actions, there are no guarantees that it won't break things now or in
the future. The author is not responsible for any database corruption that may occur; use at your own risk.`),
);

/** Invokes the help overlay */
function ShowHelpOverlay() {
    Overlay.show(helpText);
}

export default ShowHelpOverlay;
