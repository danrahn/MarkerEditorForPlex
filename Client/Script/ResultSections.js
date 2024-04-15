import { $, $$, clearEle } from './Common.js';
import { animateOpacity } from './AnimationHelpers.js';
import { BaseLog } from '/Shared/ConsoleLog.js';
import { CustomEvents } from './CustomEvents.js';
import { PlexClientState } from './PlexClientState.js';

/**
 * The result sections of the application.
 * Can be bitwise-or'd and -and'd to pass in multiple
 * sections at once to relevant methods.
 * @enum {number} */
export const UISection = {
    /** @readonly Top-level section, i.e. movies or shows. */
    MoviesOrShows : 1,
    /** @readonly */
    Seasons : 2,
    /** @readonly */
    Episodes : 4
};

/**
 * The singleton result section manager.
 * @type {ResultSections}
 * @readonly */ // Externally readonly
let Instance;

class ResultSections {
    /**
     * Initialize the singleton ResultSections instance. */
    static CreateInstance() {
        if (Instance) {
            BaseLog.error(`We should only have a single ResultSections instance!`);
            return;
        }

        Instance = new ResultSections();
    }

    /**
     * The three result sections: shows, seasons, and episodes.
     * @type {{[group: number]: HTMLElement}} */
    #uiSections = {
        [UISection.MoviesOrShows] : $('#toplevellist'),
        [UISection.Seasons]       : $('#seasonlist'),
        [UISection.Episodes]      : $('#episodelist')
    };

    constructor() {
        // Nothing to do
    }

    /**
     * Return whether the given UI section is currently visible.
     * @param {UISection} section */
    sectionVisible(section) {
        return !this.#uiSections[section].classList.contains('hidden');
    }

    /**
     * Retrieve the HTML element for the given section.
     * @param {UISection} section */
    getSection(section) {
        return this.#uiSections[section];
    }

    /**
     * Add a row to the given UI section.
     * @param {UISection} uiSection
     * @param {HTMLElement} row */
    addRow(uiSection, row) {
        this.#uiSections[uiSection].appendChild(row);
    }

    /** Clears data from the show, season, and episode lists. */
    clearAllSections() {
        this.clearAndShowSections(UISection.MoviesOrShows | UISection.Seasons | UISection.Episodes);
        PlexClientState.clearActiveShow();
    }

    /**
     * Clear out all child elements from the specified UI sections
     * @param {UISection} uiSection */
    clearSections(uiSection) {
        this.#sectionOperation(uiSection, ele => {
            clearEle(ele);
        });
    }

    /**
     * Ensure the given section(s) are visible.
     * Despite supporting multiple sections, this should really only ever
     * be called with a single section.
     * @param {UISection} uiSection */
    showSections(uiSection) {
        const promises = [];
        this.#sectionOperation(uiSection, ele => {
            const isHidden = ele.classList.contains('hidden');
            ele.classList.remove('hidden');
            if (isHidden) {
                ele.style.opacity = 0;
                ele.style.height = 0;
                promises.push(animateOpacity(ele, 0, 1, { noReset : true, duration : 100 }, () => {
                    if (document.activeElement?.id !== 'search') {
                        $$('.tabbableRow', ele)?.focus();
                    }
                }));
            }
        });

        return Promise.all(promises);
    }

    /**
     * Hide all sections indicated by uiSection
     * @param {UISection} uiSection */
    hideSections(uiSection) {
        /** @type {Promise<void>[]} */
        const promises = [];
        this.#sectionOperation(uiSection, ele => {
            if (ele.classList.contains('hidden')) {
                promises.push(Promise.resolve());
            } else {
                promises.push(animateOpacity(ele, 1, 0, 100, () => { ele.classList.add('hidden'); }));
            }
        });

        return Promise.all(promises);
    }

    /**
     * Clear the given result group of any elements and ensure it's not hidden.
     * @param {number} uiSections The group(s) to clear and unhide. */
    clearAndShowSections(uiSections) {
        this.clearSections(uiSections);
        this.showSections(uiSections);

        // Let people know the active UI section has changed/been cleared.
        window.dispatchEvent(new Event(CustomEvents.UISectionChanged));
    }

    /**
     * Apply the given function to all UI sections specified in uiSections.
     * @param {number} uiSections
     * @param {(ele: HTMLElement) => void} fn */
    #sectionOperation(uiSections, fn) {
        for (const group of Object.values(UISection)) {
            if (group & uiSections) {
                fn(this.#uiSections[group]);
            }
        }
    }


}

export { Instance as UISections, ResultSections };
