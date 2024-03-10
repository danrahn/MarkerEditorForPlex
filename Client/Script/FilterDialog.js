import { $, $$, appendChildren, buildNode } from './Common.js';

import { Theme, ThemeColors } from './ThemeColors.js';
import ButtonCreator from './ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { CustomEvents } from './CustomEvents.js';
import { flashBackground } from './AnimationHelpers.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import Overlay from './Overlay.js';
import { SectionType } from '/Shared/PlexTypes.js';

/** @typedef {!import('/Shared/MarkerBreakdown').MarkerBreakdownMap} MarkerBreakdownMap */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */

const Log = new ContextualLog('SortFilter');

/**
 * TODO: BETWEEN and percentage-based for TV shows (something like >90% && <100% could be helpful)
 * @enum */
const FilterConditions = {
    /**@readonly*/ LessThan : 0,
    /**@readonly*/ Equals : 1,
    /**@readonly*/ GreaterThan : 2,
};

/**
 * Strings used to describe each filter condition.
 * @enum */
const FilterConditionText = {
    [FilterConditions.LessThan] : 'is less than',
    [FilterConditions.Equals] : 'is',
    [FilterConditions.GreaterThan] : 'is greater than',
};

/** @enum */
const SortConditions = {
    /**@readonly*/ Alphabetical : 0,
    /**@readonly*/ MarkerCount : 1,
    /**@readonly*/ IntroMarkerCount : 2,
    /**@readonly*/ CreditsMarkerCount : 3,
};

/** @enum */
const SortConditionText = {
    [SortConditions.Alphabetical] : 'title',
    [SortConditions.MarkerCount] : 'total markers',
    [SortConditions.IntroMarkerCount] : 'intro markers',
    [SortConditions.CreditsMarkerCount] : 'credits markers',
};

/** @enum */
const SortOrder = {
    /**@readonly*/ Ascending : 0,
    /**@readonly*/ Descending : 1,
    /**@readonly*/ AscendingPercentage : 2,
    /**@readonly*/ DescendingPercentage : 3,
    /**@readonly*/ asc : (so) => so === SortOrder.Ascending || so === SortOrder.AscendingPercentage,
    /**@readonly*/ desc : (so) => !SortOrder.asc(so),
    /**@readonly*/ percentage : (so => so > SortOrder.Descending),
};

/** @enum */
const SortOrderText = {
    [SortOrder.Ascending] : 'ascending',
    [SortOrder.Descending] : 'descending',
    [SortOrder.AscendingPercentage] : 'ascending (%)',
    [SortOrder.DescendingPercentage] : 'descending (%)',
};

/**
 * Static class that holds the current global filter state, as well as helper methods
 * to determine whether a given media item is caught in said filter state.
 */
class FilterSettings {
    // Fields are readonly as far as external consumers are concerned

    /**@readonly*/ static introLimit = -1;
    /**@readonly*/ static introCondition = 0;
    /**@readonly*/ static creditsLimit = -1;
    /**@readonly*/ static creditsCondition = 0;
    /**@readonly*/ static sortBy = SortConditions.Alphabetical;
    /**@readonly*/ static sortOrder = 0;

