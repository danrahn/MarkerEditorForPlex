import { $$, $append, $br, $clear, $div, $divHolder, $h, $hr, $label, $option, $select, $span, $text } from '../HtmlHelpers.js';
import { BulkActionRow, BulkActionTable, ConflictResolutionSelection } from '../BulkActionCommon.js';
import { BulkMarkerResolveType, EpisodeAndMarkerData } from '/Shared/PlexTypes.js';
import { msToHms, pad0, plural } from '../Common.js';
import { CopyMarkerStickySettings } from '../StickySettings/CopyMarkerStickySettings.js';
import { customCheckbox } from '../CommonUI.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import Overlay from '../Overlay.js';
import { ServerCommands } from '../Commands.js';
import { TableElements } from './TableElements.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';
import TooltipBuilder from '../TooltipBuilder.js';

/** @typedef {!import('/Shared/PlexTypes').CustomBulkAddMap} CustomBulkAddMap */
/** @typedef {!import('/Shared/PlexTypes').SeasonData} SeasonData */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedBulkAddResult} SerializedBulkAddResult */
/** @typedef {!import('/Shared/PlexTypes').SerializedBulkAddResultEntry} SerializedBulkAddResultEntry */
/** @typedef {!import('/Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('/Shared/PlexTypes').ShowData} ShowData */
/** @typedef {!import('../ClientDataExtensions.js').ClientEpisodeData} ClientEpisodeData */
/** @typedef {!import('../Overlay.js').OverlayOptions} OverlayOptions */

export class CopyMarkerOverlay {
    /** @type {ClientEpisodeData} */
    #episode;

    /** @type {{ [episodeId: number]: EpisodeAndMarkerData}} */
    #episodeMap = {};

    /** @type {{ [markerId: number]: MarkerData}} */
    #markerMap = {};

    /** @type {HTMLElement} */
    #copyButton;

    /** @type {BulkActionTable} */
    #theseMarkersTable;

    /** @type {BulkActionTable} */
    #episodeSelectionTable;

    /** @type {MarkerData[]} */
    #toCopyCached = [];

    /** @type {CopyMarkerStickySettings} */
    #stickySettings = new CopyMarkerStickySettings();

    /**
     * @param {ClientEpisodeData} episode
     * @param {HTMLElement} focusBack */
    constructor(episode, focusBack) {
        this.#episode = episode;
        this.#copyButton = focusBack;
    }

