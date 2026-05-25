import * as DateUtil from './DateUtil.js';

import { $, $append, $br, $clear, $div, $divHolder, $h, $hr, $span, $table, $tbody, $td, $textSpan, $th, $thead,
    $tr } from './HtmlHelpers.js';
import { Theme, ThemeColors } from './ThemeColors.js';
import Tooltip, { TooltipTextSize } from './Tooltip.js';
import ButtonCreator from './ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import { flashBackground } from './AnimationHelpers.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import Overlay from './Overlay.js';
import { pad0 } from './Common.js';
import { SectionType } from '/Shared/PlexTypes.js';
import { ServerCommands } from './Commands.js';
import { TableElements } from 'MarkerTable';

/** @typedef {!import('./Icons').IconKeys} IconKeys */
/** @typedef {!import('/Shared/PlexTypes').DetachedCommitPreviewResult} DetachedCommitPreviewResult */
/** @typedef {!import('/Shared/PlexTypes').DetachedPendingChange} DetachedPendingChange */
/** @typedef {!import('/Shared/PlexTypes').DetachedPendingMediaGroup} DetachedPendingMediaGroup */
/** @typedef {!import('/Shared/PlexTypes').DetachedPendingSectionGroup} DetachedPendingSectionGroup */
/** @typedef {!import('/Shared/PlexTypes').DetachedStatus} DetachedStatus */


const Log = ContextualLog.Create('DetachedModeManager');

/** @type {DetachedModeManager} */
let Instance;

/**
 * Manages the detached mode status indicator and overlay, which allow users to stage
 * edits before applying them to live data. The manager handles all interactions with
 * the server related to detached mode, including refreshing status, generating commit
 * previews, and performing detached actions like commit, discard, and undo.
 */
class DetachedModeManager {
    /** @type {HTMLDivElement} */
    #statusContainer = $('#status');

    /** @type {HTMLInputElement} */
    #indicator;

    /** @type {HTMLElement} */
    #focusBack;

    /** @type {DetachedStatus} */
    #status;

    /** @type {DetachedCommitPreviewResult} */
    #preview;

    /** @type {DetachedCommitPreviewResult} */
    #nonInvasivePreview;

    /** Tracks whether the user explicitly requested preview data in the current overlay session. */
    #previewRequested = false;

    /** @type {boolean} */
    #undoInProgress = false;

    static CreateInstance() {
        if (Instance) {
            Log.warn('DetachedModeManager.CreateInstance called, but an instance already exists.');
            return;
        }

        Instance = new DetachedModeManager();
        Instance.initialize();
    }

    initialize() {
        this.#buildIndicator();
        this.refreshStatus();
    }

    isActive() {
        return this.#status?.active;
    }

