import { $, $$, $append, $br, $clear, $div, $divHolder, $h, $hr, $label, $node, $option, $select, $span, $table, $tbody,
    $td, $textSpan, $thead, toggleClass } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { pad0 } from './Common.js';

import {
    AgnosticPurgeCache,
    PurgeCacheStatus,
    PurgedEpisode,
    PurgedMovie,
    PurgedMovieSection,
    PurgedSeason,
    PurgedServer,
    PurgedShow,
    PurgedTVSection } from './PurgedMarkerCache.js';
import { animateOpacity, flashBackground, slideUp } from './AnimationHelpers.js';
import { errorMessage, errorResponseOverlay } from './ErrorHandling.js';
import { MarkerConflictResolution, MarkerData, SectionType } from '/Shared/PlexTypes.js';
import { Theme, ThemeColors } from './ThemeColors.js';
import ButtonCreator from './ButtonCreator.js';
import { CustomEvents } from './CustomEvents.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { ServerCommands } from './Commands.js';
import { TableElements } from 'MarkerTable';

/** @typedef {!import('/Shared/PlexTypes').MarkerAction} MarkerAction */
/** @typedef {!import('../../Server/PlexQueryManager').RawMarkerData} RawMarkerData */
/** @typedef {!import('/Shared/PlexTypes').MarkerDataMap} MarkerDataMap */
/** @typedef {!import('/Shared/PlexTypes').PurgeSection} PurgeSection */
/** @typedef {!import('./PurgedMarkerCache').PurgedGroup} PurgedGroup */
/** @typedef {!import('./PurgedMarkerCache').PurgedSection} PurgedSection */


const Log = ContextualLog.Create('PurgedManager');

/**
 * A class that holds the information relevant for a button callback
 * that makes a request to the server.
 */
class PurgeActionInfo {
    static #nop = () => {};

    /** @type {string} */
    text;
    /** @type {string} */
    icon;
    /** @type {(newMarkers: MarkerDataMap, deletedMarkers: MarkerDataMap, modifiedMarkers: MarkerDataMap) => void} */
    successFn;
    /** @type {() => void} */
    failureFn;

    /**
     * @param {string} text Button text.
     * @param {string} icon The icon to use for the button.
     * @param {(...any) => any} successFn Function invoked when the server request succeeds.
     * @param {(...any) => any} failureFn Function invoked when the serve request fails. */
    constructor(text, icon, successFn, failureFn) {
        this.text = text;
        this.icon = icon;
        this.successFn = successFn || PurgeActionInfo.#nop;
        this.failureFn = failureFn || PurgeActionInfo.#nop;
    }
}

/**
 * A class that holds the information relevant for a button callback
 * that changes UI state, but does not make a request to the server.
 */
class PurgeNonActionInfo {
    /** @type {string} */
    text;
    /** @type {string} */
    icon;
    /** @type {() => void} */
    callback;

    /**
     * @param {string} text The button text.
     * @param {string} icon The button icon.
     * @param {() => void} callback The callback to invoke when the button is clicked, if any. */
    constructor(text, icon, callback) {
        this.text = text;
        this.icon = icon;
        this.callback = callback || (() => {});
    }
}

/**
 * Encapsulates the restore/ignore interactions for the purge overlay. Can be
 * used at any level, i.e. at the section, season, or individual marker level.
 */
class PurgeOptions {
    /** @type {HTMLElement} */
    #parent;
    /** @type {boolean} */
    #inOperation;
    /** @type {PurgeActionInfo} */
    #restoreInfo;
    /** @type {PurgeNonActionInfo} */
    #ignoreInfo;
    /** @type {PurgeActionInfo} */
    #ignoreConfirmInfo;
    /** @type {PurgeNonActionInfo} */
    #ignoreCancelInfo;
    /** @type {() => MarkerAction[]} */
    #getMarkersFn;

    /** @param {HTMLElement} parent The element that will hold this class's HTML. */
    constructor(parent) {
        this.#parent = parent;
    }

    /**
     * Create the restore/ignore buttons and add them to the parent element.
     * @param {PurgeActionInfo} restoreInfo Properties for the 'Restore' button.
     * @param {PurgeNonActionInfo} ignoreInfo Properties for the 'Ignore' button.
     * @param {PurgeActionInfo} ignoreConfirmInfo Properties for the 'Confirm ignore' button.
     * @param {PurgeNonActionInfo} ignoreCancelInfo Properties for the 'Cancel ignore' button.
     * @param {() => MarkerAction[]} getMarkersFn Function that returns the list of marker this class applies to. */
    addButtons(restoreInfo, ignoreInfo, ignoreConfirmInfo, ignoreCancelInfo, getMarkersFn, dynamicButtons=false) {
        this.#restoreInfo = restoreInfo;
        this.#ignoreInfo = ignoreInfo;
        this.#ignoreConfirmInfo = ignoreConfirmInfo;
        this.#ignoreCancelInfo = ignoreCancelInfo;
        this.#getMarkersFn = getMarkersFn;
        const buttonFn = dynamicButtons ? ButtonCreator.dynamicButton : ButtonCreator.fullButton;
        $append(this.#parent,
            buttonFn(
                restoreInfo.text,
                restoreInfo.icon,
                ThemeColors.Green,
                this.#onRestore.bind(this),
                { class : 'restoreButton' }),
            buttonFn(
                ignoreInfo.text,
                ignoreInfo.icon,
                ThemeColors.Red,
                this.#onIgnoreClick.bind(this),
                { class : 'ignoreButton' }),
            buttonFn(
                ignoreConfirmInfo.text,
                Icons.Confirm,
                ThemeColors.Green,
                this.#onIgnoreConfirm.bind(this),
                { class : 'ignoreConfirm hidden' }),
            buttonFn(
                ignoreCancelInfo.text,
                Icons.Cancel,
                ThemeColors.Red,
                this.#onIgnoreCancel.bind(this),
                { class : 'ignoreCancel hidden' })
        );
    }

    /** Reset the current view after cancelling an 'ignore' or after a failed operation */
    resetViewState() {
        this.#exitOperation();
        this.#onIgnoreCancel();
    }

    /**
     * Marks this action as in progress, preventing other actions on the same
     * set of markers from going through.
     * @returns {boolean} Whether it's okay to begin the operation.
     */
    #enterOperation() {
        if (this.#inOperation) {
            Log.verbose('Already in an operation, ignoring action click.');
            return false;
        }

