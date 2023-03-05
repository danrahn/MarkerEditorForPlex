import { appendChildren, buildNode } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';

import ButtonCreator from './ButtonCreator.js';
import Overlay from './inc/Overlay.js';

class SectionOptionsOverlay {
    #focusBack;
    constructor() { }

    show(target) {
        this.#focusBack = target;
        const container = buildNode('div', { id : 'sectionOptionsOverlayContainer' });
        appendChildren(container,
            buildNode('h1', {}, 'Section Options'),
            buildNode('hr'),
            ButtonCreator.textButton('Import/Export markers', this.#onImportExport.bind(this), { class : 'sectionOptionsOverlayBtn' }),
            ButtonCreator.textButton(
                'Delete all markers',
                this.#onDeleteAll.bind(this),
                { class : 'sectionOptionsOverlayBtn cancelSetting' }));

        Overlay.build({ dismissible : true, focusBack : this.#focusBack, noborder : true, closeButton : true }, container);
    }

    #onImportExport() {
        Log.info('Import/export!');
        this.#transitionOverlay();
    }

    #onDeleteAll() {
        Log.info('Delete All!');
        this.#transitionOverlay();
    }

    #transitionOverlay() {
        Overlay.dismiss(true /*forReshow*/);
        setTimeout(() => { Overlay.show('Not Yet Implemented'); Overlay.setFocusBackElement(this.#focusBack); });
    }
}

export default SectionOptionsOverlay;
