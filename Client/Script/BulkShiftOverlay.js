import { Log } from "../../Shared/ConsoleLog.js";
import { SeasonData, ShowData } from "../../Shared/PlexTypes.js";

import ButtonCreator from "./ButtonCreator.js";
import { $, $$, appendChildren, buildNode, pad0, ServerCommand, timeToMs } from "./Common.js";
import Animation from "./inc/Animate.js";
import Overlay from "./inc/Overlay.js";
import { PlexUI, UISection } from "./PlexUI.js";
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
                ButtonCreator.textButton('Force Apply', this.#forceApply.bind(this), { id : 'shiftForceApplyMain', class : 'shiftForceApply', tooltip : 'Force apply the given time shift to all markers, even if some episodes have multiple markers.'}),
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

        const ignoreInfo = this.#getIgnored();
        const container = $('#bulkShiftContainer');
        const customizeTable = $('#bulkShiftCustomizeTable');
        if (ignoreInfo.hasUnresolved) {
            Log.assert(customizeTable, `How do we know we have unresolved markers if the table isn't showing?`);

            // If we've already shown the warning
            const warningH3 = $('#resolveShiftH3');
            if (warningH3) {
                // If resolveShiftH3 exists, show a similar div, but this time ask the user if they want
                // to ignore the unresolved items.
                container.insertBefore(appendChildren(buildNode('div', { id : 'forceShiftWithUnresolved' }),
                    buildNode('h3', {}, 'Are you sure you want to shift markers with unresolved conflicts? Anything unchecked will not be shifted.'),
                    ButtonCreator.textButton('Force shift', this.#forceApply.bind(this), { id : 'shiftForceApplySub', class : 'shiftForceApply' })
                ), customizeTable);
                container.removeChild(warningH3);
                return;
            }

            // If we are already showing the force shift subdialog, just flash the button
            if ($('#forceShiftWithUnresolved')) {
                return this.#flashButton($('#shiftApply'), 'red');
            }

            // No initial warning, no force shift subdialog, show resolveShiftH3.
            const resolveShiftH3 = buildNode('h3', { id : 'resolveShiftH3' }, 'Some episodes have multiple markers, please resolve below.');
            if (customizeTable) {
                // Assume nothing's changed marker-wise, and keep the existing table with its checked state if it exists
                container.insertBefore(resolveShiftH3, customizeTable);
            } else {
                $('#bulkShiftContainer').appendChild(resolveShiftH3);
                this.#check();
            }

            return;
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

        Log.assert(shiftResult.conflict, `We should only have !applied && !conflict during check_shift, not shift. What happened?`);
        $('#bulkShiftContainer').appendChild(buildNode('h3', { id : 'resolveShiftH3' }, 'Some episodes have multiple markers, please resolve below.'));
        this.#showCustomizeTable(shiftResult);
    }

    /**
     * Force applies the given shift to all markers under the given metadata id.
     * NYI */
    async #forceApply() {
        let shift = this.#shiftValue();
        if (!shift) {
            $('.shiftForceApply').forEach(f => this.#flashButton(f, 'red'));
        }

        // Brute force through everything, applying to all checked items (or all items if the conflict table isn't showing)
        const ignoreInfo = this.#getIgnored();
        try {
            await ServerCommand.shift(this.#mediaItem.metadataId, shift, true /*force*/, ignoreInfo.ignored);
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
                    TableElements.shortTimeColumn('End Time'))
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

    /**
     * Return information about ignored markers in the shift table. */
    #getIgnored() {
        const customizeTable = $('#bulkShiftCustomizeTable');
        if (!customizeTable) {
            return { ignored : [], tableVisible : false, hasUnresolved : false };
        }

        const ignored = [];
        const hasUnresolved = $('.bulkShiftSemi', customizeTable).length != 0;

        // Markers that are both off and 'semi' selected are ignored.
        $('.bulkShiftOff', customizeTable).forEach(r => ignored.push(parseInt($$('input[type=checkbox]', r).getAttribute('mid'))));
        $('.bulkShiftSemi', customizeTable).forEach(r => ignored.push(parseInt($$('input[type=checkbox]', r).getAttribute('mid'))));
        return { ignored : ignored, tableVisible : true, hasUnresolved : hasUnresolved };
    }
}

export default BulkShiftOverlay;
