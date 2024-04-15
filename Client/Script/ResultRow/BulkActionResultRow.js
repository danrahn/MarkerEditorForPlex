import { ResultRow } from './ResultRow.js';

import { appendChildren, buildNode } from '../Common.js';
import { Attributes } from '../DataAttributes.js';
import BulkAddOverlay from '../BulkAddOverlay.js';
import BulkDeleteOverlay from '../BulkDeleteOverlay.js';
import BulkShiftOverlay from '../BulkShiftOverlay.js';
import ButtonCreator from '../ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

const Log = new ContextualLog('BulkActionRow');

/**
 * A result row that offers bulk marker actions, like shifting everything X milliseconds.
 */
export class BulkActionResultRow extends ResultRow {
    /** @type {HTMLElement} */
    #bulkAddButton;
    /** @type {HTMLElement} */
    #bulkShiftButton;
    /** @type {HTMLElement} */
    #bulkDeleteButton;
    constructor(mediaItem) {
        super(mediaItem, 'bulkResultRow');
    }

    /**
     * Build the bulk result row, returning the row */
    buildRow() {
        if (this.html()) {
            Log.warn(`buildRow has already been called for this BulkActionResultRow, that shouldn't happen!`);
            return this.html();
        }

        const titleNode = buildNode('div', { class : 'bulkActionTitle' }, 'Bulk Actions');
        const row = buildNode('div', { class : 'resultRow bulkResultRow' }, 0, { keydown : this.onRowKeydown.bind(this) });
        this.#bulkAddButton = ButtonCreator.textButton(
            'Bulk Add', this.#bulkAdd.bind(this), { style : 'margin-right: 10px', [Attributes.TableNav] : 'bulk-add' });
        this.#bulkShiftButton = ButtonCreator.textButton(
            'Bulk Shift', this.#bulkShift.bind(this), { style : 'margin-right: 10px', [Attributes.TableNav] : 'bulk-shift' });
        this.#bulkDeleteButton = ButtonCreator.textButton(
            'Bulk Delete', this.#bulkDelete.bind(this), { [Attributes.TableNav] : 'bulk-delete' });
        appendChildren(row,
            titleNode,
            appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
                this.#bulkAddButton,
                this.#bulkShiftButton,
                this.#bulkDeleteButton));

        this.setHtml(row);
        return row;
    }

    // Override default behavior and don't show anything here, since we override this with our own actions.
    episodeDisplay() { }

    /**
     * Launch the bulk add overlay for the current media item (show/season). */
    #bulkAdd() {
        new BulkAddOverlay(this.mediaItem()).show(this.#bulkAddButton);
    }

    /**
     * Launch the bulk shift overlay for the current media item (show/season). */
    #bulkShift() {
        new BulkShiftOverlay(this.mediaItem()).show(this.#bulkShiftButton);
    }

    /**
     * Launch the bulk delete overlay for the current media item (show/season). */
    #bulkDelete() {
        new BulkDeleteOverlay(this.mediaItem()).show(this.#bulkDeleteButton);
    }
}
