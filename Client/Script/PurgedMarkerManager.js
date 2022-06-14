import { Log } from "../../Shared/ConsoleLog.js";
import { MarkerData } from "../../Shared/PlexTypes.js";
import ButtonCreator from "./ButtonCreator.js";
import { $, $$, appendChildren, buildNode, clearEle, errorMessage, jsonRequest, pad0 } from "./Common.js";
import Animation from "./inc/Animate.js";
import Overlay from "./inc/Overlay.js";
import Tooltip from "./inc/Tooltip.js";
import PlexClientState from "./PlexClientState.js";
import TableElements from "./TableElements.js";
import ThemeColors from "./ThemeColors.js";

/** @typedef {!import("../../Server/MarkerBackupManager.js").MarkerAction} MarkerAction */
/** @typedef {!import("../../Server/MarkerBackupManager.js").PurgeSection} PurgeSection */
/** @typedef {!import("../../Server/MarkerBackupManager.js").PurgeShow} PurgeShow */
/** @typedef {!import("../../Server/PlexQueryManager.js").RawMarkerData} RawMarkerData */


/**
 * A class that holds the information relevant for a button callback
 * that makes a request to the server.
 */
 class PurgeActionInfo {
    static #nop = () => {};

    /** @type {string} */
    text;
    /** @type {() => void} */
    successFn;
    /** @type {() => void} */
    failureFn;

    /**
     * @param {string} text Button text.
     * @param {*} successFn Function invoked when the server request succeeds.
     * @param {*} failureFn Function invoked when the serve request fails. */
    constructor(text, successFn, failureFn) {
        this.text = text;
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
    /** @type {() => void} */
    callback;

    /**
     * @param {string} text The button text.
     * @param {() => void} callback The callback to invoke when the button is clicked, if any. */
    constructor(text, callback) {
        this.text = text;
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
    /** @type {() => number[]} */
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
     * @param {() => number[]} getMarkersFn Function that returns the list of marker ids this class applies to. */
    addButtons(restoreInfo, ignoreInfo, ignoreConfirmInfo, ignoreCancelInfo, getMarkersFn) {
        this.#restoreInfo = restoreInfo;
        this.#ignoreInfo = ignoreInfo;
        this.#ignoreConfirmInfo = ignoreConfirmInfo;
        this.#ignoreCancelInfo = ignoreCancelInfo;
        this.#getMarkersFn = getMarkersFn;
        appendChildren(this.#parent,
            ButtonCreator.fullButton(
                restoreInfo.text,
                'confirm',
                'Restore Markers',
                'green',
                this.#onRestore.bind(this),
                { class : 'restoreButton' }),
            ButtonCreator.fullButton(
                ignoreInfo.text,
                'delete',
                'Ignore Markers',
                'red',
                this.#onIgnoreClick.bind(this),
                { class : 'ignoreButton' }),
            ButtonCreator.fullButton(
                ignoreConfirmInfo.text,
                'confirm',
                'Ignore Markers',
                'green',
                this.#onIgnoreConfirm.bind(this),
                { class : 'ignoreConfirm hidden' }),
            ButtonCreator.fullButton(
                ignoreCancelInfo.text,
                'cancel',
                'Cancel Ignore',
                'red',
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
    #onRestore() {
        if (!this.#enterOperation()) { return; }
        const markers = this.#getMarkersFn();
        Log.verbose(`Attempting to restore ${markers.length} marker(s).`);
        $$('.restoreButton img', this.#parent).src = ThemeColors.getIcon('loading', 'green');
        const parameters = { markerIds : markers.join(','), sectionId: PlexClientState.GetState().activeSection() };
        jsonRequest('restore_purge', parameters, this.#onRestoreSuccess.bind(this), this.#onRestoreFailed.bind(this));
    }

    /** Resets the 'confirm' image icon after getting a response from a restore/ignore request. */
    #resetConfirmImg(className) {
        $$(`.${className} img`).src = ThemeColors.getIcon('confirm', 'green');
    }

    /** Callback invoked when we successfully restored markers. */
    #onRestoreSuccess() {
        this.#resetConfirmImg('restoreButton');
        this.#resetRestoreInfo.successFn();
    }

    /** Callback invoked when we failed to restore markers. */
    #onRestoreFailed() {
        this.#resetConfirmImg('restoreButton');
        this.#resetRestoreInfo.failureFn();
    }

    /** Shows the confirmation buttons after 'Ignore' is clicked. */
    #onIgnoreClick() {
        if (this.#inOperation) { return; }
        $$('.restoreButton', this.#parent).classList.add('hidden');
        $$('.ignoreButton', this.#parent).classList.add('hidden');
        $$('.ignoreConfirm', this.#parent).classList.remove('hidden');
        $$('.ignoreCancel', this.#parent).classList.remove('hidden');
        this.#ignoreInfo.callback();
    }

    /** Kicks off the ignore process for the markers this operation applies to. */
    #onIgnoreConfirm() {
        if (!this.#enterOperation()) { return; }
        const markers = this.#getMarkersFn();
        Log.verbose(`Attempting to ignore ${markers.length} marker(s).`);
        $$('.ignoreButton', this.#parent).src = ThemeColors.getIcon('loading', 'green');
        const parameters = { markerIds : markers.join(','), sectionId: PlexClientState.GetState().activeSection() };
        jsonRequest('ignore_purge', parameters, this.#onIgnoreSuccess.bind(this), this.#onIgnoreFailed.bind(this));
    }

    /** Callback invoked when we successfully ignored markers. */
    #onIgnoreSuccess() {
        this.#resetConfirmImg('ignoreConfirm');
        this.#ignoreConfirmInfo.successFn();
    }

    /** Callback invoked when we failed to ignore markers. */
    #onIgnoreFailed() {
        this.#resetConfirmImg('ignoreConfirm');
        this.#ignoreConfirmInfo.failureFn();
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
     /**
      * The number of columns to backup and clear out when showing an inline row message.
      * @type {number} */
     static #backupLength = 4;

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
     * @param {() => void} emptyTableCallback Callback to invoke after the table this row belongs to is empty.
     */
    constructor(markerAction, emptyTableCallback) {
        this.#markerAction = markerAction;
        this.#markerData = this.#markerDataFromMarkerAction();
        this.#emptyTableCallback = emptyTableCallback;
    }

    /** Builds and returns a table row for this purged marker. */
    buildRow() {
        const ep = this.#markerAction.episodeData;
        this.#html = TableElements.rawTableRow(
            buildNode('span', { title : ep.title }, `S${pad0(ep.seasonIndex, 2)}E${pad0(ep.index, 2)}`),
            TableElements.timeData(this.#markerAction.start),
            TableElements.timeData(this.#markerAction.end),
            TableElements.dateColumn(TableElements.friendlyDate(this.#markerData)),
            this.#addPurgeOptions()
        );

        this.#html.classList.add('purgerow');

        this.#html.id = `purgerow_${this.#markerAction.marker_id}`;

        return this.#html;
    }

    /** Creates the restore/ignore option buttons for this row. */
    #addPurgeOptions() {
        let holder = buildNode('div', { class : 'purgeOptionsHolder' });
        this.#purgeOptions = new PurgeOptions(holder);
        this.#purgeOptions.addButtons(
            new PurgeActionInfo('Restore', this.#onRestoreSuccess.bind(this), this.#onRestoreFail.bind(this)),
            new PurgeNonActionInfo('Ignore', this.#onIgnore.bind(this)),
            new PurgeActionInfo('Yes', this.#onIgnoreSuccess.bind(this), this.#onIgnoreFailed.bind(this)),
            new PurgeNonActionInfo('No', this.#onIgnoreCancel.bind(this)),
            function() { return [this.#markerAction.marker_id]; }.bind(this)
        );

        return holder;
    }

    /** Callback when a marker was successfully restored. Flashes the row and then removes itself. */
    #onRestoreSuccess() {
        Animation.queue({ backgroundColor : `#${ThemeColors.get('green')}6` }, this.#html, 500);
        Animation.queueDelayed({ color : 'transparent', backgroundColor : 'transparent', height : '0px' }, this.#html, 500, 500, false, this.#removeSelfAfterAnimation.bind(this));
    }

    /** Callback when a marker failed to be restored. Flashes the row and then resets back to its original state. */
    #onRestoreFail() {
        this.#showRowMessage('Restoration failed. Please try again later.');
        Animation.queue({ backgroundColor : `#${ThemeColors.get('red')}4` }, this.#html, 500);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 500, true, this.#resetSelfAfterAnimation.bind(this));
    }

    /** After an animation completes, remove itself from the table. */
    #removeSelfAfterAnimation() {
        const parent = this.#html.parentElement;
        parent.removeChild(this.#html);
        if (parent.children.length == 0) {
            this.#emptyTableCallback();
        }
    }

    /** After an animation completes, restore the row to its original state. */
    #resetSelfAfterAnimation() {
        this.#purgeOptions.resetViewState();
    }

    /** Callback when the user clicks 'Ignore'. Replaces the row with an 'Are you sure' prompt. */
    #onIgnore() {
        this.#showRowMessage('Are you sure you want to permanently ignore this marker?');
    }

    /** Callback when the user decides to cancel the ignore operation, resetting the row to its original state. */
    #onIgnoreCancel() {
        this.#restoreTableData();
    }

    /** Callback when a marker was successfully ignored. Flash the row and remove it. */
    #onIgnoreSuccess() {
        Animation.queue({ backgroundColor : `#${ThemeColors.get('green')}4` }, this.#html, 500);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 500, true, this.#removeSelfAfterAnimation.bind(this));
    }

    /** Callback when a marker failed to be ignored. Flash the row and reset it back to its original state. */
    #onIgnoreFailed() {
        this.#html.children[0].innerText = 'Sorry, something went wrong. Please try again later.';
        Animation.queue({ backgroundColor : `#${ThemeColors.get('red')}4` }, this.#html, 500);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 500, true, this.#resetSelfAfterAnimation.bind(this));
    }

    #showRowMessage(message) {
        this.#backupTableData();
        for (let i = 0; i < PurgeRow.#backupLength; ++i) {
            this.#html.removeChild(this.#html.firstChild);
        }

        this.#html.insertBefore(buildNode('td', { colspan : 4, class : 'spanningTableRow' }, message), this.#html.firstChild);
    }

    /** Backs up the main content of the row in preparation of `#html` being cleared out. */
    #backupTableData() {
        if (this.#tableData.length != 0) {
            return;
        }

        for (let i = 0; i < PurgeRow.#backupLength; ++i) {
            this.#tableData.push(this.#html.children[i]);
        }
    }

    /** Restores the main content of this row with the backed up data. */
    #restoreTableData() {
        this.#html.removeChild(this.#html.firstChild);
        for(let i = PurgeRow.#backupLength - 1; i >= 0; --i) {
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
            episode_id : this.#markerAction.episode_id,
            season_id : this.#markerAction.season_id,
            show_id : this.#markerAction.show_id,
            section_id : PlexClientState.GetState().activeSection()
        };

        return new MarkerData(rawMarkerData);
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
        this.#html = buildNode('div', { class : 'buttonContainer', id : id });
        this.#options = new PurgeOptions(this.#html);
        this.#options.addButtons(
            new PurgeActionInfo(restoreText, this.#onRestoreSuccess.bind(this), this.#onRestoreFail.bind(this)),
            new PurgeNonActionInfo(ignoreText),
            new PurgeActionInfo('Confirm', this.#onIgnoreSuccess.bind(this), this.#onIgnoreFailed),
            new PurgeNonActionInfo('Cancel'),
            this.#getMarkersFn);
    }

    /** @returns {HTMLElement} The HTML that encapsulates this action. */
    html() { return this.#html; }

    /** Callback invoked when markers were successfully restored. */
    #onRestoreSuccess() {
        this.#onActionSuccess();
    }

    /** Callback invoked when markers were unsuccessfully restored. */
    #onRestoreFail() {
        this.#options.resetViewState();
        Animation.queue({ backgroundColor : `#${ThemeColors.get('red')}4` }, this.#html, 250);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 250, true);
    }

    /** Callback invoked when markers were successfully ignored. */
    #onIgnoreSuccess() {
        // Don't exit bulk update, since changes have been committed and the table should be invalid now.
        this.#onActionSuccess();
    }

    /** Callback invoked when we failed to ignore this marker group. */
    #onIgnoreFailed() {
        Animation.queue({ backgroundColor : `#${ThemeColors.get('red')}4` }, this.#html, 500);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 500, true, this.#options.resetViewState.bind(this.#options));
    }

    /** Common actions done when markers were successfully restored or ignored. */
    #onActionSuccess() {
        // Don't exit bulk update, since changes have been committed and the table should be invalid now.
        Animation.queue({ backgroundColor : `#${ThemeColors.get('green')}6` }, this.#html, 250);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 250, true, this.#successCallback);
    }
}

/**
 * Available purge overlay modes.
 */
const DisplayType = {
    /** Display all purged markers for a given section. */
    All : 0,
    /** Display all purged markers for a given season of a show. */
    SingleSeason : 1,
    /** Display a single purged marker */
    SingleEpisode : 2
}

/**
 * Represents purged markers for a single show. It may be a subset when
 * DisplayType is SingleSeason or SingleEpisode, but it groups all of them
 * into a single table.
 */
class PurgeTable {
    /** @type {PurgeShow} */
    #purgeShow;
    /** @type {HTMLElement} */
    #html;
    /** @type {boolean} */
    #removed;
    /** @type {() => void} */
    #removedCallback;
    /** @type {DisplayType} */
    #displayType;

    /**
     * Create a new table for one or more purged markers in a single show.
     * @param {PurgeShow} purgeShow Map of purged markers in this show.
     * @param {() => void} removedCallback Callback invoked when all markers are ignored or restored.
     * @param {DisplayType=DisplayType.All} displayType The type of overlay being shown.
     */
    constructor(purgeShow, removedCallback, displayType=DisplayType.All) {
        this.#purgeShow = purgeShow;
        this.#removedCallback = removedCallback;
        this.#displayType = displayType;
        this.#removed = false;
    }

    /** @returns {HTMLElement} The HTML associated with this table. */
    html() {
        if (this.#html) {
            return this.#html;
        }

        const firstMarker = Object.values(Object.values(Object.values(this.#purgeShow)[0])[0])[0];
        let container = buildNode('div', { class : 'purgeShowContainer', id : `purgeshow_${firstMarker.show_id}` });
        if (this.#displayType == DisplayType.All) {
            // <hr> to break up different shows if we're showing all purges in the section
            container.appendChild(buildNode('hr'));
        }

        const showName = firstMarker.episodeData.showName;
        container.appendChild(buildNode('h2', {}, showName));
        if (this.markerIds().length > 1) {
            // Only show bulk operation actions if we're not showing a single marker
            container.appendChild(
                new BulkPurgeAction(
                    `purgeshow_bulk_${firstMarker.show_id}`,
                    'Restore All',
                    'Ignore All',
                    this.#onBulkActionSuccess.bind(this),
                    this.markerIds.bind(this)).html());
        }

        let table = buildNode('table', { class : 'markerTable' });
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    'Episode',
                    TableElements.shortTimeColumn('Start Time'),
                    TableElements.shortTimeColumn('End Time'),
                    TableElements.dateColumn('Date Added'),
                    TableElements.optionsColumn('Options'))
            )
        );

        let rows = buildNode('tbody');
        this.#forMarker(function(marker, rows) {
            rows.appendChild(new PurgeRow(marker, this.#onBulkActionSuccess.bind(this)).buildRow());
        }, rows);

        table.appendChild(rows);
        container.appendChild(table);
        this.#html = container;
        return container;
    }

    /** @returns {boolean} Whether this section has been removed due to successful restores/ignores. */
    removed() { return this.#removed; }

    /** Callback invoked when all markers in the table have been handled. */
    #onBulkActionSuccess() {
        this.#removed = true;
        Animation.queue({ opacity : 0, height : '0px' }, this.#html, 250, true, this.#removedCallback);
    }

    /**
     * Helper that applies the given function to all markers in the table.
     * @param {(MarkerAction, ...any) => void} fn The function to apply to each marker.
     * @param  {...any} args Additional arguments to pass into fn.
     */
    #forMarker(fn, ...args) {
        for (const season of Object.values(this.#purgeShow)) {
            for (const episode of (Object.values(season))) {
                for (const marker of Object.values(episode)) {
                    fn.bind(this)(marker, ...args);
                }
            }
        }
    }

    /** @returns The list of markers in this table. */
    markerIds() {
        let ids = [];
        this.#forMarker(function(marker, ids) {
            ids.push(marker.marker_id);
        }, ids);
        return ids;
    }
}

/**
 * Manages the 'find all purged markers' overlay.
 */
class PurgeOverlay {
    /** @type {PurgeSection} */
    #purgeSection;
    /**
     * The list of tables in this overlay, one per show.
     * @type {PurgeTable[]} */
    #shows = [];
    /** @type {HTMLElement} */
    #html;

    /**
     * Initialize a new purge overlay.
     * @param {PurgeSection} purgeSection The purge data to display.
     */
    constructor(purgeSection) {
        this.#purgeSection = purgeSection;
    }

    /** Display the main overlay. */
    show() {
        // Main header + restore/ignore all buttons
        let container = buildNode('div', { id : 'purgeContainer' });
        appendChildren(container,
            buildNode('h1', {}, 'Purged Markers'),
            new BulkPurgeAction('purge_all', 'Restore All Markers', 'Ignore All Markers', this.#onBulkActionSuccess.bind(this), this.#getAllMarkerIds.bind(this)).html()
        );

        // Table for every show that has purged markers
        for (const show of Object.values(this.#purgeSection)) {
            const table = new PurgeTable(show, this.#showRemovedCallback.bind(this));
            this.#shows.push(table);
            container.appendChild(table.html());
        }

        this.#html = container;
        if (Object.keys(this.#purgeSection).length == 0) {
            this.#clearOverlayAfterPurge(true /*emptyOnInit*/);
        }

        Overlay.build({ dismissible : true, closeButton : true }, container);
    }

    /** Callback invoked when an entire table is removed from the overlay. */
    #showRemovedCallback() {
        for (const table of this.#shows) {
            if (!table.removed()) {
                return;
            }
        }

        this.#onBulkActionSuccess();
    }

    /** Callback invoked when all tables in the overlay have been handled. */
    #onBulkActionSuccess() {
        Animation.queue({ opacity : 0 }, this.#html, 500, false, this.#clearOverlayAfterPurge.bind(this));
    }

    /** Clears out the now-useless overlay and lets the user know there are no more purged markers to handle. */
    #clearOverlayAfterPurge(emptyOnInit=false) {
        clearEle(this.#html);
        appendChildren(this.#html,
            buildNode('h1', {}, emptyOnInit ? 'No Purged Markers Found' : 'No More Purged Markers'),
            appendChildren(buildNode('div', { class : 'buttonContainer' }),
                ButtonCreator.textButton('OK', Overlay.dismiss, { class : 'overlayInput overlayButton' })));
        Animation.queue({ opacity : 1 }, this.#html, 500);
    }

    /** @returns {number[]} The list of marker ids this overlay applies to. */
    #getAllMarkerIds() {
        let allMarkers = [];
        for (const table of this.#shows) {
            if (!table.removed()) {
                allMarkers.push(...table.markerIds());
            }
        }

        return allMarkers;
    }
}

/**
 * Manages purged markers, i.e. markers that the user added/edited, but Plex removed for one reason
 * or another, most commonly because a new file was added to a season with modified markers.
 * TODO: Consolidate/integrate/reconcile with PurgeTable
 */
class PurgedMarkerManager {
    static #manager;

    /** Create a new manager for the given client state.
     * @param {boolean} findAllEnabled Whether the user can search for all purged markers for a given section. */
    constructor(findAllEnabled) {
        if (findAllEnabled) {
            $$('#findAllPurgedHolder').classList.remove('hidden');
            const button = $$('#purgedMarkers');
            $$('#purgedMarkers').addEventListener('click', this.findPurgedMarkers.bind(this));
            Tooltip.setTooltip(button, 'Search for user modified markers<br>that Plex purged from its database.');
        }

        PurgedMarkerManager.#manager = this;
    }

    /**
     * Retrieve the singleton manager instance.
     * @returns {PurgedMarkerManager} */
    static GetManager() { return this.#manager; }

    /** Find all purged markers for the current library section. */
    findPurgedMarkers() {
        const section = PlexClientState.GetState().activeSection();
        jsonRequest('all_purges', { sectionId : section }, this.#onMarkersFound.bind(this), this.#onMarkersFailed.bind(this));
    };

    /**
     * Invoke the purge overlay for a single season's purged marker(s).
     * @param {MarkerAction[]} purgeData The list of purged markers to display. */
    showSingleSeason(purgeData) {
        this.#showSingle(purgeData, DisplayType.SingleSeason);
    }

    /**
     * Invoke the purge overlay for a singe episode's purged marker(s).
     * @param {MarkerAction[]} purgeData The list of purged markers to display */
    showSingleEpisode(purgeData) {
        this.#showSingle(purgeData, DisplayType.SingleEpisode);
    }

    /**
     * Core routine that invokes the right overlay.
     * @param {MarkerData[]} purgeData The list of purged markers to display.
     * @param {DisplayType} displayType The group of purged markers being displayed. */
    #showSingle(purgeData, displayType) {
        if (purgeData.length == 0) {
            return;
        }

        const firstMarker = purgeData[0];

        // Convert the flat list of marker ids to the tree that PurgeTable expects.
        let purgeMap = {
            [firstMarker.season_id] : {}
        };

        const season = purgeMap[firstMarker.season_id];
        for (const marker of purgeData) {
            if (!season[marker.episode_id]) {
                season[marker.episode_id] = {};
            }

            season[marker.episode_id][marker.marker_id] = marker;
        }

        const html = appendChildren(buildNode('div', { id : 'purgeContainer' }),
            new PurgeTable(purgeMap, Overlay.dismiss, displayType).html());
        Overlay.build({ dismissible : true, closeButton : true }, html);
    }

    /**
     * Callback invoked when we successfully queried for purged markers (regardless of whether we found any).
     * @param {PurgeSection} purgeSection Tree of purged markers in the current library section. */
    #onMarkersFound(purgeSection) {
        new PurgeOverlay(purgeSection, PlexClientState.GetState().activeSection()).show();
    }

    /**
     * Callback invoked when we failed to search for purged markers.
     * @param {*} response Server response */
    #onMarkersFailed(response) {
        Overlay.show(`Something went wrong retrieving purged markers. Please try again later.<br><br>Server message:<br>${errorMessage(response)}`, 'OK');
    }
}

export default PurgedMarkerManager;
