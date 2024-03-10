import { SeasonResultRowBase } from './SeasonResultRowBase.js';

import { UISection, UISections } from '../ResultSections.js';

export class SeasonTitleResultRow extends SeasonResultRowBase {

    /** @param {SeasonData} season */
    constructor(season) {
        super(season, 'seasonResult');
    }

    titleRow() { return true; }

    /**
     * Build this placeholder row. Take the bases row and adds a 'back' button */
    buildRow() {
        if (this.html()) {
            // Extra data has already been added, and super.buildRow accounts for this, and gives us some warning logging.
            return super.buildRow();
        }

        const row = super.buildRow();
        this.addBackButton(row, 'Back to seasons', async () => {
            await UISections.hideSections(UISection.Episodes);
            UISections.clearSections(UISection.Episodes);
            UISections.showSections(UISection.Seasons);
        });

        row.classList.add('dynamicText');
        return row;
    }
}
