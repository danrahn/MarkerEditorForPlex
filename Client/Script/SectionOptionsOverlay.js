import { $, $$, $append, $br, $div, $divHolder, $fileInput, $h, $hr, $i, $label, $option, $plainDivHolder, $select, $span,
    $textInput, $textSpan } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { Theme, ThemeColors } from './ThemeColors.js';
import ButtonCreator from './ButtonCreator.js';
import { customCheckbox } from './CommonUI.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import { flashBackground } from './AnimationHelpers.js';
import MarkerBreakdownChart from './MarkerBreakdownChart.js';
import { MarkerConflictResolution } from '/Shared/PlexTypes.js';
import { MarkerEnum } from '/Shared/MarkerType.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { ServerCommands } from './Commands.js';
import Tooltip from './Tooltip.js';

/** @typedef {import('./Overlay').OverlayOptions} OverlayOptions */


const Log = ContextualLog.Create('SectionOps');

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
        this.#showMain();
    }

    /**
     * Display the main overlay, either for the first time, or as the result of
     * canceling out of a specific option. */
    #showMain() {
        const container = $div({ class : 'sectionOptionsOverlayContainer' });
        $append(container,
            $h(1, 'Section Options'),
            $hr(),
            ButtonCreator.textButton('Marker Breakdown Chart', this.#onBreakdown.bind(this), { class : 'sectionOptionsOverlayBtn' }),
            ButtonCreator.textButton('Export Markers', this.#onExport.bind(this), { class : 'sectionOptionsOverlayBtn' }),
            ButtonCreator.textButton('Import Markers', this.#onImport.bind(this), { class : 'sectionOptionsOverlayBtn' }),
            ButtonCreator.textButton(
                'Delete All Markers',
                this.#onDeleteAll.bind(this),
                { class : 'sectionOptionsOverlayBtn redOnHover' }),
            ButtonCreator.textButton(
                'Back',
                Overlay.dismiss,
                { class : 'sectionOptionsOverlayBtn', style : 'margin-top: 20px' })
        );

        const options = { dismissible : true, focusBack : this.#focusBack, noborder : true, closeButton : true };
        Overlay.build(options, container);
    }

    /**
     * Show the marker breakdown chart. */
    #onBreakdown() {
        MarkerBreakdownChart.GetBreakdown($$('.moreSectionOptionsBtn'));
    }

    /**
     * Overlay invoked from the 'Export Markers' action. */
    #onExport() {
        const container = $div({ class : 'sectionOptionsOverlayContainer' });
        $append(container,
            $h(2, 'Marker Export'),
            $hr(),
            $span('Export all markers to a database file that can be imported at a later date.'),
            $hr(),
            $divHolder({ class : 'inlineFlex' },
                $label('Export all libraries: ', 'exportAll'),
                customCheckbox({ id : 'exportAll' })
            ),
            $br(), $br(),
            $plainDivHolder(
                ButtonCreator.textButton(
                    'Export',
                    this.#exportConfirmed.bind(this),
                    { id : 'exportConfirmBtn', class : 'overlayButton greenOnHover' }),
                ButtonCreator.textButton(
                    'Back',
                    this.#showMain.bind(this),
                    { class : 'overlayButton' })));

        Tooltip.setTooltip($$('label', container), 'Export markers from the entire server, not just the active library.');
        Overlay.build({ dismissible : true, focusBack : this.#focusBack }, container);
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
        const container = $div({ class : 'sectionOptionsOverlayContainer' });
        $append(container,
            $h(2, 'Marker Import'),
            $hr(),
            $span('Import markers from a backed up database file to items in this library (or the entire server).'),
            $hr(),
            $plainDivHolder(
                $label('Select a file: ', 'databaseFile'),
                $fileInput({ accept : '.db,application/x-sqlite3', id : 'databaseFile' })),
            $plainDivHolder(
                $label('Apply to all libraries: ', 'applyGlobally'),
                customCheckbox({ id : 'applyGlobally' })),
            $plainDivHolder(
                $label('Conflict Resolution Type: ', 'resolutionType'),
                $append($select('resolutionType'),
                    $option('Overwrite', MarkerConflictResolution.Overwrite),
                    $option('Merge', MarkerConflictResolution.Merge),
                    $option('Ignore', MarkerConflictResolution.Ignore))),
            $br(),
            $plainDivHolder(
                ButtonCreator.textButton(
                    'Import',
                    this.#importConfirmed.bind(this),
                    { id : 'exportConfirmBtn', class : 'overlayButton greenOnHover' }),
                ButtonCreator.textButton(
                    'Back',
                    this.#showMain.bind(this),
                    { class : 'overlayButton' }))
        );

        Overlay.build({ dismissible : true, focusBack : this.#focusBack }, container);
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
            const result = await ServerCommands.importDatabase(
                file,
                $('#applyGlobally').checked ? -1 : PlexClientState.activeSection(),
                $('#resolutionType').value);

            await Overlay.show(
                $plainDivHolder($h(2, `Marker Import Succeeded`), $hr(),
                    `Markers Added: ${result.added}`, $br(),
                    `Ignored Markers (identical): ${result.identical}`, $br(),
                    `Ignored Markers (merge/ignore/self-overlap): ${result.ignored}`, $br(),
                    `Existing Markers Deleted (overwritten): ${result.deleted}`, $br(),
                    `Existing Markers Modified (merged): ${result.modified}`, $br()),
                'Reload',
                // Easier to just reload the page instead of reconciling all the newly deleted markers
                () => { window.location.reload(); },
                false /*dismissible*/);
            Overlay.setFocusBackElement(this.#focusBack);
        } catch (err) {
            errorResponseOverlay('Failed to upload and apply markers', err);
        }
    }

    /**
     * Show an overlay making it as clear as possible that deleting section markers is not reversible. */
    #onDeleteAll() {
        const warnIntro = $textSpan('Are you sure you want to delete all markers in this section?', $br(), $br(),
            'This will remove all markers from the Plex database (both customized and autogenerated), in addition to removing ' +
            'all references to this section in the backup database.', $br(), $br(), $i({}, 'THIS CANNOT BE UNDONE.'), $br(), $br());
        const warnText = $div({ id : 'confirmDeleteAllContainer' }, warnIntro);

        const okayAttr = { id : 'overlayDeleteMarker', class : 'overlayButton confirmDelete' };
        const okayButton = ButtonCreator.textButton('Delete', this.#deleteAllConfirmed.bind(this), okayAttr);

        const cancelButton = ButtonCreator.textButton(
            'Back',
            this.#showMain.bind(this),
            { id : 'deleteMarkerCancel', class : 'overlayButton' });

        warnText.appendChild(
            $span(`If you're sure you want to continue, type DELETE (all caps) ` +
                `into the box below, and then click 'Delete'.`));

        $append(warnText,
            $br(), $br(),
            $label('Type DELETE: ', 'confirmDeleteAllText'),
            $textInput({ id : 'confirmDeleteAllText' }),
            $br(),
            $label('Delete', 'deleteAllTypeSelect'),
            $append($select('deleteAllTypeSelect'),
                $option('all markers', MarkerEnum.All),
                $option('intro markers', MarkerEnum.Intro),
                $option('credit markers', MarkerEnum.Credits),
                $option('ad markers', MarkerEnum.Ad),
            ),
            $br(),
            okayButton,
            cancelButton);

        const container = $div({ class : 'sectionOptionsOverlayContainer' });
        $append(container,
            $h(2, 'DANGER ZONE'),
            $hr(),
            warnText);
        Overlay.build({ dismissible : true, focusBack : this.#focusBack }, container);
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
            const result = await ServerCommands.sectionDelete(PlexClientState.activeSection(), deleteType);
            await Overlay.show(
                `<h2>Section Delete Succeeded</h2><hr>` +
                    `Markers Deleted: ${result.deleted}<br>` +
                    `Backup Entries Removed: ${result.backupDeleted}<br>`,
                'Reload',
                // Easier to just reload the page instead of reconciling all the newly deleted markers
                () => { window.location.reload(); },
                false /*dismissible*/);
            Overlay.setFocusBackElement(this.#focusBack);
        } catch (err) {
            errorResponseOverlay('Failed to delete section markers.', err);
        }
    }

    /**
     * Flash the background of the given element.
     * @param {HTMLElement} input */
    #flashInput(input) {
        return flashBackground(input, Theme.getHex(ThemeColors.Red, 8), 1000);
    }
}

export default SectionOptionsOverlay;
