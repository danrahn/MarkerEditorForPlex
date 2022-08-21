import { Log } from "../../Shared/ConsoleLog.js";
import { SeasonData, ShowData } from "../../Shared/PlexTypes.js";

import ButtonCreator from "./ButtonCreator.js";
import { $, $$, appendChildren, buildNode, msToHms, pad0, ServerCommand, timeToMs } from "./Common.js";
import Animation from "./inc/Animate.js";
import Overlay from "./inc/Overlay.js";
import { PlexUI, UISection } from "./PlexUI.js";
import TableElements from "./TableElements.js";
import ThemeColors from "./ThemeColors.js";
/** @typedef {!import('../../Shared/PlexTypes.js').ShiftResult} ShiftResult */
/** @typedef {!import('../../Shared/PlexTypes.js').EpisodeData} EpisodeData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedEpisodeData} SerializedEpisodeData */

/**
 * UI for bulk shifting markers for a given show/season by a set amount of time.
 */
class BulkShiftOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

    /** @type {{[episodeId: number]: SerializedEpisodeData}} */
    #episodeData;

    /**
     * Timer id to track shift user input.
     * @type {number} */
    #inputTimer;

    /**
     * Construct a new shift overlay.
     * @param {ShowData|SeasonData} mediaItem */
    constructor(mediaItem) {
        this.#mediaItem = mediaItem;
    }

    /**
     * Launch the bulk shift overlay. */
    show() {
        let container = buildNode('div', { id : 'bulkShiftContainer' })
        let title = buildNode('h1', {}, `Shift Markers for ${this.#mediaItem.title}`);
        appendChildren(container,
            title,
            buildNode('hr'),
            appendChildren(buildNode('div', { id : 'shiftZone' }),
                buildNode('label', { for : 'shiftTime' }, 'Time offset: '),
                buildNode('input', {
                    type : 'text',
                    placeholder : 'ms or mm:ss[.000]',
                    name : 'shiftTime',
                    id : 'shiftTime' },
                    0,
                    { keyup : this.#onTimeShiftChange.bind(this) })),
            appendChildren(buildNode('div', { id : 'bulkShiftButtons' }),
                ButtonCreator.textButton('Apply', this.#tryApply.bind(this), { id : 'shiftApply', tooltip : 'Attempt to apply the given time shift. Brings up customization menu if any markers have multiple episodes.' }),
                ButtonCreator.textButton('Force Apply', this.#forceApply.bind(this), { id : 'shiftForceApplyMain', class : 'shiftForceApply', tooltip : 'Force apply the given time shift to all selected markers, even if some episodes have multiple markers.'}),
                ButtonCreator.textButton('Customize', this.#check.bind(this), { tooltip : 'Bring up the list of all applicable markers and selective choose which ones to shift.' }),
                ButtonCreator.textButton('Cancel', Overlay.dismiss)
            )
        );

        Overlay.build({ closeButton: true, forceFullscreen : true, setup : { fn : () => $('#shiftTime').focus() } }, container);
    }

    /**
     * @param {KeyboardEvent} e */
    #onTimeShiftChange(e) {
        clearTimeout(this.#inputTimer);
        const table = $('#bulkShiftCustomizeTable');
        if (!table) {
            return;
        }

        if (e.key == 'Enter') {
            this.#adjustNewTimes();
            return;
        }

        this.#inputTimer = setTimeout(this.#adjustNewTimes.bind(this), 250);

    }

    /**
     * Adjust the styling of all rows in the customize table after
     * the shift changes. */
    #adjustNewTimes() {
        const table = $('#bulkShiftCustomizeTable');
        if (!table) { return; }

        const shift = this.#shiftValue() || 0;

        $('.bulkShiftRow', table).forEach(row => {
            this.#styleRow(row, $$('input[type=checkbox]', row).checked, shift);
        });
    }

    /**
     * Adjust the styling of the new start/end values of the given row.
     * If the start/end of the marker is getting cut off, show it in yellow
     * If both the start/end are beyond the bounds of the episode, show both in red.
     * If the row is unchecked, clear all styling. */
    #styleRow(row, checked, shift=null) {
        if (shift === null) {
            shift = this.#shiftValue() || 0;
        }

        if (!checked) {
            BulkShiftClasses.set(row.childNodes[4], BulkShiftClasses.Type.Reset);
            BulkShiftClasses.set(row.childNodes[5], BulkShiftClasses.Type.Reset);
            return;
        }

        const eid = parseInt(row.getAttribute('eid'));
        const start = parseInt(row.getAttribute('mstart')) + shift;
        const end = parseInt(row.getAttribute('mend')) + shift;
        const maxDuration = this.#episodeData[eid].duration;
        const newStart = Math.max(0, Math.min(start, maxDuration))
        const newEnd = Math.max(0, Math.min(end, maxDuration));
        const newStartNode = row.childNodes[4];
        const newEndNode = row.childNodes[5];
        newStartNode.innerText = msToHms(newStart);
        newEndNode.innerText = msToHms(newEnd);
        if (end < 0 || start > maxDuration) {
            [newStartNode, newEndNode].forEach(n => {
                BulkShiftClasses.set(n,  BulkShiftClasses.Type.Error);
            });

            return;
        }

        if (start < 0) {
            BulkShiftClasses.set(newStartNode, BulkShiftClasses.Type.Warn);
        } else {
            BulkShiftClasses.set(newStartNode, BulkShiftClasses.Type.Reset);
        }

        if (end > maxDuration) {
            BulkShiftClasses.set(newEndNode, BulkShiftClasses.Type.Warn);
        } else {
            BulkShiftClasses.set(newEndNode, BulkShiftClasses.Type.Reset);
        }
    }

    /**
     * Map of error messages
     * @type {{[messageType: string]: string}}
     * @readonly */
    #messages = {
        unresolved : 'Some episodes have multiple markers, please resolve below.',
        unresolvedAgain : 'Are you sure you want to shift markers with unresolved conflicts? Anything unchecked will not be shifted.',
        cutoff : 'The current shift will cut off some markers. Are you sure you want to continue?',
        error : 'The current shift completely moves at least one selected marker beyond the bounds of the episode.<br>' +
                'Do you want to ignore those and continue?',
        unresolvedPlus : 'Are you sure you want to shift markers with unresolved conflicts? Anything unchecked will not be shifted.<br>' +
                         'Additionally, some markers are either cut off or completely beyond the bounds of an episode (or both).<br>' +
                         'Cut off markers will be applied and invalid markers will be ignored.',
        cutoffPlus : 'The current shift will cut off some markers, and ignore markers beyond the bounds of the episode.<br>' +
                     'Are you sure you want to continue?'
    }

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

        const attributes = { id : 'resolveShiftMessage', resolveMessage : messageType };
        let node;
        if (addForceButton) {
            node = appendChildren(buildNode('div', attributes),
                buildNode('h4', {}, message),
                ButtonCreator.textButton('Force shift', this.#forceApply.bind(this), { id : 'shiftForceApplySub', class : 'shiftForceApply' })
            );
        } else {
            node = buildNode('h4', attributes, message);
        }

        const container = $('#bulkShiftContainer');
        const currentNode = $('#resolveShiftMessage');
        if (currentNode) {
            container.insertBefore(node, currentNode);
            container.removeChild(currentNode);
            return;
        }

        const customizeTable = $('#bulkShiftCustomizeTable');
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

        return message.getAttribute('resolveMessage');
    }

    /**
     * Attempts to apply the given shift to all markers under the given metadata id.
     * If any episode has multiple markers, shows the customization table. */
    async #tryApply() {
        let shift = this.#shiftValue();
        if (!shift) {
            return this.#flashButton($('#shiftApply'), 'red');
        }

        const ignoreInfo = this.#getIgnored();
        const customizeTable = $('#bulkShiftCustomizeTable');
        if (ignoreInfo.hasUnresolved) {
            Log.assert(customizeTable, `How do we know we have unresolved markers if the table isn't showing?`);

            // If we've already shown the warning
            const existingMessage = this.#getMessageType();
            if (existingMessage && existingMessage != 'unresolvedPlus' && (ignoreInfo.hasCutoff || ignoreInfo.hasCutoff)) {
                return this.#showMessage('unresolvedPlus', true);
            }

            if (existingMessage && existingMessage != 'unresolvedAgain') {
                return this.#showMessage('unresolvedAgain', true);
            }

            // If we are already showing the force shift subdialog, just flash the button
            if (existingMessage == 'unresolvedAgain' || existingMessage == 'unresolvedPlus') {
                return this.#flashButton($('#shiftApply'), 'red');
            }

            this.#showMessage('unresolved');
            if (!customizeTable) {
                this.#check();
            }

            return;
        }

        if (ignoreInfo.hasCutoff) {
            return this.#showMessage(ignoreInfo.hasError ? 'cutoff' : 'cutoffPlus', true);
        }

        if (ignoreInfo.hasError) {
            return this.#showMessage('error', true);
        }

        const shiftResult = await ServerCommand.shift(this.#mediaItem.metadataId, shift, false /*force*/, ignoreInfo.ignored);
        if (shiftResult.applied) {
            await this.#flashButton($('#shiftApply'), 'green');

            // If we modified a season, go up a level and show all seasons
            // so we don't have to update marker timings in-place.
            // TODO: update in-place
            if (this.#mediaItem instanceof SeasonData) {
                // 'Back to seasons' callback
                PlexUI.Get().clearAndShowSections(UISection.Episodes);
                PlexUI.Get().showSections(UISection.Seasons);
            }

            Overlay.dismiss();
            return;
        }

        this.#episodeData = shiftResult.episodeData;
        Log.assert(shiftResult.conflict || shiftResult.overflow, `We should only have !applied && !conflict during check_shift, not shift. What happened?`);
        this.#showMessage(shiftResult.overflow ? 'error' : 'unresolved', shiftResult.overflow);
        this.#showCustomizeTable(shiftResult);
    }

    /**
     * Force applies the given shift to all markers under the given metadata id. */
    async #forceApply() {
        let shift = this.#shiftValue();
        if (!shift) {
            $('.shiftForceApply').forEach(f => this.#flashButton(f, 'red'));
        }

        // Brute force through everything, applying to all checked items (or all items if the conflict table isn't showing)
        const ignoreInfo = this.#getIgnored();
        try {
            const shiftResult = await ServerCommand.shift(this.#mediaItem.metadataId, shift, true /*force*/, ignoreInfo.ignored);
            if (!shiftResult.applied) {
                Log.assert(shiftResult.overflow, `Force apply should only fail if overflow was found.`);
                this.#episodeData = shiftResult.episodeData;
                this.#showCustomizeTable(shiftResult);
                this.#showMessage('error', true);
                return;
            }

            $('.shiftForceApply').forEach(async f => {
                await this.#flashButton(f, 'green');
                Overlay.dismiss();
            });
            
            // If we modified a season, go up a level and show all seasons
            // so we don't have to update marker timings in-place.
            // TODO: update in-place
            if (this.#mediaItem instanceof SeasonData) {
                // 'Back to seasons' callback
                PlexUI.Get().clearAndShowSections(UISection.Episodes);
                PlexUI.Get().showSections(UISection.Seasons);
            }
        } catch (ex) {
            $('.shiftForceApply').forEach(f => this.#flashButton(f, 'red'));
        }
    }

    /**
     * Retrieves marker information for the current metadata id and displays it in a table for the user. */
    async #check() {
        const shiftResult = await ServerCommand.checkShift(this.#mediaItem.metadataId);
        this.#episodeData = shiftResult.episodeData;
        this.#showCustomizeTable(shiftResult);
    }

    /**
     * Retrieve the current ms time of the shift input.
     * @returns {number|false} */
    #shiftValue() {
        let shift = timeToMs($('#shiftTime').value, true /*allowNegative*/);
        if (shift == 0 || isNaN(shift)) {
            return false;
        }

        return shift;
    }

    /**
     * Flash the background of the given button the given theme color.
     * @param {HTMLElement} button
     * @param {string} color */
    async #flashButton(button, color) {
        Animation.queue({ backgroundColor : `#${ThemeColors.get(color)}4` }, button, 500);
        return new Promise((resolve, _) => {
            Animation.queueDelayed({ backgroundColor : 'transparent' }, button, 500, 500, true, resolve);
        });
    }

    /**
     * Display a table of all markers applicable to this instance's metadata id.
     * @param {ShiftResult} shiftResult */
    #showCustomizeTable(shiftResult) {
        const existingTable = $('#bulkShiftCustomizeTable');
        if (existingTable) {
            existingTable.parentElement.removeChild(existingTable);
        }

        const getCheckbox = (checked, mid, eid) => {
            const checkboxName = `mid_check_${mid}`;
            const checkbox = buildNode('input', {
                type : 'checkbox',
                name : checkboxName,
                id : checkboxName,
                eid : eid,
                mid : mid,
                linked : checked ? 0 : 1 });
            checkbox.addEventListener('change', this.#onMarkerChecked.bind(this, checkbox));
            if (checked) {
                checkbox.setAttribute('checked', 'checked');
            }

            return appendChildren(buildNode('div'),
                buildNode('label', { for : checkboxName, class : 'hidden' }, `Marker ${mid} Shift Checkbox`),
                checkbox);
        }

        const sortedMarkers = shiftResult.allMarkers.sort((a, b) => {
            /** @type {EpisodeData} */
            const aEd = shiftResult.episodeData[a.episodeId];
            /** @type {EpisodeData} */
            const bEd = shiftResult.episodeData[b.episodeId];
            if (aEd.seasonIndex != bEd.seasonIndex) { return aEd.seasonIndex - bEd.seasonIndex; }
            if (aEd.index != bEd.index) { return aEd.index - bEd.index; }
            return a.index - b.index;
        });

        const table = buildNode('table', { class : 'markerTable', id : 'bulkShiftCustomizeTable' });
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    '',
                    'Episode',
                    TableElements.shortTimeColumn('Start Time'),
                    TableElements.shortTimeColumn('End Time'),
                    TableElements.shortTimeColumn('New Start'),
                    TableElements.shortTimeColumn('New End'))
            )
        )

        const rows = buildNode('tbody');

        for (let i = 0; i < sortedMarkers.length; ++i) {
            let checkGroup = [];
            const eInfo = shiftResult.episodeData[sortedMarkers[i].episodeId];
            checkGroup.push(sortedMarkers[i]);
            while (i < sortedMarkers.length - 1 && sortedMarkers[i+1].episodeId == eInfo.metadataId) {
                checkGroup.push(sortedMarkers[++i]);
            }

            const multiple = checkGroup.length > 1;
            for (const marker of checkGroup) {
                let shift = this.#shiftValue() || 0;
                const row = TableElements.rawTableRow(
                    getCheckbox(!multiple, marker.id, marker.episodeId),
                    `S${pad0(eInfo.seasonIndex, 2)}E${pad0(eInfo.index, 2)}`,
                    TableElements.timeData(marker.start),
                    TableElements.timeData(marker.end),
                    TableElements.timeData(marker.start),
                    TableElements.timeData(marker.end),
                );

                row.classList.add('bulkShiftRow');
                row.setAttribute('mstart', marker.start);
                row.setAttribute('mend', marker.end);
                row.setAttribute('eid', marker.episodeId);
                row.setAttribute('mid', marker.id);
                if (multiple) {
                    row.classList.add('bulkShiftSemi');
                } else {
                    row.classList.add('bulkShiftOn');
                }

                this.#styleRow(row, !multiple, shift);
                rows.appendChild(row);
            }
        }

        table.appendChild(rows);
        $('#bulkShiftContainer').appendChild(table);
    }

    /**
     * Update marker row colors when a row is checked/unchecked
     * @param {HTMLInputElement} checkbox */
    #onMarkerChecked(checkbox) {
        const checked = checkbox.checked;
        const linked = checkbox.getAttribute('linked') != '0';
        const row = checkbox.parentElement.parentElement.parentElement;
        this.#styleRow(row, checked);
        if (!linked) {
            row.classList.remove(checked ? 'bulkShiftOff': 'bulkShiftOn');
            row.classList.add(checked ? 'bulkShiftOn' : 'bulkShiftOff');
            return;
        }

        /** @type {NodeListOf<DOMString>} */
        const linkedCheckboxes = $(`input[type="checkbox"][eid="${checkbox.getAttribute('eid')}"]`, row.parentElement);
        console.log(linkedCheckboxes);
        // TODO: keep track of if any have ever been checked?
        let anyChecked = checked;
        if (!anyChecked) {
            linkedCheckboxes.forEach(c => anyChecked = anyChecked || c.checked);
        }

        for (const linkedCheckbox of linkedCheckboxes) {
            const linkedRow = linkedCheckbox.parentElement.parentElement.parentElement;
            if (anyChecked) {
                linkedRow.classList.remove('bulkShiftSemi');
                linkedRow.classList.remove(linkedCheckbox.checked ? 'bulkShiftOff' : 'bulkShiftOn');
                linkedRow.classList.add(linkedCheckbox.checked ? 'bulkShiftOn' : 'bulkShiftOff');
            } else {
                linkedRow.classList.remove('bulkShiftOn');
                linkedRow.classList.remove('bulkShiftOff');
                linkedRow.classList.add('bulkShiftSemi');
            }
        }
        Log.info('Click! - ' + checked + ' - ' + linked);
    }

    /**
     * Return information about ignored markers in the shift table. */
    #getIgnored() {
        const customizeTable = $('#bulkShiftCustomizeTable');
        if (!customizeTable) {
            return { ignored : [], tableVisible : false, hasUnresolved : false, hasCutoff : false, hasError : false };
        }

        const ignored = [];
        const hasUnresolved = !!$$('tr.bulkShiftSemi', customizeTable);

        // Markers that are both off and 'semi' selected are ignored.
        $('tr.bulkShiftOff', customizeTable).forEach(r => ignored.push(parseInt(r.getAttribute('mid'))));
        $('tr.bulkShiftSemi', customizeTable).forEach(r => ignored.push(parseInt(r.getAttribute('mid'))));
        $('tr.bulkShiftOn td:nth-child(5).bulkShiftOff', customizeTable).forEach(td => ignored.push(parseInt(td.parentElement.getAttribute('mid'))));
        return {
            ignored : ignored,
            tableVisible : true,
            hasUnresolved : hasUnresolved,
            hasCutoff : !!$$('td.bulkShiftSemi', customizeTable),
            hasError  : !!$$('td.bulkShiftOff', customizeTable),
        };
    }
}

/**
 * Small helper to apply styles to a table item. */
const BulkShiftClasses = {
    classNames : ['bulkShiftOn', 'bulkShiftOff', 'bulkShiftSemi'],
    Type : {
        Reset : -1,
        Error :  1,
        Warn  :  2,
    },
    /**
     * Set the class of the given node.
     * @param {HTMLTableCellElement} node
     * @param {number} idx BulkShiftClasses.Type value */
    set : (node, idx) => {
        const names = BulkShiftClasses.classNames;
        if (idx == -1) {
            node.classList.remove(names[1]);
            node.classList.remove(names[2]);
            return;
        }

        if (!node.classList.contains(names[idx])) {
            for (let i = 0; i < names.length; ++i) {
                i == idx ? node.classList.add(names[i]) : node.classList.remove(names[i]);
            }
        }
    }
}

export default BulkShiftOverlay;
