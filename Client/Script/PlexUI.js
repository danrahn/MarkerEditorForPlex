import { $, buildNode, clearEle } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';

import Overlay from './inc/Overlay.js';

import { FilterDialog, FilterSettings } from './FilterDialog.js';
import { MovieResultRow, SectionOptionsResultRow, ShowResultRow } from './ResultRow.js';
import { ClientSettings } from './ClientSettings.js';
import { PlexClientState } from './PlexClientState.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import { SectionType } from '../../Shared/PlexTypes.js';

/** @typedef {!import('../../Shared/PlexTypes').LibrarySection} LibrarySection */
/** @typedef {!import('../../Shared/PlexTypes').ShowData} ShowData */
/** @typedef {!import('./ClientDataExtensions').ClientMovieData} ClientMovieData */


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
 * The singleton UI instance
 * @type {PlexUIManager}
 * @readonly */ // Externally readonly
let Instance;

/**
 * Handles UI interactions of the application, including
 * setting up search/dropdown listeners, and building show/season/episode result rows.
 */
class PlexUIManager {

    /** The library selection dropdown.
     * @type {HTMLSelectElement} */
    #dropdown = $('#libraries');

    /**
     * The show search box.
     * @type {HTMLInputElement} */
    #searchBox = $('#search');

    /**
     * The last value we searched for, used to ensure
     * we don't reparse thing on null input (e.g. alt key down)
     * @type {string} */
    #lastSearch = null;

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

    /** @type {ShowResultRow[]|MovieResultRow[]} */
    #activeSearch = [];

    /** Creates the singleton PlexUI for this session. */
    static CreateInstance() {
        if (Instance) {
            Log.error('We should only have a single PlexUI instance!');
            return;
        }

        Instance = new PlexUIManager();
    }

    /** Constructs a new PlexUI and begins listening for change events. */
    constructor() {
        if (Instance) {
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
        const savedSection = ClientSettings.lastSection();

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
        const preSelect = libraries.length == 1 ? libraries[0].id : lastSectionExists ? savedSection : -1;
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

    showSections(uiSection) {
        this.#sectionOperation(uiSection, ele => {
            ele.classList.remove('hidden');
        });
    }

