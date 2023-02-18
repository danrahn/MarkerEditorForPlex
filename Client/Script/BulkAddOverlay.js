import { BulkMarkerResolveType, MarkerData, MarkerType } from '../../Shared/PlexTypes.js';

import { BulkActionCommon, BulkActionRow, BulkActionTable, BulkActionType } from './BulkActionCommon.js';
import ButtonCreator from './ButtonCreator.js';
import { $, appendChildren, buildNode, errorResponseOverlay, msToHms, pad0, ServerCommand, timeToMs } from './Common.js';
import Overlay from './inc/Overlay.js';
import PlexClientState from './PlexClientState.js';
import TableElements from './TableElements.js';
import Tooltip from './inc/Tooltip.js';

/** @typedef {!import('../../Shared/PlexTypes.js').MarkerData} MarkerData */
/** @typedef {!import('../../Shared/PlexTypes.js').SeasonData} SeasonData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedBulkAddResult} SerializedBulkAddResult */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedBulkAddResultEntry} SerializedBulkAddResultEntry */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes.js').ShowData} ShowData */

/**
 * UI for bulk adding markers to a given show/season
 */
class BulkAddOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

    /** @type {BulkActionTable} */
    #table;
    /**
     * @type {SerializedBulkAddResult} */
    #serverResponse = {};

    /** @type {number} */
    #inputTimer = 0;

    /** @type {number} Cached ms of the current start input to prevent repeated calculations. */
    #cachedStart = NaN;
    /** @type {number} Cached ms of the current end input to prevent repeated calculations. */
    #cachedEnd = NaN;
    /** @type {number} The current resolution type. */
    #cachedApplyType = BulkMarkerResolveType.Fail;

    /**
     * List of descriptions for the various bulk marker resolution actions. */
    static #descriptions = [
        '',
        'If any added marker conflicts with existing markers, fail the entire operation',
        'If any added markers conflict with existing markers, merge them with into the existing marker(s)',
        'If any added marker conflicts with existing markers, don\'t add the marker to the episode'
    ];

    /**
     * Construct a new bulk add overlay.
     * @param {ShowData|SeasonData} mediaItem */
    constructor(mediaItem) {
        this.#mediaItem = mediaItem;
    }

    /** Return the customization table for this operation. */
    table() { return this.#table; }

    /**
     * Launch the bulk add overlay. */
    show() {
        let container = buildNode('div', { id : 'bulkActionContainer' });
        let title = buildNode('h1', {}, 'Bulk Add Markers');
        appendChildren(container,
            title,
            buildNode('hr'),
            appendChildren(buildNode('div', { id : 'timeZone' }),
                buildNode('label', { for : 'addStart' }, 'Start: '),
                buildNode('input', {
                    type : 'text',
                    placeholder : 'ms or ms:ss[.000]',
                    name : 'addStart',
                    id : 'addStart' },
                    0,
                    { keyup : this.#onBulkAddInputChange.bind(this) }
                ),
                buildNode('label', { for : 'addEnd' }, 'End: '),
                buildNode('input', {
                    type : 'text',
                    placeholder : 'ms or ms:ss[.000]',
                    name : 'addEnd',
                    id : 'addEnd' },
                    0,
                    { keyup : this.#onBulkAddInputChange.bind(this) }
                )),
            appendChildren(buildNode('div', { id : 'bulkAddMarkerType' }),
                buildNode('label', { for : 'markerTypeSelect' }, 'Marker Type: '),
                appendChildren(
                    buildNode('select', { id : 'markerTypeSelect' }),
                    buildNode('option', { value : 'intro', selected : 'selected' }, 'Intro'),
                    buildNode('option', { value : 'credits' }, 'Credits'))
            ),
            appendChildren(buildNode('div', { id : 'bulkAddApplyType' }),
                buildNode('label', { for : 'applyTypeSelect' }, 'Apply Action: '),
                appendChildren(
                    buildNode('select', { id : 'applyTypeSelect' }, 0, { change : this.#onApplyTypeChange.bind(this) }),
                    buildNode('option', { value : 1, selected : 'selected' }, 'Fail'),
                    buildNode('option', { value : 2 }, 'Merge'),
                    buildNode('option', { value : 3 }, 'Ignore')),
                buildNode('div', { id : 'applyTypeDescription' }, BulkAddOverlay.#descriptions[BulkMarkerResolveType.Fail])
            ),
            buildNode('hr'),
            appendChildren(buildNode('div', { id : 'bulkActionButtons' }),
                ButtonCreator.textButton('Apply', this.#apply.bind(this), { id  : 'bulkAddApply' }),
                ButtonCreator.textButton('Customize', this.#check.bind(this)),
                ButtonCreator.textButton('Cancel', Overlay.dismiss, { id : 'bulkAddCancel' })
            )
        );

        Overlay.build({ dismissible : true, closeButton : true, forceFullscreen : true, setup : { fn : () => $('#addStart').focus() } }, container);
    }

    /**
     * Processes time input
     * @param {MouseEvent} e */
    #onBulkAddInputChange(e) {
        const start = $('#addStart');
        const end = $('#addEnd');
        this.#cachedStart = timeToMs(start.value);
        this.#cachedEnd = timeToMs(end.value);
        isNaN(this.#cachedStart) ? start.classList.add('badInput') : start.classList.remove('badInput');
        isNaN(this.#cachedEnd) ? end.classList.add('badInput') : end.classList.remove('badInput');
        clearTimeout(this.#inputTimer);
        if (e.key == 'Enter') {
            this.#updateTableStats();
        }

        this.#inputTimer = setTimeout(this.#updateTableStats.bind(this), 250);
    }

    /**
     * Processes bulk marker resolution type change. */
    #onApplyTypeChange() {
        const sel = $('#applyTypeSelect');
        if (!sel) { return; }
        const val = parseInt(sel.value);
        this.#cachedApplyType = val;
        $('#applyTypeDescription').innerText = BulkAddOverlay.#descriptions[val];
        this.#updateTableStats();
    }

    /**
     * Attempts to apply the current marker to the selected episodes. */
    async #apply() {
        const startTime = this.startTime();
        const endTime = this.endTime();
        const resolveType = this.resolveType();
        const markerType = this.markerType();
        if (isNaN(startTime) || isNaN(endTime)) {
            return BulkActionCommon.flashButton('bulkAddApply', 'red');
        }

        try {
            const result = await ServerCommand.bulkAdd(markerType, this.#mediaItem.metadataId, startTime, endTime, resolveType, false /*final*/, this.#table?.getIgnored());
            if (!result.applied) {
                BulkActionCommon.flashButton('bulkAddApply', 'red', 250);
                return;
            }

            const episodes = Object.values(result.episodeMap);
            let addCount = 0;
            let editCount = 0;
            let deleteCount = 0;
            /** @type {BulkMarkerResult} */
            const adds = {};
            /** @type {BulkMarkerResult} */
            const edits = {};
            /** @type {BulkMarkerResult} */
            const deletes = {};
            for (const episodeInfo of episodes) {
                if (episodeInfo.deletedMarkers) {
                    for (const deleted of episodeInfo.deletedMarkers) {
                        const deleteShow = deletes[deleted.showId] ??= {};
                        (deleteShow[deleted.seasonId] ??= []).push(new MarkerData().setFromJson(deleted));
                        ++deleteCount;
                    }
                }

                const marker = episodeInfo.changedMarker;
                if (!marker) { continue; }
                const mapToUse = episodeInfo.isAdd ? adds : edits;
                mapToUse[marker.showId] ??= {};
                (mapToUse[marker.showId][marker.seasonId] ??= []).push(new MarkerData().setFromJson(marker));
                episodeInfo.isAdd ? ++addCount : ++editCount;
            }

            BulkActionCommon.flashButton('bulkAddApply', 'green', 250).then(() => {
                Overlay.show(`<h2>Bulk Add Succeeded</h2><hr>` +
                    `Markers Added: ${addCount}<br>` +
                    `Markers Edited: ${editCount}<br>` +
                    `Markers Deleted: ${deleteCount}<br>` +
                    `Episodes Ignored: ${result.ignoredEpisodes.length}`);
            });


            // Need to do this more efficiently. We can duplicate lots of server calls by separating these three.
            await PlexClientState.GetState().notifyBulkActionChange(deletes, BulkActionType.Delete);
            await PlexClientState.GetState().notifyBulkActionChange(adds, BulkActionType.Add);
            await PlexClientState.GetState().notifyBulkActionChange(edits, BulkActionType.Shift);

        } catch(err) {
            await BulkActionCommon.flashButton('bulkAddApply', 'red', 250);
            errorResponseOverlay('Unable to bulk add, please try again later', err, this.show.bind(this));
        }
    }

    /**
     * Request current marker statistics for the given episode group to check whether
     * a bulk add will conflict with anything. */
    async #check() {
        try {
            this.#serverResponse = await ServerCommand.checkBulkAdd(this.#mediaItem.metadataId);
            this.#showCustomizeTable();
        } catch (err) {
            errorResponseOverlay('Unable to check bulk add, please try again later', err, this.show.bind(this));
        }
    }

    /**
     * Displays a table of all episodes in the group, with color coded columns
     * to let the user know when a marker add will fail/be merged with existing markers. */
    #showCustomizeTable() {
        this.#table?.remove();
        this.#table = new BulkActionTable();

        this.#table.buildTableHead('Episode', 'Title', TableElements.shortTimeColumn('Start'), TableElements.shortTimeColumn('End'));

        const episodeData = Object.values(this.#serverResponse.episodeMap).sort((a, b) => {
            if (a.episodeData.seasonIndex != b.episodeData.seasonIndex) {
                return a.episodeData.seasonIndex - b.episodeData.seasonIndex;
            }

            return a.episodeData.index - b.episodeData.index;
        });

        for (const episodeInfo of episodeData) {
            this.#table.addRow(new BulkAddRow(this, episodeInfo));
        }

        $('#bulkActionContainer').appendChild(this.#table.html());
        this.#updateTableStats();
    }

    startTime() { return this.#cachedStart; }
    endTime() { return this.#cachedEnd; }
    resolveType() { return this.#cachedApplyType; }
    markerType() { return $('#markerTypeSelect').value; } // TODO: store main container and scope to that.

    /** Update all items in the customization table, if present. */
    #updateTableStats() {
        this.#table?.rows().forEach(row => row.update());
    }
}

/**
 * Represents a single row in the bulk add customization table.
 */
class BulkAddRow extends BulkActionRow {
    /** @type {BulkAddOverlay} */
    #parent;
    /** @type {SerializedEpisodeData} */
    #episodeInfo;
    /** @type {HTMLTableCellElement} */
    #startTd;
    /** @type {HTMLTableCellElement} */
    #endTd;
    /** @type {SerializedMarkerData[]} */
    #existingMarkers;

    /**
     * @param {BulkAddOverlay} parent
     * @param {SerializedBulkAddResultEntry} episodeInfo */
    constructor(parent, episodeInfo) {
        super(parent.table(), episodeInfo.episodeData.metadataId);
        this.#parent = parent;
        this.#episodeInfo = episodeInfo.episodeData;
        this.#existingMarkers = episodeInfo.existingMarkers;
    }

    /** Create and return the table row.
     * @returns {HTMLTableRowElement} */
    build() {
        const startTime = this.#parent.startTime();
        const endTime = this.#parent.endTime();
        this.buildRow(
            this.createCheckbox(true, null /*mid*/, this.#episodeInfo.metadataId),
            `S${pad0(this.#episodeInfo.seasonIndex, 2)}E${pad0(this.#episodeInfo.index, 2)}`,
            this.#episodeInfo.title,
            isNaN(startTime) ? '-' : TableElements.timeData(endTime),
            isNaN(endTime) ? '-' : TableElements.timeData(endTime));
        this.#startTd = this.row.children[3];
        this.#endTd = this.row.children[4];
        return this.row;
    }

    /**
     * Update the text/colors of this row. */
    update() {
        if (!this.enabled) {
            this.row.classList.add('bulkActionInactive');
            this.#clear(true /*clearText*/);
            return;
        }
        
        this.row.classList.remove('bulkActionInactive');

        const startTimeBase = this.#parent.startTime();
        const endTimeBase = this.#parent.endTime();
        const resolveType = this.#parent.resolveType();
        const warnClass = resolveType == BulkMarkerResolveType.Merge ? 'bulkActionSemi' : 'bulkActionOff';
        this.#clear();
        let start = startTimeBase;
        let end = endTimeBase;
        let semiWarn = false;
        let isWarn = false;
        let tooltip = '';
        if (isNaN(startTimeBase) || isNaN(endTimeBase) || startTimeBase >= endTimeBase) {
            this.#startTd.innerText = '--:--:--.---';
            this.#endTd.innerText = '--:--:--.---';
            this.#setClassBoth(warnClass);
            return;
        }

        for (const existingMarker of this.#existingMarkers) {
            // [Existing...{New++]---} or [Existing...{New++}...]
            if (start >= existingMarker.start && start <= existingMarker.end) {
                isWarn = true;
                semiWarn = false;
                this.#startTd.classList.add(warnClass);
                if (end < existingMarker.end) {
                    this.#setSingleClass(this.#endTd, warnClass);
                }

                tooltip += `<br>Overlaps with existing marker [${msToHms(existingMarker.start)}-${msToHms(existingMarker.end)}]`;
                
                if (resolveType == BulkMarkerResolveType.Merge) {
                    start = existingMarker.start;
                    end = Math.max(end, existingMarker.end);
                }
            // {New---[Existing++}...] or [Existing...{New+++}...]
            } else if (end >= existingMarker.start && end <= existingMarker.end) {
                isWarn = true;
                semiWarn = false;
                this.#setSingleClass(this.#endTd, warnClass);
                tooltip += `<br>Overlaps with existing marker [${msToHms(existingMarker.start)}-${msToHms(existingMarker.end)}]`;
                if (resolveType == BulkMarkerResolveType.Merge) {
                    start = Math.min(start, existingMarker.start);
                }

                this.#startTd.classList.add(warnClass);
            // {New---[Existing+++]---}
            } else if (start <= existingMarker.start && end >= existingMarker.end) {
                isWarn = true;
                semiWarn = false;
                this.#setClassBoth(warnClass);
                tooltip += `<br>Overlaps with existing marker [${msToHms(existingMarker.start)}-${msToHms(existingMarker.end)}]`;

                this.#startTd.classList.add(warnClass);
            }
        }
        
        if (end > this.#episodeInfo.duration) {
            isWarn = true;
            if (!this.#endTd.classList.contains('bulkActionOff')) {
                semiWarn = true;
                this.#endTd.classList.add('bulkActionSemi');
            }

            tooltip += `<br>End exceeds episode duration of ${msToHms(this.#episodeInfo.duration)}.`;
            end = this.#episodeInfo.duration;
            start = Math.min(start, end);
        }

        if (start >= this.#episodeInfo.duration) {
            isWarn = true;
            // setSingle instead of setBoth to ensure it overwrites anything set above.
            this.#setSingleClass(this.#startTd, 'bulkActionOff');
            this.#setSingleClass(this.#endTd, 'bulkActionOff');
            tooltip = `<br>Marker is beyond the end of the episode.`;
        }

        if (tooltip.length != 0) {
            tooltip = tooltip.substring(4);
            Tooltip.setTooltip(this.#startTd, tooltip);
            Tooltip.setTooltip(this.#endTd, tooltip);
        } else {
            Tooltip.removeTooltip(this.#startTd);
            Tooltip.removeTooltip(this.#endTd);
        }

        if (!isWarn) {
            this.#setClassBoth('bulkActionOn');
        }

        if (resolveType == BulkMarkerResolveType.Ignore && isWarn && !semiWarn) {
            this.row.classList.add('bulkActionInactive');
        } else {
            this.row.classList.remove('bulkActionInactive');
        }

        this.#startTd.innerText = msToHms(start);
        this.#endTd.innerText = msToHms(end);
    }

    /**
     * Clears any custom classes of the start/end columns.
     * @param {boolean} clearText Whether to also reset the start/end time text. */
    #clear(clearText=false) {
        for (const td of [this.#startTd, this.#endTd]) {
            if (clearText) {
                td.innerText = '--:--:--.---';
            }

            td.classList.remove('bulkActionOn');
            td.classList.remove('bulkActionOff');
            td.classList.remove('bulkActionSemi');
        }
    }

    /**
     * Add the given class to both the start and end columns.
     * @param {string} className */
    #setClassBoth(className) {
        this.#startTd.classList.add(className);
        this.#endTd.classList.add(className);
    }

    /**
     * Add the given class to both the start and end columns, clearing out any other custom classes.
     * @param {HTMLTableCellElement} td
     * @param {string} className */
    #setSingleClass(td, className) {
        td.classList.remove('bulkActionOn');
        td.classList.remove('bulkActionOff');
        td.classList.remove('bulkActionSemi');
        td.classList.add(className);
    }
}

export default BulkAddOverlay;
