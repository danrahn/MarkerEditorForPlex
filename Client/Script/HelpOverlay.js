import { $, appendChildren, buildNode, clickOnEnterCallback } from './Common.js';

import Overlay from './Overlay.js';

/**
 * The text to display in the help overlay
 * @type {HTMLElement} */
const helpText = appendChildren(
    buildNode('div', { id : 'helpOverlayHolder' }),
    buildNode('h1', {}, 'Welcome to Marker Editor for Plex'),
    buildNode('p', {}, `
For help with the configuration and usage of ths app, see the 
<a href="https://github.com/danrahn/MarkerEditorForPlex/wiki" target="_blank" rel="noreferrer">wiki on GitHub</a>.`),
    buildNode('p', { style : 'margin-top: 30px' }, `
Disclaimer: This interacts directly with your Plex database in a way that is not officially supported. While it should
be safe to perform various create/update/delete actions, there are no guarantees that it won't break things now or in
the future. The author is not responsible for any database corruption that may occur; use at your own risk.`),
);

class HelpOverlay {
    static #setup = false;
    static #btn = $('#helpContainer');
    static ShowHelpOverlay() {
        Overlay.show(helpText);
        Overlay.setFocusBackElement(HelpOverlay.#btn);
    }

    static SetupHelperListeners() {
        if (HelpOverlay.#setup) {
            return;
        }

        HelpOverlay.#btn.addEventListener('click', HelpOverlay.ShowHelpOverlay);
        HelpOverlay.#btn.addEventListener('keydown', clickOnEnterCallback);
    }
}

export default HelpOverlay;