    async show() {

        const loading = $divHolder(
            { class : 'hidden bulkActionContainer' },
            'Loading episode data...',
            $br(),
            getSvgIcon(Icons.Loading, ThemeColors.Primary, { height : '32px' })
        );

        /** @type {OverlayOptions} */
        const overlayOpts = {
            dismissible : true,
            closeButton : true,
            forceFullscreen : true,
            focusBack : this.#copyButton,
        };

        // If data retrieval is quick, don't show the loading text only to immediately overwrite it.
        setTimeout(() => {
            if (loading.isConnected) {
                loading.classList.remove('hidden');
            }
        }, 200);

        Overlay.build(overlayOpts, loading);

        const rawData = await ServerCommands.getAllEpisodes(this.#episode.metadataId);
        const episodes = [];
        for (const episode of rawData) {
            episodes.push(new EpisodeAndMarkerData().setFromJson(episode));
        }

        for (const episode of episodes) {
            this.#episodeMap[episode.metadataId] = episode;
        }

        episodes.sort((a, b) => {
            if (a.seasonIndex !== b.seasonIndex) {
                return a.seasonIndex - b.seasonIndex;
            }

            return a.episodeIndex - b.episodeIndex;
        });

        const container = $div({ id : 'markerCopyOverlay', class : 'bulkActionContainer' });
        const title = $h(1, 'Copy Markers');
        const markers = this.#episode.markerTable().markers();
        this.#toCopyCached = markers;
        for (const marker of markers) {
            this.#markerMap[marker.id] = marker;
        }

        $append(container,
            title,
            $hr(),
            $divHolder({ id : 'episodeMarkersContainer' },
                $h(2, 'Select markers to copy'),
                this.#getMarkerSelectionTable(),
            ),
            $br(),
            $divHolder({ id : 'moveMarkerContainer' },
                $label('Delete original markers after copying: ', 'moveDontCopy', { id : 'moveDontCopyLabel' }),
                customCheckbox(
                    { id : 'moveDontCopy', checked : this.#stickySettings.moveDontCopy() },
                    { change : this.#onMoveDontCopyChange.bind(this) })),
            $br(),
            $divHolder(
                { id : 'markerCopyResolveContainer' },
                new ConflictResolutionSelection(
                    'bulkAddApplyType',
                    'Conflict Resolution',
                    'copied',
                    this.#onApplyTypeChange.bind(this),
                    this.#stickySettings.applyType()
                ).build()
            ),
            $divHolder({ id : 'episodeSelectionContainer' },
                $h(2, `Copy ${plural(markers.length, 'marker')} to:`, { id : 'markerCopyTargetHeader' }),
                this.#getFilters(),
                this.#getEpisodeSelectionTable(episodes),
            ),
        );

        if (!Overlay.showing()) {
            // User canceled before data request completed?
            return;
        }

        // In-place replacement to avoid the transition animation.
        Overlay.replace(container);
    }

    #getMarkerSelectionTable() {
        const theseMarkers = this.#episode.markerTable().markers();
        this.#theseMarkersTable = new BulkActionTable('markerSelectionTable');
        this.#theseMarkersTable.buildTableHead('Type', TableElements.shortTimeColumn('Start'), TableElements.shortTimeColumn('End'));
        for (const marker of theseMarkers) {
            this.#theseMarkersTable.addRow(new MarkerCopySourceRow(this.#theseMarkersTable, marker, this));
        }

        return this.#theseMarkersTable.html();
    }

    #getEpisodeSelectionTable(data) {
        this.#episodeSelectionTable = new BulkActionTable('episodeSelectionTable');
        this.#episodeSelectionTable.buildTableHead('Episode', 'Title', 'Status');
        for (const episode of data) {
            if (this.#episode.metadataId !== episode.metadataId) {
                this.#episodeSelectionTable.addRow(
                    new MarkerCopyTargetRow(this.#episodeSelectionTable, episode, this.#episode.seasonIndex, this));
            }
        }

        return this.#episodeSelectionTable.html();
    }

    #onMoveDontCopyChange(event) {
        const moveDontCopy = event.target.checked;
        this.#stickySettings.setMoveDontCopy(moveDontCopy);
    }

    /**
     * Processes marker resolution type change.
     * @param {number} newType */
    #onApplyTypeChange(newType) {
        this.#stickySettings.setApplyType(newType);
        this.#episodeSelectionTable.rows().forEach(row => {
            row.update();
        });
    }

    #getFilters() {
        const availableSeasons = new Set();
        for (const episode of Object.values(this.#episodeMap)) {
            availableSeasons.add(episode.seasonIndex);
        }

        const seasonSelect = $select('markerCopySeasonSelect', this.#onSeasonFilterChange.bind(this));
        seasonSelect.appendChild($option('All Seasons', '-1'));
        for (const season of Array.from(availableSeasons).sort()) {
            const opts = season === this.#episode.seasonIndex ? { selected : true } : {};
            seasonSelect.appendChild($option(`Season ${season}`, season, opts));
        }

        const seasonSelectHolder = $divHolder(
            { id : 'markerCopySeasonFilter' },
            $label('Filter to: ', 'markerCopySeasonSelect'),
            seasonSelect
        );

        return $divHolder({ class : 'filterContainer' }, seasonSelectHolder);
    }

    #onSeasonFilterChange(event) {
        let deselected = false;
        const selectedSeason = parseInt(event.target.value);
        for (const row of this.#episodeSelectionTable.rows()) {
            const episode = this.#episodeMap[row.id];
            if (episode) {
                const shouldFilter = selectedSeason !== -1 && episode.seasonIndex !== selectedSeason;
                if (!deselected && row.filtered !== shouldFilter) {
                    // Remove the selection before updating the filter state to avoid positioning
                    // issues, and we also don't want filtered items to be selected.
                    this.#episodeSelectionTable.removeSelection();
                    deselected = true;
                }

                row.setFiltered(shouldFilter);
            }
        }
    }

