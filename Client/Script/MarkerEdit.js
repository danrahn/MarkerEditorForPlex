import { $, $$, appendChildren, buildNode, clearEle, errorResponseOverlay, msToHms, ServerCommand, timeToMs } from "./Common.js";
import { MarkerData, MarkerType } from "../../Shared/PlexTypes.js";

import Tooltip from "./inc/Tooltip.js";

import ButtonCreator from "./ButtonCreator.js";
import SettingsManager from "./ClientSettings.js";
import { MarkerRow } from "./MarkerTableRow.js";
import PlexClientState from "./PlexClientState.js";
import { Log } from "../../Shared/ConsoleLog.js";
import { EpisodeResultRow } from "./ResultRow.js";
import { MediaItemWithMarkerTable } from "./ClientDataExtensions.js";
import MarkerTable from "./MarkerTable.js";
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */


/**
 * Handles the editing of markers in the marker table.
 */
class MarkerEdit {
    /**
     * The marker row to edit.
     * @type {MarkerRow} */
    markerRow;

    /** Whether the marker is currently being edited. */
    editing = false;

    /** @param {MarkerRow} markerRow The marker row to edit. */
    constructor(markerRow) {
        this.markerRow = markerRow;
    }

    /**
     * Start the edit process for a marker, switching out the static UI for editable elements,
     * and replacing the modified date for confirm/cancel buttons.
     * @returns {boolean} Whether we actually started editing the marker (i.e. it wasn't already being edited). */
    onEdit() {
        if (this.editing) {
            return false;
        }

        this.editing = true;
        this.#setMarkerType();
        this.#buildTimeEdit();
        this.#buildConfirmCancel();
        return true;
    }

    /**
     * Return a text input meant for time input. If this edit session isn't for an added marker,
     * set the input's initial value to the marker's corresponding value.
     * @param {boolean} [isEnd=false] Whether the time input is for the end of a marker.
     * @returns {HTMLElement} A text input for a marker. */
    getTimeInput(isEnd) {
        let events = {};
        if (isEnd) {
            events.keydown = this.#onEndTimeInput;
        }

        let initialValue;
        if (this.markerRow.forAdd()) {
            initialValue = '';
        } else {
            initialValue = msToHms(isEnd ? this.markerRow.endTime() : this.markerRow.startTime());
        }

        let input = buildNode('input',
            {
                type : 'text',
                maxlength : 12,
                class : 'timeInput',
                placeholder : 'ms or mm:ss[.000]',
                value : initialValue,
                autocomplete : 'off',
            },
            0,
            events,
            { thisArg : this });

        input.addEventListener('keydown', (e) => {
            if (e.key.length == 1 && !e.ctrlKey && !/[\d:.]/.test(e.key)) {
                e.preventDefault();
            }
        });

        // The above keydown should catch most bad inputs, but the user can still
        // paste something invalid in. This is overkill considering there's already
        // validation before attempting to submit a timestamp, but it's better to
        // prevent the user from doing something bad as early as possible.
        input.addEventListener('paste', function(e) {
            let text = e.clipboardData.getData('text/plain');
            if (!/^[\d:.]*$/.test(text)) {
                const newText = text.replace(/[^\d:.]/g, '');
                e.preventDefault();
                try {
                    document.execCommand('insertText', false, newText);
                } catch (ex) {
                    Log.warn(ex, `MarkerEdit: Failed to execute insertText command`);
                    // Most browsers still support execCommand even though it's deprecated, but if we did fail, try a direct replacement
                    this.value = this.value.substring(0, this.selectionStart) + newText + this.value.substring(this.selectionEnd);
                }
            }
        });

        if (isEnd) {
            Tooltip.setTooltip(input, 'Ctrl+Shift+E to replace with the end of an episode.');
        }

        return input;
    }

    /**
     * Set the first column to be the type of marker (e.g. 'Intro' or 'Credits') */
    #setMarkerType() {
        const span = this.markerRow.row().children[0];
        clearEle(span);
        const select = buildNode('select', { class : 'inlineMarkerType' });
        for (const [title, value] of Object.entries(MarkerType)) {
            const option = buildNode('option', { value : value }, title);
            if (value == this.markerRow.markerType()) {
                option.selected = true;
            }

            select.appendChild(option);
        }

