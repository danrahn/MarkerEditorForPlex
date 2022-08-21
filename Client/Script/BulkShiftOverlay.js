import { Log } from "../../Shared/ConsoleLog.js";
import { SeasonData, ShowData } from "../../Shared/PlexTypes.js";

import ButtonCreator from "./ButtonCreator.js";
import { $, appendChildren, buildNode, pad0, ServerCommand, timeToMs } from "./Common.js";
import Animation from "./inc/Animate.js";
import Overlay from "./inc/Overlay.js";
import TableElements from "./TableElements.js";
import ThemeColors from "./ThemeColors.js";
/** @typedef {!import('../../Shared/PlexTypes.js').ShiftResult} ShiftResult */
/** @typedef {!import('../../Shared/PlexTypes.js').EpisodeData} EpisodeData */

/**
 * UI for bulk shifting markers for a given show/season by a set amount of time.
 */
class BulkShiftOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

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
                buildNode('input', { type : 'text', placeholder : 'ms or mm:ss[.000]', name : 'shiftTime', id : 'shiftTime' })),
            appendChildren(buildNode('div', { id : 'bulkShiftButtons' }),
                ButtonCreator.textButton('Apply', this.#tryApply.bind(this), { id : 'shiftApply', tooltip : 'Attempt to apply the given time shift. Brings up customization menu if any markers have multiple episodes.' }),
                ButtonCreator.textButton('Force Apply', this.#forceApply.bind(this), { id : 'shiftForceApply', tooltip : 'Force apply the given time shift to all markers, even if some episodes have multiple markers.'}),
                ButtonCreator.textButton('Customize', this.#check.bind(this), { tooltip : 'Bring up the list of all applicable markers and selective choose which ones to shift.' }),
                ButtonCreator.textButton('Cancel', Overlay.dismiss)
            )
        );

        Overlay.build({ closeButton: true, forceFullscreen : true, setup : { fn : () => $('#shiftTime').focus() } }, container);
    }

    /**
     * Attempts to apply the given shift to all markers under the given metadata id.
     * If any episode has multiple markers, shows the customization table.
     * NYI */
    async #tryApply() {
        let shift = this.#shiftValue();
        if (!shift) {
            return this.#flashButton($('#shiftApply'), 'red');
        }

        Log.info('Trying to apply...');
    }

    /**
     * Force applies the given shift to all markers under the given metadata id.
     * NYI */
    async #forceApply() {
        let shift = this.#shiftValue();
        if (!shift) {
            return this.#flashButton($('#shiftForceApply'), 'red');
        }

        console.log(shift);
        Log.info('Force applying...');
    }

    /**
     * Retrieves marker information for the current metadata id and displays it in a table for the user. */
    async #check() {
        const shiftResult = await ServerCommand.checkShift(this.#mediaItem.metadataId);
        Log.info(shiftResult, 'Got Result');
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
    #flashButton(button, color) {
        Animation.queue({ backgroundColor : `#${ThemeColors.get(color)}4` }, button, 500);
        Animation.queueDelayed({ backgroundColor : 'transparent' }, button, 500, 500, true);
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
                    TableElements.shortTimeColumn('End Time'))
            )
        )

        const rows = buildNode('tbody');

        for (let i = 0; i < sortedMarkers.length; ++i) {
            let checkGroup = [];
            const eInfo = shiftResult.episodeData[sortedMarkers[i].episodeId];
            checkGroup.push(sortedMarkers[i]);
            while (i < sortedMarkers.length - 1 && sortedMarkers[i+1].episodeId == eInfo.metadataId) {
                checkGroup.push(sortedMarkers[i++]);
            }

            const multiple = checkGroup.length > 1;
            for (const marker of checkGroup) {
                const row = TableElements.rawTableRow(
                    getCheckbox(!multiple, marker.id, marker.episodeId),
                    `S${pad0(eInfo.seasonIndex, 2)}E${pad0(eInfo.index, 2)}`,
                    TableElements.timeData(marker.start),
                    TableElements.timeData(marker.end)
                );
                if (multiple) {
                    row.classList.add('bulkShiftSemi');
                } else {
                    row.classList.add('bulkShiftOn');
                }

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
}

export default BulkShiftOverlay;