    /**
     * Update all relevant state after we're told that a marker row has changed. */
    onMarkerRowChanged() {
        // Update the copy text
        const selectedCount = this.#theseMarkersTable.rows().filter(row => row.enabled && !row.filtered).length;
        $$('#markerCopyTargetHeader').textContent = `Copy ${plural(selectedCount, 'marker')} to:`;

        // Cache the markers to copy so that every episode's update() method doesn't have to recalculate it.
        this.#toCopyCached = [];
        for (const row of this.#theseMarkersTable.rows()) {
            if (row.enabled && !row.filtered) {
                this.#toCopyCached.push(this.#markerMap[row.id]);
            }
        }

        // Update the episode selection table to reflect the new markers.
        for (const row of this.#episodeSelectionTable.rows()) {
            row.update();
        }
    }

    markersToCopy() {
        return this.#toCopyCached;
    }

    applyType() { return this.#stickySettings.applyType(); }
}

class MarkerCopySourceRow extends BulkActionRow {
    /** @type {MarkerData} */
    #marker;

    /** @type {CopyMarkerOverlay} */
    #copyHandler;

    /**
     * @param {BulkActionTable} parent
     * @param {MarkerData} marker
     * @param {CopyMarkerOverlay} copyHandler */
    constructor(parent, marker, copyHandler) {
        super(parent, marker.id);
        this.#marker = marker;
        this.#copyHandler = copyHandler;
    }

