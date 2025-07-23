import { $, $append, $br, $div, $divHolder, $h, $hr, $label, $textSpan, toggleClass } from './HtmlHelpers.js';
import { msToHms, pad0, toggleVisibility } from './Common.js';

import { BulkActionCommon, BulkActionRow, BulkActionTable, BulkActionType } from './BulkActionCommon.js';
import { Attributes } from './DataAttributes.js';
import { BulkShiftStickySettings } from 'StickySettings';
import ButtonCreator from './ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { customCheckbox } from './CommonUI.js';
import Icons from './Icons.js';
import { MarkerEnum } from '/Shared/MarkerType.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { ServerCommands } from './Commands.js';
import { TableElements } from 'MarkerTable';
import { ThemeColors } from './ThemeColors.js';
import { TimeInput } from './TimeInput.js';
import Tooltip from './Tooltip.js';
import TooltipBuilder from './TooltipBuilder.js';

/** @typedef {!import('/Shared/PlexTypes').EpisodeData} EpisodeData */
/** @typedef {!import('/Shared/PlexTypes').SeasonData} SeasonData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('/Shared/PlexTypes').ShiftResult} ShiftResult */
/** @typedef {!import('/Shared/PlexTypes').ShowData} ShowData */

/**
 * @typedef {Object} IgnoreInfo
 * @property {number[]} ignored List of ignored marker ids
 * @property {boolean} tableVisible Whether the customization table is visible
 * @property {boolean} hasUnresolved Whether any markers are in an unresolved state
 * @property {boolean} hasCutoff Whether any markers are partially cut off by the shift
 * @property {boolean} hasError Whether any markers are completely cut off by the shift
 */

const Log = ContextualLog.Create('BulkShift');

/**
 * UI for bulk shifting markers for a given show/season by a set amount of time.
 */
class BulkShiftOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

    /** @type {TimeInput} */
    #startTime;

    /** @type {TimeInput} */
    #endTime;

    /** @type {HTMLSelectElement} */
    #appliesToDropdown;

    /**
     * Timer id to track shift user input.
     * @type {number} */
    #inputTimer;

    /** @type {BulkActionTable} */
    #table;

    /**
     * Keeps track of all markers associated with relevant episodes, regardless of whether
     * they're currently in the marker table.
     * @type {{[episodeId: number]: {inactive: SerializedMarkerData[], active: BulkShiftRow[] }}} */
    #episodeMap;

    /** @type {number} Cached start shift time, in milliseconds */
    #startShiftMs;

    /** @type {number} Cached end shift time, in milliseconds */
    #endShiftMs;

    #stickySettings = new BulkShiftStickySettings();

    /**
     * Construct a new shift overlay.
     * @param {ShowData|SeasonData} mediaItem */
    constructor(mediaItem) {
        this.#mediaItem = mediaItem;
    }

    /**
     * Launch the bulk shift overlay.
     * @param {HTMLElement} focusBack The element to set focus back to after the bulk overlay is dismissed. */
    show(focusBack) {
        const container = $div({ id : 'bulkShiftContainer', class : 'bulkActionContainer' });
        const title = $h(1, `Shift Markers for ${this.#mediaItem.title}`);
        this.#startTime = new TimeInput(
            { isEnd : false, plainOnly : true, customValidate : true },
            { keyup : this.#onTimeShiftChange.bind(this) },
            { placeholder : 'ms or mm:ss[.000]', name : 'shiftStartTime', id : 'shiftStartTime' });

        const endVisible = this.#stickySettings.separateShift();
        this.#endTime = new TimeInput(
            { isEnd : true, plainOnly : true, customValidate : true },
            { keyup : this.#onTimeShiftChange.bind(this) },
            { placeholder : 'ms or mm:ss[.000]', name : 'shiftEndTime', id : 'shiftEndTime',
              class : endVisible ? '' : 'hidden'  });

        const separateShiftCheckbox = customCheckbox(
            { id : 'separateShiftCheck', checked : endVisible },
            { change : this.#onSeparateShiftChange },
            {},
            { thisArg : this });
        $append(container,
            title,
            $hr(),
            $divHolder({ id : 'shiftZone' },
                $label('Time shift: ', 'shiftStartTime', { id : 'shiftStartTimeLabel' }),
                this.#startTime.input(),
                $label('End shift: ', 'shiftEndTime', { class : endVisible ? '' : 'hidden', id : 'shiftEndTimeLabel' }),
                this.#endTime.input()),
            $divHolder({ id : 'expandShrinkCheck' },
                $label('Shift start and end times separately:', 'separateShiftCheck'),
                separateShiftCheckbox),
            BulkActionCommon.markerSelectType('Shift Marker Type(s): ', this.#onApplyToChanged.bind(this), this.#stickySettings.applyTo()),
            $divHolder({ id : 'bulkActionButtons' },
                ButtonCreator.fullButton('Apply',
                    Icons.Confirm,
                    ThemeColors.Green,
                    this.#tryApply.bind(this),
                    {
                        id : 'shiftApply',
                        tooltip : 'Attempt to apply the given time shift. ' +
                                  'Brings up customization menu if any markers have multiple episodes.'
                    }),
                ButtonCreator.fullButton('Force Apply',
                    Icons.Confirm,
                    ThemeColors.Red,
                    this.#forceApply.bind(this),
                    {
                        id : 'shiftForceApplyMain',
                        class : 'shiftForceApply',
                        tooltip : 'Force apply the given time shift to all selected markers, even if some episodes have multiple markers.'
                    }),
                ButtonCreator.fullButton('Customize',
                    Icons.Table,
                    ThemeColors.Primary,
                    this.#check.bind(this),
                    { tooltip : 'Bring up the list of all applicable markers and selective choose which ones to shift.' }),
                ButtonCreator.fullButton('Cancel', Icons.Cancel, ThemeColors.Red, Overlay.dismiss)
            )
        );

        this.#appliesToDropdown = $('#markerTypeSelect', container);

        Overlay.build({
            dismissible : true,
            closeButton : true,
            forceFullscreen : true,
            focusBack : focusBack }, container);
    }

    /**
     * @param {KeyboardEvent} e */
    #onTimeShiftChange(e) {
        clearTimeout(this.#inputTimer);
        this.#checkShiftValue();
        if (!this.#table) {
            return;
        }

        if (e.key === 'Enter') {
            this.#adjustNewTimes();
            return;
        }

        this.#inputTimer = setTimeout(this.#adjustNewTimes.bind(this), 250);
    }

    /**
     * Update UI when the user enables/disables the 'separate start/end' checkbox
     * @param {HTMLInputElement} checkbox */
    #onSeparateShiftChange(checkbox) {
        this.#stickySettings.setSeparateShift(checkbox.checked);
        const separateShift = this.#stickySettings.separateShift();
        toggleVisibility($('#shiftEndTimeLabel'), separateShift);
        toggleVisibility(this.#endTime.input(), separateShift);
        if (separateShift) {
            $('#shiftStartTimeLabel').innerText = 'Start shift: ';
            if (!this.#endTime.input().value) { this.#endTime.input().value = this.#startTime.input().value; }

            this.#checkShiftValue();
        } else {
            $('#shiftStartTimeLabel').innerText = 'Time shift: ';
        }

        this.#adjustNewTimes();
    }

    /**
     * Adjust the styling of all rows in the customize table after
     * the shift changes. */
    #adjustNewTimes() {
        this.#table?.rows().forEach(row => row.update());
    }

    /**
     * Recreate the marker table if it's showing and the marker apply type was changed. */
    #onApplyToChanged() {
        this.#stickySettings.setApplyTo(this.#applyTo());
        if (this.#table) {
            this.#check();
        }
    }

    /**
 * Map of error messages
     * @type {{[messageType: string]: string}}
     * @readonly */
    #messages = {
        unresolved : 'Some episodes have multiple markers, please resolve below or Force Apply.',
        unresolvedAgain : 'Are you sure you want to shift markers with unresolved conflicts? Anything unchecked will not be shifted.',
        cutoff : 'The current shift will cut off some markers. Are you sure you want to continue?',
        error : $textSpan('The current shift completely moves at least one selected marker beyond the bounds of the episode.', $br(),
            'Do you want to ignore those and continue?'),
        unresolvedPlus : $textSpan(
            'Are you sure you want to shift markers with unresolved conflicts? Anything unchecked will not be shifted.', $br(),
            'Additionally, some markers are either cut off or completely beyond the bounds of an episode (or both).', $br(),
            'Cut off markers will be applied and invalid markers will be ignored.'),
        cutoffPlus : $textSpan(
            'The current shift will cut off some markers, and ignore markers beyond the bounds of the episode.', $br(),
            'Are you sure you want to continue?'),
        invalidOffset : `Couldn't parse time offset, make sure it's valid.`
    };

    /**
     * Display a message in the bulk shift overlay.
     * @param {string} messageType
     * @param {boolean} addForceButton True to also add an additional 'force apply' button below the message */
    #showMessage(messageType, addForceButton=false) {
        let message = this.#messages[messageType];
        if (!message) {
            Log.warn(messageType, 'Attempting to show an invalid error message');
            message = 'The shift could not be applied, please try again later.';
        }

        const attributes = { id : 'resolveShiftMessage', [Attributes.BulkShiftResolveMessage] : messageType };
        let node;
        if (addForceButton) {
            node = $divHolder(attributes,
                $h(4, message),
                ButtonCreator.fullButton(
                    'Force shift',
                    Icons.Confirm,
                    ThemeColors.Red,
                    this.#forceApply.bind(this),
                    { id : 'shiftForceApplySub', class : 'shiftForceApply' })
            );
        } else {
            node = $h(4, message, attributes);
        }

        const container = $('#bulkShiftContainer');
        const currentNode = $('#resolveShiftMessage');
        if (currentNode) {
            currentNode.replaceWith(node);
            return;
        }

        const customizeTable = this.#table?.html();
        if (customizeTable) {
            container.insertBefore(node, customizeTable);
        } else {
            container.appendChild(node);
        }
    }

    /**
     * Return the current message type, or false if there isn't one showing.
     * @returns {string|false} */
    #getMessageType() {
        const message = $('#resolveShiftMessage');
        if (!message) {
            return false;
        }

        return message.getAttribute(Attributes.BulkShiftResolveMessage);
    }

    /**
     * Attempts to apply the given shift to all markers under the given metadata id.
     * If any episode has multiple markers, shows the customization table. */
    async #tryApply() {
        const startShift = this.shiftStartValue();
        const endShift = this.shiftEndValue();
        if (isNaN(startShift) || isNaN(endShift) || (!startShift && !endShift)) {
            this.#checkShiftValue();
            this.#showMessage('invalidOffset');
            return BulkActionCommon.flashButton('shiftApply', ThemeColors.Red);
        }

        const ignoreInfo = this.#getIgnored();
        if (ignoreInfo.hasUnresolved) {
            return this.#warnAboutUnresolvedMarkers(ignoreInfo);
        }

        if (ignoreInfo.hasCutoff) {
            return this.#showMessage(ignoreInfo.hasError ? 'cutoff' : 'cutoffPlus', true);
        }

        if (ignoreInfo.hasError) {
            return this.#showMessage('error', true);
        }

        const shiftResult = await ServerCommands.shift(
            this.#mediaItem.metadataId,
            startShift, endShift,
            this.#applyTo(),
            false /*force*/,
            ignoreInfo.ignored);

        if (shiftResult.applied) {
            const markerMap = BulkActionCommon.markerMapFromList(shiftResult.allMarkers);
            PlexClientState.notifyBulkActionChange(markerMap, BulkActionType.Shift);
            await BulkActionCommon.flashButton('shiftApply', ThemeColors.Green);

            Overlay.dismiss();
            return;
        }

        Log.assert(
            shiftResult.conflict || shiftResult.overflow,
            `We should only have !applied && !conflict during check_shift, not shift. What happened?`);

        this.#showMessage(shiftResult.overflow ? 'error' : 'unresolved', shiftResult.overflow);
        this.#showCustomizeTable(shiftResult);
    }

    /**
     * Indicate to the user that unresolved markers are preventing the operating from completing.
     * @param {IgnoreInfo} ignoreInfo */
    async #warnAboutUnresolvedMarkers(ignoreInfo) {
        Log.assert(this.#table, `How do we know we have unresolved markers if the table isn't showing?`);

        // If we've already shown the warning
        const existingMessage = this.#getMessageType();
        if (existingMessage && existingMessage !== 'unresolvedPlus' && (ignoreInfo.hasCutoff || ignoreInfo.hasCutoff)) {
            return this.#showMessage('unresolvedPlus', true);
        }

        if (existingMessage && existingMessage !== 'unresolvedAgain') {
            return this.#showMessage('unresolvedAgain', true);
        }

        // If we are already showing the force shift subdialog, just flash the button
        if (existingMessage === 'unresolvedAgain' || existingMessage === 'unresolvedPlus') {
            return BulkActionCommon.flashButton('shiftApply', ThemeColors.Red);
        }

        this.#showMessage('unresolved');
        if (!this.#table) {
            await this.#check();
        }
    }

    /**
     * Force applies the given shift to all markers under the given metadata id. */
    async #forceApply() {
        const startShift = this.shiftStartValue();
        const endShift = this.shiftEndValue();
        if (isNaN(startShift) || isNaN(endShift) || (!startShift && !endShift)) {
            $('.shiftForceApply').forEach(f => BulkActionCommon.flashButton(f, ThemeColors.Red));
        }

        // Brute force through everything, applying to all checked items (or all items if the conflict table isn't showing)
        const ignoreInfo = this.#getIgnored();
        try {
            const shiftResult = await ServerCommands.shift(
                this.#mediaItem.metadataId,
                startShift,
                endShift,
                this.#applyTo(),
                true /*force*/,
                ignoreInfo.ignored);

            if (!shiftResult.applied) {
                Log.assert(shiftResult.overflow, `Force apply should only fail if overflow was found.`);
                this.#showCustomizeTable(shiftResult);
                this.#showMessage('error', true);
                return;
            }

            const markerMap = BulkActionCommon.markerMapFromList(shiftResult.allMarkers);
            PlexClientState.notifyBulkActionChange(markerMap, BulkActionType.Shift);
            $('.shiftForceApply').forEach(async f => {
                await BulkActionCommon.flashButton(f, ThemeColors.Green);
                Overlay.dismiss();
            });

        } catch (ex) {
            $('.shiftForceApply').forEach(f => BulkActionCommon.flashButton(f, ThemeColors.Red));
        }
    }

    /**
     * Retrieves marker information for the current metadata id and displays it in a table for the user. */
    async #check() {
        const shiftResult = await ServerCommands.checkShift(this.#mediaItem.metadataId, this.#applyTo());
        this.#showCustomizeTable(shiftResult);
    }

    /**
     * Retrieve the current ms time of the start shift input.
     * @returns {number} */
    shiftStartValue() { return this.#startShiftMs; }

    /**
     * Retrieve the current ms time of the end shift input, or the start time if we're not separating the shift.
     * @returns {number} */
    shiftEndValue() { return this.#stickySettings.separateShift() ? this.#endShiftMs : this.#startShiftMs; }

    table() { return this.#table; }

    /** Marks the time input red if the shift value is invalid. */
    #checkShiftValue() {
        this.#startShiftMs = this.#startTime.ms();
        toggleClass(this.#startTime.input(), 'badInput', isNaN(this.#startShiftMs));
        if (this.#stickySettings.separateShift()) {
            this.#endShiftMs = this.#endTime.ms();
            toggleClass(this.#endTime.input(), 'badInput', isNaN(this.#endShiftMs));
        }
    }

    /**
     * The marker type(s) to apply the shift to. */
    #applyTo() { return parseInt(this.#appliesToDropdown.value); }

    /**
     * Return an array of all markers that overlap with the given start and end timestamps,
     * excluding the marker that's associated with those timestamps.
     * @param {number} markerId The marker to check
     * @param {number} episodeId The episode associated with the marker
     * @param {number} start The new start time of the marker
     * @param {number} end The new end time of the marker
     * @returns {SerializedMarkerData[]} */
    overlappingMarkers(markerId, episodeId, start, end) {
        const data = this.#episodeMap[episodeId];
        if (!data) {
            Log.assert(false, 'We should only call overlappingMarkers if we have a customization table.');
            return [];
        }

        const overlapping = [];
        for (const marker of data.inactive) {
            if (marker.id === markerId) {
                continue; // This should be impossible for inactive markers.
            }

            if (start <= marker.start && end >= marker.start || start > marker.start && start <= marker.end) {
                overlapping.push(marker);
            }
        }

        for (const row of data.active) {
            if (row.markerId() === markerId) {
                continue;
            }

            const marker = row.marker();

            // If the linked row is also enabled, apply the shift to that marker before testing
            // It's only possible for a linked row to overlap if we have separate start and end
            // shifts, but check all rows regardless.
            if (row.enabled && !row.isError()) {
                const linkStart = marker.start + this.shiftStartValue();
                const linkEnd = marker.end + this.shiftEndValue();
                if (start <= linkStart && end >= linkStart || start > linkStart && start <= linkEnd) {
                    const markerCopy = { ...marker };
                    markerCopy.start = linkStart;
                    markerCopy.end = linkEnd;
                    overlapping.push(markerCopy);
                }
            } else if (start <= marker.start && end >= marker.start || start > marker.start && start <= marker.end) {
                overlapping.push(marker);
            }
        }

        return overlapping;
    }

    /**
     * Display a table of all markers applicable to this instance's metadata id.
     * @param {ShiftResult} shiftResult */
    #showCustomizeTable(shiftResult) {
        this.#table?.remove();
        this.#table = new BulkActionTable();
        this.#episodeMap = {};

        this.#table.buildTableHead(
            'Episode',
            TableElements.shortTimeColumn('Start Time'),
            TableElements.shortTimeColumn('End Time'),
            TableElements.shortTimeColumn('New Start'),
            TableElements.shortTimeColumn('New End')
        );

        const markerTypeSelected = this.#applyTo();

        const sortedMarkers = BulkActionCommon.sortMarkerList(shiftResult.allMarkers, shiftResult.episodeData);
        for (let i = 0; i < sortedMarkers.length; ++i) {
            const checkGroup = [];
            const eInfo = shiftResult.episodeData[sortedMarkers[i].parentId];
            const inactive = [];

            // If the marker type is selected, prep it for row addition
            if (MarkerEnum.typeMatch(sortedMarkers[i].markerType, markerTypeSelected))  {
                checkGroup.push(sortedMarkers[i]);
            } else {
                inactive.push(sortedMarkers[i]);
            }

            while (i < sortedMarkers.length - 1 && sortedMarkers[i+1].parentId === eInfo.metadataId) {
                if (MarkerEnum.typeMatch(sortedMarkers[++i].markerType, markerTypeSelected)) {
                    checkGroup.push(sortedMarkers[i]);
                } else {
                    inactive.push(sortedMarkers[i]);
                }
            }

            const multiple = checkGroup.length > 1;
            const active = [];
            for (const marker of checkGroup) {
                const row = new BulkShiftRow(this, marker, eInfo, multiple);
                this.#table.addRow(row, multiple);
                active.push(row);
            }

            this.#episodeMap[eInfo.metadataId] = {
                inactive,
                active,
            };
        }

        this.#table.rows().forEach(row => row.update());

        $('#bulkShiftContainer').appendChild(this.#table.html());
    }

    /**
     * Just an intellisense hack.
     * @returns {BulkShiftRow[]} */
    #tableRows() {
        return this.#table.rows();
    }

    /**
     * Return information about ignored markers in the shift table.
     * @returns {IgnoreInfo} */
    #getIgnored() {
        if (!this.#table) {
            return { ignored : [], tableVisible : false, hasUnresolved : false, hasCutoff : false, hasError : false };
        }

        const ignored = this.#table.getIgnored();
        let hasUnresolved = false;
        let hasCutoff = false;
        let hasError = false;
        const tableVisible = true;
        for (const row of this.#tableRows()) {
            hasUnresolved ||= row.isUnresolved();
            hasCutoff ||= row.isCutoff();
            if (row.isError()) {
                hasError = true;
                ignored.push(row.markerId());
            }
        }

        return {
            ignored,
            tableVisible,
            hasUnresolved,
            hasCutoff,
            hasError,
        };
    }
}