    hideSections(uiSection) {
        this.#sectionOperation(uiSection, ele => {
            ele.classList.add('hidden');
        });
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
        this.#lastSearch = null;
        const section = parseInt(this.#dropdown.value);
        const libType = parseInt(this.#dropdown.childNodes[this.#dropdown.selectedIndex].getAttribute('libtype'));
        switch (libType) {
            case SectionType.Movie:
                this.#searchBox.placeholder = 'Search for a Movie...';
                break;
            case SectionType.TV:
                this.#searchBox.placeholder = 'Search for a Show...';
                break;
            default:
                Log.warn(`Unexpected library type ${libType}`);
                this.#searchBox.placeholder = 'Search for an item...';
                break;
        }

        await PlexClientState.setSection(section, libType);
        this.clearAllSections();
        if (!isNaN(section) && section != -1) {
            ClientSettings.setLastSection(section);
            this.#searchContainer.classList.remove('hidden');
        }

        if (ClientSettings.backupEnabled() && ClientSettings.showExtendedMarkerInfo()) {
            // In this case, we should have pre-built our purge cache, so grab everything now so that
            // we don't have to 'Find Purged Markers' to hydrate the warning icons at the movie/show/season/episode level
            PurgedMarkers.findPurgedMarkers(true /*dryRun*/);
        }

        if (this.#searchBox.value.length > 0) {
            this.#search(); // Restart any existing search in the new library
        }
    }

    /**
     * Handle search box input. Invoke a search immediately if 'Enter' is pressed, otherwise
     * set a timeout to invoke a search after a quarter of a second has passed.
     * @this {PlexUIManager}
     * @param {KeyboardEvent} e */
    async #onSearchInput(e) {
        clearTimeout(this.#searchTimer);
        if (e.key == 'Enter') {
            this.#lastSearch = null; // Guarantee we reload things.
            return this.#search();
        }

        // List of modifiers to ignore as input, take from
        // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values.
        const modifiers = ['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'FnLock', 'Hyper', 'Meta',
            'NumLock', 'ScrollLock', 'Shift', 'Super', 'Symbol', 'SymbolLock'];
        if (this.#searchBox.value.length == 0 && modifiers.indexOf(e.key) === -1) {
            // Only show all series if the user explicitly presses 'Enter'
            // on a blank query, otherwise clear the results.
            if (this.#lastSearch.length != 0) {
                this.clearAllSections();
            }

            return;
        }

        this.#searchTimer = setTimeout(this.#search.bind(this), 250);
    }

    /** Initiate a search to the database for shows. */
    #search(forFilterReapply=false) {
        if (!forFilterReapply && this.#searchBox.value == this.#lastSearch) {
            return;
        }

        this.#lastSearch = this.#searchBox.value;

        // If we're adjusting the list due to a filter change,
        // we don't want to reapply the search itself, just decide
        // what items we want to display.
        if (!forFilterReapply) {

            // Remove any existing show/season/marker data
            this.clearAllSections();

            PlexClientState.search(this.#searchBox.value);

            this.clearAndShowSections(UISection.MoviesOrShows);
        } else {
            // Clear the section, but don't show it
            this.clearSections(UISection.MoviesOrShows);
        }

        switch (PlexClientState.activeSectionType()) {
            case SectionType.Movie:
                this.#searchMovies();
                break;
            case SectionType.TV:
                this.#searchShows(forFilterReapply);
                break;
            default:
                Log.error(`Attempting to search with an invalid section type.`);
                break;
        }
    }

    #searchMovies() {
        const movieList = this.#uiSections[UISection.MoviesOrShows];
        if (ClientSettings.backupEnabled() && ClientSettings.showExtendedMarkerInfo()) {
            movieList.appendChild(new SectionOptionsResultRow().buildRow());
        }

        /** @type {ClientMovieData[]} */
        const searchResults = PlexClientState.getUnfilteredSearchResults();
        if (searchResults.length == 0) {
            movieList.appendChild(buildNode('div', { class : 'topLevelResult movieResult' }, 'No results found.'));
            return;
        }

        this.#activeSearch = [];
        const rowsLimit = 250; // Most systems should still be fine with this. Even 1000 might not be horrible, but play it safe.
        let nonFiltered = 0;
        let nextFilterIndex = 0;
        for (const movie of searchResults) {
            ++nextFilterIndex;
            if (!FilterSettings.shouldFilter(movie.markerBreakdown())) {
                ++nonFiltered;
                const newRow = new MovieResultRow(movie);
                this.#activeSearch.push(newRow);
                movieList.appendChild(newRow.buildRow());
            }

            if (nonFiltered == rowsLimit) {
                break;
            }
        }

        if (nonFiltered === 0) {
            movieList.appendChild(this.noResultsBecauseOfFilterRow());
        }

        if (searchResults.length > nextFilterIndex) {

            const loadTheRest = () => {
                movieList.removeChild(movieList.children[movieList.children.length - 1]);
                for (const movie of searchResults.slice(nextFilterIndex)) {
                    if (!FilterSettings.shouldFilter(movie.markerBreakdown())) {
                        const newRow = new MovieResultRow(movie);
                        this.#activeSearch.push(newRow);
                        movieList.appendChild(newRow.buildRow());
                    }
                }
            };

            const text = `Results are limited to the top ${rowsLimit} items, ` +
            `click here to load up to ${searchResults.length - nextFilterIndex} more.<br><br>` +
            `WARNING: loading too many rows might hang your browser page.<br>`;
            movieList.appendChild(
                buildNode('div',
                    { class : 'topLevelResult movieResult', style : 'text-align: center' },
                    text,
                    { click : loadTheRest }));
        }
    }

    #searchShows(forFilterReapply=false) {
        if (!forFilterReapply) {
            // "Background" update, we don't want to wipe out the
            // current view if the user is viewing a show/season
            PlexClientState.clearActiveShow();
        }

        const showList = this.#uiSections[UISection.MoviesOrShows];
        if (ClientSettings.backupEnabled() && ClientSettings.showExtendedMarkerInfo()) {
            showList.appendChild(new SectionOptionsResultRow().buildRow());
        }

        /** @type {ShowData[]} */
        const searchResults = PlexClientState.getUnfilteredSearchResults();
        if (searchResults.length == 0) {
            showList.appendChild(buildNode('div', { class : 'topLevelResult showResult' }, 'No results found.'));
            return;
        }

        this.#activeSearch = [];
        for (const show of searchResults) {
            if (!FilterSettings.shouldFilter(show.markerBreakdown())) {
                const newRow = new ShowResultRow(show);
                this.#activeSearch.push(newRow);
                showList.appendChild(newRow.buildRow());
            }
        }

        if (this.#activeSearch.length === 0) {
            showList.appendChild(this.noResultsBecauseOfFilterRow());
        }
    }

    /**
     * Return a row indicating that there are no rows to show because
     * the active filter is hiding all of them. Clicking the row displays the filter UI.
     * @returns {HTMLElement} */
    noResultsBecauseOfFilterRow() {
        return buildNode(
            'div',
            { class : 'topLevelResult ' },
            'No results with the current filter.',
            { click : () => new FilterDialog().show() });
    }

    /** Apply the given function to all UI sections specified in uiSections. */
    #sectionOperation(uiSections, fn) {
        for (const group of Object.values(UISection)) {
            if (group & uiSections) {
                fn(this.#uiSections[group]);
            }
        }
    }

    /**
     * Callback invoked when a new filter is applied. */
    onFilterApplied() {
        // Don't initialize a search if we don't have any existing items
        if (PlexClientState.getUnfilteredSearchResults().length !== 0) {
            this.#search(true /*forFilterReapply*/);
        }

        // onFilterApplied should probably live completely within PlexClientState,
        // or I need to set stricter boundaries on what goes there versus here, since
        // they both are UI-related.
        PlexClientState.onFilterApplied();
    }
}

export { PlexUIManager, UISection, Instance as PlexUI };
