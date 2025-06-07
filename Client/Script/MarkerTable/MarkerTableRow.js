
import { $$, $append, $br, $clear, $div, $divHolder, $span, $td, $textSpan, $tr } from '../HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { animateOpacity, flashBackground } from '../AnimationHelpers.js';
import { Attributes, TableNavDelete } from '../DataAttributes.js';
import { MarkerEdit, ThumbnailMarkerEdit } from './MarkerEdit.js';
import { Theme, ThemeColors } from '../ThemeColors.js';
import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { errorToast } from '../ErrorHandling.js';
import Icons from '../Icons.js';
import { MarkerData } from '/Shared/PlexTypes.js';
import { MarkerType } from '/Shared/MarkerType.js';
import { ServerCommands } from '../Commands.js';
import { TableElements } from './TableElements.js';
import { TimestampThumbnails } from './TimestampThumbnails.js';
import Tooltip from '../Tooltip.js';


const Log = ContextualLog.Create('MarkerTableRow');

/** @typedef {!import('../ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('../ResultRow/BaseItemResultRow').BaseItemResultRow} BaseItemResultRow */

class MarkerRow {
    /**
     * The raw HTML of this marker row.
     * @type {HTMLElement} */
    html;

    /**
     * The media item row that owns this marker row.
     * @type {BaseItemResultRow} */
    #parentRow;

    /**
     * The editor in charge of handling the UI and eventing related to marker edits.
     * @type {MarkerEdit} */
    #editor;

    /**
     * Create a new base MarkerRow. This should not be instantiated on its own, only through its derived classes.
     * @param {BaseItemResultRow} parent The media item that owns this marker.
     * @param {ChapterData[]} [chapters] The chapter data (if any) for the media item associated with this marker. */
    constructor(parent, chapters) {
        this.#parentRow = parent;
        const useThumbs = ClientSettings.useThumbnails() && parent.baseItem().hasThumbnails;

        if (useThumbs) {
            this.#editor = new ThumbnailMarkerEdit(this, chapters);
        } else {
            this.#editor = new MarkerEdit(this, chapters);
        }
    }

    /** Build the HTML of the table row. Overridden by derived classes. */
    buildRow() {}

    /** Return the raw HTML of this row. */
    row() { return this.html; }

