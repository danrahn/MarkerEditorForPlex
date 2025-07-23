import { $append, $span } from '../HtmlHelpers.js';
import { Attributes } from '../DataAttributes.js';
import ButtonCreator from '../ButtonCreator.js';
import { CopyMarkerOverlay } from './CopyMarkerOverlay.js';
import { TableElements } from './TableElements.js';
import Tooltip from '../Tooltip.js';

/** @typedef {!import('../ResultRow/BaseItemResultRow').BaseItemResultRow} BaseItemResultRow */
/** @typedef {!import('./MarkerTable').MarkerTable} MarkerTable */

// TODO: Is the copy action actually useful? Statically disabled for now (and incomplete).
const CopyActionEnabled = false;

export class MarkerTableActionsRow {
    /** @type {BaseItemResultRow} */
    #parentRow;

    /** @type {MarkerTable} */
    #markerTable;

    /** @type {HTMLTableRowElement} */
    #html;

    /** @type {HTMLElement} */
    #addButton;

    /** @type {HTMLElement} */
    #copyButton;

    /**
     * @param {BaseItemResultRow} parentRow
     * @param {MarkerTable} markerTable */
    constructor(parentRow, markerTable) {
        this.#parentRow = parentRow;
        this.#markerTable = markerTable;
    }

    build() {
        if (this.#html) {
            return this.#html;
        }

        const buttons = [];
        this.#addButton = ButtonCreator.textButton(
            'Add Marker',
            this.#markerTable.onMarkerAdd.bind(this.#markerTable),
            { [Attributes.TableNav] : 'new-marker', class : 'markerTableActionButton' });
        buttons.push(this.#addButton);
        if (CopyActionEnabled && !this.#parentRow.isMovie()) {
            this.#copyButton = ButtonCreator.textButton(
                'Copy Marker',
                this.#onMarkerCopy.bind(this),
                { [Attributes.TableNav] : 'copy-marker', class : 'markerTableActionButton' });
            this.#toggleCopyButton();
            buttons.push(this.#copyButton);
        }

        this.#html = TableElements.spanningTableRow(
            $append($span(), ...buttons),
            { class : 'markerRow' }
        );

        return this.#html;
    }

    #onMarkerCopy() {
        if (this.#markerTable.markerCount() === 0) {
            return;
        }

        new CopyMarkerOverlay(this.#parentRow.baseItem(), this.#copyButton).show();

        // Use bulk action infra with two BulkActionTables - one with all the markers in this episode,
        // and another one with all the markers that we can copy to. Use the same bulk add marker resolution
        // options, as well as the "advanced" bulk add request.
        // Also a "copy as" -> "copy this intro marker as a credits marker"? Maybe not.
        // TODO: What can be shared 1:1 with BulkAddOverlay?
    }

    onMarkersUpdated() {
        this.#toggleCopyButton();
    }

    #toggleCopyButton() {
        if (!CopyActionEnabled || this.#parentRow.isMovie()) {
            // Movies don't have a marker table, the copy buttons shouldn't even exist.
            return;
        }

        if (this.#markerTable.markerCount() > 0) {
            this.#copyButton.classList.remove('disabled');
            Tooltip.removeTooltip(this.#copyButton);
        } else {
            this.#copyButton.classList.add('disabled');
            Tooltip.setTooltip(this.#copyButton, 'No markers available to copy');
        }
    }
}