/**
 * Represents a single row in the bulk shift table.
 */
class BulkShiftRow extends BulkActionRow {
    /** @type {BulkShiftOverlay} */
    #parent;
    /** @type {SerializedMarkerData} */
    #marker;
    /** @type {SerializedEpisodeData} */
    #episode;
    /**
     * Whether there are other linked rows that are associated with the same episode
     * @type {boolean} */
    #linked = false;
    /**
     * Caches whether this row was enabled during the last update.
     * @type {boolean} */
    #enabledLastUpdate = null;
    /**
     * Tracks whether this row is partially shifted off the start/end of the episode.
     * Always false if the row is disabled.
     * @type {boolean} */
    #isWarn = false;
    /**
     * Tracks whether this row is completely shifted off the start/end of the episode.
     * Always false if the row is disabled.
     * @type {boolean} */
    #isError = false;

    /**
     * @param {BulkShiftOverlay} parent
     * @param {SerializedMarkerData} marker
     * @param {SerializedEpisodeData} episode
     * @param {boolean} linked Whether other markers with this episode id exist. */
    constructor(parent, marker, episode, linked) {
        super(parent.table(), marker.id);
        this.#parent = parent;
        this.#marker = marker;
        this.#episode = episode;
        this.#linked = linked;
    }

    episodeId() { return this.#marker.parentId; }
    markerId() { return this.#marker.id; }
    marker() { return this.#marker; }
    /** Returns whether this row is linked to other rows that share the same episode id. */
    linked() { return this.#linked; }
    /** Returns whether any part of the shifted marker in this row is cut off by the start/end of the episode. */
    isCutoff() { return this.#isWarn; }
    /** Returns whether the shifted marker is completely beyond the bounds of the episode. */
    isError() { return this.#isError; }
    /** Returns whether this marker is linked and no linked markers are checked. */
    isUnresolved() { return this.row.children[1].classList.contains('bulkActionSemi'); }

    /** Build and return the marker row. */
    build() {
        const row = this.buildRow(
            this.createCheckbox(!this.#linked, this.#marker.id),
            `S${pad0(this.#episode.seasonIndex, 2)}E${pad0(this.#episode.index, 2)}`,
            TableElements.timeData(this.#marker.start),
            TableElements.timeData(this.#marker.end),
            TableElements.timeData(this.#marker.start),
            TableElements.timeData(this.#marker.end),
        );

        if (this.#linked) {
            BulkShiftClasses.set(row.children[1], BulkShiftClasses.Type.Warn, true);
            this.#markActive(false, row.children[4], row.children[5]);
        } else {
            BulkShiftClasses.set(row.children[1], BulkShiftClasses.Type.On, true);
            this.#markActive(false, row.children[2], row.children[3]);
            row.children[4].classList.add('bulkActionSemi');
            row.children[5].classList.add('bulkActionSemi');
        }

        return this.row;
    }

    /**
     * Mark the given timing nodes as active or inactive.
     * @param {boolean} active
     * @param  {...HTMLElement} nodes */
    #markActive(active, ...nodes) {
        if (active) {
            nodes.forEach(n => n.classList.remove('bulkActionInactive'));
        } else {
            nodes.forEach(n => n.classList.add('bulkActionInactive'));
        }
    }

    /**
     * Adjust the styling of the new start/end values of the given row.
     * If the start/end of the marker is getting cut off, show it in yellow
     * If both the start/end are beyond the bounds of the episode, show both in red.
     * If the row is unchecked, clear all styling. */
    update() {
        this.#isError = false;
        this.#isWarn = false;
        const startShift = this.#parent.shiftStartValue() || 0;
        const endShift = this.#parent.shiftEndValue() || 0;
        const enabledChanged = this.enabled !== this.#enabledLastUpdate;
        if (enabledChanged) {
            this.#markActive(!this.enabled, this.row.children[2], this.row.children[3]);
            if (this.enabled) {
                this.#markActive(this.enabled, this.row.children[4], this.row.children[5]);
            } else {
                BulkShiftClasses.set(this.row.children[4], BulkShiftClasses.Type.Reset, false);
                BulkShiftClasses.set(this.row.children[5], BulkShiftClasses.Type.Reset, false);
            }

            this.#enabledLastUpdate = this.enabled;
        }

        if (!this.#validateMarkerRowShift(startShift, endShift)) {
            return;
        }

        if (!this.#linked) {
            BulkShiftClasses.set(this.row.children[1], this.enabled ? BulkShiftClasses.Type.On : BulkShiftClasses.Type.Error, true);
            return;
        }

        /** @type {BulkShiftRow[]} */
        const linkedRows = [];
        let anyChecked = this.enabled;
        for (const row of this.#parent.table().rows()) {
            Log.assert(row instanceof BulkShiftRow, `How did a non-shift row get here?`);
            if (row.episodeId() === this.episodeId()) {
                linkedRows.push(row);
                anyChecked ||= row.enabled;
            }
        }

        for (const linkedRow of linkedRows) {
            if (anyChecked) {
                BulkShiftClasses.set(
                    linkedRow.row.children[1],
                    linkedRow.enabled && !linkedRow.#isError ? BulkShiftClasses.Type.On : BulkShiftClasses.Type.Error,
                    true);
            } else if (!linkedRow.#isError) {
                BulkShiftClasses.set(linkedRow.row.children[1], BulkShiftClasses.Type.Warn, true);
            }

            // A change in enabled/disabled state might result in new warnings for linked markers. Update those as well.
            // This should be safe from infinite recursion, because enabledChanged shouldn't be true for these sub-updates.
            if (enabledChanged) {
                linkedRow.update();
            }
        }
    }

    /**
     * Updates the marker row's new timings and checks for overflow/underflow/overlap.
     * @param {number} startShift Time in ms to shift the start marker
     * @param {number} endShift Time in ms to shift the end marker
     * @returns {boolean} `true` if the caller should continue processing the marker, false if a blocking check failed. */
    #validateMarkerRowShift(startShift, endShift) {
        const start = this.#marker.start + startShift;
        const end = this.#marker.end + endShift;
        const maxDuration = this.#episode.duration;
        const newStart = Math.max(0, Math.min(start, maxDuration));
        const newEnd = Math.max(0, Math.min(end, maxDuration));
        const newStartNode = this.row.children[4];
        const newEndNode = this.row.children[5];
        newStartNode.innerText = msToHms(newStart);
        newEndNode.innerText = msToHms(newEnd);

        // If we aren't enabled, skip custom coloring.
        if (!this.enabled) {
            return true;
        }

        if (end < 0 || start > maxDuration || end <= start) {
            this.#markActive(true, this.row.children[2], this.row.children[3]);
            [this.row.children[1], newStartNode, newEndNode].forEach(n => {
                BulkShiftClasses.set(n, BulkShiftClasses.Type.Error, false,
                    `This marker is shifted outside of the episode.`);
            });

            this.#isError = true;

            return false;
        }

        const startWarnText = new TooltipBuilder();
        const endWarnText = new TooltipBuilder();
        if (start < 0) {
            startWarnText.addLine(`This shift will truncate the marker by ${msToHms(-start)}.`);
            BulkShiftClasses.set(newStartNode, BulkShiftClasses.Type.Warn, true, startWarnText.get());
            this.#isWarn = true;
        } else {
            BulkShiftClasses.set(newStartNode, BulkShiftClasses.Type.On, true);
        }

        if (end > maxDuration) {
            this.#isWarn = true;
            endWarnText.addLine(`This shift will truncate the marker by ${msToHms(end - maxDuration)}.`);
            BulkShiftClasses.set(newEndNode, BulkShiftClasses.Type.Warn, true, endWarnText.get());
        } else {
            BulkShiftClasses.set(newEndNode, BulkShiftClasses.Type.On, true);
        }

        const overlap = this.#parent.overlappingMarkers(this.markerId(), this.#episode.metadataId, newStart, newEnd);
        for (const marker of overlap) {
            const warnText = `Overlaps with ${marker.markerType} marker: [${msToHms(marker.start)}-${msToHms(marker.end)}]`;
            startWarnText.addLine(warnText);
            endWarnText.addLine(warnText);
        }

        if (!startWarnText.empty()) {
            BulkShiftClasses.set(newStartNode, BulkShiftClasses.Type.Warn, true, startWarnText.get());
        }

        if (!endWarnText.empty()) {
            BulkShiftClasses.set(newEndNode, BulkShiftClasses.Type.Warn, true, endWarnText.get());
        }

        return true;
    }
}

/**
 * Small helper to apply styles to a table item. */
const BulkShiftClasses = {
    classNames : ['bulkActionOn', 'bulkActionOff', 'bulkActionSemi'],
    Type : {
        Reset : -1,
        On    :  0,
        Error :  1,
        Warn  :  2,
    },
    /**
     * Set the class of the given node.
     * @param {HTMLTableCellElement} node
     * @param {number} idx BulkShiftClasses.Type value
     * @param {boolean} active Whether this node is active */
    set : (node, idx, active, tooltip='') => {
        const names = BulkShiftClasses.classNames;
        active ? node.classList.remove('bulkActionInactive') : node.classList.add('bulkActionInactive');
        if (idx === -1) {
            node.classList.remove(names[0]);
            node.classList.remove(names[1]);
            node.classList.remove(names[2]);
            return;
        }

        if (!node.classList.contains(names[idx])) {
            for (let i = 0; i < names.length; ++i) {
                i === idx ? node.classList.add(names[i]) : node.classList.remove(names[i]);
            }
        }

        if (tooltip) {
            Tooltip.setTooltip(node, tooltip);
        } else {
            Tooltip.removeTooltip(node);
        }
    }
};

export default BulkShiftOverlay;
