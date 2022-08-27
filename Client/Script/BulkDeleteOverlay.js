import { SeasonData, ShowData } from '../../Shared/PlexTypes.js';
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */

import { BulkActionCommon, BulkActionRow, BulkActionTable, BulkActionType } from './BulkActionCommon.js';
import ButtonCreator from './ButtonCreator.js';
import { $, appendChildren, buildNode, errorResponseOverlay, pad0, ServerCommand } from './Common.js';
import Overlay from './inc/Overlay.js';
import PlexClientState from './PlexClientState.js';
import TableElements from './TableElements.js';


/**
 * UI for bulk deleting markers for a given show/season.
 */
class BulkDeleteOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

    /** @type {BulkActionTable} */
    #table;

    /**
     * Construct a new bulk delete overlay.
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
        const ignored = this.#table.getIgnored();
        try {
            const result = await ServerCommand.bulkDelete(this.#mediaItem.metadataId, ignored);
            const markerMap = BulkActionCommon.markerMapFromList(result.deletedMarkers);

            PlexClientState.GetState().notifyBulkActionChange(markerMap, BulkActionType.Delete);
            await BulkActionCommon.flashButton('deleteApply', 'green');
            if (result.markers.length == 0) {
                return Overlay.dismiss();
            }

            this.#showCustomizationTable();
        } catch (err) {
            await BulkActionCommon.flashButton('deleteApply', 'red', 250);
            errorResponseOverlay('Unable to bulk delete, please try again later', err, this.show.bind(this));
        }
    }

    /**
     * Display a table of all markers associated with the overlay's metadata id. */
    async #showCustomizationTable() {
        const data = await ServerCommand.checkBulkDelete(this.#mediaItem.metadataId);
        this.#table?.remove();
        this.#table = new BulkActionTable();

        ButtonCreator.setText($('#deleteApply'), 'Delete Selected');
        const sortedMarkers = BulkActionCommon.sortMarkerList(data.markers, data.episodeData);

        this.#table.buildTableHead(
            'Episode',
            TableElements.customClassColumn('Name', 'bulkActionEpisodeColumn'),
            TableElements.shortTimeColumn('Start Time'),
            TableElements.shortTimeColumn('End Time')
        );

        for (const marker of sortedMarkers) {
            this.#table.addRow(new BulkDeleteRow(this.#table, marker, data.episodeData[marker.episodeId]));
        }

        $('#bulkActionContainer').appendChild(this.#table.html());
    }
}

/**
 * Represents a single row in the bulk delete customization table.
 */
class BulkDeleteRow extends BulkActionRow {
    /** @type {SerializedMarkerData} */
    #marker;
    /** @type {SerializedEpisodeData} */
    #episode;

    /**
     * @param {BulkActionTable} table
     * @param {SerializedMarkerData} markerInfo
     * @param {SerializedEpisodeData} episodeInfo */
    constructor(table, markerInfo, episodeInfo) {
        super(table, markerInfo.id);
        this.#marker = markerInfo;
        this.#episode = episodeInfo;
    }

    /** Construct the table row. */
    build() {
        const row = this.buildRow(
            this.createCheckbox(true /*checked*/, this.#marker.id, this.#marker.episodeId),
            `S${pad0(this.#episode.seasonIndex, 2)}E${pad0(this.#episode.index, 2)}`,
            TableElements.customClassColumn(this.#episode.title, 'bulkActionEpisodeColumn'),
            TableElements.timeData(this.#marker.start),
            TableElements.timeData(this.#marker.end),
        );

        row.children[3].classList.add('bulkActionOff');
        row.children[4].classList.add('bulkActionOff');
        return row;
    }

    /** Update the table row after being checked/unchecked. */
    update() {
        // Select only the times, using the episode/name for multiselect.
        // Only highlight times in red if selected, indicating that those
        // markers will be deleted.
        for (const col of [this.row.children[3], this.row.children[4]]) {
            this.enabled ? col.classList.add('bulkActionOff') : col.classList.remove('bulkActionOff');
            this.enabled ? col.classList.remove('bulkActionInactive') : col.classList.add('bulkActionInactive');
        }
    }
}

export default BulkDeleteOverlay;
