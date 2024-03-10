import { ResultRow } from './ResultRow.js';

import { appendChildren, buildNode } from '../Common.js';
import { FilterDialog, FilterSettings } from '../FilterDialog.js';
import ButtonCreator from '../ButtonCreator.js';
import { ClientSettings } from '../ClientSettings.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import Icons from '../Icons.js';
import { PlexClientState } from '../PlexClientState.js';
import SectionOptionsOverlay from '../SectionOptionsOverlay.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';

const Log = new ContextualLog('SectionOptionsRow');

/**
 * A section-wide header that is displayed no matter what the current view state is (beside the blank state).
 * Currently only contains the Filter entrypoint.
 */
export class SectionOptionsResultRow extends ResultRow {
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

        if (!ClientSettings.showExtendedMarkerInfo()) {
            Log.error(`SectionOptionsResultRow requires extended marker info`);
            return buildNode('div');
        }

        const titleNode = buildNode('div', { class : 'bulkActionTitle' }, 'Section Options');
        const row = buildNode('div', { class : 'sectionOptionsResultRow' });
        this.#filterButton = ButtonCreator.fullButton('Sort/Filter',
            Icons.Filter,
            ThemeColors.Primary,
            function (_e, self) { new FilterDialog(PlexClientState.activeSectionType()).show(self); },
            { class : 'filterBtn', style : 'margin-right: 10px' });
        Tooltip.setTooltip(this.#filterButton, 'No Active Filter'); // Need to seed the setTooltip, then use setText for everything else.
        this.updateFilterTooltip();

        this.#moreOptionsButton = ButtonCreator.fullButton(
            'More...',
            Icons.Settings,
            ThemeColors.Primary,
            function (_e, self) { new SectionOptionsOverlay().show(self); },
            { class : 'moreSectionOptionsBtn' });

        appendChildren(row,
            titleNode,
            appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
                this.#filterButton,
                this.#moreOptionsButton));
        this.setHtml(row);
        return row;
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
