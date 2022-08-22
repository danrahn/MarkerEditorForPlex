import { SeasonData, ShowData } from '../../Shared/PlexTypes.js';
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */

import Animation from './inc/Animate.js';
import { BulkActionCommon, BulkActionType } from './BulkActionCommon.js';
import ButtonCreator from './ButtonCreator.js';
import { $, appendChildren, buildNode, errorResponseOverlay, pad0, ServerCommand } from './Common.js';
import Overlay from './inc/Overlay.js';
import PlexClientState from './PlexClientState.js';
import TableElements from './TableElements.js';
import ThemeColors from './ThemeColors.js';


/**
 * UI for bulk deleting markers for a given show/season.
 */
class BulkDeleteOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

    /**
     * Construct a new shift overlay.
     * @param {ShowData|SeasonData} mediaItem */
    constructor(mediaItem) {
        this.#mediaItem = mediaItem;
    }

    /**
     * Launch the bulk delete overlay. */
    show() {
        let container = buildNode('div', { id : 'bulkActionContainer' })
        let title = buildNode('h1', {}, `Delete All Markers`);
        appendChildren(container,
            title,
            buildNode('hr'),
            buildNode('h4', {}, `Are you sure you want to delete all markers for ${this.#mediaItem.title}?<br>This cannot be undone.`),
            appendChildren(buildNode('div', { id : 'bulkActionButtons' }),
                ButtonCreator.textButton('Delete All', this.#deleteAll.bind(this), { id : 'deleteApply', class : 'cancelSetting' }),
                ButtonCreator.textButton('Customize', this.#showCustomizationTable.bind(this), { id : 'deleteCustomize', tooltip : 'Bring up a table of all markers that will be deleted, with the option to keep some.'}),
                ButtonCreator.textButton('Cancel', Overlay.dismiss, { id : 'bulkDeleteCancel' })
            )
        );

        Overlay.build({ dismissible : true, closeButton: true, forceFullscreen : true, setup : { fn : () => $('#bulkDeleteCancel').focus() } }, container);
    }

    /**
     * Attempt to delete all markers associated with this overlay's metadata id, minus any unchecked items. */
    async #deleteAll() {
        const ignored = this.#getIgnored();
        try {
            const result = await ServerCommand.bulkDelete(this.#mediaItem.metadataId, ignored);
            const markerMap = BulkActionCommon.markerMapFromList(result.deletedMarkers);

            PlexClientState.GetState().notifyBulkActionChange(markerMap, BulkActionType.Delete);
            await this.#flashButton($('#deleteApply'), 'green');
            if (result.markers.length == 0) {
                return Overlay.dismiss();
            }

            this.#showCustomizationTable();
        } catch (err) {
            await this.#flashButton($('#deleteApply'), 'red', 250);
            errorResponseOverlay('Unable to bulk delete, please try again later', err, this.show.bind(this));
        }
    }

    /**
     * Flash the background of the given button the given theme color.
     * @param {HTMLElement} button
     * @param {string} color */
    async #flashButton(button, color, duration=500) {
        Animation.queue({ backgroundColor : `#${ThemeColors.get(color)}4` }, button, duration);
        return new Promise((resolve, _) => {
            Animation.queueDelayed({ backgroundColor : 'transparent' }, button, duration, duration, true, resolve);
        });
    }

    /**
     * Display a table of all markers associated with the overlay's metadata id. */
    async #showCustomizationTable() {
        const data = await ServerCommand.checkBulkDelete(this.#mediaItem.metadataId);
        const existingTable = $('#bulkDeleteCustomizeTable');
        if (existingTable) {
            existingTable.parentElement.removeChild(existingTable);
        }

        ButtonCreator.setText($('#deleteApply'), 'Delete Selected');
        const sortedMarkers = BulkActionCommon.sortMarkerList(data.markers, data.episodeData);

        const table = buildNode('table', { class : 'markerTable', id : 'bulkDeleteCustomizeTable' });
        const mainCheckbox = buildNode('input', { type : 'checkbox', title : 'Select/unselect all', checked : 'checked' });
        mainCheckbox.addEventListener('change', BulkActionCommon.selectUnselectAll.bind(this, mainCheckbox, 'bulkDeleteCustomizeTable'));
        table.appendChild(
            appendChildren(buildNode('thead'),
                TableElements.rawTableRow(
                    mainCheckbox,
                    'Episode',
                    TableElements.customClassColumn('Name', 'bulkActionEpisodeColumn'),
                    TableElements.shortTimeColumn('Start Time'),
                    TableElements.shortTimeColumn('End Time'))
            )
        );

        const rows = buildNode('tbody');
        for (const marker of sortedMarkers) {
            const eInfo = data.episodeData[marker.episodeId];
            const row = TableElements.rawTableRow(
                BulkActionCommon.checkbox(true, marker.id, marker.episodeId, {}, this.#onMarkerChecked, this),
                `S${pad0(eInfo.seasonIndex, 2)}E${pad0(eInfo.index, 2)}`,
                TableElements.customClassColumn(eInfo.title, 'bulkActionEpisodeColumn'),
                TableElements.timeData(marker.start),
                TableElements.timeData(marker.end),
            );

            row.setAttribute('eid', marker.episodeId);
            row.setAttribute('mid', marker.id);
            row.classList.add('bulkActionOn');
            rows.appendChild(row);
        }

        table.appendChild(rows);
        $('#bulkActionContainer').appendChild(table);
    }

    /**
     * Update marker row colors when a row is checked/unchecked
     * @param {HTMLInputElement} checkbox */
    #onMarkerChecked(checkbox) {
        const row = checkbox.parentElement.parentElement.parentElement;
        const checked = checkbox.checked;
        row.classList.remove(checked ? 'bulkActionOff': 'bulkActionOn');
        row.classList.add(checked ? 'bulkActionOn' : 'bulkActionOff');
    }

    /**
     * Retrieve the list of markers to ignore when bulk-deleting. */
    #getIgnored() {
        const customizeTable = $('#bulkDeleteCustomizeTable');
        if (!customizeTable) {
            return [];
        }

        const ignored = [];
        $('tr.bulkActionOff', customizeTable).forEach(r => ignored.push(parseInt(r.getAttribute('mid'))));
        return ignored;
    }
}

export default BulkDeleteOverlay;
