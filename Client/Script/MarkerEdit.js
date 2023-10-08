import {
    $,
    $$,
    appendChildren,
    buildNode,
    clearEle,
    errorResponseOverlay,
    msToHms,
    ServerCommand,
    timeInputShortcutHandler,
    timeToMs } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import Overlay from './inc/Overlay.js';
import Tooltip from './inc/Tooltip.js';

import ButtonCreator from './ButtonCreator.js';
import { ClientSettings } from './ClientSettings.js';
import { MarkerData } from '../../Shared/PlexTypes.js';
import { MarkerType } from '../../Shared/MarkerType.js';

/** @typedef {!import('../../Shared/PlexTypes').ChapterData} ChapterData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('./ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('./MarkerTableRow').MarkerRow} MarkerRow */


const Log = new ContextualLog('MarkerEdit');

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

    /**
     * Chapters associated with this marker's media item.
     * @type {ChapterData[]} */
    #chapters;

    /**
     * @param {MarkerRow} markerRow The marker row to edit.
     * @param {ChapterData[]} chapters Chapter data (if any) for the media item associated with this marker. */
    constructor(markerRow, chapters) {
        this.markerRow = markerRow;
        this.#chapters = chapters;
    }

    /**
     * Start the edit process for a marker, switching out the static UI for editable elements,
     * and replacing the modified date for confirm/cancel buttons.
     * @param {boolean} startInChapterMode Whether to initialize chapter-edit UI (if we have chapter data).
     * @returns {boolean} Whether we actually started editing the marker (i.e. it wasn't already being edited). */
    onEdit(startInChapterMode) {
        if (this.editing) {
            return false;
        }

        this.editing = true;
        this.#buildMarkerType();
        this.#buildTimeEdit();
        this.#buildConfirmCancel();
        this.#buildChapterSwitch();
        if (startInChapterMode && this.#chapters.length > 0) {
            this.#toggleChapterEntry();
        }

        return true;
    }

    /**
     * Return a text input meant for time input. If this edit session isn't for an added marker,
     * set the input's initial value to the marker's corresponding value.
     * @param {boolean} [isEnd=false] Whether the time input is for the end of a marker.
     * @returns {HTMLElement} A text input for a marker. */
    getTimeInput(isEnd) {
        const events = {
            keydown : [
                function (_input, e) { timeInputShortcutHandler(e, this.markerRow.parent().mediaItem().duration); },
                this.#timeInputEditShortcutHandler
            ],
            keyup : [
                this.#timeInputEditKeyupShortcutHandler
            ]
        };
        if (isEnd) {
            events.keydown.push(this.#onEndTimeInput);
        }

        let initialValue;
        if (this.markerRow.forAdd()) {
            initialValue = '';
        } else {
            initialValue = msToHms(isEnd ? this.markerRow.endTime() : this.markerRow.startTime());
        }

        const input = buildNode('input',
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

        // The above keydown should catch most bad inputs, but the user can still
        // paste something invalid in. This is overkill considering there's already
        // validation before attempting to submit a timestamp, but it's better to
        // prevent the user from doing something bad as early as possible.
        input.addEventListener('paste', function(e) {
            const text = e.clipboardData.getData('text/plain');
            if (!/^[\d:.]*$/.test(text)) {
                const newText = text.replace(/[^\d:.]/g, '');
                e.preventDefault();

                // Only attempt to insert if our transformed data can be interpreted
                // as a valid timestamp.
                if (isNaN(timeToMs(newText)) && isNaN(parseInt(newText))) {
                    return;
                }

                try {
                    document.execCommand('insertText', false, newText);
                } catch (ex) {
                    Log.warn(ex, `Failed to execute insertText command`);
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
     * Handles MarkerEdit specific time input shortcuts, like committing an action
     * and changing the marker type.
     * @param {KeyboardEvent} e */
    #timeInputEditShortcutHandler(_input, e) {
        if (e.shiftKey || e.ctrlKey || e.altKey) {
            return;
        }

        switch (e.key) {
            case 'i':
                e.preventDefault();
                return this.#setMarkerType(MarkerType.Intro);
            case 'c':
                e.preventDefault();
                return this.#setMarkerType(MarkerType.Credits);
            case 'Enter':
                // Only commit on Keyup to avoid any accidental double submissions
                // that may result in confusing error UI. Left here for when my
                // future self forgets why I didn't add this here.
                break;
            case 'Escape':
                return this.#onMarkerActionCancel(e);
            default:
                return;
        }
    }

    /**
     * Handles MarkerEdit specific time input shortcuts that should
     * only fire on Keyup (i.e. committing the action)
     * @param {*} _input
     * @param {KeyboardEvent} e */
    #timeInputEditKeyupShortcutHandler(_input, e) {
        switch (e.key) {
            case 'Enter':
                // Ctrl+Enter or Shift+Enter attempts to submit the operation
                if (e.ctrlKey || e.shiftKey) {
                    this.#onMarkerActionConfirm(e);
                }
                break;
            default:
                break;
        }
    }

    /**
     * Set the first column to be the type of marker (e.g. 'Intro' or 'Credits') */
    #buildMarkerType() {
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
     * @param {string} markerType */
    #setMarkerType(markerType) {
        const select = this.markerRow.row().children[0].querySelector('select');
        if (!select) {
            Log.warn('setMarkerType - Unable to find marker type dropdown');
            return;
        }

        switch (markerType) {
            case MarkerType.Intro:
                select.value = 'intro';
                break;
            case MarkerType.Credits:
                select.value = 'credits';
                break;
            default:
                Log.warn(`setMarkerType - Unknown type ${markerType} given.`);
                break;
        }
    }

    /**
     * Replace the static marker start/end times with editable text fields. */
    #buildTimeEdit() {
        const start = this.markerRow.row().children[1];
        clearEle(start);
        start.appendChild(this.getTimeInput(false));

        const end = this.markerRow.row().children[2];
        clearEle(end);
        end.appendChild(this.getTimeInput(true));
        $$('input', start).focus();
        $$('input', start).select();
    }

    /**
     * Replaces the modified date column with confirm/cancel buttons. */
    #buildConfirmCancel() {
        let operation;
        if (this.markerRow.forAdd()) {
            operation = 'Add';
        } else {
            operation = 'Edit';
        }

        const destination = this.markerRow.row().children[3];
        clearEle(destination);
        appendChildren(destination,
            ButtonCreator.iconButton('confirm', `Confirm ${operation}`, 'green', this.#onMarkerActionConfirm.bind(this)),
            ButtonCreator.iconButton('cancel', `Cancel ${operation}`, 'red', this.#onMarkerActionCancel.bind(this))
        );
    }

    /**
     * Relay a marker add/edit confirmation to the right handler.
     * @param {Event} event */
    async #onMarkerActionConfirm(event) {
        if (this.markerRow.forAdd()) {
            this.#onMarkerAddConfirm(event);
        } else {
            this.#onMarkerEditConfirm(event);
        }
    }

    /**
     * Relay a marker add/edit cancellation to the right handler.
     * @param {Event} event */
    async #onMarkerActionCancel(event) {
        if (this.markerRow.forAdd()) {
            this.#onMarkerAddCancel(event);
        } else {
            this.#onMarkerEditCancel(event);
        }
    }

    /**
     * Attempts to add a marker to the database, first validating that the marker is valid.
     * On success, make the temporary row permanent and rearrange the markers based on their start time.
     * @param {Event} event */
    async #onMarkerAddConfirm(event) {
        const markerType = $$('.inlineMarkerType', this.markerRow.row()).value;
        const inputs = $('input[type="text"]', this.markerRow.row());
        const startTime = timeToMs(inputs[0].value);
        const endTime = timeToMs(inputs[1].value);
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        const metadataId = mediaItem.metadataId;
        const final = endTime == mediaItem.duration && markerType == MarkerType.Credits;
        if (!mediaItem.markerTable().checkValues(this.markerRow.markerId(), startTime, endTime)) {
            Overlay.setFocusBackElement(event.target);
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
    #onMarkerAddCancel() {
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        mediaItem.markerTable().removeTemporaryMarkerRow(this.markerRow.row());
    }

    /** Commits a marker edit, assuming it passes marker validation.
     * @param {Event} event */
    async #onMarkerEditConfirm(event) {
        const markerType = $$('.inlineMarkerType', this.markerRow.row()).value;
        const inputs = $('input[type="text"]', this.markerRow.row());
        const startTime = timeToMs(inputs[0].value);
        const endTime = timeToMs(inputs[1].value);
        /** @type {MediaItemWithMarkerTable} */
        const mediaItem = this.markerRow.parent().mediaItem();
        const markerId = this.markerRow.markerId();
        const final = endTime == mediaItem.duration && markerType == MarkerType.Credits;
        if (!mediaItem.markerTable().checkValues(markerId, startTime, endTime)) {
            Overlay.setFocusBackElement(event.target);
            return;
        }

        try {
            const rawMarkerData = await ServerCommand.edit(markerType, markerId, startTime, endTime, final);
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
     * Initializes the Chapter Edit button, and if chapters are available, the chapter dropdowns. */
    #buildChapterSwitch() {
        // Always hide non-edit options, but don't add anything if we have no chapter data.
        const options = this.markerRow.row().children[4];
        for (const child of options.children) {
            child.classList.add('hidden');
        }

        const btn = ButtonCreator.fullButton(
            'Chapters',
            'chapter',
            'Chapter Mode Toggle',
            'standard',
            this.#toggleChapterEntry.bind(this),
            {
                class : 'chapterToggle',
                tooltip : 'Enter Chapter Mode'
            }
        );

        options.appendChild(btn);
        if (this.#chapters.length === 0) {
            btn.classList.add('disabled');
            Tooltip.setTooltip(btn, `No chapter data found, can't enter chapter edit mode.`);
        } else {
            // Relies on time inputs already existing
            const start = this.markerRow.row().children[1];
            start.insertBefore(this.#chapterSelect(false /*end*/), start.firstChild);
            const end = this.markerRow.row().children[2];
            end.insertBefore(this.#chapterSelect(true /*end*/), end.firstChild);
        }
    }

    /**
     * Handler that toggles the visibility of raw time inputs versus chapter dropdowns when the chapter icon is clicked. */
    #toggleChapterEntry() {
        if (this.#chapters.length < 1) {
            Log.warn(`Called toggleChapterEntry when we don't have any chapter data to show! Ignoring call.`);
            return;
        }

        const row = this.markerRow.row();
        $('.timeInput', row).forEach(r => {
            r.classList.toggle('hidden');
        });

        $('.chapterSelect', row).forEach(r => {
            r.classList.toggle('hidden');

            // In addition to toggling, set the raw input to the most recently selected chapter. While
            // not necessarily in all cases, it does ensure we properly adjust any preview thumbnails.
            const select = $$('select', r);
            const valueFromChapter = msToHms(this.#chapters[select.value][select.getAttribute('data-chapterFn')]);
            const input = $$('.timeInput', r.parentElement);
            input.value = valueFromChapter;
            input.dispatchEvent(new KeyboardEvent('keyup', { key : 'Enter', keyCode : 13 }));
        });

        const toggle = $$('.chapterToggle', row);
        if ($('.timeInput', row)?.[0].classList.contains('hidden')) {
            ButtonCreator.setText(toggle, 'Manual');
            ButtonCreator.setIcon(toggle, 'cursor', 'standard');
            Tooltip.setText(toggle, 'Enter Manual Mode');
        } else {
            ButtonCreator.setText(toggle, 'Chapters');
            ButtonCreator.setIcon(toggle, 'chapter', 'standard');
            Tooltip.setText(toggle, 'Enter Chapter Mode');
        }
    }

    /**
     * Build and return a dropdown containing the available chapters for the media item associated with this marker.
     * @param {boolean} end Whether we're building a dropdown for the end of a marker. */
    #chapterSelect(end) {
        // A11y - All inputs should have a label (even if hidden), but since there can be an arbitrary number
        // of marker edits active, we need to generate a unique ID to link the two (I think).
        const id = (base => {
            let post;
            do { post = crypto.getRandomValues(new Uint32Array(1))[0].toString(16); } while ($(`#${base}${post}`));

            return base + post;
        })('chapterSelectContainer');

        const select = buildNode(
            'select',
            { class : 'editByChapter', 'data-chapterFn' : end ? 'end' : 'start' },
            0,
            { change : this.#onChapterInputChanged.bind(this) });

        // If we're editing an exiting marker, start out with chapters that are closest to the original marker value.
        let currentValue = $$('.timeInput', this.markerRow.row().children[end ? 2 : 1]);
        currentValue = currentValue ? timeToMs(currentValue.value) : 0;
        let bestValue = 0;
        let bestDiff = Math.abs(this.#chapters[0][end ? 'end' : 'start'] - currentValue);
        for (const [index, chapter] of Object.entries(this.#chapters)) {
            const timestamp = end ? chapter.end : chapter.start;
            const displayTime = msToHms(timestamp);
            const displayTitle = `${chapter.name || 'Chapter ' + (parseInt(index) + 1)} (${displayTime})`;
            const diff = Math.abs(timestamp - currentValue);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestValue = index;
            }

            select.appendChild(buildNode('option', { value : index }, displayTitle));
        }

        select.value = bestValue;
        select.title = select.children[bestValue].innerText;

        return appendChildren(buildNode('span', { class : 'chapterSelect hidden' }),
            buildNode('label', { for : id, class : 'hidden' }, end ? 'End Chapter' : 'Start Chapter'),
            select);
    }

    /**
     * Update the underlying time inputs when chapters change.
     * @param {Event} e */
    #onChapterInputChanged(e) {
        // TODO: Logic to enable/disable options to prevent selecting a start timestamp greater than the end.
        // That can get tricky though, e.g. I want to immediately change the intro chapter, but can't because
        // it's larger than the current end. A better approach may be a 'link' option that allows users to
        // just specify a single chapter, and it updates the start and end. That's the more natural approach,
        // but clashes with the marker table's concept of separate starts and ends, and it was easier to keep
        // them separate for chapters as well in this initial implementation.
        const index = e.target.value;
        const valueFromChapter = msToHms(this.#chapters[index][e.target.getAttribute('data-chapterFn')]);
        const input = $$('.timeInput', e.target.parentElement.parentElement);
        input.value = valueFromChapter;
        e.target.title = e.target.children[index].innerText;

        // Simulate an 'Enter' key to ensure thumbnails are updated if present.
        input.dispatchEvent(new KeyboardEvent('keyup', { key : 'Enter', keyCode : 13 }));
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
    #onMarkerEditCancel() {
        this.resetAfterEdit();
    }

    /**
     * Removes the editable input fields from a marker that was in edit mode, reverting back to static values. */
    resetAfterEdit() {
        const options = this.markerRow.row().children[4];
        const chapterToggle = $$('.chapterToggle', options);
        chapterToggle?.parentElement.removeChild(chapterToggle);

        for (const child of options.children) {
            child.classList.remove('hidden');
        }

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
     * Whether we ran into an error when loading a start/end thumbnail.
     * @type {boolean[]} */
    #thumbnailError = [false, false];
    #thumbnailsCollapsed = ClientSettings.collapseThumbnails();
    #cachedHeight = 0;

    /**
     * @param {MarkerRow} markerRow The marker row to edit.
     * @param {ChapterData} chapters The chapter data (if any) for this marker's media item. */
    constructor(markerRow, chapters) {
        super(markerRow, chapters);
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
        const input = super.getTimeInput(isEnd);
        input.addEventListener('keydown', this.#thumbnailTimeInputShortcutHandler.bind(this));
        const timestamp = (isEnd ? this.markerRow.endTime() : this.markerRow.startTime());
        input.addEventListener('keyup', this.#onTimeInputKeyup.bind(this, input));
        const src = `t/${this.markerRow.parent().mediaItem().metadataId}/${timestamp}`;
        const img = buildNode(
            'img',
            {
                src : src,
                class : `inputThumb loading thumb${isEnd ? 'End' : 'Start' }`,
                alt : 'Timestamp thumbnail',
                width : '240px',
                style : 'height: 0'
            },
            0,
            {
                error : this.#onThumbnailPreviewLoadFailed.bind(this),
                load : this.#onThumbnailPreviewLoad.bind(this)
            },
            { thisArg : this }
        );

        if (!ClientSettings.autoLoadThumbnails()) {
            Tooltip.setTooltip(img, 'Press Enter after entering a timestamp to update the thumbnail.');
        }

        return appendChildren(buildNode('div', { class : 'thumbnailTimeInput' }), input, img);
    }

    onEdit(startInChapterMode) {
        if (!super.onEdit(startInChapterMode)) {
            return;
        }

        const startCollapsed = ClientSettings.collapseThumbnails();
        const startText = startCollapsed ? 'Show' : 'Hide';
        const btn = ButtonCreator.fullButton(
            startText,
            'imgIcon',
            'Show/Hide Thumbnails',
            'standard',
            this.#expandContractThumbnails.bind(this));

        btn.classList.add('thumbnailShowHide');
        const options = this.markerRow.row().children[4];

        // We want this as the first option. insertBefore properly handles the case where firstChild is null
        options.insertBefore(btn, options.firstChild);
    }

    resetAfterEdit() {
        const span = $$('.thumbnailShowHide', this.markerRow.row());
        if (!span) {
            return;
        }

        const parent = span.parentNode;
        parent.removeChild(span);
        super.resetAfterEdit();
    }

    /**
     * @param {KeyboardEvent} e */
    #thumbnailTimeInputShortcutHandler(e) {
        switch (e.key) {
            case 't':
                e.preventDefault();
                this.#expandContractThumbnails(null, this.markerRow.row().children[4].querySelector('div.button'));
                break;
            default:
                break;
        }
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
        if (!ClientSettings.autoLoadThumbnails()) {
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

        const img = $$('.inputThumb', editGroup);
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

    /** Callback when we failed to load a preview thumbnail, marking it as in an error state.
     * @param {HTMLImageElement} img */
    #onThumbnailPreviewLoadFailed(img) {
        if (this.#cachedHeight && !img.src.endsWith('svg')) {
            img.src = `t/-1/${this.#cachedHeight}.svg`;
            const idx = img.classList.contains('thumbnailStart') ? 0 : 1;
            const wasError = this.#thumbnailError[idx];
            if (!wasError) {
                Tooltip.removeTooltip(img);
                Tooltip.setTooltip(img, `Failed to load thumbnail. This is usually due to the file reporting ` +
                    `a duration that's longer than the actual length of the video stream.`);
            }
        } else {
            this.#thumbnailError[img.classList.contains('thumbStart') ? 0 : 1] = true;
            img.alt = 'Failed to load thumbnail';
            img.classList.remove('loading');
        }
    }

    /** Callback when we successfully loaded a preview thumbnail, setting its initial expanded/collapsed state.
     * @param {HTMLImageElement} img */
    #onThumbnailPreviewLoad(img) {
        const idx = img.classList.contains('thumbnailStart') ? 0 : 1;
        const wasError = this.#thumbnailError[idx];
        this.#thumbnailError[idx] = false;
        if (wasError) {
            Tooltip.removeTooltip(img);
            if (!ClientSettings.autoLoadThumbnails()) {
                Tooltip.setTooltip(img, 'Press Enter after entering a timestamp to update the thumbnail.');
            }
        }

        img.classList.remove('loading');
        img.classList.add('loaded');
        const realHeight = img.naturalHeight * (img.width / img.naturalWidth);
        this.#cachedHeight = realHeight;
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
        this.#thumbnailsCollapsed = !this.#thumbnailsCollapsed;
        const hidden = button.innerText.startsWith('Show');
        $('.inputThumb', this.markerRow.row()).forEach(thumb => {
            thumb.classList.toggle('hiddenThumb');
            thumb.style.height = this.#thumbnailsCollapsed ? '0' : thumb.getAttribute('realheight') + 'px';
            thumb.classList.toggle('visibleThumb');
            $$('span', button).innerText = hidden ? 'Hide' : 'Show';
            if (!this.#thumbnailsCollapsed) {
                this.#refreshImage(thumb.parentNode);
            }
        });
    }
}

export { MarkerEdit, ThumbnailMarkerEdit };
