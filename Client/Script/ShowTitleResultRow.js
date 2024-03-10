import { UISection, UISections } from './ResultSections.js';
import { PlexClientState } from './PlexClientState.js';
import ShowResultRowBase from './ShowResultRowBase.js';

/** @typedef {!import('../../Shared/PlexTypes').ShowData} ShowData */

/**
 * A show result row that's used as a placeholder when a specific show/season is active.
 */
export default class ShowTitleResultRow extends ShowResultRowBase {
    /**
     * @param {ShowData} show */
    constructor(show) {
        super(show, 'topLevelResult showResult');
    }

    titleRow() { return true; }

    /**
     * Build this placeholder row. Takes the base row and adds a 'back' button. */
    buildRow() {
        if (this.html()) {
            // Extra data has already been added, and super.buildRow accounts for this, and gives us some warning logging.
            return super.buildRow();
        }

        const row = super.buildRow();
        this.addBackButton(row, 'Back to results', async () => {
            UISections.clearSections(UISection.Seasons | UISection.Episodes);
            await UISections.hideSections(UISection.Seasons | UISection.Episodes);
            UISections.showSections(UISection.MoviesOrShows);
        });

        row.classList.add('dynamicText');
        return row;
    }

    /**
     * Updates various UI states after purged markers are restored/ignored.
     * @param {PurgedShow} _unpurged */
    notifyPurgeChange(_unpurged) {
        /*async*/ PlexClientState.updateNonActiveBreakdown(this, []);
    }

    /**
     * Update marker breakdown data after a bulk update.
     * @param {{[seasonId: number]: MarkerData[]}} _changedMarkers */
    notifyBulkAction(_changedMarkers) {
        return PlexClientState.updateNonActiveBreakdown(this, []);
    }
}