        this.#inOperation = true;
        return true;
    }

    /** Exit the current operation, in either success or failure. */
    #exitOperation() {
        if (!this.#inOperation) {
            Log.warn(`Attempting to exit an action that wasn't set!`);
        }

        this.#inOperation = false;
    }

    /** Kicks off the restoration process for the markers this operation applies to. */
    async #onRestore() {
        if (!this.#enterOperation()) { return; }

        const markers = this.#getMarkersFn();
        const purged = markers.filter(m => !m.readded).map(m => m.marker_id);
        const readded = markers.filter(m => m.readded).map(m => ({ oldId : m.marker_id, newId : m.readded_id }));

        Log.verbose(`Attempting to restore ${markers.length} marker(s).`);
        ButtonCreator.setIcon($$('.restoreButton', this.#parent), Icons.Loading, ThemeColors.Green);

        try {
            const restoreData = await ServerCommands.restorePurge(
                { restoreIds : purged, redeleteIds : readded },
                PlexClientState.activeSection(),
                PurgeConflictControl.CurrentResolutionType());
            const newMarkers = {};
            Object.entries(restoreData.newMarkers).forEach(
                d => newMarkers[d[0]] = d[1].map(m => new MarkerData().setFromJson(m)));

            const deletedMarkers = {};
            Object.entries(restoreData.deletedMarkers).forEach(
                d => deletedMarkers[d[0]] = d[1].map(m => new MarkerData().setFromJson(m)));

            const modifiedMarkers = {};
            Object.entries(restoreData.modifiedMarkers).forEach(
                d => modifiedMarkers[d[0]] = d[1].map(m => new MarkerData().setFromJson(m)));

            this.#resetConfirmImg('restoreButton');
            this.#restoreInfo.successFn(newMarkers, deletedMarkers, modifiedMarkers, restoreData.ignoredMarkers);
        } catch (err) {
            errorMessage(err); // For logging
            this.#resetConfirmImg('restoreButton');
            this.#restoreInfo.failureFn();
        }
    }

    /** Resets the 'confirm' image icon after getting a response from a restore/ignore request. */
    #resetConfirmImg(className) {
        ButtonCreator.setIcon($$(`.${className}`, this.#parent), Icons.Confirm, ThemeColors.Green);
    }

    /** Shows the confirmation buttons after 'Ignore' is clicked. */
    #onIgnoreClick() {
        if (this.#inOperation) { return; }

        $$('.restoreButton', this.#parent).classList.add('hidden');
        $$('.ignoreButton', this.#parent).classList.add('hidden');
        $$('.ignoreConfirm', this.#parent).classList.remove('hidden');
        $$('.ignoreCancel', this.#parent).classList.remove('hidden');
        $$('.ignoreCancel', this.#parent).focus();
        this.#ignoreInfo.callback();
    }

    /** Kicks off the ignore process for the markers this operation applies to. */
    async #onIgnoreConfirm() {
        if (!this.#enterOperation()) { return; }

        const markers = this.#getMarkersFn();
        const purged = markers.filter(m => !m.readded).map(m => m.marker_id);
        const readded = markers.filter(m => m.readded).map(m => m.marker_id);
        Log.verbose(`Attempting to ignore ${markers.length} marker(s).`);
        ButtonCreator.setIcon($$('.ignoreConfirm', this.#parent), Icons.Loading, ThemeColors.Green);

        try {
            await ServerCommands.ignorePurge(purged, readded, PlexClientState.activeSection());
            this.#resetConfirmImg('ignoreConfirm');
            this.#ignoreConfirmInfo.successFn();
        } catch (err) {
            errorMessage(err); // For logging
            this.#resetConfirmImg('ignoreConfirm');
            this.#ignoreConfirmInfo.failureFn();
        }
    }

    /** Resets the operation view after the user cancels the ignore operation. */
    #onIgnoreCancel() {
        $$('.restoreButton', this.#parent).classList.remove('hidden');
        $$('.ignoreButton', this.#parent).classList.remove('hidden');
        $$('.ignoreConfirm', this.#parent).classList.add('hidden');
        $$('.ignoreCancel', this.#parent).classList.add('hidden');
        this.#ignoreCancelInfo.callback();
    }
}

/**
 * The PurgeRow represents a single row in the PurgeTable.
 */
class PurgeRow {

    /** @type {MarkerAction} */
    #markerAction;

    /**
     * Callback to invoke after the table this row belongs to is empty.
     * @type {() => void} */
    #emptyTableCallback;

    /** Marker data converted from `#markerAction`
     * #@type {MarkerData} */
    #markerData;

    /** @type {HTMLElement} */
    #html;

    /** Cached `td`s of the main row, as `#html` can change. */
    #tableData = [];

    /** @type {PurgeOptions} */
    #purgeOptions;

    /**
     * Create a new row for a purged marker.
     * @param {MarkerAction} markerAction The action this row represents.
     * @param {() => void} emptyTableCallback Callback to invoke after the table this row belongs to is empty. */
    constructor(markerAction, emptyTableCallback) {
        this.#markerAction = markerAction;
        this.#markerData = this.#markerDataFromMarkerAction();
        this.#emptyTableCallback = emptyTableCallback;
    }

    /** Builds and returns a table row for this purged marker. */
    buildRow() {
        this.#html = TableElements.rawTableRow(...(this.customTableColumns().concat(this.#tableColumnsCommon())));

        this.#html.classList.add('purgerow');

        this.#html.id = `purgerow_${this.#markerAction.marker_id}`;

        return this.#html;
    }

    /** @returns {MarkerAction} */
    markerAction() { return this.#markerAction; }

    /** Return whether this marker is a purged marker. False indicates this is an re-added marker. */
    isPurged() { return !this.#markerAction.readded; }

    /** @returns {HTMLElement[]} */
    customTableColumns() { Log.error(`customTableColumns cannot be called directly on PurgeRow.`); return []; }

    /** @returns {HTMLElement[]} */
    #tableColumnsCommon() {
        return [
            TableElements.timeData(this.#markerAction.start),
            TableElements.timeData(this.#markerAction.end),
            TableElements.dateColumn(TableElements.friendlyDate(this.#markerData)),
            this.#addPurgeOptions()
        ];
    }

    /** Creates the restore/ignore option buttons for this row. */
    #addPurgeOptions() {
        const holder = $div({ class : 'purgeOptionsHolder' });
        this.#purgeOptions = new PurgeOptions(holder);
        const ignoreConfirm = new PurgeActionInfo('Yes', Icons.Confirm, this.#onIgnoreSuccess.bind(this), this.#onIgnoreFailed.bind(this));
        const ignoreCancel = new PurgeNonActionInfo('No', Icons.Cancel, this.#onIgnoreCancel.bind(this));
        if (this.#markerAction.readded) {
            this.#purgeOptions.addButtons(
                new PurgeActionInfo('Re-delete', Icons.Delete, this.#onRestoreSuccess.bind(this), this.#onRestoreFail.bind(this)),
                new PurgeNonActionInfo('Ignore', Icons.Confirm, this.#onIgnore.bind(this)),
                ignoreConfirm,
                ignoreCancel,
                /**@this {PurgeRow}*/function() { return [this.#markerAction]; }.bind(this),
                true /*dynamicButtons*/
            );
        } else {
            this.#purgeOptions.addButtons(
                new PurgeActionInfo('Restore', Icons.Confirm, this.#onRestoreSuccess.bind(this), this.#onRestoreFail.bind(this)),
                new PurgeNonActionInfo('Ignore', Icons.Delete, this.#onIgnore.bind(this)),
                ignoreConfirm,
                ignoreCancel,
                /**@this {PurgeRow}*/function() { return [this.#markerAction]; }.bind(this),
                true /*dynamicButtons*/
            );
        }

        return holder;
    }

    /** Sends a notification to the client state that a marker has been restored/ignored.
     * @param {MarkerDataMap} _new The newly restored marker as a single element array, or null if the purged marker was ignored
     * @param {MarkerDataMap} _del Array of deleted markers as a result of the restoration (or null as above)
     * @param {MarkerDataMap} _mod Array of edited markers as a result of the restore (or null as above) */
    notifyPurgeChange(_new=null, _del=null, _mod=null) { Log.error(`notifyPurgeChange should not be called on the base class.`); }

    /**
     * Animation triggered after a table row is successfully restored/ignored.
     * The row is deleted after the animation completes.
     * @param {string} successColor The color to flash the table row. */
    #animateRowActionSuccess(successColor) {
        // Three phases to the animation, since table rows are limited in how their height can be adjusted:
        // 1. Flash row green for 750ms
        // 2. Fade out row for 250ms, starting at 500ms
        // 3. Clear out row content, slide up row in 250ms.

        // First need to explicitly set tr height so it doesn't immediately shrink when we clear the element
        this.#html.style.height = this.#html.getBoundingClientRect().height + 'px';
        flashBackground(this.#html, successColor, 750);
        animateOpacity(this.#html, 1, 0, { duration : 250, delay : 500 }, () => {
            $clear(this.#html);
            slideUp(this.#html, 250, this.#removeSelfAfterAnimation.bind(this));
        });
    }

    /** Callback when a marker was successfully restored. Flashes the row and then removes itself.
     * @param {MarkerDataMap} newMarker The newly restored marker, in the form of a single-element array.
     * @param {MarkerDataMap} deletedMarkers Any markers deleted as a result of this restore.
     * @param {MarkerDataMap} modifiedMarkers Any modified existing markers as a result of this restore. */
    #onRestoreSuccess(newMarker, deletedMarkers, modifiedMarkers) {
        this.#animateRowActionSuccess(Theme.getHex(ThemeColors.Green, 6));
        this.notifyPurgeChange(newMarker, deletedMarkers, modifiedMarkers);
    }

    /**
     * Flash the background color of this row.
     * @param {string} color Color category to flash
     * @param {(any) => any} [callback] Optional callback to invoke after the animation completes. */
    #flashHtml(color, callback) {
        return flashBackground(this.#html, Theme.getHex(color, 4), 1000, callback);
    }

    /** Callback when a marker failed to be restored. Flashes the row and then resets back to its original state. */
    #onRestoreFail() {
        this.#showRowMessage('Restoration failed. Please try again later.');
        this.#flashHtml(ThemeColors.Red, this.#resetSelfAfterAnimation.bind(this));
    }

    /** After an animation completes, remove itself from the table. */
    #removeSelfAfterAnimation() {
        const parent = this.#html.parentElement;
        parent.removeChild(this.#html);
        if (parent.children.length === 0) {
            this.#emptyTableCallback();
        }
    }

    /** After an animation completes, restore the row to its original state. */
    #resetSelfAfterAnimation() {
        this.#purgeOptions.resetViewState();
    }

    /** Callback when the user clicks 'Ignore'. Replaces the row with an 'Are you sure' prompt. */
    #onIgnore() {
        if (this.#markerAction.readded) {
            this.#showRowMessage('Are you sure you want keep this previously deleted marker?');
        } else {
            this.#showRowMessage('Are you sure you want to permanently ignore this marker?');
        }
    }

    /** Callback when the user decides to cancel the ignore operation, resetting the row to its original state. */
    #onIgnoreCancel() {
        this.#restoreTableData();
    }

    /** Callback when a marker was successfully ignored. Flash the row and remove it. */
    #onIgnoreSuccess() {
        this.#animateRowActionSuccess(Theme.getHex(ThemeColors.Green, 4));
        this.notifyPurgeChange({}, {}, {});
    }

    /** Callback when a marker failed to be ignored. Flash the row and reset it back to its original state. */
    #onIgnoreFailed() {
        this.#html.children[0].innerText = 'Sorry, something went wrong. Please try again later.';
        this.#flashHtml(ThemeColors.Red, this.#resetSelfAfterAnimation.bind(this));
    }

    #showRowMessage(message) {
        this.#backupTableData();
        for (let i = 0; i < this.#backupLength(); ++i) {
            this.#html.removeChild(this.#html.firstChild);
        }

        this.#html.insertBefore(
            $td(message, { colspan : this.#backupLength(), class : 'spanningTableRow' }),
            this.#html.firstChild);
    }

    /** Backs up the main content of the row in preparation of `#html` being cleared out. */
    #backupTableData() {
        if (this.#tableData.length !== 0) {
            return;
        }

        for (let i = 0; i < this.#backupLength(); ++i) {
            this.#tableData.push(this.#html.children[i]);
        }
    }

    /** Restores the main content of this row with the backed up data. */
    #restoreTableData() {
        this.#html.removeChild(this.#html.firstChild);
        for (let i = this.#backupLength() - 1; i >= 0; --i) {
            this.#html.insertBefore(this.#tableData[i], this.#html.firstChild);
        }
    }

    /** Translates MarkerAction columns to RawMarkerData, or as close as we can get. */
    #markerDataFromMarkerAction() {
        /** @type {RawMarkerData} */
        const rawMarkerData = {
            id : this.#markerAction.marker_id,
            index : -1,
            start : this.#markerAction.start,
            end : this.#markerAction.end,
            modified_date : this.#markerAction.modified_at,
            created_at : this.#markerAction.created_at,
            parent_id : this.#markerAction.parent_id,
            season_id : this.#markerAction.season_id,
            show_id : this.#markerAction.show_id,
            section_id : PlexClientState.activeSection(),
            marker_type : this.#markerAction.marker_type,
            final : this.#markerAction.final,
            user_created : this.#markerAction.user_created,
        };

        return new MarkerData(rawMarkerData);
    }

    /**
     * The number of columns in this row. TV shows have 6, movies have 5. */
    tableColumns() { return 5; }

    /**
     * The number of columns to backup and clear out when showing an inline row message.
     * Note: this is one less than the number of columns, since we treat the options row differently. */
    #backupLength() { return this.tableColumns() - 1; }
}

/**
 * A PurgeRow for a marker that belongs to a TV episode, mainly differing in the
 * addition of an 'episode title' row, and how notifications are send back to the client.
 */
class TVPurgeRow extends PurgeRow {
    /**
     * Return the list of columns specific to TV shows. In this case, the marker type
     * and episode title. The marker type isn't really shared, but it it makes building
     * the entire row more manageable to repeat it.
     * @returns {HTMLElement[]} */
    customTableColumns() {
        const ep = this.markerAction().episodeData;
        return [
            $span(this.markerAction().marker_type),
            $span(`S${pad0(ep.seasonIndex, 2)}E${pad0(ep.index, 2)}`, { title : ep.title }),
        ];
    }

    /**
     * Sends a notification to the client state that a marker has been restored/ignored.
     * @param {MarkerDataMap} newMarkers The newly restored marker as a single element array. Empty if the purged marker was ignored.
     * @param {MarkerDataMap} deletedMarkers Array of deleted markers as a result of the restoration (or empty as above)
     * @param {MarkerDataMap} modifiedMarkers Array of edited markers as a result of the restore (or empty as above) */
    notifyPurgeChange(newMarkers, deletedMarkers, modifiedMarkers) {
        const markerAction = this.markerAction();
        const dummyLibrary = new PurgedTVSection();
        const dummyShow = new PurgedShow(markerAction.show_id, dummyLibrary);
        const dummySeason = new PurgedSeason(markerAction.season_id, dummyShow);
        const dummyEpisode = new PurgedEpisode(markerAction.parent_id, dummySeason);
        dummyLibrary.addInternal(dummyShow.id, dummyShow);
        dummyShow.addInternal(dummySeason.id, dummySeason);
        dummySeason.addInternal(dummyEpisode.id, dummyEpisode);
        dummyEpisode.addNewMarker(markerAction);
        PurgeManagerSingleton.onPurgedMarkerAction(dummyLibrary, newMarkers, deletedMarkers, modifiedMarkers);
    }

    tableColumns() { return 6; }
}

/**
 * A PurgeRow for a marker that belongs to a movie. Unlike a TV marker row, a movie
 * marker row doesn't need to have a column indicating the title.
 */
class MoviePurgeRow extends PurgeRow {
    /**
     * @returns {HTMLElement} */
    customTableColumns() {
        return  [
            $span(this.markerAction().marker_type),
        ];
    }

    /**
     * Sends a notification to the client state that a marker has been restored/ignored.
     * @param {MarkerDataMap} newMarkers The newly restored marker as a single element array. Empty if the purged marker was ignored.
     * @param {MarkerDataMap} deletedMarkers Array of deleted markers as a result of the restoration (or empty as above)
     * @param {MarkerDataMap} modifiedMarkers Array of edited markers as a result of the restore (or empty as above) */
    notifyPurgeChange(newMarkers, deletedMarkers, modifiedMarkers) {
        const markerAction = this.markerAction();
        const dummyLibrary = new PurgedMovieSection();
        const dummyMovie = new PurgedMovie(markerAction.parent_id, dummyLibrary);
        dummyLibrary.addInternal(dummyMovie.id, dummyMovie);
        dummyMovie.addNewMarker(markerAction);
        PurgeManagerSingleton.onPurgedMarkerAction(dummyLibrary, newMarkers, deletedMarkers, modifiedMarkers);
    }
}

/**
 * Common class for handling bulk purge actions
 */
class BulkPurgeAction {
    /** @type {() => number[]} */
    #getMarkersFn;
    /** @type {() => void} */
    #successCallback;
    /** @type {HTMLElement} */
    #html;
    /** @type {PurgeOptions} */
    #options;

    /**
     * Create a new bulk purge action.
     * @param {string} id The HTML id for this action group.
     * @param {string} restoreText Text for the 'restore all' button.
     * @param {string} ignoreText Text for the 'ignore all' button.
     * @param {() => void} successCallback Callback invoked after successfully restoring or ignoring this marker group.
     * @param {() => number[]} getMarkersFn Function that returns the list of marker ids this action applies to. */
    constructor(id, restoreText, ignoreText, successCallback, getMarkersFn) {
        this.#successCallback = successCallback;
        this.#getMarkersFn = getMarkersFn;
        // Just create all four necessary buttons instead of dealing with overwriting/adding/removing
        // various button states. Just deal with hidden/visible.
        this.#html = $div({ class : 'buttonContainer', id : id });
        this.#options = new PurgeOptions(this.#html);
        this.#options.addButtons(
            new PurgeActionInfo(restoreText, Icons.Confirm, this.#onRestoreSuccess.bind(this), this.#onRestoreFail.bind(this)),
            new PurgeNonActionInfo(ignoreText, Icons.Delete),
            new PurgeActionInfo('Confirm', Icons.Confirm, this.#onIgnoreSuccess.bind(this), this.#onIgnoreFailed.bind(this)),
            new PurgeNonActionInfo('Cancel', Icons.Cancel),
            this.#getMarkersFn);
    }

    /** @returns {HTMLElement} The HTML that encapsulates this action. */
    html() { return this.#html; }

    /** Callback invoked when markers were successfully restored.
     * @param {MarkerDataMap} newMarkers Array of newly restored markers.
     * @param {MarkerDataMap} deletedMarkers
     * @param {MarkerDataMap} modifiedMarkers
     * @param {number} ignoredMarkers */
    #onRestoreSuccess(newMarkers, deletedMarkers, modifiedMarkers, ignoredMarkers) {
        this.#onActionSuccess(newMarkers, deletedMarkers, modifiedMarkers, ignoredMarkers);
    }

    /** Callback invoked when markers were unsuccessfully restored. */
    #onRestoreFail() {
        this.#options.resetViewState();
        flashBackground(this.#html, Theme.getHex(ThemeColors.Red, 4), 750);
    }

    /** Callback invoked when markers were successfully ignored. */
    #onIgnoreSuccess() {
        // Don't exit bulk update, since changes have been committed and the table should be invalid now.
        this.#onActionSuccess();
    }

    /** Callback invoked when we failed to ignore this marker group. */
    #onIgnoreFailed() {
        flashBackground(this.#html, Theme.getHex(ThemeColors.Red, 4), 1000, this.#options.resetViewState.bind(this.#options));
    }

    /** Common actions done when markers were successfully restored or ignored. */
    #onActionSuccess(newMarkers, deletedMarkers, modifiedMarkers, _ignoredMarkers) {
        // Don't exit bulk update, since changes have been committed and the table should be invalid now.
        flashBackground(this.#html, Theme.getHex(ThemeColors.Green, 6), 750, /**@this {BulkPurgeAction}*/function() {
            // TODO: find a different way to show stats, since getting here doesn't necessarily mean
            //       all markers in the overlay are taken care of, and we don't want to interrupt with an overlay.
            // const arrLen = (x) => x ? Object.values(x).reduce((sum, arr) => sum + arr.length, 0) : 0;

            // Overlay.show($plainDivHolder($h(2, `Restoration Succeeded`), $hr(),
            //     `Restored Markers: ${arrLen(newMarkers)}`, $br(),
            //     `Edited Markers: ${arrLen(modifiedMarkers)}`, $br(),
            //     `Replaced Markers: ${arrLen(deletedMarkers)}`, $br(),
            //     `Ignored Markers: ${ignoredMarkers}`));
            this.#successCallback(newMarkers, deletedMarkers, modifiedMarkers);
        }.bind(this));
    }
}

/**
 * Available purge overlay modes.
 */
const DisplayType = {
    /** Display all purged markers for a given section. */
    All : 0,
    /** Display all purged markers for a given show/movie. */
    SingleTopLevel : 1,
    /** Display all purged markers for a given season of a show. */
    SingleSeason : 2,
    /** Display a single purged marker */
    SingleEpisode : 3
};

/**
 * Represents purged markers for a single show. It may be a subset when
 * DisplayType is SingleSeason or SingleEpisode, but it groups all of them
 * into a single table.
 */
class PurgeTable {
    /** @type {PurgedGroup} */
    #purgedGroup;
    /** @type {HTMLElement} */
    #html;
    /** @type {boolean} */
    #removed;
    /** @type {() => void} */
    #removedCallback;
    /** @type {DisplayType} */
    #displayType;
    /** @type {boolean} */
    #showResolutionControl;

    /**
     * Create a new table for one or more purged markers in a single show.
     * @param {PurgedGroup} purgedGroup Group of purged markers in this show/movie.
     * @param {() => void} removedCallback Callback invoked when all markers are ignored or restored.
     * @param {DisplayType=DisplayType.All} displayType The type of overlay being shown.
     * @param {boolean} showResolutionControl Whether to show the purge resolution options.
     *                                        True for single items, false for section-wide overlay. */
    constructor(purgedGroup, removedCallback, displayType=DisplayType.All, showResolutionControl=false) {
        this.#purgedGroup = purgedGroup;
        this.#removedCallback = removedCallback;
        this.#displayType = displayType;
        this.#showResolutionControl = showResolutionControl;
        this.#removed = false;
    }

    /** @returns {HTMLElement} The HTML associated with this table. */
    html() {
        if (this.#html) {
            return this.#html;
        }

        const firstMarker = this.#purgedGroup.getAny();
        const typePrefix = (this.#purgedGroup instanceof PurgedShow) ? 'purgeshow' : 'purgemovie';
        const countPostfix = (this.#purgedGroup instanceof PurgedShow) ? firstMarker.show_id : firstMarker.parent_id;
        const container = $div({ class : 'purgeGroupContainer', id : `${typePrefix}_${countPostfix}` });
        if (this.#displayType === DisplayType.All) {
            // <hr> to break up different shows if we're showing all purges in the section
            container.appendChild($hr());
        }

        container.appendChild($h(2, this.mainTitle()));
        if (this.#showResolutionControl) {
            container.appendChild(PurgeConflictControl.GetControl());
        }

        const markers = this.markers();
        if (markers.length > 1) {
            const anyPurged = !!markers.find(m => !m.readded);
            const anyReadded = !!markers.find(m => m.readded);
            // Only show bulk operation actions if we're not showing a single marker
            container.appendChild(
                new BulkPurgeAction(
                    `${typePrefix}_bulk_${countPostfix}`,
                    (anyPurged ? anyReadded ? 'Restore/Re-Delete' : 'Restore' : 'Re-Delete') + ' All',
                    'Ignore All',
                    this.#onBulkActionSuccess.bind(this),
                    this.markers.bind(this)).html());
        }

        const table = $table({ class : 'markerTable' });
        table.appendChild($thead(this.tableHeader()));

        const tbody = $tbody();

        /**
         * @param {MarkerAction} marker
         * @param {HTMLElement} rows */
        const appendPurgedRow = (marker, rows) => {
            rows.appendChild(this.getNewPurgedRow(marker, this.#onRowRemoved.bind(this)).buildRow());
        };

        this.#forMarker(appendPurgedRow, tbody);

        table.appendChild(tbody);
        container.appendChild(table);
        this.#html = container;
        return container;
    }

    /** @returns {string} */
    mainTitle() { Log.error(`mainTitle cannot be called on the base class.`); return ''; }
    /** @returns {HTMLElement} */
    tableHeader() { Log.error(`tableHeader cannot be called on the base class.`); return $span(); }
    /** @returns {PurgeRow} */
    getNewPurgedRow() { Log.error(`getNewPurgedRow cannot be called on the base class.`); }
    /** @returns {PurgedSection} */
    newPurgedSection() { Log.error(`newPurgedSection cannot be called on the base class.`); }

    /** @returns {PurgedGroup} */
    purgedGroup() { return this.#purgedGroup; }

    /** @returns {boolean} Whether this section has been removed due to successful restores/ignores. */
    removed() { return this.#removed; }

    /** Callback invoked when all markers in the table have been handled.
     * @param {MarkerDataMap} newMarkers The newly restored markers, or null if the purged markers were ignored.
     * @param {MarkerDataMap} deletedMarkers Array of deleted markers as a result of the restoration (or null as above)
     * @param {MarkerDataMap} modifiedMarkers Array of edited markers as a result of the restore (or null as above) */
    #onBulkActionSuccess(newMarkers={}, deletedMarkers={}, modifiedMarkers={}) {
        this.#onRowRemoved();
        const allMarkers = [];
        this.#forMarker(marker => allMarkers.push(marker));
        const dummyLibrary = this.newPurgeSection();
        // Need a deep copy of purgedShow so we don't get confused between markers that are
        // still purged and those that were just cleared in onPurgedMarkerAction.
        dummyLibrary.addInternal(this.#purgedGroup.id, this.#purgedGroup.deepClone());
        PurgeManagerSingleton.onPurgedMarkerAction(dummyLibrary, newMarkers, deletedMarkers, modifiedMarkers);
    }

    /**
     * Animate the removal of this row */
    #onRowRemoved() {
        this.#removed = true;
        return slideUp(this.#html, 500, () => {
            this.#html.parentElement.removeChild(this.#html);
            this.#removedCallback();
        });
    }

    /**
     * Helper that applies the given function to all markers in the table.
     * @param {(marker: MarkerAction, ...any) => void} fn The function to apply to each marker.
     * @param  {...any} args Additional arguments to pass into fn.
     */
    #forMarker(fn, ...args) {
        this.#purgedGroup.forEach(/**@this {PurgeTable}*/function(marker) {
            fn.bind(this)(marker, ...args);
        }.bind(this));
    }

    /** @returns The list of markers in this table. */
    markers() {
        /** @type {MarkerAction[]} */
        const ids = [];
        this.#forMarker(function(marker, markers) {
            markers.push(marker);
        }, ids);
        return ids;
    }
}

/**
 * A purge table for an entire TV show.
 */
class TVPurgeTable extends PurgeTable {
    /** @returns {PurgedShow} */
    purgedGroup() { return super.purgedGroup(); }
    /** @returns {string} */
    mainTitle() {
        return this.purgedGroup().getAny().episodeData.showName;
    }

    /** @returns {HTMLElement} */
    tableHeader() {
        return TableElements.rawTableRow(
            'Type',
            'Episode',
            TableElements.shortTimeColumn('Start Time'),
            TableElements.shortTimeColumn('End Time'),
            TableElements.dateColumn('Date Added'),
            TableElements.optionsColumn('Options', 2));
    }

    /**
     * @param {MarkerAction} marker
     * @param {() => void} emptyTableCallback
     * @returns {TVPurgeRow} */
    getNewPurgedRow(marker, emptyTableCallback) {
        return new TVPurgeRow(marker, emptyTableCallback);
    }

    newPurgeSection() { return new PurgedTVSection(); }
}

/**
 * A purge table for a single movie.
 */
class MoviePurgeTable extends PurgeTable {
    /** @returns {PurgedMovie} */
    purgedGroup() { return super.purgedGroup(); }
    /** @returns {string} */
    mainTitle() {
        const movieData = this.purgedGroup().getAny().movieData;
        return `${movieData.title} (${movieData.year})`;
    }

    /** @returns {HTMLElement} */
    tableHeader() {
        return TableElements.rawTableRow(
            'Type',
            TableElements.shortTimeColumn('Start Time'),
            TableElements.shortTimeColumn('End Time'),
            TableElements.dateColumn('Date Added'),
            TableElements.optionsColumn('Options', 2));
    }

    /**
     * @param {MarkerAction} marker
     * @param {() => void} emptyTableCallback
     * @returns {MoviePurgeRow} */
    getNewPurgedRow(marker, emptyTableCallback) {
        return new MoviePurgeRow(marker, emptyTableCallback);
    }

    newPurgeSection() { return new PurgedMovieSection(); }
}

class PurgeConflictControl {
    static #resolutionDescriptions = {
        [MarkerConflictResolution.Overwrite] : $textSpan(
            `If any existing markers overlap with the restored marker, delete the existing marker.`, $br(),
            `This is useful if you previously tweaked Plex-generated markers and analyzing the item reset them.`),
        [MarkerConflictResolution.Merge] :
            `If any existing markers overlap with the restored marker, merge them into one marker that spans ` +
            `the full length of both.`,
        [MarkerConflictResolution.Ignore] :
            `If any existing markers overlap with the restored marker, keep the existing marker and permanently ` +
            `ignore the purged marker.`,
    };

    static GetControl() {
        const selectContainer = $div({ id : 'purgeResolutionContainer' });

        const resolutionTypeChange = () => {
            const description = $$('#purgeResolutionDescription');
            if (description) {
                $clear(description);
                description.appendChild($node(PurgeConflictControl.#resolutionDescriptions[PurgeConflictControl.CurrentResolutionType()]));
            }
        };

        const select = $select('purgeResolution', resolutionTypeChange);
        for (const [key, value] of Object.entries(MarkerConflictResolution)) {
            select.appendChild($option(key, value));
        }

        const showHideResolutionStrategy = () => {
            const description = $$('#purgeResolutionDescription');
            const show = description.classList.contains('hidden');
            toggleClass($$('.expandIcon', $('#purgeResolutionLabel')), 'collapsed', !show);
            description.classList.toggle('hidden');
        };

        $append(selectContainer,
            $label(
                $append($span(),
                    getSvgIcon(Icons.Arrow, ThemeColors.Primary, { class : 'expandIcon collapsed' }),
                    $span(' Resolve Strategy: ')),
                'purgeResolution',
                {
                    id : 'purgeResolutionLabel',
                    for : 'purgeResolution',
                    title : 'Click to show/hide resolve strategy descriptions'
                },
                { click : showHideResolutionStrategy }),
            select,
            $div(
                { id : 'purgeResolutionDescription', class : 'hidden' },
                PurgeConflictControl.#resolutionDescriptions[MarkerConflictResolution.Overwrite]));

        return selectContainer;
    }

    /**
     * Return the current purge conflict resolution type.
     * @returns {number} */
    static CurrentResolutionType() { return parseInt($$('#purgeResolution')?.value || 0); }
}

/**
 * Manages the 'find all purged markers' overlay.
 */
class PurgeOverlay {
    /** @type {PurgedSection} */
    #purgedSection;
    /**
     * The list of tables in this overlay, one per top-level item (movie/show).
     * @type {PurgeTable[]} */
    #tables = [];

    /**
     * Initialize a new purge overlay.
     * @param {PurgedSection} purgedSection The purge data to display.
     */
    constructor(purgedSection) {
        this.#purgedSection = purgedSection;
    }

    /** Display the main overlay.
     * @param {HTMLElement} focusBack The element to set focus back to after this overlay is dismissed. */
    show(focusBack) {
        // Main header + restore/ignore all buttons
        const container = $div({ id : 'purgeContainer' });
        const purgeInfo = { purged : false, readd : false };
        this.#purgedSection.forEach(m => purgeInfo[m.readded ? 'readd' : 'purged'] = true);
        $append(container,
            $h(1, 'Purged Markers'),
            PurgeConflictControl.GetControl(),
            new BulkPurgeAction('purge_all',
                (purgeInfo.purged ? purgeInfo.readd ? 'Restore/Re-Delete' : 'Restore' : 'Re-Delete') + ' All Markers',
                'Ignore All Markers',
                this.#onBulkActionSuccess.bind(this),
                this.#getAllMarkers.bind(this)).html()
        );

        // Table for every top-level item that has purged markers. I.e. for each movie or for each show.
        for (const topLevelItem of Object.values(this.#purgedSection.data)) {
            if (topLevelItem.count <= 0) {
                continue;
            }

            const table = topLevelItem instanceof PurgedMovie ?
                new MoviePurgeTable(topLevelItem, this.#tableRemovedCallback.bind(this)) :
                new TVPurgeTable(topLevelItem, this.#tableRemovedCallback.bind(this));

            this.#tables.push(table);
            container.appendChild(table.html());
        }

        if (this.#purgedSection.count <= 0) {
            Overlay.setFocusBackElement(focusBack);
            this.#noMorePurges(true /*emptyOnInit*/);
            return;
        }

        Overlay.build({ dismissible : true, closeButton : true, focusBack : focusBack }, container);
    }

    /** Callback invoked when an entire table is removed from the overlay. */
    #tableRemovedCallback() {
        for (const table of this.#tables) {
            if (!table.removed()) {
                return;
            }
        }

        this.#noMorePurges();
    }

    /** Callback invoked when all tables in the overlay have been handled.
     * @param {MarkerData[]} newMarkers Array of newly restored markers, or null if the purged markers were ignored.
     * @param {MarkerData[]} deletedMarkers Array of deleted markers as a result of the restoration (or null as above)
     * @param {MarkerData[]} modifiedMarkers Array of edited markers as a result of the restore (or null as above) */
    #onBulkActionSuccess(newMarkers=null, deletedMarkers=null, modifiedMarkers=null) {
        this.#noMorePurges();
        PurgeManagerSingleton.onPurgedMarkerAction(this.#purgedSection.deepClone(), newMarkers, deletedMarkers, modifiedMarkers);
    }

    /** Clears out the now-useless overlay and lets the user know there are no more purged markers to handle. */
    #noMorePurges(emptyOnInit=false) {
        const container = $divHolder({ id : 'purgeContainer' },
            $h(1, emptyOnInit ? 'No Purged Markers Found' : 'No More Purged Markers'),
            $div({ class : 'buttonContainer' }, ButtonCreator.textButton('OK', Overlay.dismiss, { class : 'overlayInput overlayButton' })));
        Overlay.build({ dismissible : true, closeButton : true, focusBack : null }, container);
    }

    /** @returns {MarkerAction[]} The list of marker ids this overlay applies to. */
    #getAllMarkers() {
        const allMarkers = [];
        for (const table of this.#tables) {
            if (!table.removed()) {
                allMarkers.push(...table.markers());
            }
        }

        return allMarkers;
    }
}

/**
 * Singleton instance of the PurgedMarkerManager
 * @type {PurgedMarkerManager}
 * @readonly */
let PurgeManagerSingleton;

/**
 * Manages purged markers, i.e. markers that the user added/edited, but Plex removed for one reason
 * or another, most commonly because a new file was added to a season with modified markers.
 * TODO: Consolidate/integrate/reconcile with PurgeTable
 */
class PurgedMarkerManager {
    /**
     * Hierarchical cache of known purged markers in the current server.
     * @type {PurgedServer} */
    #serverPurgeInfo = new PurgedServer();

    /**
     * Maps metadata ids (whether it's a show, season, episode, or movie) to their associated PurgedGroup.
     * @type {AgnosticPurgeCache} */
    #purgeCache = new AgnosticPurgeCache();

    static CreateInstance(findAllEnabled) {
        if (PurgeManagerSingleton) {
            Log.error('We should only have a single PurgedMarkerManager instance!');
            return;
        }

        PurgeManagerSingleton = new PurgedMarkerManager(findAllEnabled);
    }

    /**
     * Create a new purged marker manager. */
    constructor() {
        if (PurgeManagerSingleton) {
            throw new Error(`Don't create a new PurgedMarkerManager when the singleton already exists!`);
        }
    }

    /**
     * Find all purged markers for the current library section.
     * @param {boolean} [dryRun=false] Whether we just want to populate our purge data, not show it. */
    async findPurgedMarkers(dryRun=false) {
        const section = PlexClientState.activeSection();
        const cachedSection = this.#serverPurgeInfo.get(section);
        if (cachedSection && cachedSection.status === PurgeCacheStatus.Complete) {
            // We have full cached data, used that.
            Log.tmi(`PurgedMarkerManager::findPurgedMarkers: Found cached data, bypassing all_purges call to server.`);
            if (!dryRun) {
                new PurgeOverlay(cachedSection, section).show($('#purgedMarkers'));
            }

            return;
        }

        try {
            this.#onMarkersFound(await ServerCommands.allPurges(section), dryRun);
        } catch (err) {
            errorResponseOverlay(`Something went wrong retrieving purged markers. Please try again later.`, err);
        }
    }

    /** Retrieve all purged markers for the show with the given metadata id.
     * @param {number} showId
     * @throws {Error} if the purge_check fails */
    async getPurgedShowMarkers(showId) {
        const section = this.#serverPurgeInfo.getOrAdd(PlexClientState.activeSection());
        const show = (await this.#getPurgedTopLevelMarkersShared(section, showId));
        if (show === false) {
            return; // We already cached things, no need to update season/episode map.
        }

        // Mark each season/episode of the show as complete. Somewhat inefficient, but it's not
        // expected for there to be enough purged markers for this to cause any significant slowdown.
        // In theory not necessary, but good to be safe.
        show.forEach(/**@this {PurgedMarkerManager}*/function(/**@type {MarkerAction}*/ markerAction) {
            this.#purgeCache.get(markerAction.parent_id).status = PurgeCacheStatus.Complete;
            this.#purgeCache.get(markerAction.season_id).status = PurgeCacheStatus.Complete;
        }.bind(this));
    }

    /**
     * Retrieve all purged markers for the movie with the given metadata id.
     * @param {number} movieId */
    async getPurgedMovieMarkers(movieId) {
        const section = this.#serverPurgeInfo.getOrAdd(PlexClientState.activeSection(), true /*isMovie*/);
        await this.#getPurgedTopLevelMarkersShared(section, movieId);
    }

    /**
     * Shared method of getting purged markers for a given top-level item (movie or show)
     * @param {PurgedSection} section
     * @param {number} metadataId */
    async #getPurgedTopLevelMarkersShared(section, metadataId) {
        // If the section itself is complete, we know the item doesn't have any purged markers
        // if there's no cache entry.
        if (section.status === PurgeCacheStatus.Complete && !section.get(metadataId)) {
            return false;
        }

        let topLevelItem = section.getOrAdd(metadataId);

        if (topLevelItem.status === PurgeCacheStatus.Complete) {
            return false;
        } else if (topLevelItem.status === PurgeCacheStatus.PartiallyInitialized) {
            // Partial state, this shouldn't happen! Overwrite.
            topLevelItem = section.addNewGroup(topLevelItem.id);
        }

        // No try/catch, caller must handle
        /** @type {MarkerAction[]} */
        const actions = await ServerCommands.purgeCheck(metadataId);
        for (const action of actions) {
            this.#addToCache(action);
        }

        topLevelItem.status = PurgeCacheStatus.Complete;
        return topLevelItem;
    }

    /** Return the number of purged markers associated with the given show/season/episode */
    getPurgeCount(metadataId) {
        const item = this.#purgeCache.get(metadataId);
        return item ? item.count : 0;
    }

    /**
     * Return the number of purged markers found for the given section id (or the current section if an id isn't provided).
     * Note that this only returns the number of cached purges, which might not be an exhaustive list if extended marker
     * statistics are disabled server-side. */
    getSectionPurgeCount(sectionId) {
        const id = sectionId === undefined ? PlexClientState.activeSection() : sectionId;
        const section = this.#serverPurgeInfo.get(id);
        if (!section) {
            return 0;
        }

        return section.count;
    }

    /**
     * Add the given marker action to the purge caches.
     * @param {MarkerAction} action */
    #addToCache(action) {
        if (action.show_id === -1) {
            // Movie
            Log.assert(action.movieData, 'Show id of -1 should imply that we have valid MovieData.');
            /** @type {PurgedMovieSection} */
            const section = this.#serverPurgeInfo.getOrAdd(action.section_id, true /*isMovie*/);
            const movie = section.getOrAdd(action.parent_id);
            this.#purgeCache.lazySet(movie.id, movie);
            if (movie.get(action.marker_id)) {
                Log.warn(`Attempting to add a marker to the cache that already exists (${action.marker_id})! Overwriting.`);
            }

            movie.addNewMarker(action);

        } else {
            const section = this.#serverPurgeInfo.getOrAdd(action.section_id, false /*isMovie*/);
            const show = section.getOrAdd(action.show_id);
            const season = show.getOrAdd(action.season_id);
            const episode = season.getOrAdd(action.parent_id);
            this.#purgeCache.lazySet(show.id, show);
            this.#purgeCache.lazySet(season.id, season);
            this.#purgeCache.lazySet(episode.id, episode);
            if (episode.get(action.marker_id)) {
                Log.warn(`Attempting to add a marker to the cache that already exists (${action.marker_id})! Overwriting.`);
            }

            episode.addNewMarker(action);
        }
    }

    /**
     * Callback invoked when a marker or markers are restored or ignored, updating all relevant caches.
     * @param {PurgedSection} purgedSection
     * @param {MarkerDataMap} newMarkers
     * @param {MarkerDataMap} deletedMarkers Map of deleted markers as a result of the restoration (or empty as above)
     * @param {MarkerDataMap} modifiedMarkers Map of edited markers as a result of the restore (or empty as above) */
    async onPurgedMarkerAction(purgedSection, newMarkers=null, deletedMarkers=null, modifiedMarkers=null) {
        purgedSection.forEach(/**@this {PurgedMarkerManager}*/function(/**@type {MarkerAction}*/ marker) {
            /** @type {PurgedBaseItem} */
            const baseItem = this.#purgeCache.get(marker.parent_id);
            if (baseItem) {
                /* eslint-disable padding-line-between-statements */
                baseItem.removeIfPresent(marker.marker_id);
                if (baseItem.count <= 0) { delete this.#purgeCache[marker.parent_id]; }
                if (baseItem instanceof PurgedEpisode) {
                    if (this.#purgeCache.get(marker.season_id).count <= 0) { delete this.#purgeCache[marker.season_id]; }
                    if (this.#purgeCache.get(marker.show_id).count <= 0) { delete this.#purgeCache[marker.show_id]; }
                }
                /* eslint-enable */
            }
        }.bind(this));

        PlexClientState.setInBulkOperation(true);
        try {
            await PlexClientState.notifyPurgeChange(purgedSection, newMarkers, deletedMarkers, modifiedMarkers);
        } finally {
            PlexClientState.setInBulkOperation(false);
        }

        // After everything's updated, reapply the current filter in case the new/removed items affected anything
        window.dispatchEvent(new Event(CustomEvents.MarkerFilterApplied));
        window.dispatchEvent(new Event(CustomEvents.PurgedMarkersChanged));
    }

    /**
     * Show the purge overlay for the current section.
     * Note that this purely relies on cached data, so in the case where extended marker stats are disabled,
     * this may not show all purged markers, just markers for shows that have been navigated to.
     * @param {HTMLElement} caller The source of this request. Focus will be set back to this element when the overlay is dismissed. */
    showCurrentSection(caller) {
        new PurgeOverlay(this.#serverPurgeInfo.get(PlexClientState.activeSection()), PlexClientState.activeSection()).show(caller);
    }

    /**
     * Invoke the purge overlay for a single show's purged marker(s).
     * @param {number} showId The show of purged markers to display.
     * @param {HTMLElement} caller The source of this request. Focus will be set back to this element when the overlay is dismissed. */
    showSingleShow(showId, caller) {
        const showMarkers = this.#purgeCache.get(showId);
        if (!showMarkers) {
            // Ignore invalid requests
            Log.warn(`Called showSingleShow with a show that has no cached purged markers (${showId}). How did that happen?`);
            return;
        }

        this.#showSingle(showMarkers, DisplayType.SingleTopLevel, caller);
    }

    /**
     * Invoke the purge overlay for a single season's purged marker(s).
     * @param {number} seasonId The season of purged markers to display.
     * @param {HTMLElement} caller The source of this request. Focus will be set back to this element when the overlay is dismissed. */
    showSingleSeason(seasonId, caller) {
        const seasonMarkers = this.#purgeCache.get(seasonId);
        if (!seasonMarkers) {
            // Ignore invalid requests
            Log.warn(`Called showSingleSeason with a season that has no cached purged markers (${seasonId}). How did that happen?`);
            return;
        }

        // Reach into the internals of PurgedGroup to create a minified cache
        const dummyShow = new PurgedShow(seasonMarkers.parent.id);
        dummyShow.addInternal(seasonId, seasonMarkers);

        this.#showSingle(dummyShow, DisplayType.SingleSeason, caller);
    }

    /**
     * Invoke the purge overlay for a singe episode's purged marker(s).
     * @param {number} episodeId The episode of purged markers to display.
     * @param {HTMLElement} caller The source of this request. Focus will be set back to this element when the overlay is dismissed. */
    showSingleEpisode(episodeId, caller) {
        const episodeMarkers = this.#purgeCache.get(episodeId);
        if (!episodeMarkers) {
            // Ignore invalid requests
            Log.warn(`Called showSingleEpisode with an episode that has no cached purged markers (${episodeId}). How did that happen?`);
            return;
        }

        // Reach into the internals of PurgedGroup to create a minified cache
        const dummyShow = new PurgedShow(episodeMarkers.parent.parent.id);
        const dummySeason = new PurgedSeason(episodeMarkers.parent.id, dummyShow);
        dummySeason.addInternal(episodeId, episodeMarkers);
        dummyShow.addInternal(dummySeason.id, dummySeason);

        this.#showSingle(dummyShow, DisplayType.SingleEpisode, caller);
    }

    /**
     * Show purged markers for a single movie, initiated through its entry in the search results table.
     *
     * Identical to showSingleShow, but it's clearer than bundling them together.
     * @param {number} movieId
     * @param {HTMLElement} caller The source of this request. Focus will be set back to this element when the overlay is dismissed. */
    showSingleMovie(movieId, caller) {
        const movieMarkers = this.#purgeCache.get(movieId);
        if (!movieMarkers) {
            // Ignore invalid requests
            Log.warn(`Called showSingleMovie with a movie that has no cached purged markers (${movieId}). How did that happen?`);
            return;
        }

        this.#showSingle(movieMarkers, DisplayType.SingleTopLevel, caller);
    }

    /**
     * Core routine that invokes the right overlay.
     * @param {PurgedShow} purgedItem The purged markers to display.
     * @param {DisplayType} displayType The group of purged markers being displayed.
     * @param {HTMLElement?} focusBack The element to focus back on after the overlay is dismissed. */
    #showSingle(purgedItem, displayType, focusBack) {
        if (purgedItem.count === 0) {
            return;
        }

        const args = [purgedItem, Overlay.dismiss, displayType, true /*showResolutionControl*/];
        const table = purgedItem instanceof PurgedMovie ? new MoviePurgeTable(...args) : new TVPurgeTable(...args);
        const html = $div({ id : 'purgeContainer' }, table.html());
        Overlay.build({ dismissible : true, closeButton : true, focusBack : focusBack }, html);
    }

    /**
     * Callback invoked when we successfully queried for purged markers (regardless of whether we found any).
     * @param {PurgeSection} purgeSection Tree of purged markers in the current library section.
     * @param {boolean} dryRun Whether we just want to populate our cache data, not show the purges. */
    #onMarkersFound(purgeSection, dryRun) {
        const isMovieSection = PlexClientState.activeSectionType() === SectionType.Movie;
        if (isMovieSection) {
            for (const [movieId, movie] of Object.entries(purgeSection)) {
                const movieCache = this.#purgeCache.get(movieId);
                if (movieCache && movieCache.status === PurgeCacheStatus.Complete) {
                    Log.tmi(`#onMarkersFound: Not caching completely cached movie ${movieId}`);
                    continue;
                }

                for (const markerAction of Object.values(movie)) {
                    this.#addToCache(markerAction);
                }

                this.#purgeCache.get(movieId).status = PurgeCacheStatus.Complete;
            }
        } else {
            // TV section
            for (const [showId, show] of Object.entries(purgeSection)) {
                const showCache = this.#purgeCache.get(showId);
                if (showCache && showCache.status === PurgeCacheStatus.Complete) {
                    Log.tmi(`#onMarkersFound: Not caching completely cached show ${showId}`);
                    continue;
                }

                for (const [seasonId, season] of Object.entries(show)) {
                    // If we're here, we shouldn't have anything cached
                    Log.assert(
                        !this.#purgeCache.get(seasonId),
                        `#onMarkersFound: [!this.#purgeCache.get(seasonId)] - ` +
                            `If the season isn't complete, the season shouldn't exist.`);
                    for (const [episodeId, episode] of Object.entries(season)) {
                        for (const markerAction of Object.values(episode)) {
                            this.#addToCache(markerAction);
                        }

                        this.#purgeCache.get(episodeId).status = PurgeCacheStatus.Complete;
                    }

                    this.#purgeCache.get(seasonId).status = PurgeCacheStatus.Complete;
                }

                this.#purgeCache.get(showId).status = PurgeCacheStatus.Complete;
            }
        }

        const activeSection = PlexClientState.activeSection();
        this.#serverPurgeInfo.getOrAdd(activeSection, isMovieSection).status = PurgeCacheStatus.Complete;
        if (dryRun) {
            return;
        }

        new PurgeOverlay(this.#serverPurgeInfo.get(activeSection), activeSection).show();
    }
}

export { PurgedMarkerManager, PurgeManagerSingleton as PurgedMarkers };