    /** @returns {HTMLTableRowElement} */
    build() {
        this.buildRow(
            this.createCheckbox(true, this.#marker.id),
            this.#marker.markerType,
            TableElements.timeData(this.#marker.start),
            TableElements.timeData(this.#marker.end)
        );

        return this.row;
    }

    update() {
        this.#copyHandler.onMarkerRowChanged();
    }
}

class MarkerCopyTargetRow extends BulkActionRow {
    /** @type {EpisodeAndMarkerData} */
    #episode;

    /** @type {HTMLTableCellElement} */
    #statusCell;

    /** @type {CopyMarkerOverlay} */
    #copyHandler;

    #toCopy = new Set();
    #applyType = BulkMarkerResolveType.DryRun;

    /**
     * @param {BulkActionTable} parent
     * @param {EpisodeAndMarkerData} episode
     * @param {number} filteredSeason
     * @param {CopyMarkerOverlay} copyHandler */
    constructor(parent, episode, filteredSeason, copyHandler) {
        super(parent, episode.metadataId);
        this.#episode = episode;
        this.filtered = filteredSeason !== -1 && filteredSeason !== episode.seasonIndex;
        this.#copyHandler = copyHandler;
    }

    /** @returns {HTMLTableRowElement} */
    build() {
        this.buildRow(
            this.createCheckbox(true, this.#episode.metadataId),
            `S${pad0(this.#episode.seasonIndex, 2)}E${pad0(this.#episode.index, 2)}`,
            this.#episode.title,
            TableElements.customClassColumn('', 'markerCopyStatusCell'),
        );

        this.#statusCell = this.row.cells[3];
        this.#statusCell.setAttribute('data-state', MarkerApplyState.Unset);
        this.setFiltered(this.filtered);
        this.update();
        return this.row;
    }

    update() {
        if (this.filtered) {
            return;
        }

        // Nothing to do if we're applying the same markers, unless the apply type has changed.
        const toCopyNew = this.#copyHandler.markersToCopy();
        const applyTypeChanged = this.#applyType !== this.#copyHandler.applyType();
        if (!applyTypeChanged && this.#toCopy.size === toCopyNew.length && toCopyNew.every(marker => this.#toCopy.has(marker.id))) {
            return;
        }

        this.#toCopy.clear();
        toCopyNew.forEach(m => this.#toCopy.add(m.id));
        this.#applyType = this.#copyHandler.applyType();

        const tt = new TooltipBuilder();
        const oldState = parseInt(this.#statusCell.getAttribute('data-state'));
        let newState = MarkerApplyState.Clean;
        for (const marker of toCopyNew) {
            newState = this.#markerStatus(marker, newState, tt);
        }

        if (tt.empty()) {
            Tooltip.removeTooltip(this.#statusCell);
        } else {
            Tooltip.setTooltip(this.#statusCell, tt.get(), { textSize : -1, maxWidth : 600 });
        }

        if (!applyTypeChanged && newState === oldState) {
            // No change, and tooltip has already been updated. Nothing to do.
            return;
        }

        this.#statusCell.setAttribute('data-state', newState.toString());
        this.#setClass(newState);
    }

    /**
     * @param {MarkerData} markerToCopy
     * @param {number} currentStatus
     * @param {TooltipBuilder} tt */
    #markerStatus(markerToCopy, currentStatus, tt) {
        const markers = this.#episode.markers;
        const shortMarker = m => `[${msToHms(m.start - (m.start % 1000), true)}-${msToHms(m.end - (m.end % 1000), true)}]`;
        const overlap = m => tt.addLine(`${shortMarker(markerToCopy)} overlaps with ${shortMarker(m)}`);
        if (markerToCopy.start >= this.#episode.duration) {
            // The marker is completely off the end of the episode.
            tt.addLine(`Marker ${shortMarker(markerToCopy)} is completely off the end of the episode.`);
            return MarkerApplyState.PastEnd;
        }

        for (const marker of markers) {
            if (markerToCopy.end < marker.start) {
                // No overlap, continue.
                continue;
            }

            if (markerToCopy.end < marker.end) {
                // Overlap, but not past the end of the episode.
                currentStatus = Math.max(currentStatus, MarkerApplyState.Overlap);
                overlap(marker);
                continue;
            }

            if (markerToCopy.start < marker.end) {
                // Overlap, but might also be past the end of the episode.
                currentStatus = Math.max(currentStatus, MarkerApplyState.Overlap);
                overlap(marker);
            }

            if (markerToCopy.start >= this.#episode.duration) {
                // The marker is completely off the end of the episode.
                currentStatus = MarkerApplyState.PastEnd;
                tt.addLine(
                    `Marker [${msToHms(markerToCopy.start, true)}-${msToHms(markerToCopy.end, true)}] ` +
                    `is completely off the end of the episode.`
                );
            }
        }

        return currentStatus;
    }

    #setClass(state) {
        this.#statusCell.classList.remove('bulkActionOn', 'bulkActionSemi', 'bulkActionOff');
        this.row.classList.remove('bulkActionInactive');
        let icon = { image : '', color : '' };
        let text = '';
        switch (state) {
            case MarkerApplyState.Clean:
                this.#statusCell.classList.add('bulkActionOn');
                icon = { image : Icons.Confirm, color : ThemeColors.Green };
                text = 'No issues';
                break;
            case MarkerApplyState.Overlap:
            {
                const isFail = this.#copyHandler.applyType() === BulkMarkerResolveType.Fail;
                this.#statusCell.classList.add(isFail ? 'bulkActionOff' : 'bulkActionSemi');
                icon = { image : isFail ? Icons.Cancel : Icons.Warn, color : isFail ? ThemeColors.Red : ThemeColors.Orange };
                text = 'Overlap';

                if (this.#copyHandler.applyType() === BulkMarkerResolveType.Ignore) {
                    this.row.classList.add('bulkActionInactive');
                }
                // fallthrough
                break;
            }
            case MarkerApplyState.TooLong:
                this.#statusCell.classList.add('bulkActionSemi');
                icon = { image : Icons.Warn, color : ThemeColors.Orange };
                text = 'Too long';
                break;
            case MarkerApplyState.PastEnd:
                this.#statusCell.classList.add('bulkActionOff');
                icon = { image : Icons.Cancel, color : ThemeColors.Red };
                text = 'Past end';
                break;
        }

        $clear(this.#statusCell);
        this.#statusCell.appendChild(
            $append($span(null, { class : 'inlineIcon' }), getSvgIcon(icon.image, icon.color, { height : '1em' }), $text(text)));
    }
}

const MarkerApplyState = {
    /** @readonly The state has not been determined yet. */
    Unset : -1,
    /** @readonly The marker can be applied without issues. */
    Clean : 1,
    /** @readonly Part of the marker extends beyond the episode length. */
    TooLong : 2,
    /** @readonly The marker overlaps with at least one existing marker. */
    Overlap : 3,
    /** @readonly The marker is completely off the end of the episode without overlap. */
    PastEnd : 4,
};