        span.appendChild(select);
    }

    /**
     * Replace the static marker start/end times with editable text fields. */
    #buildTimeEdit() {
        let start = this.markerRow.row().children[1];
        clearEle(start);
        start.appendChild(this.getTimeInput(false));

        let end = this.markerRow.row().children[2];
        clearEle(end);
        end.appendChild(this.getTimeInput(true));
        $$('input', start).focus();
        $$('input', start).select();
    }

    /**
     * Replaces the modified date column with confirm/cancel buttons. */
    #buildConfirmCancel() {
        let confirmCallback;
        let cancelCallback;
        let operation;
        if (this.markerRow.forAdd()) {
            confirmCallback = this.onMarkerAddConfirm;
            cancelCallback = this.onMarkerAddCancel;
            operation = 'Add';
        } else {
            confirmCallback = this.onMarkerEditConfirm;
            cancelCallback = this.onMarkerEditCancel;
            operation = 'Edit';
        }

        let destination = this.markerRow.row().children[3];
        clearEle(destination);
        appendChildren(destination,
            ButtonCreator.iconButton('confirm', `Confirm ${operation}`, 'green', confirmCallback.bind(this)),
            ButtonCreator.iconButton('cancel', `Cancel ${operation}`, 'red', cancelCallback.bind(this))
        );
    }

    /**
     * Attempts to add a marker to the database, first validating that the marker is valid.
     * On success, make the temporary row permanent and rearrange the markers based on their start time. */
    async onMarkerAddConfirm() {
        const markerType = $$('.inlineMarkerType', this.markerRow.row()).value;
        const inputs = $('input[type="text"]', this.markerRow.row());
        const startTime = timeToMs(inputs[0].value);
        const endTime = timeToMs(inputs[1].value);
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        const metadataId = mediaItem.metadataId;
        const final = endTime == mediaItem.duration && markerType == MarkerType.Credits;
        if (!mediaItem.markerTable().checkValues(this.markerRow.markerId(), startTime, endTime)) {
            return;
        }

        try {
            const rawMarkerData = await ServerCommand.add(markerType, metadataId, startTime, endTime, final);
            const newMarker = new MarkerData().setFromJson(rawMarkerData);
            /** @type {MediaItemWithMarkerTable} */
            const mediaItem = this.markerRow.parent().mediaItem();
            mediaItem.markerTable().addMarker(newMarker, this.markerRow.row());
        } catch (err) {
            errorResponseOverlay('Sorry, something went wrong trying to add the marker. Please try again later.', err);
        }
    }

    /** Handle cancellation of adding a marker - remove the temporary row and reset the 'Add Marker' button. */
    onMarkerAddCancel() {
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        mediaItem.markerTable().removeTemporaryMarkerRow(this.markerRow.row());
    }

    /** Commits a marker edit, assuming it passes marker validation. */
    async onMarkerEditConfirm() {
        const markerType = $$('.inlineMarkerType', this.markerRow.row()).value;
        const inputs = $('input[type="text"]', this.markerRow.row());
        const startTime = timeToMs(inputs[0].value);
        const endTime = timeToMs(inputs[1].value);
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        const userCreated = this.markerRow.createdByUser();
        const markerId = this.markerRow.markerId();
        const final = endTime == mediaItem.duration && markerType == MarkerType.Credits;
        if (!mediaItem.markerTable().checkValues(markerId, startTime, endTime)) {
            return;
        }

        try {
            const rawMarkerData = await ServerCommand.edit(markerType, markerId, startTime, endTime, userCreated, final);
            const editedMarker = new MarkerData().setFromJson(rawMarkerData);
            /** @type {MediaItemWithMarkerTable} */
            const mediaItem = this.markerRow.parent().mediaItem();
            mediaItem.markerTable().editMarker(editedMarker);
            this.resetAfterEdit();
        } catch (err) {
            this.onMarkerEditCancel();
            errorResponseOverlay('Sorry, something went wrong with that request.', err);
        }
    }

    /**
     * Callback after a marker has been successfully edited. Replace input fields with the new times, and adjust indexes as necessary.
     * @param {Object} response The server response, a serialized version of {@linkcode MarkerData}. */
    onMarkerEditSuccess(response) {
        const partialMarker = new MarkerData().setFromJson(response);
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        mediaItem.markerTable().editMarker(partialMarker);
        this.resetAfterEdit();
    }

    /** Cancels an edit operation, reverting the editable row fields with their previous times. */
    onMarkerEditCancel() {
        this.resetAfterEdit();
    }

    /**
     * Removes the editable input fields from a marker that was in edit mode, reverting back to static values. */
    resetAfterEdit() {
        this.markerRow.reset();
        this.editing = false;
        Tooltip.dismiss();
    }

    /**
     * Processes input to the 'End time' input field, entering the end of the episode on Ctrl+Shift+E
     * @this {MarkerEdit}
     * @param {HTMLInputElement} input
     * @param {KeyboardEvent} e */
    #onEndTimeInput(input, e) {
        if (!e.shiftKey || !e.ctrlKey || e.key != 'E') {
            return;
        }

        e.preventDefault();
        input.value = msToHms(this.markerRow.parent().mediaItem().duration);

        // Assume credits if they enter the end of the episode.
        $$('.inlineMarkerType', this.markerRow.row()).value = 'credits';
    }
}

