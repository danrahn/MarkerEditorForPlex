import { ResultRow } from './ResultRow.js';

import { appendChildren, buildNode, toggleVisibility } from '../Common.js';
import { FilterDialog, FilterSettings } from '../FilterDialog.js';
import { Attributes } from '../DataAttributes.js';
import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import Icons from '../Icons.js';
import { PlexClientState } from '../PlexClientState.js';
import { PurgedMarkers } from '../PurgedMarkerManager.js';
import SectionOptionsOverlay from '../SectionOptionsOverlay.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';

const Log = ContextualLog.Create('SectionOptionsRow');

/**
 * A section-wide header that is displayed no matter what the current view state is (beside the blank state).
 * Currently only contains the Filter entrypoint.
 */
export class SectionOptionsResultRow extends ResultRow {
    /** @type {HTMLElement} */
    #purgeButton;
    /** @type {HTMLElement} */
    #filterButton;
    /** @type {HTMLElement} */
    #moreOptionsButton;
    constructor() {
        super(null, 'topLevelResult sectionOptions');
    }

    /**
     * Build the section-wide header. */
    buildRow() {
        if (this.html()) {
            Log.warn(`buildRow has already been called for this SectionOptionsResultRow, that shouldn't happen!`);
            return this.html();
        }

        const titleNode = buildNode('div', { class : 'bulkActionTitle' }, 'Section Options');
        const row = buildNode('div', { class : 'sectionOptionsResultRow' }, 0, { keydown : this.onRowKeydown.bind(this) });

        this.#purgeButton = ButtonCreator.dynamicButton(
            'Purged Markers Found', Icons.Warn, ThemeColors.Orange, () => PurgedMarkers.showCurrentSection(this.#purgeButton),
            { class : 'hidden', style : 'margin-right: 10px', [Attributes.TableNav] : 'section-purges' });
        this.#checkForPurges();

        this.#filterButton = ButtonCreator.fullButton('Sort/Filter',
            Icons.Filter,
            ThemeColors.Primary,
            function (_e, self) { new FilterDialog(PlexClientState.activeSectionType()).show(self); },
            { class : 'filterBtn', style : 'margin-right: 10px', [Attributes.TableNav] : 'sort-filter' });
        Tooltip.setTooltip(this.#filterButton, 'No Active Filter'); // Need to seed the setTooltip, then use setText for everything else.
        this.updateFilterTooltip();
        if (!ClientSettings.showExtendedMarkerInfo()) {
            this.#filterButton.classList.add('hidden');
        }

        this.#moreOptionsButton = ButtonCreator.fullButton(
            'More...',
            Icons.Settings,
            ThemeColors.Primary,
            function (_e, self) { new SectionOptionsOverlay().show(self); },
            { class : 'moreSectionOptionsBtn', [Attributes.TableNav] : 'more-options' });

        appendChildren(row,
            titleNode,
            appendChildren(
                row.appendChild(buildNode('div', { class : 'goBack' })),
                this.#purgeButton,
                this.#filterButton,
                this.#moreOptionsButton));
        this.setHtml(row);
        return row;
    }

    /**
     * If extended marker statistics are enabled server-side, check if there are any
     * purged markers for this section, then update the visibility of the purge button
     * based on the result. */
    async #checkForPurges() {
        // We only grab section-wide purges when extended marker stats are enabled,
        // but we might still have section purges based on the show-level purges
        // that we gather during normal app usage.
        if (!ClientSettings.extendedMarkerStatsBlocked()) {
            await PurgedMarkers.findPurgedMarkers(true /*dryRun*/);
        }

        this.updatePurgeDisplay();
    }

    /**
     * Show/hide the 'purged markers found' button based on the number of purges found in this section. */
    updatePurgeDisplay() {
        toggleVisibility(this.#purgeButton, PurgedMarkers.getSectionPurgeCount() > 0);
    }

    /**
     * Update the filter button's style and tooltip based on whether a filter is currently active. */
    updateFilterTooltip() {
        if (FilterSettings.hasFilter()) {
            this.#filterButton.classList.add('filterActive');
            Tooltip.setText(this.#filterButton, FilterSettings.filterTooltipText());
        } else {
            this.#filterButton.classList.remove('filterActive');
            Tooltip.setText(this.#filterButton, 'No Active Filter');
        }
    }
}