    /**
     * Show the detached mode overlay.
     * @param {HTMLElement} [focusBack]
     * @param {boolean} [includePreview=false] */
    async showOverlay(focusBack, includePreview=false) {
        this.#focusBack = focusBack ?? this.#indicator;
        if (!includePreview) {
            // Default overlay open is status-only; preview is opt-in because it queries live DB.
            this.#previewRequested = false;
        }

        const refreshed = await this.refreshStatus(includePreview, true /*includeNonInvasivePreview*/);
        if (!refreshed) {
            errorResponseOverlay(
                'Unable to retrieve detached mode status.',
                'The server may still be restarting. Please try again.');
            return;
        }

        await Overlay.build(
            { dismissible : true, focusBack : this.#focusBack },
            this.#buildOverlay());
    }

    /**
     * Refresh current detached status and update the indicator.
     * @param {boolean} [includePreview=false]
     * @param {boolean} [includeNonInvasivePreview=false] */
    async refreshStatus(includePreview=false, includeNonInvasivePreview=false) {
        if (!this.#indicator) {
            return false;
        }

        this.#setIndicatorState(
            'Detached Mode Loading...',
            Icons.Loading,
            ThemeColors.Primary,
            'detachedModeLoading');

        const em = err => err?.message ?? err;
        try {
            this.#status = await ServerCommands.detachedStatus();

            if (!this.#status.active) {
                this.#preview = null;
                this.#nonInvasivePreview = null;
                this.#previewRequested = false;
            }

            if (includePreview && this.#status.active) {
                this.#previewRequested = true;
                this.#preview = null;
                try {
                    this.#preview = await ServerCommands.detachedCommitPreview(true /*includeLiveImpact*/);
                    this.#nonInvasivePreview = this.#preview;
                } catch (err) {
                    Log.verbose(em(err), 'Detached preview unavailable');
                }
            } else if (!this.#previewRequested && includeNonInvasivePreview) {
                this.#preview = null;
                if (this.#status.active) {
                    try {
                        this.#nonInvasivePreview = await ServerCommands.detachedCommitPreview(false /*includeLiveImpact*/);
                    } catch (err) {
                        this.#nonInvasivePreview = null;
                        Log.verbose(em(err), 'Detached non-invasive preview unavailable');
                    }
                }
            }

            this.#updateIndicatorFromStatus();
            return true;
        } catch (err) {
            Log.warn(em(err), 'Could not refresh detached mode status');
            this.#status = null;
            this.#preview = null;
            this.#setIndicatorState(
                'Detached Mode Unavailable',
                Icons.Cancel,
                ThemeColors.Red,
                'detachedModeError');
            this.#setIndicatorVisible(false);
            return false;
        }
    }

    /**
     * Builds the detached mode status indicator that is visible at the top of
     * the page when detached mode is active. */
    #buildIndicator() {
        if (!this.#statusContainer) {
            Log.error('Could not initialize detached mode indicator, #status was not found.');
            return;
        }