    /** Return the base media item this marker belongs to. */
    baseItemRow() { return this.#parentRow; }

    /**
     * The marker table this row belongs to can be cached across searches, but the
     * result row will be different, so we have to update the parent.
     * @param {BaseItemResultRow} parentRow */
    setBaseItem(parentRow) { this.#parentRow = parentRow; }

    /** Returns the editor for this marker. */
    editor() { return this.#editor; }

    /**
     * Returns the start time for this marker. 0 if {@linkcode forAdd} is true. */
    startTime() { return 0; }

    /** Returns the end time for this marker. 0 if {@linkcode forAdd} is true. */
    endTime() { return 0; }

    /** Returns whether this is an in-progress marker addition. */
    forAdd() { return false; }

    /** Returns the marker id for this marker, if it's an edit of an existing marker. */
    markerId() { return -1; }

    /** Returns the type of this marker. */
    markerType() { return 'intro'; }

    /** Return whether this marker was originally created by Plex automatically, or by the user. */
    createdByUser() { return true; }

    /** Resets this marker row after an edit is completed (on success or failure). */
    reset() {}

    /** Triggered when the client windows switches between a large and small width. */
    onWindowResize() {}

    /** Show/hide static preview thumbnails. No-op for non-thumbnail marker rows. */
    toggleStaticPreviews(_show) { return [Promise.resolve()]; }
}

/** Represents an existing marker in the database. */
class ExistingMarkerRow extends MarkerRow {
    /** @type {MarkerData} */
    #markerData;

    /** @type {TimestampThumbnails?} */
    #thumbnails;

    /**
     * @param {MarkerData} marker The marker to base this row off of.
     * @param {BaseItemResultRow} parent The parent media item that owns this marker.
     * @param {ChapterData[]} chapters The chapters (if any) associated with this marker's media item. */
    constructor(marker, parent, chapters) {
        super(parent, chapters);
        this.#markerData = marker;
        if (ClientSettings.useThumbnails() && parent.baseItem().hasThumbnails) {
            this.#thumbnails = new TimestampThumbnails(this, false /*forEdit*/);
        }

        this.buildRow();
    }

    startTime() { return this.#markerData.start; }
    endTime() { return this.#markerData.end; }
    markerId() { return this.#markerData.id; }
    markerType() { return this.#markerData.markerType; }
    createdByUser() { return this.#markerData.createdByUser; }
    reset() {
        const children = this.#tableData(!!$$('.markerOptionsHolder', this.html));
        for (let i = 0; i < children.length; ++i) {
            $clear(this.html.children[i]);
            if (typeof children[i] == 'string') {
                this.html.children[i].innerText = children[i];
            } else {
                this.html.children[i].appendChild(children[i]);
            }
        }

        this.#thumbnails?.reset();
    }

    /**
     * Builds the marker row based on the existing marker values. */
    buildRow() {
        const tr = $tr({ class : 'markerRow' });

        const tableData = this.#tableData(true);
        const timeAttrib = ClientSettings.useThumbnails() ? { class : 'topAlignedPlainText' } : {};
        $append(tr,
            $td(tableData[0]),
            $td(tableData[1], timeAttrib),
            $td(tableData[2], timeAttrib),
            $td(tableData[3], { class : 'centeredColumn timeColumn topAlignedPlainText' }),
            $td(tableData[4], { class : 'centeredColumn topAligned' }));

        this.html = tr;
        if (this.#markerData.isFinal) {
            tr.children[0].classList.add('italic');
            Tooltip.setTooltip(tr.children[0], 'Final');
        }
    }

    /**
     * Retrieve the data fields for the table in the form of an array of strings/HTMLElements.
     * @param {boolean} includeOptions Whether the 'options' column should be included in the data.
     * This will be false if invoking an edit operation didn't need to overwrite the original options. */
    #tableData(includeOptions) {

        const data = [
            Object.keys(MarkerType).find(k => MarkerType[k] === this.#markerData.markerType),
            TableElements.timeData(this.#markerData.start, this.#thumbnails, false /*isEnd*/),
            TableElements.timeData(this.#markerData.end, this.#thumbnails, true /*isEnd*/),
            TableElements.friendlyDate(this.#markerData)
        ];

        if (includeOptions) {
            data.push(this.#buildOptionButtons());
        }

        return data;
    }

    /**
     * Create and return the [thumb]/edit/delete marker option buttons.
     * @returns {HTMLElement} */
    #buildOptionButtons() {
        const editArgs = [ThemeColors.Primary, this.#onEditClick.bind(this), { [Attributes.TableNav] : 'edit' }];
        const delArgs = [ThemeColors.Red, this.#confirmMarkerDelete.bind(this),
            { class : 'deleteMarkerBtn', [Attributes.TableNav] : TableNavDelete }];

        // Force icon buttons when we have 3+ options, otherwise make them dynamic.
        if (this.#thumbnails) {
            // Hacky, shouldn't rely on this behavior.
            return $divHolder({ class : 'markerOptionsHolder' },
                this.#thumbnails.getToggleIcon(false /*dynamic*/),
                ButtonCreator.iconButton(Icons.Edit, 'Edit Marker', ...editArgs),
                ButtonCreator.iconButton(Icons.Delete, 'Delete Marker', ...delArgs),
            );
        }

        return $divHolder({ class : 'markerOptionsHolder' },
            ButtonCreator.dynamicButton('Edit', Icons.Edit, ...editArgs),
            ButtonCreator.dynamicButton('Delete', Icons.Delete, ...delArgs),
        );
    }

    /**
     * Start an edit session, but first, ensure static thumbnails are hidden.
     * @param {MouseEvent} e */
    async #onEditClick(e) {
        if (this.#thumbnails?.visible()) {
            await this.#thumbnails.toggleThumbnails(null, null, 100);
        }

        this.editor().onEdit(e.shiftKey);
    }

    /** Prompts the user before deleting a marker. */
    async #confirmMarkerDelete() {
        const dateAdded = this.html.children[3];
        const options = this.html.children[4];
        Log.assert(dateAdded.childNodes.length === 1, `Inline marker delete only expects a single child in the DateAdded td.`);
        Log.assert(options.childNodes.length === 1, `Inline marker delete only expects a single child in the Options td.`);

        await Promise.all([
            animateOpacity(dateAdded.children[0], 1, 0, { duration : 100, noReset : true },
                () => dateAdded.children[0].classList.add('hidden')),
            animateOpacity(options.children[0], 1, 0, { duration : 100, noReset : true },
                () => options.children[0].classList.add('hidden')),
        ]);

        const text = $span('Are you sure? ', { class : 'inlineMarkerDeleteConfirm' });
        dateAdded.appendChild(text);

        const cancel = ButtonCreator.dynamicButton(
            'No',
            Icons.Cancel,
            ThemeColors.Red,
            this.#onMarkerDeleteCancel.bind(this),
            { [Attributes.TableNav] : 'cancel-del' });
        const delOptions = $append(
            $div({ class : 'markerOptionsHolder inlineMarkerDeleteButtons' }),
            ButtonCreator.dynamicButton('Yes',
                Icons.Confirm,
                ThemeColors.Green,
                this.#onMarkerDelete.bind(this),
                { class : 'confirmDelete', [Attributes.TableNav] : 'confirm-del' }
            ),
            cancel,
        );

        options.appendChild(delOptions);
        cancel.focus();

        return Promise.all([
            animateOpacity(dateAdded, 0, 1, { duration : 100, noReset : true }),
            animateOpacity(delOptions, 0, 1, { duration : 100, noReset : true }),
        ]);
    }

    /** Makes a request to delete a marker, removing it from the marker table on success. */
    async #onMarkerDelete() {
        const confirmBtn = $$('.confirmDelete', this.html);
        try {
            ButtonCreator.setIcon(confirmBtn, Icons.Loading, ThemeColors.Green);
            const rawMarkerData = await ServerCommands.delete(this.markerId());
            ButtonCreator.setIcon(confirmBtn, Icons.Confirm, ThemeColors.Green);
            const deletedMarker = new MarkerData().setFromJson(rawMarkerData);
            /** @type {MediaItemWithMarkerTable} */
            const mediaItem = this.baseItemRow().mediaItem();
            await flashBackground(confirmBtn, Theme.getHex(ThemeColors.Green, '6'), 200);
            Tooltip.dismiss();
            mediaItem.markerTable().deleteMarker(deletedMarker, this.row());
        } catch (err) {
            ButtonCreator.setIcon(confirmBtn, Icons.Confirm, ThemeColors.Red);
            errorToast($textSpan(`Failed to delete marker.`, $br(), err), 5000);
            await flashBackground(confirmBtn, Theme.getHex(ThemeColors.Red, '6'), 500);
            this.#onMarkerDeleteCancel();
        }
    }

    /**
     * Removes the temporary delete confirmation UI and bring the old UI back. */
    async #onMarkerDeleteCancel() {
        const dateAdded = this.html.children[3];
        const confText = $$('.inlineMarkerDeleteConfirm', dateAdded);

        const options = this.html.children[4];
        const confButtons = $$('.inlineMarkerDeleteButtons', options);
        await Promise.all([
            animateOpacity(confText, 1, 0, { duration : 100, noReset : true }),
            animateOpacity(confButtons, 1, 0, { duration : 100, noReset : true }),
        ]);

        dateAdded.removeChild(confText);
        dateAdded.children[0].classList.remove('hidden');
        options.removeChild(confButtons);
        options.children[0].classList.remove('hidden');
        $$('.deleteMarkerBtn', options)?.focus();
        Tooltip.dismiss();

        return Promise.all([
            animateOpacity(dateAdded.children[0], 0, 1, { duration : 100, noReset : true }),
            animateOpacity(options.children[0], 0, 1, { duration : 100, noReset : true })
        ]);
    }

    /**
     * When switching between between small and large screen modes, forward the event to
     * the edit session if it's active, otherwise adjust the 'added at' date text. */
    onWindowResize() {
        if (this.editor().editing) {
            this.editor().onWindowResize();
        } else {
            this.html?.children[3]?.replaceWith(
                $td(TableElements.friendlyDate(this.#markerData), { class : 'centeredColumn timeColumn topAlignedPlainText' }));
        }
    }

    /**
     * Toggle the static thumbnails in this row.
     * @param {boolean} show */
    toggleStaticPreviews(show) {
        /** @type {Promise<void>[]} */
        const promises = [];
        if (this.#thumbnails && this.#thumbnails.visible() !== show) {
            promises.push(this.#thumbnails.toggleThumbnails());
        }

        return promises;
    }
}

/**
 * Represents a marker that does not exist yet, (i.e. being added by the user). */
class NewMarkerRow extends MarkerRow {

    /**
     * @param {BaseItemResultRow} parent The parent metadata item that owns this row.
     * @param {ChapterData[]} chapters */
    constructor(parent, chapters) {
        super(parent, chapters);
        this.buildRow();
    }

    /**
     * Builds an empty row for a new marker. The creator should immediately invoke `editor().onEdit()`
     * after creating this row. */
    buildRow() {
        this.html = $append($tr({ class : 'markerRow' }),
            $td('-'),
            $td('-'),
            $td('-'),
            $td('-', { class : 'centeredColumn timeColumn topAlignedPlainText' }),
            $td('', { class : 'centeredColumn topAligned' }));
    }

    forAdd() { return true; }
}

export { MarkerRow, ExistingMarkerRow, NewMarkerRow };
