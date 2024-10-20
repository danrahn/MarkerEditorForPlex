import { $, $$, $append, $div, $divHolder, $h, $hr, $label, $option, $select, $textInput } from './HtmlHelpers.js';

import { Theme, ThemeColors } from './ThemeColors.js';
import ButtonCreator from './ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { CustomEvents } from './CustomEvents.js';
import { flashBackground } from './AnimationHelpers.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import Overlay from './Overlay.js';
import { SectionType } from '/Shared/PlexTypes.js';
import TooltipBuilder from './TooltipBuilder.js';

/** @typedef {!import('/Shared/MarkerBreakdown').MarkerBreakdownMap} MarkerBreakdownMap */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */

const Log = ContextualLog.Create('SortFilter');

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
    /**@readonly*/ AdMarkerCount : 4,
};

/** @enum */
const SortConditionText = {
    [SortConditions.Alphabetical] : 'title',
    [SortConditions.MarkerCount] : 'total markers',
    [SortConditions.IntroMarkerCount] : 'intro markers',
    [SortConditions.CreditsMarkerCount] : 'credits markers',
    [SortConditions.AdMarkerCount] : 'ad markers',
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
    /**@readonly*/ static adLimit = -1;
    /**@readonly*/ static adCondition = 0;
    /**@readonly*/ static sortBy = SortConditions.Alphabetical;
    /**@readonly*/ static sortOrder = 0;

    /**
     * @param {MarkerBreakdown} breakdown */
    static shouldFilter(breakdown) {
        return FilterSettings.hasFilter()
            && (
                FilterSettings.#shouldFilterCore(
                    breakdown.introBuckets(), FilterSettings.introLimit, FilterSettings.introCondition)
                || FilterSettings.#shouldFilterCore(
                    breakdown.creditsBuckets(), FilterSettings.creditsLimit, FilterSettings.creditsCondition)
                || FilterSettings.#shouldFilterCore(
                    breakdown.adBuckets(), FilterSettings.adLimit, FilterSettings.adCondition));
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
        FilterSettings.adLimit = -1;
    }

    /**
     * Returns whether a global filter is active. */
    static hasFilter() {
        return FilterSettings.introLimit !== -1
        || FilterSettings.creditsLimit !== -1
        || FilterSettings.adLimit !== -1
        || !FilterSettings.isDefaultSort();
    }

    /**
     * Returns a tooltip text that describes the current filter. */
    static filterTooltipText() {
        const tt = new TooltipBuilder();
        if (FilterSettings.introLimit !== -1) {
            tt.addLine(`Intro count ${FilterConditionText[FilterSettings.introCondition]} ${FilterSettings.introLimit}`);
        }

        if (FilterSettings.creditsLimit !== -1) {
            tt.addLine(`Credits count ${FilterConditionText[FilterSettings.creditsCondition]} ${FilterSettings.creditsLimit}`);
        }

        if (FilterSettings.adLimit !== -1) {
            tt.addLine(`Ad count ${FilterConditionText[FilterSettings.adCondition]} ${FilterSettings.adLimit}`);
        }

        if (!FilterSettings.isDefaultSort()) {
            tt.addLine(`Sorted by ${SortConditionText[FilterSettings.sortBy]} (${SortOrderText[FilterSettings.sortOrder]})`);
        }

        return tt.get();
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
            case SortConditions.AdMarkerCount:
                return percentageSort ? 'itemsWithAds' : 'totalAds';
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
    /** @type {HTMLElement} */
    #adFilter;
    /** @type {number} */
    #libType = -1;

    constructor(activeSectionType) {
        this.#libType = activeSectionType;
        const containerName = 'settingsContainer'; // 'sortFilterDialog'
        const container = $div({ class : `${containerName} filterDialogContainer` });

        const buildSelect = (text, selected) => {
            const sel = $select(`${text}MarkerFilterType`, null, { class : 'filterSelect' });
            $append(sel,
                $option('<', FilterConditions.LessThan),
                $option('=', FilterConditions.Equals),
                $option('>', FilterConditions.GreaterThan));
            sel.value = selected;
            return sel;
        };

        const filterRow = (text, selected, inputValue) =>
            $divHolder({ class : 'formInput' },
                $label(`${text} markers `, { for : `${text}MarkerFilterType` }),
                $divHolder({ class : 'filterMultiInput' },
                    buildSelect(text, selected),
                    $textInput(
                        { placeholder : '#', id : `${text}MarkerFilterValue`, class : 'filterNumberInput', value : inputValue },
                        { keydown : this.#onTextInput.bind(this) }
                    )
                )
            );

        const introLimit = FilterSettings.introLimit === -1 ? '' : FilterSettings.introLimit;
        const introCondition = introLimit === '' ? FilterConditions.Equals : FilterSettings.introCondition;
        this.#introFilter = filterRow('Intro', introCondition, introLimit);

        const creditsLimit = FilterSettings.creditsLimit === -1 ? '' : FilterSettings.creditsLimit;
        const creditsCondition = creditsLimit === '' ? FilterConditions.Equals : FilterSettings.creditsCondition;
        this.#creditsFilter = filterRow('Credits', creditsCondition, creditsLimit);

        const adLimit = FilterSettings.adLimit === -1 ? '' : FilterSettings.adLimit;
        const adCondition = adLimit === '' ? FilterConditions.Equals : FilterSettings.adCondition;
        this.#adFilter = filterRow('Ad', adCondition, adLimit);

        $append(container,
            $h(2, 'Sort and Filter'),
            $hr(),
            $divHolder({ style : 'padding: 20px' },
                $h(3, 'Filter'),
                $hr(),
                this.#introFilter,
                this.#creditsFilter,
                this.#adFilter,
                $hr(),
            ),
            this.#sortOptions()
        );

        $append(container.appendChild($div({ class : 'formInput flexKeepRight' })),
            $divHolder({ class : 'settingsButtons' },
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
        const sortBy = $divHolder({ class : 'formInput' },
            $label('Sort By', 'sortBy'),
            $divHolder({ class : 'filterMultiInput' },
                $append($select('sortBy', this.#onSortByChanged.bind(this), { class : 'filterSelect' }),
                    $option('Alphabetical', SortConditions.Alphabetical),
                    $option('Marker Count', SortConditions.MarkerCount),
                    $option('Intro Marker Count', SortConditions.IntroMarkerCount),
                    $option('Credits Marker Count', SortConditions.CreditsMarkerCount),
                    $option('Ad Marker Count', SortConditions.AdMarkerCount),
                )
            )
        );

        $$('select', sortBy).value = FilterSettings.sortBy;

        const optStr = FilterSettings.sortBy === SortConditions.Alphabetical ? [ 'A-Z', 'Z-A'] : ['Low to High', 'High to Low'];
        const options = [
            $option(optStr[0], SortOrder.Ascending, { id : 'sortAsc' }),
            $option(optStr[1], SortOrder.Descending, { id : 'sortDesc' })
        ];

        if (FilterSettings.sortBy !== SortConditions.Alphabetical && this.#libType === SectionType.TV) {
            options.push(...this.#percentageSortOptions());
        }

        const sortOrder = $divHolder({ class : 'formInput' },
            $label('From', 'sortOrder'),
            $divHolder({ class : 'filterMultiInput' },
                $append($select('sortOrder', null, { class : 'filterSelect' }),
                    ...options
                )
            )
        );

        $$('select', sortOrder).value = FilterSettings.sortOrder;

        return $divHolder({ style : 'padding: 0 20px 20px 20px' },
            $h(3, 'Sort'),
            $hr(),
            sortBy,
            sortOrder,
            $hr()
        );
    }

    /**
     * Additional percentage-based sort order options when sorting by marker stats. */
    #percentageSortOptions() {
        return [
            $option('Low to High (%)', SortOrder.AscendingPercentage, { id : 'sortAscP' }),
            $option('High to Low (%)', SortOrder.DescendingPercentage, { id : 'sortDescP' }),
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
                $append(so, ...this.#percentageSortOptions());
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
        const markerFilters = [
            {
                filter : this.#introFilter,
                setLimit : (l) => FilterSettings.introLimit = l,
                setCondition : (c) => FilterSettings.introCondition = c
            },
            {
                filter : this.#creditsFilter,
                setLimit : (l) => FilterSettings.creditsLimit = l,
                setCondition : (c) => FilterSettings.creditsCondition = c
            },
            {
                filter : this.#adFilter,
                setLimit : (l) => FilterSettings.adLimit = l,
                setCondition : (c) => FilterSettings.adCondition = c
            },
        ];

        for (const markerFilter of markerFilters) {
            const text = $$('input[type=text]', markerFilter.filter);
            const count = parseInt(text.value);
            const condition = parseInt($$('select', markerFilter.filter).value);
            markerFilter.setCondition(condition);
            if (text.value.length === 0) {
                markerFilter.setLimit(-1);
                continue;
            }

            if (isNaN(count) || count === 0 && condition === FilterConditions.LessThan) {
                this.#flashInput(text);
                return;
            }

            markerFilter.setLimit(count);
        }

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
