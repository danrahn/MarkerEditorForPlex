import { $, $$, appendChildren, buildNode, clearEle, errorMessage, jsonRequest, msToHms } from "./Common.js";
import { MarkerData } from "../../Shared/PlexTypes.js";

import Overlay from "./inc/Overlay.js";
import Tooltip from "./inc/Tooltip.js";

import ButtonCreator from "./ButtonCreator.js";
import SettingsManager from "./ClientSettings.js";
import { MarkerRow } from "./MarkerTableRow.js";
import PlexClientState from "./PlexClientState.js";


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
                value : initialValue
            },
            0,
            events,
            { thisArg : this });

        if (isEnd) {
            Tooltip.setTooltip(input, 'Ctrl+Shift+E to replace with the end of an episode.');
        }

        return input;
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
            ButtonCreator.iconButton('confirm', `Confirm ${operation}`, 'green', confirmCallback, {}, this),
            ButtonCreator.iconButton('cancel', `Cancel ${operation}`, 'red', cancelCallback, {}, this)
        );
    }

    /**
     * Attempts to add a marker to the database, first validating that the marker is valid.
     * On success, make the temporary row permanent and rearrange the markers based on their start time. */
    onMarkerAddConfirm() {
        const inputs = $('input[type="text"]', this.markerRow.row());
        const startTime = MarkerEdit.timeToMs(inputs[0].value);
        const endTime = MarkerEdit.timeToMs(inputs[1].value);
        const metadataId = this.markerRow.episodeId();
        const episode = PlexClientState.GetState().getEpisode(metadataId);
        if (!episode.checkValues(this.markerRow.markerId(), startTime, endTime)) {
            return;
        }

        let failureFunc = (response) => {
            Overlay.show(`Sorry, something went wrong trying to add the marker. Please try again later.<br><br>
            Server response:<br>${errorMessage(response)}`, 'OK');
        }
    
        jsonRequest('add', { metadataId : metadataId, start : startTime, end : endTime }, this.onMarkerAddSuccess.bind(this), failureFunc);
    }

    /**
     * Callback after we successfully added a marker. Replace the temporary row with a permanent one, and adjust indexes as necessary.
     * @param {Object} response The server response, a serialized version of {@linkcode MarkerData}. */
    onMarkerAddSuccess(response) {
        const newMarker = new MarkerData().setFromJson(response);
        PlexClientState.GetState().getEpisode(newMarker.episodeId).addMarker(newMarker, this.markerRow.row());
    }

    /** Handle cancellation of adding a marker - remove the temporary row and reset the 'Add Marker' button. */
    onMarkerAddCancel() {
        PlexClientState.GetState().getEpisode(this.markerRow.episodeId()).cancelMarkerAdd(this.markerRow.row());
    }

    /** Commits a marker edit, assuming it passes marker validation. */
    onMarkerEditConfirm() {
        const inputs = $('input[type="text"]', this.markerRow.row());
        const startTime = MarkerEdit.timeToMs(inputs[0].value);
        const endTime = MarkerEdit.timeToMs(inputs[1].value);
        const metadataId = this.markerRow.episodeId();
        const episode = PlexClientState.GetState().getEpisode(metadataId);
        const userCreated = this.markerRow.createdByUser();
        const markerId = this.markerRow.markerId();
        if (!episode.checkValues(markerId, startTime, endTime)) {
            return;
        }

        let failureFunc = (response) => {
            this.onMarkerEditCancel.bind(this)();
            Overlay.show(`Sorry, something went wrong with that request. Server response:<br><br>${errorMessage(response)}`, 'OK');
        }

        jsonRequest('edit', { id : markerId, start : startTime, end : endTime, userCreated : userCreated ? 1 : 0 }, this.onMarkerEditSuccess.bind(this), failureFunc.bind(this));
    }

    /**
     * Callback after a marker has been successfully edited. Replace input fields with the new times, and adjust indexes as necessary.
     * @param {Object} response The response from the server, a serialized version of a minimal {@linkcode MarkerData}. */
    onMarkerEditSuccess(response) {
        const partialMarker = new MarkerData().setFromJson(response);
        PlexClientState.GetState().getEpisode(partialMarker.episodeId).editMarker(partialMarker);
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
        input.value = msToHms(PlexClientState.GetState().getEpisode(this.markerRow.episodeId()).duration);
    }

    /**
     * Parses [hh]:mm:ss.000 input into milliseconds (or the integer conversion of string milliseconds).
     * @param {string} value The time to parse
     * @returns The number of milliseconds indicated by `value`. */
    static timeToMs(value) {
        let ms = 0;
        if (value.indexOf(':') == -1 && value.indexOf('.') == -1) {
            return parseInt(value);
        }
    
        // I'm sure this can be improved on.
        let result = /^(?:(\d?\d):)?(?:(\d?\d):)?(\d?\d)\.?(\d{1,3})?$/.exec(value);
        if (!result) {
            return NaN;
        }
    
        if (result[4]) {
            ms = parseInt(result[4]);
            switch (result[4].length) {
                case 1:
                    ms *= 100;
                    break;
                case 2:
                    ms *= 10;
                    break;
                default:
                    break;
            }
        }
    
        if (result[3]) {
            ms += parseInt(result[3]) * 1000;
        }
    
        if (result[2]) {
            ms += parseInt(result[2]) * 60 * 1000;
        }
    
        // Because the above regex isn't great, if we have mm:ss.000, result[1]
        // will be populated but result[2] won't. This catches that and adds
        // result[1] as minutes instead of as hours like we do below.
        if (result[1] && !result[2]) {
            ms += parseInt(result[1]) * 60 * 1000;
        }
    
        if (result[1] && result[2]) {
            ms += parseInt(result[1]) * 60 * 60 * 1000;
        }
    
        return ms;
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

    /** @param {MarkerRow} markerRow The marker row to edit. */
    constructor(markerRow) {
        super(markerRow);
    }

    /**
     * Builds on top of {@linkcode MarkerEdit.getTimeInput}, adding a thumbnail below the time input field.
     * @param {boolean} isEnd Whether we're getting time input for the end of the marker.
     */
    getTimeInput(isEnd) {
        let input = super.getTimeInput(isEnd);
        const timestamp = (isEnd ? this.markerRow.endTime() : this.markerRow.startTime()) / 1000;
        input.addEventListener('keyup', this.#onTimeInputKeyup.bind(this, input));
        const src = `t/${this.markerRow.episodeId()}/${timestamp}`;
        let img = buildNode(
            'img',
            { src : src, class : 'inputThumb', alt : 'Timestamp Thumbnail', width : '240px', style : 'height: 0' },
            0,
            {
                error : this.#onThumbnailPreviewLoadFailed,
                load : this.#onThumbnailPreviewLoad
            },
            { thisArg : this }
        );

        Tooltip.setTooltip(img, 'Press Enter after entering a timestamp<br>to update the thumbnail.');
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
        const btn = ButtonCreator.fullButton(startText, 'imgIcon', 'Show/Hide Thumbnails', 'standard', this.#expandContractThumbnails, {}, this);
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
        if (e.key != 'Enter') {
            return;
        }

        const seconds = parseInt(MarkerEdit.timeToMs(input.value) / 1000);
        if (isNaN(seconds)) {
            return; // Don't asl for a thumbnail if the input isn't valid.
        }

        let img = $$('.inputThumb', input.parentNode);
        if (!img) {
            // We shouldn't get here
            Log.warn('Unable to retrieve marker thumbnail image, no img element found!');
            return;
        }

        const url = `t/${this.markerRow.episodeId()}/${seconds}`;
        img.classList.remove('hidden');
        img.src = url;
    }

    /** Callback when we failed to load a preview thumbnail, marking it as in an error state. */
    #onThumbnailPreviewLoadFailed(img) {
        this.#thumbnailError = true;
        img.classList.add('hidden');
    }

    /** Callback when we successfully loaded a preview thumbnail, setting its initial expanded/collapsed state. */
    #onThumbnailPreviewLoad(img) {
        const realHeight = img.naturalHeight * (img.width / img.naturalWidth);
        img.setAttribute('realheight', realHeight);
        if (SettingsManager.Get().collapseThumbnails()) {
            img.classList.add('hiddenThumb');
        } else {
            img.style.height = `${realHeight}px`;
            img.classList.add('visibleThumb');
        }
    }
    
    /**
     * Callback when the 'Show/Hide Thumbs' button is clicked. Adjusts the button text
     * and begin the height transitions for the thumbnails themselves. */
    #expandContractThumbnails(button) {
        if (this.#thumbnailError) {
            return // Something else bad happened, don't touch it. TODO: Recover if it's no longer in an error state.
        }

        const hidden = button.innerText.startsWith('Show');
        $('.inputThumb', this.markerRow.row()).forEach(thumb => {
            thumb.classList.toggle('hiddenThumb');
            thumb.style.height = hidden ? thumb.getAttribute('realheight') + 'px' : '0';
            thumb.classList.toggle('visibleThumb');
            $$('span', button).innerText = `${hidden ? 'Hide' : 'Show'} Thumbs`;
        });
    }
}

export { MarkerEdit, ThumbnailMarkerEdit }