    /**
     * @param {MarkerBreakdown} breakdown */
    static shouldFilter(breakdown) {
        return FilterSettings.hasFilter()
            && (FilterSettings.#shouldFilterCore(breakdown.introBuckets(), FilterSettings.introLimit, FilterSettings.introCondition)
                || FilterSettings.#shouldFilterCore(
                    breakdown.creditsBuckets(), FilterSettings.creditsLimit, FilterSettings.creditsCondition));
    }

    /**
     * Determine if the array of markers meets the filter criteria.
     * TODO: If episodes have a MarkerBreakdown attached, they can go through the regular shouldFilter. But
     *       a full MarkerBreakdown for a single episode (or movie for that matter) is a bit overkill, so
     *       I'm not sure if that's better than just having a separate method here for that.
     * @param {MarkerData[]} markers */
    static shouldFilterEpisode(markers) {
        if (!FilterSettings.hasFilter()) {
            return false;
        }

        // Just build a temporary breakdown and test that.
        const breakdown = new MarkerBreakdown();
        breakdown.initBase();
        const markerKey = markers.reduce((acc, m) => acc + MarkerBreakdown.deltaFromType(1, m.markerType), 0);
        breakdown.delta(0, markerKey);
        return FilterSettings.shouldFilter(breakdown);
    }

    /**
     * Clear any active filter */
    static resetFilter() {
        FilterSettings.introLimit = -1;
        FilterSettings.creditsLimit = -1;
    }

    /**
     * Returns whether a global filter is active. */
    static hasFilter() {
        return FilterSettings.introLimit !== -1 || FilterSettings.creditsLimit !== -1 || !FilterSettings.isDefaultSort();
    }

    /**
     * Returns a tooltip text that describes the current filter. */
    static filterTooltipText() {
        let text = '';
        if (FilterSettings.introLimit !== -1) {
            text += `Intro count ${FilterConditionText[FilterSettings.introCondition]} ${FilterSettings.introLimit}`;
        }

        if (FilterSettings.creditsLimit !== -1) {
            if (text.length !== 0) { text += '<br>'; }

            text += `Credits count ${FilterConditionText[FilterSettings.creditsCondition]} ${FilterSettings.creditsLimit}`;
        }

        if (!FilterSettings.isDefaultSort()) {
            if (text.length !== 0) { text += '<br>'; }

            text += `Sorted by ${SortConditionText[FilterSettings.sortBy]} (${SortOrderText[FilterSettings.sortOrder]})`;
        }

        return text;
    }

    static isDefaultSort() {
        return FilterSettings.sortBy === SortConditions.Alphabetical && FilterSettings.sortOrder === SortOrder.Ascending;
    }

    static resetSort() {
        FilterSettings.sortBy = SortConditions.Alphabetical;
        FilterSettings.sortOrder = SortOrder.Ascending;
    }

    static sortBreakdownMethod() {
        const percentageSort = SortOrder.percentage(FilterSettings.sortOrder);
        switch (FilterSettings.sortBy) {
            case SortConditions.MarkerCount:
                return percentageSort ? 'itemsWithMarkers' : 'totalMarkers';
            case SortConditions.IntroMarkerCount:
                return percentageSort ? 'itemsWithIntros' : 'totalIntros';
            case SortConditions.CreditsMarkerCount:
                return percentageSort ? 'itemsWithCredits' : 'totalCredits';
            default:
                Log.warn(`sortBreakdownMethod should only be called with marker-based sort conditions.`);
                return 'totalMarkers';
        }
    }

    /**
     * @param {MarkerBreakdownMap} markerCounts
     * @param {number} markerLimit
     * @param {number} markerCondition */
    static #shouldFilterCore(markerCounts, markerLimit, markerCondition) {
        if (markerLimit < 0) {
            return false;
        }

        /* eslint-disable padding-line-between-statements */
        switch (markerCondition) {
            case FilterConditions.LessThan:
                for (const bucket of Object.keys(markerCounts)) { if (+bucket < markerLimit) { return false; } }
                return true;
            case FilterConditions.Equals:
                for (const bucket of Object.keys(markerCounts)) { if (+bucket === markerLimit) { return false; } }
                return true;
            case FilterConditions.GreaterThan:
                for (const bucket of Object.keys(markerCounts)) { if (+bucket > markerLimit) { return false; } }
                return true;
            default:
                return false; // Default to not filtering it
        }
        /* eslint-enable */
    }
}

/**
 * UI that allows the user to (re)set the current global filter */
class FilterDialog {
    /** @type {HTMLElement} */
    #html;
    /** @type {HTMLElement} */
    #introFilter;
    /** @type {HTMLElement} */
    #creditsFilter;
    /** @type {number} */
    #libType = -1;