        this.#indicator = ButtonCreator.fullButton(
            'Detached Mode Loading...',
            Icons.Loading,
            ThemeColors.Primary,
            (_e, self) => this.showOverlay(self),
            { id : 'detachedModeIndicator', class : 'detachedModeIndicator' });
        this.#indicator.classList.add('hidden');

        $clear(this.#statusContainer);
        this.#statusContainer.appendChild(this.#indicator);
    }

    /**
     * Update indicator text/icon and normalize state classes.
     * @param {string} text
     * @param {keyof IconKeys} icon
     * @param {string} color
     * @param {string} stateClass */
    #setIndicatorState(text, icon, color, stateClass) {
        ButtonCreator.setText(this.#indicator, text);
        ButtonCreator.setIcon(this.#indicator, icon, color);

        this.#indicator.classList.remove('detachedModeActive', 'detachedModeInactive', 'detachedModeError', 'detachedModeLoading');
        this.#indicator.classList.add(stateClass);
    }

    /**
     * @param {boolean} visible */
    #setIndicatorVisible(visible) {
        this.#indicator.classList.toggle('hidden', !visible);
    }

    #updateIndicatorFromStatus() {
        if (!this.#status) {
            this.#setIndicatorState(
                'Detached Mode Unavailable',
                Icons.Cancel,
                ThemeColors.Red,
                'detachedModeError');
            this.#setIndicatorVisible(false);
            return;
        }

        if (!this.#status.active) {
            this.#setIndicatorState(
                'Detached Mode Disabled',
                Icons.Settings,
                ThemeColors.Primary,
                'detachedModeInactive');
            this.#setIndicatorVisible(false);
            return;
        }

        this.#setIndicatorState('Detached Mode Active', Icons.Info, ThemeColors.Primary, 'detachedModeActive');
        this.#setIndicatorVisible(true);
    }

    #buildOverlay() {
        const description = this.#status.active ?
            'Detached mode is active. New edits are staged and not yet applied to live data.' :
            'Detached mode is currently off.';

        const overlayBody = $append(
            $div({ class : 'sectionOptionsOverlayContainer detachedModeOverlayContainer' }),
            $h(2, 'Detached Mode'),
            $div(
                { class : 'detachedModeDescription' },
                description),
            $hr());

        if (this.#status.active) {
            this.#appendActiveSummary(overlayBody);
        } else {
            overlayBody.appendChild($div(
                { class : 'detachedModeHint' },
                'Start detached mode to stage marker edits before committing or discarding.'));
        }

        overlayBody.appendChild(this.#buildButtons());
        return overlayBody;
    }

    /**
     * @param {HTMLElement} overlayBody */
    #appendActiveSummary(overlayBody) {
        const preview = this.#preview;
        const basicPreview = preview ?? this.#nonInvasivePreview;
        const hasPreview = !!preview;
        const hasBasicPreview = !!basicPreview;
        const previewNotReady = this.#previewRequested ? 'Unavailable' : 'Not generated';
        const touchedCount = hasBasicPreview ? `${basicPreview.touchedParentIds.length}` : previewNotReady;
        const commitImpact = preview?.commit;
        const pendingChangeCount = hasBasicPreview ? `${this.#pendingChangeCount()}` : previewNotReady;
        const deletedCount = hasPreview ? `${commitImpact.deletedMarkers}` : previewNotReady;
        const insertedCount = hasPreview ? `${commitImpact.insertedMarkers}` : previewNotReady;
        const remapCount = hasPreview ? `${commitImpact.potentialRemappedMarkerIds}` : previewNotReady;
        const remapTooltip = 'Estimated number of newly inserted markers whose IDs may change when committing to live data. ' +
            'This can happen when live and detached databases assign different marker IDs. Marker timing/content is unchanged.';

        const summary = $append(
            $div({ class : 'detachedModeSummary' }),
            this.#summaryRow('Started', this.#friendlyDate(this.#status.startedAt)),
            this.#summaryRow('Touched Items', touchedCount),
            this.#summaryRow('Pending Changes', pendingChangeCount),
            this.#summaryRow('Markers Deleted', deletedCount),
            this.#summaryRow('Markers Inserted', insertedCount),
            this.#summaryRow(this.#summaryLabelWithTooltip('Potential ID Remaps', remapTooltip), remapCount));

        overlayBody.appendChild(summary);
        overlayBody.appendChild(this.#buildPendingChangesView());
        overlayBody.appendChild($div(
            { class : 'detachedModeHint' },
            'Use Commit to apply all staged changes to live data, Discard to throw them away, or Undo on specific rows.'));
    }

    #buildButtons() {
        const buttons = [];
        if (this.#status.active) {
            const hasKnownPending = !!(this.#preview || this.#nonInvasivePreview);
            const hasChanges = hasKnownPending ? this.#pendingChangeCount() > 0 : true;
            const commitClass = hasChanges ?
                'detachedModeAction confirm' :
                'detachedModeAction disabled';
            const commitColor = hasChanges ? ThemeColors.Green : ThemeColors.Primary;

            buttons.push(ButtonCreator.fullButton(
                'Commit',
                Icons.Confirm,
                commitColor,
                this.#startCommit.bind(this),
                { class : commitClass, id : 'commitDetachedButton' }));

            buttons.push(ButtonCreator.fullButton(
                'Discard',
                Icons.Delete,
                ThemeColors.Red,
                this.#startDiscard.bind(this),
                { class : 'detachedModeAction warning', id : 'discardDetachedButton' }));

            const previewText = this.#previewRequested ? 'Refresh Preview' : 'Show Preview';
            const previewIcon = this.#previewRequested ? Icons.Restart : Icons.Table;
            buttons.push(ButtonCreator.fullButton(
                previewText,
                previewIcon,
                ThemeColors.Primary,
                (_e, self) => this.showOverlay(self, true /*includePreview*/),
                {
                    class : 'detachedModeAction',
                    id : 'previewDetachedButton',
                    tooltip : 'Queries the live database to estimate commit impact and ID remaps before applying changes.'
                }));
        } else {
            buttons.push(ButtonCreator.fullButton(
                'Enter Detached Mode',
                Icons.Settings,
                ThemeColors.Primary,
                this.#startDetached.bind(this),
                { class : 'detachedModeAction confirm', id : 'enterDetachedButton' }));

            buttons.push(ButtonCreator.fullButton(
                'Refresh',
                Icons.Restart,
                ThemeColors.Primary,
                (_e, self) => this.showOverlay(self),
                { class : 'detachedModeAction', id : 'refreshDetachedButton' }));
        }

        buttons.push(ButtonCreator.fullButton(
            'Back',
            Icons.Back,
            ThemeColors.Primary,
            Overlay.dismiss,
            { class : 'detachedModeAction', id : 'backDetachedButton' }));

        return $divHolder({ class : 'detachedModeButtons' }, ...buttons);
    }

    /**
     * Returns the total number of pending changes across all sections. */
    #pendingChangeCount() {
        return this.#pendingSections().reduce((sectionCount, section) =>
            sectionCount + section.media.reduce((mediaCount, media) => mediaCount + media.rows.length, 0),
        0);
    }

    /** @returns {DetachedPendingSectionGroup[]} */
    #pendingSections() {
        return this.#preview?.pendingChanges || this.#nonInvasivePreview?.pendingChanges || [];
    }

    #buildPendingChangesView() {
        const sections = this.#pendingSections();
        if (sections.length === 0) {
            if (this.#preview || this.#nonInvasivePreview) {
                return $div(
                    { class : 'detachedModeHint detachedPendingEmpty' },
                    'No pending marker edits to review.');
            }

            if (!this.#previewRequested) {
                return $div(
                    { class : 'detachedModeHint detachedPendingEmpty' },
                    'Preview not generated yet. Click Show Preview to query live data and estimate commit impact.');
            }

            return $div(
                { class : 'detachedModeHint detachedPendingEmpty' },
                'Detailed preview is unavailable right now. Resume the server and refresh to review pending marker edits.');
        }

        const container = $div({ class : 'detachedPendingContainer', id : 'detachedPendingContainer' });
        for (const section of sections) {
            container.appendChild(this.#buildPendingSection(section));
        }

        return container;
    }

    /**
     * @param {DetachedPendingSectionGroup} section */
    #buildPendingSection(section) {
        const sectionContainer = $append(
            $div({ class : 'detachedPendingSection' }),
            $hr(),
            $h(3, section.sectionName));

        for (const media of section.media) {
            sectionContainer.appendChild(this.#buildPendingMedia(section, media));
        }

        return sectionContainer;
    }

    /**
     * @param {DetachedPendingSectionGroup} section
     * @param {DetachedPendingMediaGroup} media */
    #buildPendingMedia(section, media) {
        const mediaTitle = section.sectionType === SectionType.Movie && media.mediaYear ?
            `${media.mediaTitle} (${media.mediaYear})` :
            media.mediaTitle;

        const mediaContainer = $append(
            $div({ class : 'detachedPendingMedia' }),
            $h(4, mediaTitle, { class : 'detachedPendingMediaTitle' }));

        const table = $table({ class : 'markerTable detachedPendingTable' });
        table.appendChild(this.#buildPendingTableHeader(section.sectionType));
        const body = $tbody();
        for (const row of media.rows) {
            body.appendChild(this.#buildPendingTableRow(section.sectionType, row));
        }

        table.appendChild(body);
        mediaContainer.appendChild(table);
        return mediaContainer;
    }

    /**
     * @param {number} sectionType */
    #buildPendingTableHeader(sectionType) {
        const headerRow = $tr();
        headerRow.appendChild($th('Change'));
        headerRow.appendChild($th('Type'));
        if (sectionType === SectionType.TV) {
            headerRow.appendChild($th('Episode'));
        }

        headerRow.appendChild($th('Start Time', { class : 'shortTimeColumn centeredColumn' }));
        headerRow.appendChild($th('End Time', { class : 'shortTimeColumn centeredColumn' }));
        headerRow.appendChild($th('Date Added', { class : 'timeColumn centeredColumn detachedDateColumn' }));
        headerRow.appendChild($th('Options', { class : 'centeredColumn' }));
        return $thead(headerRow);
    }

    /**
     * @param {number} sectionType
     * @param {DetachedPendingChange} change */
    #buildPendingTableRow(sectionType, change) {
        const row = $tr({ id : `detachedPendingRow_${change.markerId}` });
        row.appendChild($td(this.#operationLabel(change.operation)));
        row.appendChild($td(change.markerType));

        if (sectionType === SectionType.TV) {
            row.appendChild($td(this.#episodeCode(change), { class : 'centeredColumn' }));
        }

        row.appendChild($td(TableElements.timeData(change.start), { class : 'centeredColumn' }));
        row.appendChild($td(TableElements.timeData(change.end), { class : 'centeredColumn' }));
        row.appendChild($td(this.#friendlyDate(change.createdAt), { class : 'centeredColumn detachedDateColumn' }));

        const undoButton = ButtonCreator.dynamicButton(
            'Undo',
            Icons.Back,
            ThemeColors.Primary,
            (_e, self) => this.#undoPendingChange(change, self),
            { class : 'detachedPendingUndoButton' });

        row.appendChild($td($append($div({ class : 'detachedPendingRowOptions' }), undoButton), { class : 'centeredColumn' }));
        return row;
    }

    /**
     * @param {string} operation */
    #operationLabel(operation) {
        switch (operation) {
            case 'add':
                return 'Added';
            case 'delete':
                return 'Deleted';
            case 'edit':
                return 'Edited';
            default:
                return operation;
        }
    }

    /**
     * @param {DetachedPendingChange} change */
    #episodeCode(change) {
        const season = pad0(change.seasonIndex || 0, 2);
        const episode = pad0(change.episodeIndex || 0, 2);
        const code = $span(`S${season}E${episode}`, { class : 'detachedPendingEpisodeCode' });
        if (change.episodeTitle) {
            Tooltip.setTooltip(code, change.episodeTitle, { textSize : TooltipTextSize.Smaller });
        }

        return code;
    }

    /**
     * @param {number} epoch */
    #friendlyDate(epoch) {
        const ms = epoch * 1000;
        const friendly = $span(DateUtil.getDisplayDate(ms));
        Tooltip.setTooltip(friendly, DateUtil.getFullDate(ms), { textSize : TooltipTextSize.Smaller });
        return friendly;
    }

    /**
     * @param {DetachedPendingChange} change
     * @param {HTMLElement} button */
    async #undoPendingChange(change, button) {
        if (this.#undoInProgress) {
            return;
        }

        this.#undoInProgress = true;
        button.classList.add('disabled');
        ButtonCreator.setText(button, 'Undoing...');
        ButtonCreator.setIcon(button, Icons.Loading, ThemeColors.Primary);

        try {
            await ServerCommands.detachedUndoChange(change.markerId);
            await this.refreshStatus(true /*includePreview*/);
            Overlay.replace(this.#buildOverlay());
        } catch (err) {
            errorResponseOverlay(
                `Failed to undo pending change for marker ${change.markerId}.`,
                err,
                () => this.showOverlay(this.#focusBack));
        } finally {
            this.#undoInProgress = false;
        }
    }

    /**
     * @param {string|HTMLElement} label
     * @param {string} value */
    #summaryRow(label, value) {
        const labelNode = typeof label === 'string' ? `${label}:` : label;
        return $append(
            $div({ class : 'detachedModeSummaryRow' }),
            $span(labelNode, { class : 'detachedModeSummaryLabel' }),
            $span(value, { class : 'detachedModeSummaryValue' }));
    }

    /**
     * @param {string} label
     * @param {string} tooltip
     * @returns {HTMLSpanElement} */
    #summaryLabelWithTooltip(label, tooltip) {
        const icon = $span(
            getSvgIcon(Icons.Help, ThemeColors.Primary, { width : 12, height : 12 }),
            { class : 'detachedSummaryHelpIcon' });
        Tooltip.setTooltip(icon, tooltip, { textSize : TooltipTextSize.Smaller, maxWidth : 420 });

        return $append(
            $span(null, { class : 'detachedModeSummaryLabelWithHelp' }),
            $span(`${label}:`),
            icon);
    }

    /**
     * After a successful action, briefly flash the button and then show a prompt to reload the page.
     * @param {HTMLDivElement} button
     * @param {keyof IconKeys} icon
     * @param {string} color
     * @param {string} title
     * @param {string} message */
    #successfulAction(button, icon, color, title, message) {
        ButtonCreator.setIcon(button, icon, color);
        flashBackground(button, Theme.getHex(ThemeColors.Green, 4), 500, () => {
            this.#showReloadPrompt(title, message);
        });
    }

    /**
     * After a failed action, briefly flash the button, show an error overlay,
     * and return to the detached mode overlay on dismissal.
     * @param {HTMLDivElement} button
     * @param {keyof IconKeys} icon
     * @param {string} color
     * @param {string} title
     * @param {string} message */
    #failedAction(button, icon, color, err, message) {
        ButtonCreator.setIcon(button, icon, color);
        flashBackground(button, Theme.getHex(ThemeColors.Red, 4), 500, () => {
            errorResponseOverlay(
                message,
                err,
                () => this.showOverlay(this.#focusBack));
        });
    }

    /**
     * Attempt to enter detached mode.
     * @param {Event} _e
     * @param {HTMLDivElement} btn */
    async #startDetached(_e, btn) {
        try {
            ButtonCreator.setIcon(btn, Icons.Loading, ThemeColors.Primary);
            await ServerCommands.detachedStart();
            this.#successfulAction(btn, Icons.Settings, ThemeColors.Primary,
                'Detached mode started.',
                'Reload to continue editing with staged changes enabled.');
        } catch (err) {
            this.#failedAction(btn, Icons.Settings, ThemeColors.Primary, err,
                'Failed to start detached mode.');
        }
    }

    /**
     * Attempt to commit detached changes.
     * @param {Event} _e
     * @param {HTMLDivElement} btn */
    async #startCommit(_e, btn) {
        const hasChanges = (this.#preview || this.#nonInvasivePreview) ? this.#pendingChangeCount() > 0 : true;
        const commitColor = hasChanges ? ThemeColors.Green : ThemeColors.Primary;
        try {
            ButtonCreator.setIcon(btn, Icons.Loading, commitColor);
            await ServerCommands.detachedCommit();
            this.#successfulAction(btn, Icons.Confirm, ThemeColors.Green,
                'Detached changes were committed.',
                'Reload to continue editing against live data.');
        } catch (err) {
            this.#failedAction(btn, Icons.Confirm, commitColor, err,
                'Failed to commit detached changes.');
        }
    }

    /**
     * Attempt to discard detached changes.
     * @param {Event} _e
     * @param {HTMLDivElement} btn */
    async #startDiscard(_e, btn) {
        try {
            ButtonCreator.setIcon(btn, Icons.Loading, ThemeColors.Red);
            await ServerCommands.detachedDiscard();
            this.#successfulAction(btn, Icons.Delete, ThemeColors.Red,
                'Detached changes were discarded.',
                'Reload to continue editing against live data.');
        } catch (err) {
            this.#failedAction(btn, Icons.Delete, ThemeColors.Red, err,
                'Failed to discard detached changes.');
        }
    }

    /**
     * @param {string} title
     * @param {string} message */
    async #showReloadPrompt(title, message) {
        await Overlay.show(
            $textSpan(title, $br(), $br(), message),
            'Reload',
            () => window.location.reload(),
            false);
    }
}

export { DetachedModeManager, Instance as DetachedMode };
