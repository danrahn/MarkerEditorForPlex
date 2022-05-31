import { $, buildNode, clearEle } from "./Common.js";

import { Settings } from "./index.js";

import Overlay from "./inc/Overlay.js";

import PlexClientState from "./PlexClientState.js";
import { ShowResultRow } from "./ResultRow.js";
import { Log } from "../../Shared/ConsoleLog.js";

/** @typedef {!import('../../Shared/PlexTypes').LibrarySection} LibrarySection */


/**
 * The result sections of the application.
 * Can be bitwise-or'd and -and'd to pass in multiple
 * sections at once to relevant methods.
 * @enum */
const UISection = {
    Shows    : 0x1,
    Seasons  : 0x2,
    Episodes : 0x4
};

/**
 * Handles UI interactions of the application, including
 * setting up search/dropdown listeners, and building show/season/episode result rows.
 */
class PlexClientUI {
    /** The library selection dropdown.
     * @type {HTMLSelectElement} */
    #dropdown = $('#libraries');

    /**
     * The show search box.
     * @type {HTMLInputElement} */
    #searchBox = $('#search');

    /**
     * The container that encapsulates the three result groups
     * @type {HTMLElement} */
    #searchContainer = $('#container');

    /**
     * The three result sections: shows, seasons, and episodes.
     * @type {{[group: number]: HTMLElement}}
     * */
    #uiSections = {
        [UISection.Shows]    : $('#showlist'),
        [UISection.Seasons]  : $('#seasonlist'),
        [UISection.Episodes] : $('#episodelist')
    };

    /**
     * timerID for the search timeout
     * @type {number} */
    #searchTimer;

    /** Constructs a new PlexClientUI and begins listening for change events. */
    constructor() {
        this.#dropdown.addEventListener('change', this.#libraryChanged.bind(this));
        this.#searchBox.addEventListener('keyup', this.#onSearchInput.bind(this));
    }

    /**
     * Populate the library selection dropdown with the items retrieved from the database.
     * If only a single library is returned, automatically select it.
     * @param {LibrarySection[]} libraries List of libraries found in the database. */
    init(libraries) {
        clearEle(this.#dropdown);
        if (libraries.length < 1) {
            Overlay.show('No TV libraries found in the database.', 'OK');
            return;
        }

        this.#dropdown.appendChild(buildNode('option', { value : '-1' }, 'Select a library to parse'));
        const savedSection = Settings.lastSection();

        // We might not find the section if we're using a different database or the library was deleted.
        let lastSectionExists = false;
        for (const library of libraries) {
            lastSectionExists = lastSectionExists || library.id == savedSection;
            this.#dropdown.appendChild(buildNode('option', { value : library.id }, library.name));
        }

        if (savedSection != -1 && !lastSectionExists) {
            Log.info(`Found a cached library section (${savedSection}), but it doesn't exist anymore!`);
        }

        // Select a library automatically if there's only one TV show library
        // or we have an existing cached library section.
        let preSelect = libraries.length == 1 ? libraries[0].id : lastSectionExists ? savedSection : -1;
        if (preSelect != -1) {
            this.#dropdown.value = preSelect;
            this.#libraryChanged();
        }
    }

    /**
     * Callback invoked when settings are applied.
     * @param {boolean} shouldResetView Whether a setting that affects the display of markers
     * was changed, requiring the current view to be reset. */
    onSettingsApplied(shouldResetView) {
        if (shouldResetView) {
            this.clearAllSections();
        }

        if (!this.#searchBox.classList.contains('hidden')) {
            this.#searchBox.value = '';
            this.#searchBox.focus();
        }
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
        this.clearAndShowSections(UISection.Shows | UISection.Seasons | UISection.Episodes)
        PlexClientState.GetState().clearActiveShow();
    }

    /**
     * Clear out all child elements from the specified UI sections
     * @param {UISection} uiSection */
    clearSections(uiSection) {
        this.#sectionOperation(uiSection, ele => {
            clearEle(ele);
        });
    }

    showSections(uiSection) {
        this.#sectionOperation(uiSection, ele => {
            ele.classList.remove('hidden');
        });
    }

    hideSections(uiSection) {
        this.#sectionOperation(uiSection, ele => {
            ele.classList.add('hidden');
        })
    }

    /**
     * Clear the given result group of any elements and ensure it's not hidden.
     * @param {number} uiSections The group(s) to clear and unhide. */
    clearAndShowSections(uiSections) {
        this.clearSections(uiSections);
        this.showSections(uiSections);
    }

    async #libraryChanged() {
        this.#searchContainer.classList.add('hidden');
        const section = parseInt(this.#dropdown.value);
        await PlexClientState.GetState().setSection(section);
        this.clearAllSections();
        if (!isNaN(section) && section != -1) {
            Settings.setLastSection(section);
            this.#searchContainer.classList.remove('hidden');
        }
    }

    /**
     * Handle search box input. Invoke a search immediately if 'Enter' is pressed, otherwise
     * set a timeout to invoke a search after a quarter of a second has passed.
     * @this {PlexClientUI}
     * @param {KeyboardEvent} e */
    #onSearchInput(e) {
        clearTimeout(this.#searchTimer);
        if (e.key == 'Enter') {
            this.#search();
            return;
        }
    
        // List of modifiers to ignore as input, take from
        // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values.
        const modifiers = ['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'FnLock', 'Hyper', 'Meta',
                           'NumLock', 'ScrollLock', 'Shift', 'Super', 'Symbol', 'SymbolLock'];
        if (modifiers.indexOf(e.key) !== -1) {
            return;
        }

        if (this.#searchBox.value.length == 0) {
            // Only show all series if the user explicitly presses 'Enter'
            // on a blank query, otherwise clear the results.
            this.clearAllSections();
            return;
        }

        this.#searchTimer = setTimeout(this.#search.bind(this), 250);
    }

    /** Initiate a search to the database for shows. */
    #search() {
        // Remove any existing show/season/marker data
        this.clearAllSections();
        PlexClientState.GetState().search(this.#searchBox.value, this.#afterSearchCompleted.bind(this));
    }

    /** After a show search has completed, creates a DOM entry entry for each match. */
    #afterSearchCompleted() {
        this.clearAndShowSections(UISection.Shows);
        PlexClientState.GetState().clearActiveShow();
        let showList = this.#uiSections[UISection.Shows];
        const searchResults = PlexClientState.GetState().getSearchResults();
        if (searchResults.length == 0) {
            showList.appendChild(buildNode('div', { class : 'showResult' }, 'No results found.'));
            return;
        }

        for (const show of searchResults) {
            showList.appendChild(new ShowResultRow(show).buildRow());
        }
    }

    /** Apply the given function to all UI sections specified in uiSections. */
    #sectionOperation(uiSections, fn) {
        for (const group of Object.values(UISection)) {
            if (group & uiSections) {
                fn(this.#uiSections[group]);
            }
        }
    }
}

export { PlexClientUI, UISection }
