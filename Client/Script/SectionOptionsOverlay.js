import { $, $$, appendChildren, buildNode, errorResponseOverlay, ServerCommand } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import Animation from './inc/Animate.js';
import Overlay from './inc/Overlay.js';
import ThemeColors from './ThemeColors.js';

import { MarkerConflictResolution, MarkerEnum } from '../../Shared/PlexTypes.js';
import ButtonCreator from './ButtonCreator.js';
import { PlexClientState } from './PlexClientState.js';
import Tooltip from './inc/Tooltip.js';

/** @typedef {import('./inc/Overlay').OverlayOptions} OverlayOptions */


const Log = new ContextualLog('SectionOps');

class SectionOptionsOverlay {
    /**
     * The element to set focus back to when the overlay is dismissed.
     * @type {HTMLElement} */
    #focusBack;

    constructor() { }

    /**
     * Initialize and show the section options overlay.
     * @param {HTMLElement} focusBack */
    show(focusBack) {
        this.#focusBack = focusBack;
        this.#showMain(false /*needsTransition*/);
    }

    /**
     * Display the main overlay, either for the first time, or as the result of
     * canceling out of a specific option.
     * @param {boolean} needsTransition Whether an overlay is already showing, so we should smoothly transition between overlays. */
    #showMain(needsTransition) {
        const container = buildNode('div', { class : 'sectionOptionsOverlayContainer' });
        appendChildren(container,
            buildNode('h1', {}, 'Section Options'),
            buildNode('hr'),
            ButtonCreator.textButton('Export markers', this.#onExport.bind(this), { class : 'sectionOptionsOverlayBtn' }),
            ButtonCreator.textButton('Import markers', this.#onImport.bind(this), { class : 'sectionOptionsOverlayBtn' }),
            ButtonCreator.textButton(
                'Delete all markers',
                this.#onDeleteAll.bind(this),
                { class : 'sectionOptionsOverlayBtn cancelSetting' }),
            ButtonCreator.textButton(
                'Back',
                Overlay.dismiss,
                { class : 'sectionOptionsOverlayBtn', style : 'margin-top: 20px' })
        );

        const options = { dismissible : true, focusBack : this.#focusBack, noborder : true, closeButton : true };
        if (needsTransition) {
            this.#transitionOverlay(container, options);
        } else {
            Overlay.build(options, container);
        }
    }

    /**
     * Overlay invoked from the 'Export Markers' action. */
    #onExport() {
        const container = buildNode('div', { class : 'sectionOptionsOverlayContainer' });
        appendChildren(container,
            buildNode('h2', {}, 'Marker Export'),
            buildNode('hr'),
            buildNode('span', {}, 'Export all markers to a database file that can be imported at a later date.'),
            buildNode('hr'),
            appendChildren(buildNode('div'),
                buildNode('label', { for : 'exportAll' }, 'Export all libraries '),
                buildNode('input', { type : 'checkbox', id : 'exportAll' })),
            buildNode('br'),
            appendChildren(buildNode('div'),
                ButtonCreator.textButton(
                    'Export',
                    this.#exportConfirmed.bind(this),
                    { id : 'exportConfirmBtn', class : 'overlayButton confirmSetting' }),
                ButtonCreator.textButton(
                    'Back',
                    function () { this.#showMain(true); }.bind(this),
                    { class : 'overlayButton' })));

        Tooltip.setTooltip($$('label', container), 'Export markers from the entire server, not just the active library.');
        this.#transitionOverlay(container, { dismissible : true, focusBack : this.#focusBack });
    }

    /**
     * Attempt to export this section's markers (or the entire server). */
    #exportConfirmed() {
        const exportAll = $('#exportAll').checked;
        try {
            window.open(`export/${exportAll ? -1 : PlexClientState.activeSection() }`);
            setTimeout(Overlay.dismiss, 1000);
        } catch (err) {
            errorResponseOverlay('Failed to export library markers.', err);
        }
    }

    /**
     * Overlay invoked from the 'Import Markers' action. */
    #onImport() {
        const container = buildNode('div', { class : 'sectionOptionsOverlayContainer' });
        appendChildren(container,
            buildNode('h2', {}, 'Marker Import'),
            buildNode('hr'),
            buildNode('span', {}, 'Import markers from a backed up database file to items in this library (or the entire server).'),
            buildNode('hr'),
            appendChildren(buildNode('div'),
                buildNode('label', { for : 'databaseFile' }, 'Select a file: '),
                buildNode('input', { type : 'file', accept : '.db,application/x-sqlite3', id : 'databaseFile' })),
            appendChildren(buildNode('div'),
                buildNode('label', { for : 'applyGlobally' }, 'Apply to all libraries: '),
                buildNode('input', { type : 'checkbox', id : 'applyGlobally' })),
            appendChildren(buildNode('div'),
                buildNode('label', { for : 'resolutionType' }, 'Conflict Resolution Type: '),
                appendChildren(buildNode('select', { id : 'resolutionType' }),
                    buildNode('option', { value : MarkerConflictResolution.Overwrite }, 'Overwrite'),
                    buildNode('option', { value : MarkerConflictResolution.Merge }, 'Merge'),
                    buildNode('option', { value : MarkerConflictResolution.Ignore }, 'Ignore'))),
            buildNode('br'),
            appendChildren(buildNode('div'),
                ButtonCreator.textButton(
                    'Import',
                    this.#importConfirmed.bind(this),
                    { id : 'exportConfirmBtn', class : 'overlayButton confirmSetting' }),
                ButtonCreator.textButton(
                    'Back',
                    function () { this.#showMain(true); }.bind(this),
                    { class : 'overlayButton' }))
        );

        this.#transitionOverlay(container, { dismissible : true, focusBack : this.#focusBack });
    }

    /**
     * Upload the attached file and attempt to import all markers it contains. */
    async #importConfirmed() {
        /** @type {HTMLInputElement} */
        const fileNode = $('#databaseFile');
        const files = fileNode.files;
        if (files?.length !== 1) {
            return this.#flashInput(fileNode);
        }

        const file = files[0];
        if (!file.name.endsWith('.db')) {
            return this.#flashInput(fileNode);
        }

        if (file.size > 1024 * 1024 * 32) { // 32MB limit
            const fSize = parseInt(file.size);
            errorResponseOverlay('Failed to upload and apply markers.', `File size of ${fSize} bytes is larger than 32MB limit.`);
            return;
        }

        Log.info(file.name, `Uploading File`);
        try {
            const result = await ServerCommand.importDatabase(
                file,
                $('#applyGlobally').checked ? -1 : PlexClientState.activeSection(),
                $('#resolutionType').value);

            Overlay.dismiss(true /*forReshow*/);
            setTimeout(() => {
                Overlay.show(
                    `<h2>Marker Import Succeeded</h2><hr>` +
                        `Markers Added: ${result.added}<br>` +
                        `Ignored Markers (identical): ${result.identical}<br>` +
                        `Ignored Markers (merge/ignore/self-overlap): ${result.ignored}<br>` +
                        `Existing Markers Deleted (overwritten): ${result.deleted}<br>` +
                        `Existing Markers Modified (merged): ${result.modified}<br>`,
                    'Reload',
                    // Easier to just reload the page instead of reconciling all the newly deleted markers
                    () => { window.location.reload(); },
                    false /*dismissible*/);
                Overlay.setFocusBackElement(this.#focusBack);
            }, 250);
        } catch (err) {
            errorResponseOverlay('Failed to upload and apply markers', err);
        }
    }

    /**
     * Show an overlay making it as clear as possible that deleting section markers is not reversible. */
    #onDeleteAll() {
        const warnIntro = 'Are you sure you want to delete all markers in this section?<br><br>This will ' +
        'remove all markers from the Plex database (both customized and autogenerated), in addition to removing ' +
        'all references to this section in the backup database.<br><br><i>THIS CANNOT BE UNDONE</i>.<br><br>';
        const warnText = buildNode('div', { id : 'confirmDeleteAllContainer' }, warnIntro);

        const okayAttr = { id : 'overlayDeleteMarker', class : 'overlayButton confirmDelete' };
        const okayButton = ButtonCreator.textButton('Delete', this.#deleteAllConfirmed.bind(this), okayAttr);

        const cancelButton = ButtonCreator.textButton(
            'Back',
            function () { this.#showMain(true); }.bind(this),
            { id : 'deleteMarkerCancel', class : 'overlayButton' });

        warnText.appendChild(
            buildNode('span', {}, `If you're sure you want to continue, type DELETE (all caps) ` +
                `into the box below, and then click 'Delete'.`));

        appendChildren(warnText,
            buildNode('br'), buildNode('br'),
            buildNode('label', { for : 'confirmDeleteAllText' }, 'Type DELETE: '),
            buildNode('input', { type : 'text', id : 'confirmDeleteAllText' }),
            buildNode('br'),
            buildNode('label', { for : 'deleteAllTypeSelect' }, 'Delete'),
            appendChildren(buildNode('select', { id : 'deleteAllTypeSelect' }),
                buildNode('option', { value : MarkerEnum.Credits | MarkerEnum.Intro }, 'intro and credit markers'),
                buildNode('option', { value : MarkerEnum.Intro }, 'intro markers'),
                buildNode('option', { value : MarkerEnum.Credits }, 'credit markers')),
            buildNode('br'),
            okayButton,
            cancelButton);

        const container = buildNode('div', { class : 'sectionOptionsOverlayContainer' });
        appendChildren(container,
            buildNode('h2', {}, 'DANGER ZONE'),
            buildNode('hr'),
            warnText);
        this.#transitionOverlay(
            container,
            { dismissible : true, focusBack : this.#focusBack });
    }

    /**
     * Verify the user actually wants to delete markers, and try to do it. */
    async #deleteAllConfirmed() {
        const text = $('#confirmDeleteAllText').value;
        if (text !== 'DELETE') {
            this.#flashInput($('#confirmDeleteAllText'));
            return;
        }

        Log.warn(`Attempting to delete markers for an entire section.`);
        const deleteType = parseInt($('#deleteAllTypeSelect').value);
        try {
            const result = await ServerCommand.sectionDelete(PlexClientState.activeSection(), deleteType);
            Overlay.dismiss(true /*forReshow*/);
            setTimeout(() => {
                Overlay.show(
                    `<h2>Section Delete Succeeded</h2><hr>` +
                        `Markers Deleted: ${result.deleted}<br>` +
                        `Backup Entries Removed: ${result.backupDeleted}<br>`,
                    'Reload',
                    // Easier to just reload the page instead of reconciling all the newly deleted markers
                    () => { window.location.reload(); },
                    false /*dismissible*/);
                Overlay.setFocusBackElement(this.#focusBack);
            }, 250);
        } catch (err) {
            errorResponseOverlay('Failed to delete section markers.', err);
        }
    }

    /**
     * Dismiss the current overlay and immediately replace it with a new one.
     * @param {HTMLElement} container
     * @param {OverlayOptions} options */
    #transitionOverlay(container, options) {
        Overlay.dismiss(true /*forReshow*/);
        setTimeout(() => { Overlay.build(options, container); }, 250);
    }

    /**
     * Flash the background of the given element.
     * @param {HTMLElement} input */
    #flashInput(input) {
        Animation.queue({ backgroundColor : `#${ThemeColors.get('red')}8` }, input, 500);
        return new Promise((resolve, _) => {
            Animation.queueDelayed({ backgroundColor : 'transparent' }, input, 500, 500, true, resolve);
        });
    }
}

export default SectionOptionsOverlay;
