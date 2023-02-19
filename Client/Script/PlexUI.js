import { $, buildNode, clearEle } from './Common.js';

import Overlay from './inc/Overlay.js';

import SettingsManager from './ClientSettings.js';
import PlexClientState from './PlexClientState.js';
import { MovieResultRow, ShowResultRow } from './ResultRow.js';
import { Log } from '../../Shared/ConsoleLog.js';
import { SectionType } from '../../Shared/PlexTypes.js';

/** @typedef {!import('../../Shared/PlexTypes.js').LibrarySection} LibrarySection */


/**
 * The result sections of the application.
 * Can be bitwise-or'd and -and'd to pass in multiple
 * sections at once to relevant methods.
 * @enum */
const UISection = {
    MoviesOrShows : 0x1, // TODO: is there any value in a separate movie vs show hierarchy?
    Seasons       : 0x2,
    Episodes      : 0x4
};

/**
 * Handles UI interactions of the application, including
 * setting up search/dropdown listeners, and building show/season/episode result rows.
 */
class PlexUI {
    /** @type {PlexUI} */
    static #plexUI;

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
        [UISection.MoviesOrShows] : $('#toplevellist'),
        [UISection.Seasons]       : $('#seasonlist'),
        [UISection.Episodes]      : $('#episodelist')
    };

    /**
     * timerID for the search timeout
     * @type {number} */
    #searchTimer;

    /** @type {ShowResultRow[]} */
    #activeSearch = [];

    /** Creates the singleton PlexUI for this session. */
    static Initialize() {
        if (PlexUI.#plexUI) {
            Log.error('We should only have a single SettingsManager instance!');
            return;
        }

        PlexUI.#plexUI = new PlexUI();
    }

    /** @returns {PlexUI} */
    static Get() {
        if (!PlexUI.#plexUI) {
            Log.error(`Accessing settings before it's been initialized'! Initializing now...`);
            PlexUI.Initialize();
        }

        return this.#plexUI;
    }

    /** Constructs a new PlexUI and begins listening for change events. */
    constructor() {
        if (PlexUI.#plexUI) {
            throw new Error(`Don't create a new PlexUI when the singleton already exists!`);
        }

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
            Overlay.show('No Movie/TV libraries found in the database.');
            return;
        }

        this.#dropdown.appendChild(buildNode('option', { value : '-1', libtype : '-1' }, 'Select a library to parse'));
        const savedSection = SettingsManager.Get().lastSection();

        // We might not find the section if we're using a different database or the library was deleted.
        let lastSectionExists = false;
        for (const library of libraries) {
            lastSectionExists = lastSectionExists || library.id == savedSection;
            this.#dropdown.appendChild(buildNode('option', { value : library.id, libtype : library.type }, library.name));
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
        this.clearAndShowSections(UISection.MoviesOrShows | UISection.Seasons | UISection.Episodes)
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

    /**
     * Retrieve all ShowResultRows in the search result list. */
    getActiveSearchRows() {
        return this.#activeSearch;
    }

    async #libraryChanged() {
        this.#searchContainer.classList.add('hidden');
        const section = parseInt(this.#dropdown.value);
        await PlexClientState.GetState().setSection(section, parseInt(this.#dropdown.childNodes[this.#dropdown.selectedIndex].getAttribute('libtype')));
        this.clearAllSections();
        if (!isNaN(section) && section != -1) {
            SettingsManager.Get().setLastSection(section);
            this.#searchContainer.classList.remove('hidden');
        }

        if (this.#searchBox.value.length > 0) {
            this.#search(); // Restart any existing search in the new library
        }
    }

    /**
     * Handle search box input. Invoke a search immediately if 'Enter' is pressed, otherwise
     * set a timeout to invoke a search after a quarter of a second has passed.
     * @this {PlexUI}
     * @param {KeyboardEvent} e */
    async #onSearchInput(e) {
        clearTimeout(this.#searchTimer);
        if (e.key == 'Enter') {
            return this.#search();
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
        PlexClientState.GetState().search(this.#searchBox.value);
        this.clearAndShowSections(UISection.MoviesOrShows);
        switch (PlexClientState.GetState().activeSectionType()) {
            case SectionType.Movie:
                this.#searchMovies();
                break;
            case SectionType.TV:
                this.#searchShows();
                break;
            default:
                Log.error(`Attempting to search with an invalid section type.`);
                break;
        }
    }

    #searchMovies() {
        let movieList = this.#uiSections[UISection.MoviesOrShows];
        const searchResults = PlexClientState.GetState().getSearchResults();
        if (searchResults.length == 0) {
            movieList.appendChild(buildNode('div', { class : 'topLevelResult movieResult' }, 'No results found.'));
            return;
        }

        this.#activeSearch = [];
        for (const movie of searchResults) {
            const newRow = new MovieResultRow(movie);
            this.#activeSearch.push(newRow);
            // TODO NEXT: This needs to have marker data associated,
            // or most likely delay load until we want to show markers for the first time.
            // Also, limit search results to first X (100)? It can be large, but we don't want
            // to draw 10K rows, especially if we try to load marker data for all of them.
            movieList.appendChild(newRow.buildRow());
        }
    }

    #searchShows() {
        PlexClientState.GetState().clearActiveShow();
        let showList = this.#uiSections[UISection.MoviesOrShows];
        const searchResults = PlexClientState.GetState().getSearchResults();
        if (searchResults.length == 0) {
            showList.appendChild(buildNode('div', { class : 'topLevelResult showResult' }, 'No results found.'));
            return;
        }

        this.#activeSearch = [];
        for (const show of searchResults) {
            const newRow = new ShowResultRow(show);
            this.#activeSearch.push(newRow);
            showList.appendChild(newRow.buildRow());
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

export { PlexUI, UISection }
