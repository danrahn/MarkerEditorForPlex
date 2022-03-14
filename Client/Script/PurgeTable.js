import { $$, appendChildren, buildNode, clearEle, jsonRequest } from "./Common.js";
import { MarkerData } from "../../Shared/PlexTypes.js";

import Animation from "./inc/Animate.js";
import Overlay from "./inc/Overlay.js";

import ButtonCreator from "./ButtonCreator.js";
import TableElements from "./TableElements.js";
import ThemeColors from "./ThemeColors.js";

/** @typedef {!import("../../Server/MarkerBackupManager.js").MarkerAction} MarkerAction */
/** @typedef {!import("../../Server/PlexQueryManager.js").RawMarkerData} RawMarkerData */

/**
 * The PurgeRow represents a single row in the PurgeTable.
 */
class PurgeRow {
    /** @type {MarkerAction} */
    #markerAction;

    /** @type {number} */
    #sectionId;

    /** Marker data converted from `#markerAction`
     * #@type {MarkerData} */
    #markerData;

    /** @type {HTMLElement} */
    #html;

    /** Cached `td`s of the main row, as `#html` can change. */
    #tableData = [];

    constructor(sectionId, markerAction) {
        this.#sectionId = sectionId;
        this.#markerAction = markerAction;
        this.#markerData = this.#markerDataFromMarkerAction();
    }

    /** Builds and returns a table row for this purged marker. */
    buildRow() {
        this.#html = TableElements.rawTableRow(
            TableElements.timeData(this.#markerAction.start),
            TableElements.timeData(this.#markerAction.end),
            TableElements.dateColumn(TableElements.friendlyDate(this.#markerData)),
            this.#purgeOptions()
        );

        this.#html.id = `purgerow_${this.#markerAction.marker_id}`;

        return this.#html;
    }

    /** Creates the restore/ignore option buttons for this row. */
    #purgeOptions() {
        return appendChildren(buildNode('div', { class : 'purgeOptionsHolder' }),
            ButtonCreator.fullButton(
                'Restore',
                'confirm',
                'Restore Marker',
                'green',
                this.#onRestore.bind(this),
                { title : 'Restore marker to the Plex database', class : 'restoreButton' }),
            ButtonCreator.fullButton(
                'Ignore',
                'delete',
                'Ignore Marker',
                'red',
                this.#onIgnore.bind(this),
                { title : 'Permanately ignore this marker in the future' })
        );
    }

    /** Callback invoked when the user clicks 'Restore'. Makes a request to the server to restore the marker. */
    #onRestore() {
        $$('.restoreButton', this.#html).src = ThemeColors.getIcon('loading', 'green');
        const parameters = { markerId : this.#markerAction.marker_id, sectionId: this.#sectionId };
        jsonRequest('restore', parameters, this.#onRestoreSuccess.bind(this), this.#onRestoreFail.bind(this));
    }

    /**
     * Callback when a marker was successfully restored. Flashes the row and then removes itself.
     * @param {Object} markerData Serialized `MarkerData` of the restored marker. */
    #onRestoreSuccess(markerData) { // TODO: Do something with this returned data.
        $$('.restoreButton', this.#html).src = ThemeColors.getIcon('confirm', 'green');
        Animation.queue({ backgroundColor : `#${ThemeColors.get('green')}6` }, this.#html, 500);
        Animation.queueDelayed({ color : 'transparent', backgroundColor : 'transparent', height : '0px' }, this.#html, 500, 500, false, this.#removeSelfAfterAnimation.bind(this));
    }

    /** Callback when a marker failed to be restored. Flashes the row and then resets back to its original state. */
    #onRestoreFail() {
        this.#backupTableData();
        clearEle(this.#html);
        this.#html.appendChild(buildNode('td', { colspan : 4 , class: 'spanningTableRow' }, 'Restoration failed. Please try again later.'));
        Animation.queue({ backgroundColor : `#${ThemeColors.get('red')}4` }, this.#html, 500);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, this.#html, 500, 500, true, this.#resetSelfAfterAnimation.bind(this));
    }

    /** After an animation completes, remove itself from the table. */
    #removeSelfAfterAnimation() {
        this.#html.parentElement.removeChild(this.#html);
    }

    /** After an animation completes, restore the row to its original state. */
    #resetSelfAfterAnimation() {
        this.#onIgnoreCancel();
    }

    /** Callback when the user clicks 'Ignore'. Replaces the row with an 'Are you sure' prompt. */
    #onIgnore() {
        this.#backupTableData();
        clearEle(this.#html);
        appendChildren(this.#html,
            buildNode('td', { colspan : 3, class : 'spanningTableRow' }, 'Are you sure you want to permanately ignore this marker?'),
            appendChildren(buildNode('td'),
                appendChildren(buildNode('div', { class : 'purgeOptionsHolder' }),
                    ButtonCreator.fullButton('Yes', 'confirm', 'Ignore Marker', 'green', this.#onIgnoreConfirm.bind(this), { class : 'ignoreButton' }),
                    ButtonCreator.fullButton('No', 'cancel', 'Cancel Ignore', 'red', this.#onIgnoreCancel.bind(this))
                )
            )
        );
    }

    /** Callback when the user decides to cancel the ignore operaiton, resetting the row to its original state. */
    #onIgnoreCancel() {
        clearEle(this.#html);
        appendChildren(this.#html, ...this.#tableData);
        $$('.restoreButton', this.#html).src = ThemeColors.getIcon('confirm', 'green'); // Just in case.
    }

    /** Callback when the user confirms their ignore request. Calls to the server to ignore the marker. */
    #onIgnoreConfirm() {
        $$('.ignoreButton', this.#html).src = ThemeColors.getIcon('loading', 'green');
        const parameters = { markerId : this.#markerAction.marker_id, sectionId: this.#sectionId };
        jsonRequest('ignore_purge', parameters, this.#onIgnoreSuccess.bind(this), this.#onIgnoreFailed.bind(this));
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

    /** Backs up the main content of the row in preparation of `#html` being cleared out. */
    #backupTableData() {
        if (this.#tableData.length != 0) {
            return;
        }

        for (const td of this.#html.children) {
            this.#tableData.push(td);
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
            section_id : this.#sectionId
        };

        return new MarkerData(rawMarkerData);
    }

}

/**
 * The PurgeTable displays the purged markers provided in an overlay table for users to restore if desired.
 */
class PurgeTable {

    /** @type {MarkerAction[]} */
    #purgedMarkers;
    /** @type {number} */
    #sectionId;
    constructor(sectionId, purgedMarkers) {
        this.#sectionId = sectionId;
        this.#purgedMarkers = purgedMarkers;
    }
    
    /** Show the overlay. */
    show() {
        let container = buildNode('div', { id : 'purgeContainer' });
        let table = buildNode('table', { class : 'markerTable' });
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    TableElements.shortTimeColumn('Start Time'),
                    TableElements.shortTimeColumn('End Time'),
                    TableElements.dateColumn('Date Added'),
                    TableElements.optionsColumn('Options'))
            )
        );

        let rows = buildNode('tbody');
        for (const marker of this.#purgedMarkers) {
            rows.appendChild(new PurgeRow(this.#sectionId, marker).buildRow());
        }

        table.appendChild(rows);

        container.appendChild(table);
        Overlay.build({ dismissible: true, closeButton : true }, container);
    }
}

export default PurgeTable