/**
 * An extension of MarkerEdit that handles showing/hiding thumbnails associated with the input timestamps.
 */
class ThumbnailMarkerEdit extends MarkerEdit {
    /**
     * Whether we ran into an error when loading a thumbnail.
     * @type {boolean} */
    #thumbnailError = false;
    #thumbnailsCollapsed = SettingsManager.Get().collapseThumbnails();

    /** @param {MarkerRow} markerRow The marker row to edit. */
    constructor(markerRow) {
        super(markerRow);
    }

    /**
     * Holds the setTimeout id that will load a preview thumbnail based on the current input value.
     * Only valid if autoload is enabled.
     * @type {number} */
    #autoloadTimeout;

    /**
     * Builds on top of {@linkcode MarkerEdit.getTimeInput}, adding a thumbnail below the time input field.
     * @param {boolean} isEnd Whether we're getting time input for the end of the marker.
     */
    getTimeInput(isEnd) {
        let input = super.getTimeInput(isEnd);
        const timestamp = (isEnd ? this.markerRow.endTime() : this.markerRow.startTime());
        input.addEventListener('keyup', this.#onTimeInputKeyup.bind(this, input));
        const src = `t/${this.markerRow.parent().mediaItem().metadataId}/${timestamp}`;
        let img = buildNode(
            'img',
            { src : src, class : 'inputThumb loading', alt : 'Timestamp Thumbnail', width : '240px', style : 'height: 0' },
            0,
            {
                error : this.#onThumbnailPreviewLoadFailed,
                load : this.#onThumbnailPreviewLoad
            },
            { thisArg : this }
        );

        if (SettingsManager.Get().autoLoadThumbnails()) {
            Tooltip.setTooltip(img, 'Press Enter after entering a timestamp<br>to update the thumbnail.');
        }

        return appendChildren(buildNode('div', { class : 'thumbnailTimeInput' }), input, img);
    }

    onEdit() {
        if (!super.onEdit()) {
            return;
        }

        let options = this.markerRow.row().children[4];
        for (const child of options.children) {
            child.classList.add('hidden');
        }

        const startCollapsed = SettingsManager.Get().collapseThumbnails();
        const startText = `${startCollapsed ? 'Show' : 'Hide'} Thumbs`;
        const btn = ButtonCreator.fullButton(startText, 'imgIcon', 'Show/Hide Thumbnails', 'standard', this.#expandContractThumbnails.bind(this));
        btn.classList.add('thumbnailShowHide');
        options.appendChild(btn);
    }

    resetAfterEdit() {
        let span = $$('.thumbnailShowHide', this.markerRow.row());
        if (!span) {
            return;
        }

        const parent = span.parentNode;
        parent.removeChild(span);
        for (const child of parent.children) {
            child.classList.remove('hidden');
        }

        super.resetAfterEdit();
    }

    /**
     * Detects 'Enter' keypress in time input fields and fetches a new thumbnail if needed.
     * @this {ThumbnailMarkerEdit}
     * @param {HTMLElement} input
     * @param {KeyboardEvent} e */
    #onTimeInputKeyup(input, e) {
        // We only care about input if thumbnails are visible
        if (this.#thumbnailsCollapsed) {
            return;
        }

        this.#handleThumbnailAutoLoad(input, e);
        if (e.key != 'Enter') {
            return;
        }



        this.#refreshImage(input.parentNode);
    }

    /**
     * Resets the autoload timer if enabled. Continues with regular load if 'Enter' was the pressed key.
     * @param {HTMLElement} input
     * @param {KeyboardEvent} e */
    #handleThumbnailAutoLoad(input, e) {
        if (!SettingsManager.Get().autoLoadThumbnails()) {
            return;
        }

        clearTimeout(this.#autoloadTimeout);
        if (e.key != 'Enter') {
            this.#autoloadTimeout = setTimeout(/**@this {ThumbnailMarkerEdit}*/function() {
                this.#refreshImage(input.parentNode);
            }.bind(this), 250);
        }
    }

    /**
     * Sets the src of a thumbnail image based on the current input.
     * @param {Element} editGroup The DOM element containing a start or end marker's time input and thumbnail. */
    #refreshImage(editGroup) {
        const timestamp = timeToMs($$('.timeInput', editGroup).value);
        if (isNaN(timestamp)) {
            return; // Don't ask for a thumbnail if the input isn't valid.
        }
        let img = $$('.inputThumb', editGroup);
        if (!img) {
            // We shouldn't get here
            Log.warn('Unable to retrieve marker thumbnail image, no img element found!');
            return;
        }

        const url = `t/${this.markerRow.parent().mediaItem().metadataId}/${timestamp}`;
        img.classList.remove('hidden');
        if (!img.src.endsWith(url)) {
            img.classList.remove('loaded');
            img.classList.add('loading');
            img.src = url;
        }
    }

    /** Callback when we failed to load a preview thumbnail, marking it as in an error state. */
    #onThumbnailPreviewLoadFailed(img) {
        this.#thumbnailError = true;
        img.classList.add('hidden');
        img.classList.remove('loading');
    }

    /** Callback when we successfully loaded a preview thumbnail, setting its initial expanded/collapsed state. */
    #onThumbnailPreviewLoad(img) {
        img.classList.remove('loading');
        img.classList.add('loaded');
        const realHeight = img.naturalHeight * (img.width / img.naturalWidth);
        img.setAttribute('realheight', realHeight);
        if (this.#thumbnailsCollapsed) {
            img.classList.add('hiddenThumb');
        } else {
            img.style.height = `${realHeight}px`;
            img.classList.add('visibleThumb');
        }
    }

    /**
     * Callback when the 'Show/Hide Thumbs' button is clicked. Adjusts the button text
     * and begin the height transitions for the thumbnails themselves.
     * @param {MouseEvent} _ The (unused) MouseEvent
     * @param {HTMLElement} button */
    #expandContractThumbnails(_, button) {
        if (this.#thumbnailError) {
            return // Something else bad happened, don't touch it. TODO: Recover if it's no longer in an error state.
        }
        this.#thumbnailsCollapsed = !this.#thumbnailsCollapsed;
        const hidden = button.innerText.startsWith('Show');
        $('.inputThumb', this.markerRow.row()).forEach(thumb => {
            thumb.classList.toggle('hiddenThumb');
            thumb.style.height = this.#thumbnailsCollapsed ? '0' : thumb.getAttribute('realheight') + 'px';
            thumb.classList.toggle('visibleThumb');
            $$('span', button).innerText = `${hidden ? 'Hide' : 'Show'} Thumbs`;
            if (!this.#thumbnailsCollapsed) {
                this.#refreshImage(thumb.parentNode);
            }
        });
    }
}

export { MarkerEdit, ThumbnailMarkerEdit }