    constructor(activeSectionType) {
        this.#libType = activeSectionType;
        const containerName = 'settingsContainer'; // 'sortFilterDialog'
        const container = buildNode('div', { id : containerName, class : 'filterDialogContainer' });

        const buildSelect = (text, selected) => {
            const sel = buildNode('select', { id : `${text}MarkerFilterType`, class : 'filterSelect' });
            appendChildren(sel,
                buildNode('option', { value : FilterConditions.LessThan }, '<'),
                buildNode('option', { value : FilterConditions.Equals }, '='),
                buildNode('option', { value : FilterConditions.GreaterThan }, '>'));
            sel.value = selected;
            return sel;
        };

        const filterRow = (text, selected, inputValue) =>
            appendChildren(buildNode('div', { class : 'formInput' }),
                buildNode('label', { for : `${text}MarkerFilterType` }, `${text} markers `),
                appendChildren(buildNode('div', { class : 'filterMultiInput' }),
                    buildSelect(text, selected),
                    buildNode('input', {
                        type : 'text',
                        placeholder : '#',
                        id : `${text}MarkerFilterValue`,
                        class : 'filterNumberInput',
                        value : inputValue
                    }, 0, { keydown : this.#onTextInput.bind(this) })));

        const introLimit = FilterSettings.introLimit === -1 ? '' : FilterSettings.introLimit;
        const introCondition = introLimit === '' ? FilterConditions.Equals : FilterSettings.introCondition;
        this.#introFilter = filterRow('Intro', introCondition, introLimit);

        const creditsLimit = FilterSettings.creditsLimit === -1 ? '' : FilterSettings.creditsLimit;
        const creditsCondition = creditsLimit === '' ? FilterConditions.Equals : FilterSettings.creditsCondition;
        this.#creditsFilter = filterRow('Credits', creditsCondition, creditsLimit);

        appendChildren(container,
            buildNode('h2', {}, 'Sort and Filter'),
            buildNode('hr'),
            appendChildren(buildNode('div', { style : 'padding: 20px' }),
                buildNode('h3', {}, 'Filter'),
                buildNode('hr'),
                this.#introFilter,
                this.#creditsFilter,
                buildNode('hr')
            ),
            this.#sortOptions()
        );

        appendChildren(container.appendChild(buildNode('div', { class : 'formInput' })),
            appendChildren(buildNode('div', { class : 'settingsButtons' }),
                ButtonCreator.textButton('Apply', this.#applyFilter.bind(this), { class : 'greenOnHover' }),
                ButtonCreator.textButton('Reset', this.#resetFilter.bind(this), { id : 'resetFilter', class : 'yellowOnHover' }),
                ButtonCreator.textButton('Cancel', Overlay.dismiss, { class : 'redOnHover' })
            )
        );

        this.#html = container;
    }

    /**
     * Build the sort section of the dialog (sort by X, sort direction) */
    #sortOptions() {
        const sortBy = appendChildren(buildNode('div', { class : 'formInput' }),
            buildNode('label', { for : 'sortBy' }, 'Sort By'),
            appendChildren(buildNode('div', { class : 'filterMultiInput' }),
                appendChildren(
                    buildNode(
                        'select',
                        { id : 'sortBy', class : 'filterSelect' },
                        0,
                        { change : this.#onSortByChanged.bind(this) }),
                    buildNode('option', { value : SortConditions.Alphabetical }, 'Alphabetical'),
                    buildNode('option', { value : SortConditions.MarkerCount }, 'Marker Count'),
                    buildNode('option', { value : SortConditions.IntroMarkerCount }, 'Intro Marker Count'),
                    buildNode('option', { value : SortConditions.CreditsMarkerCount }, 'Credits Marker Count')
                )
            )
        );

        $$('select', sortBy).value = FilterSettings.sortBy;

        const optStr = FilterSettings.sortBy === SortConditions.Alphabetical ? [ 'A-Z', 'Z-A'] : ['Low to High', 'High to Low'];
        const options = [
            buildNode('option', { value : SortOrder.Ascending, id : 'sortAsc' }, optStr[0]),
            buildNode('option', { value : SortOrder.Descending, id : 'sortDesc' }, optStr[1])
        ];

        if (FilterSettings.sortBy !== SortConditions.Alphabetical && this.#libType === SectionType.TV) {
            options.push(...this.#percentageSortOptions());
        }

        const sortOrder = appendChildren(buildNode('div', { class : 'formInput' }),
            buildNode('label', { for : 'sortOrder' }, 'From'),
            appendChildren(buildNode('div', { class : 'filterMultiInput' }),
                appendChildren(buildNode('select', { id : 'sortOrder', class : 'filterSelect' }),
                    ...options
                )
            )
        );

        $$('select', sortOrder).value = FilterSettings.sortOrder;

        return appendChildren(buildNode('div', { style : 'padding: 0 20px 20px 20px' }),
            buildNode('h3', {}, 'Sort'),
            buildNode('hr'),
            sortBy,
            sortOrder,
            buildNode('hr')
        );
    }

    /**
     * Additional percentage-based sort order options when sorting by marker stats. */
    #percentageSortOptions() {
        return [
            buildNode('option', { value : SortOrder.AscendingPercentage, id : 'sortAscP' }, 'Low to High (%)'),
            buildNode('option', { value : SortOrder.DescendingPercentage, id : 'sortDescP' }, 'High to Low (%)'),
        ];
    }

    /**
     * Update possible sort order options when the sort by field changes. */
    #onSortByChanged() {
        const sortBy = parseInt($('#sortBy').value);
        const alpha = sortBy === SortConditions.Alphabetical;
        const hasPercentageSorts = !!$('#sortAscP');

        const so = $('#sortOrder');
        if (alpha) {
            if (parseInt(so.value) === SortOrder.DescendingPercentage) {
                so.value = SortOrder.Descending;
            }

            $('#sortAsc').innerText = 'A-Z';
            $('#sortDesc').innerText = 'Z-A';
            if (hasPercentageSorts) {
                so.removeChild($('#sortAscP'));
                so.removeChild($('#sortDescP'));
            }
        } else {
            $('#sortAsc').innerText = 'Low to High';
            $('#sortDesc').innerText = 'High to Low';
            if (!hasPercentageSorts && this.#libType === SectionType.TV) {
                appendChildren(so, ...this.#percentageSortOptions());
            }
        }
    }

    /**
     * Show the filter dialog.
     * @param {HTMLElement} owner */
    show(owner) {
        // Copy from settings.
        Overlay.build({
            dismissible : true,
            centered : false,
            noborder : true,
            setup : { fn : () => $('#IntroMarkerFilterValue').focus() },
            focusBack : owner
        }, this.#html);
    }

    /**
     * Prevent non-digit input
     * @param {KeyboardEvent} e */
    #onTextInput(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            this.#applyFilter();
            return;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !/^\d$/.test(e.key)) {
            e.preventDefault();
        }
    }

    /**
     * Flash the background of the given element.
     * @param {HTMLElement} input */
    #flashInput(input) {
        return flashBackground(input, Theme.getHex(ThemeColors.Red, 8), 1000);
    }

    /**
     * Validates the given filter, and signals the UI of a change if everything is valid. */
    #applyFilter() {
        const introText = $$('input[type=text]', this.#introFilter);
        const  introCount = parseInt(introText.value);
        const introCondition = parseInt($$('select', this.#introFilter).value);
        if (introText.value.length === 0) {
            FilterSettings.introLimit = -1;
        } else {
            if (isNaN(introCount) || introCount === 0 && introCondition === FilterConditions.LessThan) {
                this.#flashInput(introText);
                return;
            }

            FilterSettings.introLimit = introCount;
        }

        FilterSettings.introCondition = introCondition;

        // Can this be shared with above?
        const creditsText = $$('input[type=text]', this.#creditsFilter);
        const creditsCount = parseInt(creditsText.value);
        const creditsCondition = parseInt($$('select', this.#creditsFilter).value);
        if (creditsText.value.length === 0) {
            FilterSettings.creditsLimit = -1;
        } else {
            if (isNaN(creditsCount) || creditsCount === 0 && creditsCondition === FilterConditions.LessThan) {
                this.#flashInput(creditsText);
                return;
            }

            FilterSettings.creditsLimit = creditsCount;
        }

        FilterSettings.creditsCondition = creditsCondition;

        FilterSettings.sortBy = parseInt($('#sortBy').value);
        FilterSettings.sortOrder = parseInt($('#sortOrder').value);
        Overlay.dismiss();
        window.dispatchEvent(new Event(CustomEvents.MarkerFilterApplied));
    }

    /**
     * Clear any existing filter. */
    #resetFilter() {
        FilterSettings.resetFilter();
        FilterSettings.resetSort();
        Overlay.dismiss();
        window.dispatchEvent(new Event(CustomEvents.MarkerFilterApplied));
    }
}

export { FilterDialog, FilterSettings, SortConditions, SortOrder };
