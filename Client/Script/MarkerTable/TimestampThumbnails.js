import { $, $$, $img } from '../HtmlHelpers.js';
import { ctrlOrMeta, msToHms } from '../Common.js';
import { slideDown, slideUp } from '../AnimationHelpers.js';
import { Attributes } from '../DataAttributes.js';
import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import Icons from '../Icons.js';
import { isSmallScreen } from '../WindowResizeEventHandler.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';

/** @typedef {!import('./MarkerTableRow').MarkerRow} MarkerRow */

const Log = ContextualLog.Create('TimestampThumbs');

/**
 * @typedef {{
 *  start : { promise?: Promise<void>, resolve?: (value: any) => void },
*   end : { promise?: Promise<void>, resolve?: (value: any) => void },
 * }} FirstLoadPromises
 * */

/**
 * Small struct that holds the actual <img> elements for the timestamp thumbnails.
 */
class ThumbnailPair {
    /** @type {HTMLImageElement} */
    start = null;
    /** @type {HTMLImageElement} */
    end = null;
    /** @type {FirstLoadPromises} */
    #promises = {
        start : {
            promise : null,
            resolve : null,
        },
        end : {
            promise : null,
            resolve : null,
        }
    };

    #isError = {
        start : false,
        end : false,
    };

    /** Retrieve both start and end thumbnails in an array. */
    both() { return [this.start, this.end]; }
    /** Retrieve the start or end thumbnail. */
    get(isEnd) { return isEnd ? this.end : this.start; }
    /** Set the start or end thumbnail. */
    set(thumbnail, isEnd) { this[isEnd ? 'end' : 'start'] = thumbnail; }
    /** Set whether the given thumbnail is an error thumbnail. */
    setError(isEnd, isError) { this.#isError[isEnd ? 'end' : 'start'] = isError; }
    /** Return whether the given thumbnail is an error thumbnail. */
    isError(isEnd) { return this.#isError[isEnd ? 'end' : 'start']; }

    /** Mark the start/end thumbnail as loading. Only relevant for the first thumbnail load. */
    setLoading(isEnd) {
        const p = this.#promises[isEnd ? 'end' : 'start'];
        p.promise = new Promise(r => { p.resolve = r; });
    }

    /** Mark the start/end thumbnail as loaded. Only relevant for the first thumbnail load. */
    setLoaded(isEnd) {
        const p = this.#promises[isEnd ? 'end' : 'start'];
        p.resolve?.();
        this[isEnd ? 'end' : 'start'].classList.remove('placeholder');
    }

    /** Returns a promise that resolves when both the first start and end thumbnails have loaded. */
    ensureLoaded() {
        const promises = [this.#promises.start.promise, this.#promises.end.promise].filter(p => !!p);
        return Promise.all(promises);
    }
}

/**
 * TimestampThumbnails holds the logic for a collapsable set of two thumbnails that correspond to
 * the start and end timestamps of a marker. */
export class TimestampThumbnails {

    /** Global flag indicating that we're in the middle of a bulk toggle. */
    static #InBulkToggle = false;

    /**
     * Cached at the start of a bulk operation so we don't have to calculate the document's
     * current bounds dozens or hundreds of times. */
    static #CachedDocumentBounds = {};

    /**
     * Global resize listener that looks for thumbnails that need to be resized outside of
     * the standard addWindowResizedListener flow, as we want to resize some thumbnails
     * on every resize, not just when we switch between small and large screen modes. */
    static OnWindowResized() {
        // Reaches into internals, but I'm too lazy right now
        // to get this properly componentized.

        const thumbs = $('.staticThumb:not(.placeholder)');

        // TODO: this can mess up width calculations if another marker in this table is being edited.
        // Should edit thumbnails also shrink to fit the exiting viewport? My gut says yes, potentially
        // with a "expanded" mode that opens an overlay with vertical start/end times.
        const thumb = thumbs[0];
        if (!thumb) {
            return;
        }

        let table = thumb;
        while (table && !(table instanceof HTMLTableElement)) {
            table = table.parentElement;
        }

        if (!table) {
            // How?
            return;
        }

        Log.tmi(`Window resized: adjusting ${thumbs.length} thumbnail widths.`);
        for (const img of $('.staticThumb:not(.placeholder)', table)) {
            img.width = 0;
        }

        const newWidth = TimestampThumbnails.#getStaticWidth(thumb);
        for (const img of thumbs) {
            img.width = newWidth;
            img.height = newWidth * (img.naturalHeight / img.naturalWidth);
        }
    }

    /**
     * Return the width we should set the given static thumbnail
     * @param {HTMLImageElement} thumb */
    static #getStaticWidth(thumb) {
        return Math.min(isSmallScreen() ? 180 : 240, thumb.parentElement.getBoundingClientRect().width);
    }

    /**
     * The table row these thumbnails belong to.
     * @type {MarkerRow} */
    #markerRow;

    /**
     * The thumbnails themselves.
     * @type {ThumbnailPair} */
    #thumbnails;

    /**
     * The show/hide toggle button.
     * @type {HTMLElement} */
    #toggleButton;

    /**
     * The callback invoked to retrieve the timestamp for the thumbnail.
     * @type {(isEnd: boolean) => number} */
    #newTimestamp;


    /** Whether these thumbnails are associated with a marker edit. */
    #forEdit = false;

    /** Whether the thumbnails are currently visible. */
    #showing = false;

    /** The height to use for error thumbnails. */
    #cachedHeight = -1;

    /**
     * @param {MarkerRow} row
     * @param {boolean} forEdit
     * @param {((isEnd: boolean) => number)?} newTimestampFn */
    constructor(row, forEdit, newTimestampFn) {
        this.#markerRow = row;
        if (forEdit) {
            this.#showing = !ClientSettings.collapseThumbnails();
            this.#forEdit = true;
        }

        if (newTimestampFn) {
            this.#newTimestamp = newTimestampFn;
        } else {
            this.#newTimestamp = isEnd => isEnd ? this.#markerRow.endTime() : this.#markerRow.startTime();
        }

        this.#thumbnails = new ThumbnailPair();
    }

    /**
     * Invoked when the user exits edit mode. Removes the thumbnail toggle button,
     * because the non-thumbnail edit session doesn't expect extra options during
     * cleanup (which should probably be changed). */
    resetAfterEdit() {
        this.#toggleButton?.parentNode.removeChild(this.#toggleButton);
    }

    /** Return whether thumbnails are currently visible. */
    visible() { return this.#showing; }

    /** Retrieve a toggle icon that will show/hide thumbnails when clicked.
     * @param {boolean} dynamic Whether to create a dynamic button or icon-only button. */
    getToggleIcon(dynamic) {
        const startText = this.#showing ? 'Hide' : 'Show';
        const attributes = {
            class : 'thumbnailShowHide',
            tooltip : startText + ' thumbnails',
            [Attributes.TableNav] : 'thumb-collapse',
        };

        if (!this.#forEdit) { // TODO?
            attributes.events = {
                longpress : function () {
                    Log.verbose(`Triggering preview toggle longpress`);
                    const evt = new MouseEvent('click', {
                        ctrlKey : true,
                    });

                    this.toggleThumbnails(evt);
                }.bind(this)
            };
        }

        const commonParams = [ThemeColors.Primary, this.toggleThumbnails.bind(this), attributes];

        this.#toggleButton = dynamic ?
            ButtonCreator.dynamicButton(startText, Icons.Img, ...commonParams) :
            ButtonCreator.iconButton(Icons.Img, startText, ...commonParams);

        return this.#toggleButton;
    }

    /**
     * Build and return the thumbnail image.
     * @param {boolean} isEnd Whether we're creating a start or end timestamp thumbnail.
     * @param {number} widthOverride If non-zero, overrides the default thumbnail width with this value. */
    buildThumbnail(isEnd, widthOverride=0) {
        this.#thumbnails.setLoading(isEnd);

        const width = widthOverride || (isSmallScreen() ? 180 : 240);
        const timestamp = isEnd ? this.#markerRow.endTime() : this.#markerRow.startTime();
        const src = `t/${this.#markerRow.baseItemRow().mediaItem().metadataId}/${timestamp}`;
        const thumbnail = $img(
            {
                src : src,
                class : `inputThumb loading thumb${isEnd ? 'End' : 'Start'}${widthOverride ? ' staticThumb' : ''}`,
                alt : `Timestamp Thumbnail [${msToHms(timestamp)}]`,
                width : width,
                height : 0,
            },
            {
                error : this.#onThumbnailPreviewLoadFailed.bind(this),
                load : this.#onThumbnailPreviewLoad.bind(this),
            }
        );

        // Only adjustable thumbnails need this tooltip.
        if (this.#forEdit && !ClientSettings.autoLoadThumbnails()) {
            Tooltip.setTooltip(thumbnail, 'Press Enter after entering a timestamp to update the thumbnail.');
        }

        this.#thumbnails.set(thumbnail, isEnd);

        return thumbnail;
    }

    /**
     * Adjusts the width edit session thumbnails depending on whether we're in small screen mode. */
    onWindowResize() {
        for (const thumb of this.#thumbnails.both()) {
            thumb.width = isSmallScreen() ? 180 : 240;
            const displayHeight = thumb.naturalHeight * (thumb.width / thumb.naturalWidth);
            if (this.#showing) {
                thumb.height = displayHeight;
            }
        }
    }

    /**
     * Callback when the 'Show/Hide Thumbs' button is clicked. Adjusts the button text
     * and begin the height transitions for the thumbnails themselves.
     * @param {MouseEvent} event The (unused) MouseEvent
     * @param {HTMLElement} _button The (unused) toggle button
     * @param {number} duration */
    async toggleThumbnails(event, _button, duration=250) {
        if (ctrlOrMeta(event) && !this.#forEdit) { // For now, ignore edit-based clicks
            return this.#toggleAll(event);
        }

        if (this.#forEdit && TimestampThumbnails.#InBulkToggle) {
            // Exclude edit thumbnails from bulk toggle (for now?)
            return;
        }

        Log.tmi(`${this.#showing ? 'Hiding' : 'Showing'} timestamp thumbnails for markerId ${this.#markerRow.markerId()}`);
        this.#showing = !this.#showing;
        const shouldShow = this.#showing;
        const needsToggle = await this.#ensure();
        /** @type {Promise<void>[]} */
        const promises = [];
        const shouldAnimate = !TimestampThumbnails.#InBulkToggle || this.#isVisible();
        for (const thumb of this.#thumbnails.both()) {
            if (needsToggle) {
                if (shouldAnimate) {
                    promises.push(new Promise(r => {
                        if (shouldShow) {
                            const to = thumb.width * (thumb.naturalHeight / thumb.naturalWidth);
                            slideDown(thumb, to + 'px', { duration : duration, noReset : true }, r);
                        } else {
                            slideUp(thumb, { duration : duration, noReset : true }, r);
                        }
                    }));
                } else {
                    thumb.height = shouldShow ? thumb.width * (thumb.naturalHeight / thumb.naturalWidth) : 0;
                }
            }

            const text = shouldShow ? 'Hide' : 'Show';
            ButtonCreator.setText(this.#toggleButton, text);
            Tooltip.setText(this.#toggleButton, text + ' thumbnails');

            if (shouldShow && needsToggle) {
                this.refreshImage(thumb === this.#thumbnails.end);
            }
        }

        await Promise.all(promises);
    }

    /**
     * Toggle all static thumbnails in the table (Ctrl+Click) or result view (Ctrl+Shift+Click)
     * @param {MouseEvent} event */
    async #toggleAll(event) {
        TimestampThumbnails.#InBulkToggle = true;
        TimestampThumbnails.#CachedDocumentBounds = document.body.getBoundingClientRect();
        Log.verbose(`${this.#showing ? 'Hiding' : 'Showing'} all timestamp thumbnails${event.shiftKey ? '' : ' in this table'}`);

        // TODO: don't reach so far up/down the chain?
        // We could also improve perf a negligible amount by not aligning ourselves
        // to the top of the list first.
        let currentBaseItem = this.#markerRow.baseItemRow();
        if (event.shiftKey) {
            while (currentBaseItem.getPreviousBaseItem()) {
                currentBaseItem = currentBaseItem.getPreviousBaseItem();
            }
        }

        const show = !this.#showing;
        const promises = [];
        while (currentBaseItem) {
            const table = currentBaseItem.baseItem().markerTable();
            if (table.isVisible()) {
                promises.push(...table.showHidePreviewThumbnails(show));
            }

            if (!event.shiftKey) {
                break;
            }

            currentBaseItem = currentBaseItem.getNextBaseItem();
        }

        await Promise.all(promises);
        TimestampThumbnails.#CachedDocumentBounds = {};
        TimestampThumbnails.#InBulkToggle = false;
    }

    /**
     * Return whether the toggle button for this row is in the client viewport. */
    #isVisible() {
        const rect = this.#toggleButton?.getBoundingClientRect();
        return rect && rect.top < TimestampThumbnails.#CachedDocumentBounds.height && rect.y + rect.height > 0;
    }

    /**
     * Updates the start or end thumbnail to a new timestamp.
     *
     * Should only be invoked by edit sessions.
     * @param {boolean} isEnd */
    refreshImage(isEnd) {
        const timestamp = this.#newTimestamp(isEnd);
        if (isNaN(timestamp)) {
            return; // Don't ask for a thumbnail if the input isn't valid.
        }

        const thumb = this.#thumbnails.get(isEnd);
        if (!thumb) {
            // We shouldn't get here
            Log.warn('Unable to retrieve marker thumbnail image, no img element found!');
            return;
        }

        const url = `t/${this.#markerRow.baseItemRow().mediaItem().metadataId}/${timestamp}`;
        thumb.classList.remove('hidden');
        if (!thumb.src.endsWith(url)) {
            thumb.classList.remove('loaded');
            thumb.classList.add('loading');
            thumb.src = url;
        }
    }

    /**
     * Called after an edit session exists, forcing static thumbnails to
     * think they're in a collapsed state. */
    reset() {
        this.#showing = false;
        const text = 'Show';
        ButtonCreator.setText(this.#toggleButton, text);
        Tooltip.setText(this.#toggleButton, text + ' thumbnails');
    }

    /** Callback when we failed to load a preview thumbnail, marking it as in an error state.
     * @param {Event} e */
    #onThumbnailPreviewLoadFailed(e) {
        const thumb = e.target;
        const isEnd = thumb.classList.contains('thumbEnd');
        const wasError = this.#thumbnails.isError(isEnd);
        this.#thumbnails.setError(isEnd, true);
        if (thumb.src.endsWith('svg')) {
            // We failed to load an error thumbnail. Stop trying.
            thumb.alt = 'Failed to load thumbnail';
            thumb.classList.remove('loading');
        } else {
            if (!wasError) {
                Tooltip.removeTooltip(thumb);
                Tooltip.setTooltip(thumb, `Failed to load thumbnail. This is usually due to the file reporting ` +
                    `a duration that's longer than the actual length of the video stream.`);
            }

            // Make sure this happens after setting #thumbnailError to avoid races.
            let svgHeight = this.#cachedHeight;
            if (this.#cachedHeight === -1) {
                svgHeight = 135; // Until we get a real thumbnail to test, use 240x135 (16:9) as the default size.
            }

            thumb.src = `t/-1/${svgHeight}.svg`;
        }
    }

    /** Callback when we successfully loaded a preview thumbnail, setting its initial expanded/collapsed state.
     * @param {Event} e */
    #onThumbnailPreviewLoad(e) {
        /** @type {HTMLImageElement} */
        const thumb = e.target;
        const isEnd = thumb.classList.contains('thumbEnd');
        const wasError = this.#thumbnails.isError(isEnd);
        const isErrorThumb = thumb.src.endsWith('svg');
        this.#thumbnails.setError(isEnd, isErrorThumb);
        if (wasError) {
            Tooltip.removeTooltip(thumb);
            if (!ClientSettings.autoLoadThumbnails()) {
                Tooltip.setTooltip(thumb, 'Press Enter after entering a timestamp to update the thumbnail.');
            }

            if (!isErrorThumb) {
                thumb.removeAttribute('height');
            }
        }

        thumb.classList.remove('loading');
        thumb.classList.add('loaded');

        // If the original is e.g. 300 x 200, the error thumb should be scaled down to 240 x 160
        // NOTE: Keep in sync with badThumb.svg width, as this calculation is based on
        // its hardcoded width of 240px.
        const unsetCachedHeight = this.#cachedHeight === -1;

        // Don't use an error SVG to set the cached height.
        if (!isErrorThumb) {
            this.#cachedHeight = thumb.naturalHeight * (240 / thumb.naturalWidth);
            if (unsetCachedHeight) {
                if (this.#thumbnails.start.src.endsWith('svg')) {
                    // Update to the correct height.
                    this.#thumbnails.start.src = `t/-1/${this.#cachedHeight}`;
                }

                if (this.#thumbnails.end.src.endsWith('svg')) {
                    // Update to the correct height.
                    this.#thumbnails.end.src = `t/-1/${this.#cachedHeight}`;
                }
            }
        }

        const displayHeight = thumb.naturalHeight * (thumb.width / thumb.naturalWidth);
        this.#thumbnails.setLoaded(isEnd);
        if (this.#showing && parseInt(thumb.height) === 0) {
            slideDown(thumb, `${displayHeight}px`, { duration : 250, noReset : true }, () => thumb.style.removeProperty('height'));
        }
    }

    /**
     * Make sure we've successfully loaded start/end thumbnails at least once,
     * as height calculations/animations won't work as expected otherwise.
     * @returns {Promise<boolean>} Whether we waited for thumbnails to load. */
    async #ensure() {
        if (this.#thumbnails.start && this.#thumbnails.start.isConnected
            && this.#thumbnails.end && this.#thumbnails.end.isConnected) {
            return true;
        }

        Log.assert(this.#toggleButton, 'We should only be here if we have a toggle button');
        Log.assert(this.#showing,
            `If initial thumbnails aren't loaded, we should only be here if we want to show them for the first time.`);

        // The initial load can take some time for very large files or slow storage. Let the user know
        // something is happening by changing the image icon to the loading icon temporarily.
        ButtonCreator.setIcon(this.#toggleButton, Icons.Loading);
        const start = $$('.staticThumbStart', this.#markerRow.row());
        const end = $$('.staticThumbEnd', this.#markerRow.row());
        const widthOverride = TimestampThumbnails.#getStaticWidth(start);
        start.replaceWith(this.buildThumbnail(false, widthOverride));
        end.replaceWith(this.buildThumbnail(true, widthOverride));
        await this.#thumbnails.ensureLoaded();
        ButtonCreator.setIcon(this.#toggleButton, Icons.Img);
        ButtonCreator.setText(this.#toggleButton, `Show Thumbnails`);
        return false;
    }
}
