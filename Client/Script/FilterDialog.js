import MarkerBreakdown from '../../Shared/MarkerBreakdown.js';
import ButtonCreator from './ButtonCreator.js';
import { $$, appendChildren, buildNode } from './Common.js';
import Animation from './inc/Animate.js';
import Overlay from './inc/Overlay.js';
import { PlexUI } from './PlexUI.js';
import ThemeColors from './ThemeColors.js';

/** @typedef {!import('../../Shared/PlexTypes.js').MarkerData} MarkerData */
/** @typedef {!import('../../Shared/PlexTypes.js').MarkerBreakdownMap} MarkerBreakdownMap */

/**
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
    [FilterConditions.LessThan] : ' is less than ',
    [FilterConditions.Equals] : ' is ',
    [FilterConditions.GreaterThan] : ' is greater than ',
}

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

    /**
     * @param {MarkerBreakdown} breakdown */
    static shouldFilter(breakdown) {
        return FilterSettings.hasFilter() &&
            (FilterSettings.#shouldFilterCore(breakdown.introBuckets(), FilterSettings.introLimit, FilterSettings.introCondition)
            || FilterSettings.#shouldFilterCore(breakdown.creditsBuckets(), FilterSettings.creditsLimit, FilterSettings.creditsCondition));
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
        let markerKey = 0;
        for (const marker of markers) {
            markerKey += MarkerBreakdown.deltaFromType(1, marker.markerType);
        }

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
        return FilterSettings.introLimit != -1 || FilterSettings.creditsLimit != -1;
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

        return text;
    }

    /**
     * @param {MarkerBreakdownMap} markerCounts 
     * @param {number} markerLimit
     * @param {number} markerCondition */
    static #shouldFilterCore(markerCounts, markerLimit, markerCondition) {
        if (markerLimit < 0) {
            return false;
        }

        switch (markerCondition) {
            case FilterConditions.LessThan:
                for (const bucket of Object.keys(markerCounts)) { if (bucket < markerLimit) { return false; } }
                return true;
            case FilterConditions.Equals:
                for (const bucket of Object.keys(markerCounts)) { if (bucket == markerLimit) { return false; } }
                return true;
            case FilterConditions.GreaterThan:
                for (const bucket of Object.keys(markerCounts)) { if (bucket > markerLimit) { return false; } }
                return true;
            default:
                return false; // Default to not filtering it
        }
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

    constructor() {
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
        }
        const filterRow = (text, selected, inputValue) => {
            return appendChildren(buildNode('div', { class : 'formInput' }),
                buildNode('label', { for : `${text}MarkerFilterType` }, `${text} markers `),
                buildNode('input', {
                    type : 'text',
                    placeholder : '#',
                    id : `${text}MarkerFilterValue`,
                    class : 'filterNumberInput',
                    value : inputValue
                }, 0, { keydown : this.#onTextInput.bind(this) }),
                buildSelect(text, selected));
        };

        const introLimit = FilterSettings.introLimit == -1 ? '' : FilterSettings.introLimit;
        const introCondition = introLimit === '' ? FilterConditions.Equals : FilterSettings.introCondition;
        this.#introFilter = filterRow('Intro', introCondition, introLimit);

        
        const creditsLimit = FilterSettings.creditsLimit == -1 ? '' : FilterSettings.creditsLimit;
        const creditsCondition = creditsLimit === '' ? FilterConditions.Equals : FilterSettings.creditsCondition;
        this.#creditsFilter = filterRow('Credits', creditsCondition, creditsLimit);

        appendChildren(container,
            buildNode('h2', {}, 'Filter'),
            buildNode('hr'),
            this.#introFilter,
            this.#creditsFilter,
            buildNode('hr'))
        
        appendChildren(container.appendChild(buildNode('div', { class : 'formInput' })),
            appendChildren(buildNode('div', { class : 'settingsButtons' }),
                ButtonCreator.textButton('Apply', this.#applyFilter.bind(this), { class : 'confirmSetting' }),
                ButtonCreator.textButton('Reset', this.#resetFilter.bind(this), { id : 'resetFilter' }),
                ButtonCreator.textButton('Cancel', Overlay.dismiss, { class : 'cancelSetting' })
            )
        );

        this.#html = container;
    }
    
    /**
     * Show the filter dialog. */
    show() {
        // Copy from settings.
        Overlay.build({ dismissible: true, centered: false, noborder: true }, this.#html);
    }

    /**
     * Prevent non-digit input
     * @param {KeyboardEvent} e */
    #onTextInput(e) {
        if (e.key == 'Enter' && e.ctrlKey) {
            this.#applyFilter();
            return;
        }

        if (e.key.length == 1 && !e.ctrlKey && !e.altKey && !/^\d$/.test(e.key)) {
            e.preventDefault();
        }
    }

    /**
     * Flash the background of the given element.
     * @param {HTMLElement} input */
    #flashInput(input) {
        Animation.queue({ backgroundColor: `#${ThemeColors.get('red')}8` }, input, 500);
        return new Promise((resolve, _) => {
            Animation.queueDelayed({ backgroundColor : 'transparent' }, input, 500, 500, true, resolve);
        });
    }

    /**
     * Validates the given filter, and signals the UI of a change if everything is valid. */
    #applyFilter() {
        const introText = $$('input[type=text]', this.#introFilter);
        const  introCount = parseInt(introText.value);
        const introCondition = parseInt($$('select', this.#introFilter).value);
        if (introText.value.length == 0) {
            FilterSettings.introLimit = -1;
        } else {
            if (isNaN(introCount) || introCount === 0 && introCondition == FilterConditions.LessThan) {
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
        if (creditsText.value.length == 0) {
            FilterSettings.creditsLimit = -1;
        } else {
            if (isNaN(creditsCount) || creditsCount === 0 && creditsCondition == FilterConditions.LessThan) {
                this.#flashInput(creditsText);
                return;
            }

            FilterSettings.creditsLimit = creditsCount;
        }
        
        FilterSettings.creditsCondition = creditsCondition;
        PlexUI.Get().onFilterApplied();
        Overlay.dismiss();
    }

    /**
     * Clear any existing filter. */
    #resetFilter() {
        FilterSettings.resetFilter();
        PlexUI.Get().onFilterApplied();
        Overlay.dismiss();
    }
}

export { FilterDialog, FilterSettings };
