import { $, $append, $br, $div, $divHolder, $h, $hr, $span } from './HtmlHelpers.js';
import { pad0, toggleVisibility } from './Common.js';

import { BulkActionCommon, BulkActionRow, BulkActionTable, BulkActionType } from './BulkActionCommon.js';
import { BulkDeleteStickySettings } from 'StickySettings';
import ButtonCreator from './ButtonCreator.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import Icons from './Icons.js';
import { MarkerEnum } from '/Shared/MarkerType.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { ServerCommands } from './Commands.js';
import { TableElements } from 'MarkerTable';
import { ThemeColors } from './ThemeColors.js';

/** @typedef {!import('/Shared/PlexTypes').SeasonData} SeasonData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('/Shared/PlexTypes').ShowData} ShowData */

/**
 * UI for bulk deleting markers for a given show/season.
 */
class BulkDeleteOverlay {
    /** @type {ShowData|SeasonData} */
    #mediaItem;

    /** @type {BulkActionTable} */
    #table;

    /** @type {HTMLSelectElement} */
    #appliesToDropdown;

    /** @type {BulkDeleteStickySettings} */
    #stickySettings = new BulkDeleteStickySettings();

    /**
     * Construct a new bulk delete overlay.
     * @param {ShowData|SeasonData} mediaItem */
    constructor(mediaItem) {
        this.#mediaItem = mediaItem;
    }

    /**
     * Launch the bulk delete overlay.
     * @param {HTMLElement} focusBack The element to set focus back to after the bulk overlay is dismissed. */
    show(focusBack) {
        const container = $div({ id : 'bulkDeleteContainer', class : 'bulkActionContainer' });
        const title = $h(1, `Delete All Markers`);
        $append(container,
            title,
            $hr(),
            $h(4, $append($span(),
                `Are you sure you want to bulk delete markers for ${this.#mediaItem.title}?`, $br(),
                `This cannot be undone.`)),
            BulkActionCommon.markerSelectType('Delete Marker Type(s): ', this.#onApplyToChanged.bind(this), this.#stickySettings.applyTo()),
            $divHolder({ id : 'bulkActionButtons' },
                ButtonCreator.fullButton('Delete All',
                    Icons.Confirm,
                    ThemeColors.Green,
                    this.#deleteAll.bind(this),
                    { id : 'deleteApply', class : 'redOnHover' }),
                ButtonCreator.fullButton(
                    'Customize',
                    Icons.Table,
                    ThemeColors.Primary,
                    this.#showCustomizationTable.bind(this),
                    {
                        id : 'deleteCustomize',
                        tooltip : 'Bring up a table of all markers that will be deleted, with the option to keep some.'
                    }),
                ButtonCreator.fullButton('Cancel', Icons.Cancel, ThemeColors.Red, Overlay.dismiss, { id : 'bulkDeleteCancel' })
            )
        );

        this.#appliesToDropdown = $('#markerTypeSelect', container);

        Overlay.build({
            dismissible : true,
            closeButton : true,
            forceFullscreen : true,
            setup : { fn : () => $('#bulkDeleteCancel').focus() },
            focusBack : focusBack }, container);
    }

    /** Adjusts the customization table (if visible) after the marker apply type is changed. */
    #onApplyToChanged() {
        const applyTo = this.#applyTo();
        this.#stickySettings.setApplyTo(applyTo);
        this.#table?.rows().forEach(row => {
            if (!(row instanceof BulkDeleteRow)) {
                return;
            }

            toggleVisibility(row.row, MarkerEnum.typeMatch(row.markerType(), applyTo));

            // Bit of a hack based on how getIgnored works, but we want to ensure
            // that anything ignored by marker type filters is seen as selected
            // by the underlying table so it's not added to our ignore list, so
            // mark everything as checked after the marker selection type is changed.
            row.setChecked(true);
        });

        let text = `Delete ${this.#table ? 'Selected' : 'All'}`;
        switch (applyTo) {
            case MarkerEnum.Intro:
                text += ' Intros';
                break;
            case MarkerEnum.Credits:
                text += ' Credits';
                break;
            case MarkerEnum.Ad:
                text += ' Ads';
                break;
            default:
                break;
        }

        ButtonCreator.setText($('#deleteApply'), text);
    }

    /**
     * Attempt to delete all markers associated with this overlay's metadata id, minus any unchecked items. */
    async #deleteAll() {
        const ignored = this.#table?.getIgnored();
        const applyTo = this.#applyTo();
        try {
            const result = await ServerCommands.bulkDelete(this.#mediaItem.metadataId, applyTo, ignored);
            const markerMap = BulkActionCommon.markerMapFromList(result.deletedMarkers);

            PlexClientState.notifyBulkActionChange(markerMap, BulkActionType.Delete);
            await BulkActionCommon.flashButton('deleteApply', ThemeColors.Green);

            // If the bulk operation deleted all markers of the desired type, dismiss the overlay,
            // otherwise refresh the customization table.
            const remaining = result.markers.reduce((acc, marker) => acc + MarkerEnum.typeMatch(marker.markerType, applyTo) ? 1 : 0, 0);
            if (remaining === 0) {
                return Overlay.dismiss();
            }

            this.#showCustomizationTable();
        } catch (err) {
            await BulkActionCommon.flashButton('deleteApply', ThemeColors.Red, 500);
            errorResponseOverlay('Unable to bulk delete, please try again later', err, this.show.bind(this));
        }
    }

    /**
     * Display a table of all markers associated with the overlay's metadata id. */
    async #showCustomizationTable() {
        const data = await ServerCommands.checkBulkDelete(this.#mediaItem.metadataId);
        this.#table?.remove();
        this.#table = new BulkActionTable();

        const sortedMarkers = BulkActionCommon.sortMarkerList(data.markers, data.episodeData);

        this.#table.buildTableHead(
            'Episode',
            'Type',
            TableElements.customClassColumn('Name', 'bulkActionEpisodeColumn'),
            TableElements.shortTimeColumn('Start Time'),
            TableElements.shortTimeColumn('End Time')
        );

        for (const marker of sortedMarkers) {
            this.#table.addRow(new BulkDeleteRow(this.#table, marker, data.episodeData[marker.parentId]));
        }

        $('#bulkDeleteContainer').appendChild(this.#table.html());
        this.#onApplyToChanged();
    }

    /**
     * The marker type(s) to apply the shift to. */
    #applyTo() { return parseInt(this.#appliesToDropdown.value); }
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
            this.createCheckbox(true /*checked*/, this.#marker.id),
            `S${pad0(this.#episode.seasonIndex, 2)}E${pad0(this.#episode.index, 2)}`,
            this.#marker.markerType[0].toUpperCase() + this.#marker.markerType.substring(1),
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

    /** The marker type (intro/credits) of the marker associated with this row. */
    markerType() {
        return this.#marker.markerType;
    }
}

export default BulkDeleteOverlay;
