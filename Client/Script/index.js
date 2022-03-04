/**
 * @typedef {!import('../../Shared/PlexTypes').ShowMap} ShowMap
 */

window.addEventListener('load', setup);

/** @type {Plex} */
let PlexState;

/** @type {boolean} */
let g_dark = null;
let g_appConfig;

/** Initial setup on page load. */
function setup()
{
    setTheme();
    $('#showInstructions').addEventListener('click', showHideInstructions);
    $('#libraries').addEventListener('change', libraryChanged);
    $('#search').addEventListener('keyup', onSearchInput);
    $('#settings').addEventListener('click', showSettings);
    setupMarkerBreakdown();
    PlexState = new Plex();
    mainSetup();
}

/**
 * A class that handles that keeps track of the currently UI state of Plex Intro Editor,
 * including search results and the active show/season. 
 */
class Plex
{
    /** @type {number} */
    activeSection = -1;
    /** @type {Object<number, ShowMap>} */
    shows = {};
    /** @type {ShowData[]} */
    #activeSearch = [];
    /** @type {ShowData} */
    #activeShow;
    /** @type {SeasonData} */
    #activeSeason;

    constructor() {}

    /**
     * Set the currently active library.
     * @param {number} section The section to make active.
     */
    async setSection(section) {
        this.activeSection = isNaN(section) ? -1 : section;
        if (this.activeSection != -1) {
            await this._populate_shows();
        }
    }

    /**
     * @returns The list of shows that match the current search.
     */
    getSearchResults() {
        return this.#activeSearch;
    }

    /**
     * Sets the show with the given metadataId as active.
     * @param {number} metadataId
     * @returns {ShowData|false} The show with the given metadata id, or `false` if the show was not found.
     */
    setActiveShow(metadataId) {
        if (!this.shows[this.activeSection][metadataId]) {
            return false;
        }

        if (this.#activeShow && this.#activeShow.metadataId != metadataId) {
            this.clearActiveShow();
        } else if (!this.#activeShow) {
            this.#activeShow = this.shows[this.activeSection][metadataId];
        }

        return this.#activeShow;
    }

    /**
     * @returns {ShowData} The active show, or null if no show is active.
     */
    getActiveShow() {
        return this.#activeShow;
    }

    /** Clears out the currently active show and other dependent data (i.e. {@linkcode #activeSeason}). */
    clearActiveShow() {
        // It's probably fine to keep the season/episode data cached,
        // but it could theoretically be a memory hog if someone navigates
        // through their entire library with hundreds/thousands of seasons.
        if (this.#activeShow) {
            this.clearActiveSeason();
            this.#activeShow.clearSeasons();
            this.#activeShow = null;
        }
    }

    /** Clears out the currently active season and its episode data. */
    clearActiveSeason() {
        if (this.#activeSeason) {
            this.#activeSeason.clearEpisodes();
            this.#activeSeason = null;
        }
    }

    /**
     * Adds the given season to the current show.
     * @param {SeasonData} season 
     */
    addSeason(season) {
        this.#activeShow.addSeason(season);
    }

    /**
     * Sets the season with the given metadata id as active.
     * @param {number} metadataId The metadata of the season.
     * @returns {SeasonData|false} The season with the given metadata id, or `false` if the season could not be found.
     */
    setActiveSeason(metadataId) {
        let season = this.#activeShow.getSeason(metadataId);
        if (!season) {
            return false;
        }

        if (this.#activeSeason && this.#activeSeason.metadataId != metadataId) {
            this.clearActiveSeason();
        } else if (!this.#activeSeason) {
            this.#activeSeason = season;
        }

        return this.#activeSeason;
    }

    /**
     * @returns {SeasonData} The currently active season, or `null` if now season is active.
     */
    getActiveSeason() {
        return this.#activeSeason;
    }

    /**
     * Add the given episode to the active season's episode cache.
     * @param {EpisodeData} episode
     */
    addEpisode(episode) {
        this.#activeSeason.addEpisode(episode);
    }

    /**
     * Retrieve an episode from the active season's episode cache.
     * @param {number} metadataId
     */
    getEpisode(metadataId) {
        return this.#activeSeason.getEpisode(metadataId);
    }

    /**
     * Search for shows that match the given query.
     * @param {string} query The show to search for.
     * @param {Function<Object>} successFunc The function to invoke after search the search results have been compiled.
     */
    search(query, successFunc)
    {
        // Ignore non-word characters to improve matching if there are spacing or quote mismatches. Don't use \W though, since that also clears out unicode characters.
        // Rather than import some heavy package that's aware of unicode word characters, just clear out the most common characters we want to ignore.
        // I could probably figure out how to utilize Plex's spellfix tables, but substring search on display, sort, and original titles should be good enough here.
        query = query.toLowerCase().replace(/[\s,'"_\-!?]/g, '');

        const showList = Object.values(this.shows[this.activeSection]);

        let result = [];
        for (const show of showList) {
            if (show.searchTitle.indexOf(query) != -1
                || (show.sortTitle && show.sortTitle.indexOf(query) != -1)
                || (show.originalTitle && show.originalTitle.indexOf(query) != -1)) {
                result.push(show);
            }
        }

        const defaultSort = (a, b) => {
            const aTitle = a.sortTitle || a.searchTitle;
            const bTitle = b.sortTitle || b.searchTitle;
            return aTitle.localeCompare(bTitle);
        }

        // Sort the results. Title prefix matches are first, then sort title prefix matches, the original title prefix matches, and alphabetical sort title after that.
        result.sort((a, b) => {
            if (query.length == 0) {
                // Blank query should return all shows, and in that case we just care about sort title order
                return defaultSort(a, b);
            }

            const prefixTitleA = a.searchTitle.startsWith(query);
            const prefixTitleB = b.searchTitle.startsWith(query);
            if (prefixTitleA != prefixTitleB) {
                return prefixTitleA ? -1 : 1;
            }

            const prefixSortA = a.sortTitle && a.sortTitle.startsWith(query);
            const prefixSortB = b.sortTitle && b.sortTitle.startsWith(query);
            if (prefixSortA != prefixSortB) {
                return prefixSortA ? -1 : 1;
            }

            const prefixOrigA = a.originalTitle && a.originalTitle.startsWith(query);
            const prefixOrigB = b.originalTitle && b.originalTitle.startsWith(query);
            if (prefixOrigA != prefixOrigB) {
                return prefixOrigA ? -1 : 1;
            }

            return defaultSort(a, b);
        });

        this.#activeSearch = result;
        successFunc();
    }

    /**
     * Kick off a request to get all shows in the currently active session, if it's not already cached.
     * @returns {Promise<void>}
     */
    async _populate_shows() {
        if (this.shows[this.activeSection]) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            jsonRequest(
                'get_section',
                { id : PlexState.activeSection },
                (res) => {
                    let allShows = {};
                    PlexState.shows[PlexState.activeSection] = allShows;
                    for (const show of res) {
                        let showData = new ShowData().setFromJson(show);
                        allShows[showData.metadataId] = showData;
                    }
                    resolve();
                },
                (res) => {
                    Overlay.show(`Something went wrong retrieving shows from the selected library, please try again later.<br><br>Server message:<br>${res.Error}`);
                });
        });
    }
}

/** `localStorage` key to remember a user's chosen theme. */
const themeKey = 'plexIntro_theme';

/**
 * The CSS DOM element used to swap themed stylesheets.
 * @type {HTMLElement}
 */
let themedStyle;

/** Determine and set the initial theme to use on load */
function setTheme() {
    g_dark = parseInt(localStorage.getItem(themeKey));
    let manual = true;
    let darkThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    if (isNaN(g_dark)) {
        manual = false;
        g_dark = darkThemeMediaQuery != "not all" && darkThemeMediaQuery.matches;
    }

    themedStyle = buildNode('link', { rel : 'stylesheet', type : 'text/css', href : `Client/Style/theme${g_dark ? 'Dark' : 'Light' }.css`});
    $$('head').appendChild(themedStyle);

    let checkbox = $('#darkModeCheckbox');
    checkbox.checked = g_dark;
    checkbox.addEventListener('change', (e) => toggleTheme(e.target.checked, true /*manual*/));

    toggleTheme(g_dark, manual);
    darkThemeMediaQuery.addEventListener('change', e => { if (toggleTheme(e.matches, false /*manual*/)) checkbox.checked = e.matches; });

    // index.html hard-codes the dark theme icon. Adjust if necessary
    if (!g_dark) {
        $('#settings').src = '/i/212121/settings.svg';
    }
}


/**
 * Toggle light/dark theme.
 * @param {boolean} isDark Whether dark mode is enabled.
 * @param {boolean} manual Whether we're toggling due to user interaction, or due to a change in the system theme.
 * @returns {boolean} Whether we actually toggled the theme.
 */
function toggleTheme(isDark, manual) {
    if (isDark == g_dark) {
        return false;
    }

    if (manual) {
        localStorage.setItem(themeKey, isDark ? 1 : 0);
    } else if (!!localStorage.getItem(themeKey)) {
        // A manual choice sticks, regardless of browser theme change.
        return false;
    }

    g_dark = isDark;

    if (g_dark) {
        themedStyle.href = "themeDark.css";
    } else {
        themedStyle.href = "themeLight.css";
    }

    adjustIcons();
    return true;
}

/** After changing the theme, make sure any theme-sensitive icons are also adjusted. */
function adjustIcons() {
    for (const icon of $('img[src^="/i/"]')) {
        const split = icon.src.split('/');
        icon.src = `/i/${colors.get(icon.getAttribute('theme'))}/${split[split.length - 1]}`;
    }
}

/**
 * Toggle the visibility of the instructions.
 * @this HTMLElement */
function showHideInstructions() {
    $('.instructions').forEach(instruction => instruction.classList.toggle('hidden'));
    if (this.innerHTML[0] == '+') {
        this.innerHTML = '- Click to hide details';
    } else {
        this.innerHTML = '+ Click here for details';
    }
}

/**
 * Kick off the initial requests necessary for the page to function:
 * * Get app config
 * * Get local settings
 * * Retrieve libraries
 */
function mainSetup() {
    let failureFunc = (response) => {
        Overlay.show(`Error getting libraries, please verify you have provided the correct database path and try again. Server Message:<br><br>${response.Error}`, 'OK');
    };

    let gotConfig = (config) => {
        g_appConfig = config;
        parseSettings();
        jsonRequest('get_sections', {}, listLibraries, failureFunc);
    }

    let noConfig = () => {
        g_appConfig = {};
        Overlay.show('Error getting config, please try again later.', 'OK');
    }

    jsonRequest('get_config', {}, gotConfig, noConfig);
}

/**
 * Populate the library selection dropdown with the items retrieved from the database.
 * If only a single library is returned, automatically select it.
 * @param {Object[]} libraries List of libraries found in the database.
 */
function listLibraries(libraries) {
    let select = document.querySelector('#libraries');
    clearEle(select);

    if (libraries.length < 1) {
        Overlay.show('No TV libraries found in the database.', 'OK');
        return;
    }

    select.appendChild(buildNode(
        'option',
        {
            value: '-1',
            plexType: '-1'
        },
        'Select a library to parse')
    );

    libraries.forEach(library => {
        select.appendChild(buildNode(
            'option',
            { value: `${library.id}` },
            library.name)
        );
    });

    // Only a single TV show library, select it automatically
    if (libraries.length == 1)
    {
        select[1].selected = true;
        libraryChanged.bind(select)();
    }
}

/** Handles when the selected library changes, clearing any existing data and requesting new show data. */
async function libraryChanged() {
    $('#container').classList.add('hidden');
    let section = parseInt(this.value);
    await PlexState.setSection(section);
    clearAll();
    if (!isNaN(section) && section != -1) {
        $('#container').classList.remove('hidden');
    }
}

/** Clear data from the show, season, and episode lists. */
function clearAll() {
    for (const group of [$('#showlist'), $('#seasonlist'), $('#episodelist')])
    {
        clearAndShow(group);
    }

    PlexState.clearActiveShow();
}

/**
 * Reset a given element - clearing its contents and the hidden flag.
 * @param {HTMLElement} ele The element to clear and unhide.
 */
function clearAndShow(ele) {
    clearEle(ele);
    ele.classList.remove('hidden');
}

const settingsKey = 'plexIntro_settings';
let g_localSettings = {};

/**
 * Retrieve local settings. Currently only contains the setting controlling whether
 * thumbnails are shown during marker edit, as dark mode setting is stored separately.
 */
function parseSettings() {
    $('#settings').classList.remove('hidden');
    try {
        g_localSettings = JSON.parse(localStorage.getItem(settingsKey));
        verifySettings();
    } catch (e) {
        g_localSettings = defaultSettings();
    }
}

/** @returns The default settings. */
function defaultSettings() {
    return {
        useThumbnails : g_appConfig.useThumbnails
    };
}

/** Verify local settings are present and have the fields we expect. */
function verifySettings() {
    if (!g_localSettings) {
        g_localSettings = defaultSettings();
        return;
    }

    if (!g_localSettings.hasOwnProperty('useThumbnails')) {
        g_localSettings.useThumbnails = g_appConfig.useThumbnails;
    }
}

/**
 * Show the settings overlay.
 * Currently only has two options:
 * * Dark Mode: toggles dark mode, and is linked to the main dark mode toggle
 * * Show Thumbnails: Toggles whether thumbnails are shown when editing/adding markers.
 *   Only visible if app settings have thumbnails enabled.
 */
function showSettings() {
    let options = [];
    options.push(buildSettingCheckbox('Dark Mode', 'darkModeSetting', g_dark));
    if (g_appConfig.useThumbnails) {
        options.push(buildSettingCheckbox(
            'Show Thumbnails',
            'showThumbnailsSetting',
            g_localSettings.useThumbnails,
            'When editing markers, display thumbnails that<br>correspond to the current timestamp (if available)'));
    }
    options.push(buildNode('hr'));

    let container = buildNode('div', { id : 'settingsContainer'}).appendChildren(
        buildNode('h3', {}, 'Settings'),
        buildNode('hr')
    );

    options.forEach(option => container.appendChild(option));
    const buildButton = (text, id, callback, style='') => buildNode(
        'input', {
            type : 'button',
            value : text,
            id : id,
            style : style
        },
        0,
        {
            click : callback
        });

    container.appendChild(buildNode('div', { class : 'formInput' }).appendChildren(
        buildNode('div', { class : 'settingsButtons' }).appendChildren(
            buildButton('Cancel', 'cancelSettings', Overlay.dismiss, 'margin-right: 10px'),
            buildButton('Apply', 'applySettings', applySettings)
        )
    ));

    Overlay.build({ dismissible : true, centered : false, noborder: true }, container);
}

/** Helper method that builds a label+checkbox combo for use in the settings dialog. */
function buildSettingCheckbox(label, name, checked, tooltip='') {
    let labelNode = buildNode('label', { for : name }, label + ': ');
    if (tooltip) {
        Tooltip.setTooltip(labelNode, tooltip);
    }

    let checkbox = buildNode('input', { type : 'checkbox', name : name, id : name });
    if (checked) {
        checkbox.setAttribute('checked', 'checked');
    }
    return buildNode('div', { class : 'formInput' }).appendChildren(
        labelNode,
        checkbox
    );
}

/** Apply and save settings after the user chooses to commit their changes. */
function applySettings() {
    if ($('#darkModeSetting').checked != g_dark) {
        $('#darkModeCheckbox').click();
    }

    g_localSettings.useThumbnails = g_appConfig.useThumbnails && $('#showThumbnailsSetting').checked;
    localStorage.setItem(settingsKey, JSON.stringify(g_localSettings));
    Overlay.dismiss();
}

/** Set up click handler and tooltip text for the marker breakdown button. */
function setupMarkerBreakdown() {
    const stats = $('#markerBreakdown');
    stats.addEventListener('click', getMarkerBreakdown);
    Tooltip.setTooltip(stats, 'Generate a graph displaying the number<br>of episodes with and without markers');
}

/**
 * Kicks off a request for marker stats. This can take some time for large libraries,
 * so first initialize an overlay so the user knows something's actually happening.
 */
function getMarkerBreakdown() {

    Overlay.show(
        buildNode('div').appendChildren(
            buildNode('h2', {}, 'Marker Breakdown'),
            buildNode('br'),
            buildNode('div', {}, 'Getting marker breakdown. This may take awhile...'),
            buildNode('br'),
            buildNode('img', { width : 30, height : 30, src : 'i/c1c1c1/loading.svg' })),
        'Cancel');

    jsonRequest('get_stats', { id : PlexState.activeSection }, showMarkerBreakdown, markerBreakdownFailed);
}

/**
 * After successfully grabbing the marker breakdown from the server, build a pie chart
 * visualizing the number of episodes that have n markers.
 * @param {Object<string, number>} response A map of marker counts to the number of episodes that has that marker count.
 */
function showMarkerBreakdown(response) {
    const overlay = $('#mainOverlay');
    if (!overlay) {
        Log.verbose('Overlay is gone, not showing stats');
        return; // User closed out of window
    }

    let dataPoints = [];
    for (const [bucket, value] of Object.entries(response)) {
        dataPoints.push({ value : value, label : plural(bucket, 'Marker') });
    }

    const chartOptions = {
        radius : Math.min(Math.min(400, window.innerWidth / 2 - 40), window.innerHeight / 2 - 200),
        points : dataPoints,
        title : 'Marker Breakdown',
        colorMap : { // Set colors for 0 and 1, use defaults for everything else
            '0 Markers' : '#a33e3e',
            '1 Marker'  : '#2e832e'
        },
        sortFn : (a, b) => parseInt(a.label) - parseInt(b.label),
        labelOptions : { count : true, percentage : true }
    }

    const chart = Chart.pie(chartOptions);

    // Our first request may be slow, and we want to show the graph immediately.
    // Subsequent requests might instantly return cached data, so we want to include a fade in
    const opacity = parseFloat(getComputedStyle(overlay).opacity);
    const delay = (1 - opacity) * 250;
    Overlay.destroy();
    Overlay.build({ dismissible : true, centered : true, delay : delay, noborder : true, closeButton : true },
        buildNode('div', { style : 'text-align: center' }).appendChildren(chart));
}

/**
 * Let the user know something went wrong if we failed to grab marker stats.
 * @param {Object} response JSON failure message.
 */
function markerBreakdownFailed(response) {
    Overlay.destroy();
    Overlay.show(
        buildNode('div').appendChildren(
            buildNode('h2', {}, 'Error'),
            buildNode('br'),
            buildNode('div', {}, `Failed to get marker breakdown: ${response.Error || response.message}`)
        ), 'OK');
}

/**
 * timerID for the search timeout
 * @type {number} */
let g_searchTimer;

/**
 * Handle search box input. Invoke a search immediately if 'Enter' is pressed, otherwise
 * set a timeout to invoke a search after a quarter of a second has passed.
 * @param {KeyboardEvent} e
 */
function onSearchInput(e) {
    clearTimeout(g_searchTimer);
    if (e.keyCode == 13 /*enter*/) {
        search();
        return;
    }

    // List of modifiers, taken from https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values, to ignore as input.
    const modifiers = ['Alt', 'AltGraph', 'CapsLock', 'Control', 'Fn', 'FnLock', 'Hyper', 'Meta', 'NumLock', 'ScrollLock', 'Shift', 'Super', 'Symbol', 'SymbolLock'];
    if (modifiers.indexOf(e.key) !== -1) {
        return;
    }

    if ($('#search').value.length == 0) {
        // Only show all series if the user explicitly presses 'Enter'
        // on a blank query, otherwise clear the results.
        clearAll();
        return;
    }

    g_searchTimer = setTimeout(search, 250);
}

/** Initiate a search to the database for shows. */
function search() {
    // Remove any existing show/season/marker data
    clearAll();
    PlexState.search($('#search').value, afterSearchCompleted);
}

/**
 * After a show search has completed, creates a DOM entry entry for each match.
 */
function afterSearchCompleted() {
    let showList = $('#showlist');
    clearAndShow(showList);
    PlexState.clearActiveShow();

    const searchResults = PlexState.getSearchResults();
    if (searchResults.length == 0) {
        showList.appendChild(buildNode('div', { class : 'showResult' }, "No results found."));
        return;
    }

    for (const show of searchResults) {
        let div = buildShowRow(show);
        showList.appendChild(div);
    }
}

/**
 * Creates a DOM element for a show result.
 * Each entry contains three columns - the show name, the number of seasons, and the number of episodes.
 * @param {ShowData} show Information for a specific show.
 * @param {boolean} [selected=false] True if this row is selected and should be treated like a header opposed to a clickable entry.
 * @returns {HTMLElement}
 */
function buildShowRow(show, selected=false) {
    let titleNode = buildNode('div', {}, show.title);
    if (show.originalTitle) {
        titleNode.appendChild(buildNode('span', { class : 'showResultOriginalTitle' }, ` (${show.originalTitle})`));
    }

    let events = {};
    if (!selected) {
        events = { click : showClick };
    }

    let row = buildNode('div', { class : 'showResult', metadataId : show.metadataId }, 0, events).appendChildren(
        titleNode,
        buildNode('div', { class : 'showResultSeasons' }, plural(show.seasonCount, 'Season')),
        buildNode('div', { class : 'showResultEpisodes' }, plural(show.episodeCount, 'Episode'))
    );

    if (selected) {
        row.classList.add('selected');
        row.appendChild(buildNode('div', { class : 'goBack' }).appendChildren(
            createFullButton('Back to results', 'back', 'Go back', 'standard', () => {
                clearAndShow($('#seasonlist'));
                clearAndShow($('#episodelist'));
                $('#showlist').classList.remove('hidden');
            })
        ));
    }

    return row;
}

/** Click handler for clicking a show row. Initiates a request for season details. */
function showClick() {
    // Remove any existing marker data
    clearEle($('#episodelist'));

    let show = PlexState.setActiveShow(parseInt(this.getAttribute('metadataId')));
    if (!show) {
        Overlay.show('Unable to retrieve data for that show. Please try again later.', 'OK');
        return;
    }


    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the seasons for ${show.title}.<br>Server message:<br>${response.Error || response.message}`, 'OK');
    };

    jsonRequest('get_seasons', { id : show.metadataId }, showSeasons, failureFunc);
}

/**
 * Takes the seasons retrieved for a show and creates and entry for each season.
 * @param {Object[]} seasons List of seasons for a given show.
 */
function showSeasons(seasons) {
    let seasonList = $('#seasonlist');
    clearAndShow(seasonList);
    $('#showlist').classList.add('hidden');
    seasonList.appendChild(buildShowRow(PlexState.getActiveShow(), true /*selected*/))
    seasonList.appendChild(buildNode('hr'));
    for (const season of seasons) {
        seasonList.appendChild(buildSeasonRow(season));
        PlexState.addSeason(new SeasonData().setFromJson(season));
    }
}

/**
 * Creates a DOM element for the given season.
 * Each row contains the season number, the season title (if applicable), and the number of episodes in the season.
 * @param {SeasonData} season Season information
 * @param {boolean} [selected=false] `true` if this row is selected and should be treated like a header opposed to a clickable entry.
 * @returns {HTMLElement}
 */
function buildSeasonRow(season, selected=false) {
    let titleNode = buildNode('div', {}, `Season ${season.index}`);
    if (season.title.toLowerCase() != `season ${season.index}`) {
        titleNode.appendChild(buildNode('span', { class : 'seasonTitle' }, ` (${season.title})`));
    }

    let events = {};
    if (!selected) {
        events = { click : seasonClick };
    }

    let row = buildNode('div', { class : 'seasonResult', metadataId : season.metadataId }, 0, events).appendChildren(
        titleNode,
        buildNode('div'), // empty to keep alignment w/ series
        buildNode('div', { class : 'showResultEpisodes' }, plural(season.episodeCount, 'Episode'))
    );

    if (selected) {
        row.classList.add('selected');
        row.appendChild(buildNode('div', { class : 'goBack' }).appendChildren(
            createFullButton('Back to seasons', 'back', 'Go back', 'standard', () => {
                clearAndShow($('#episodelist'));
                $('#seasonlist').classList.remove('hidden');
            })
        ));
    }

    return row;
}

/** Click handler for clicking a show row. Initiates a request for all episodes in the given season. */
function seasonClick() {
    let season = PlexState.setActiveSeason(parseInt(this.getAttribute('metadataId')));
    if (!season) {
        Overlay.show('Unable to retrieve data for that season. Please try again later.', 'OK');
        return;
    }

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the episodes for ${season.title}.<br>Server message:<br>${response.Error || response.message}`, 'OK');
    };

    jsonRequest('get_episodes', { id : season.metadataId }, parseEpisodes, failureFunc);
}

/**
 * Takes the given list of episodes and makes a request for marker details for each episode.
 * @param {Object[]} episodes Array of episodes in a particular season of a show.
 */
function parseEpisodes(episodes) {
    let queryString = [];
    for (const episode of episodes) {
        PlexState.addEpisode(new EpisodeData().setFromJson(episode));
        queryString.push(episode.metadataId);
    }

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the markers for these episodes, please try again.<br><br>Server Message:<br>${response.Error}`, 'OK');
    }

    jsonRequest('query', { keys : queryString.join(',') }, showEpisodesAndMarkers, failureFunc);
}

/**
 * Takes the given list of episode data and creates entries for each episode and its markers.
 * @param {Object<number, object[]>} data Map of episode ids to an array of serialized {@linkcode MarkerData} for the episode.
 */
function showEpisodesAndMarkers(data) {
    let episodelist = $('#episodelist');
    clearEle(episodelist);
    $('#seasonlist').classList.add('hidden');
    episodelist.appendChild(buildShowRow(PlexState.getActiveShow(), true /*selected*/));
    episodelist.appendChild(buildNode('hr'));
    episodelist.appendChild(buildSeasonRow(PlexState.getActiveSeason(), true /*selected*/));
    episodelist.appendChild(buildNode('hr'));
    for (const key of Object.keys(data)) {
        let episode = PlexState.getEpisode(parseInt(key));
        for (const marker of data[key]) {
            episode.markers.push(new MarkerData().setFromJson(marker));
        }

        const markers = episode.markers;

        episodelist.appendChildren(
            buildNode('div').appendChildren(
                buildNode('div', { class : 'episodeResult', title : 'Click to expand/contract. Control+Click to expand/contract all' }, 0, { click : showHideMarkerTable }).appendChildren(
                    buildNode('div', { class : 'episodeName' }).appendChildren(
                        buildNode('span', { class : 'markerExpand' }, '&#9205; '),
                        buildNode('span', {}, `${episode.showName} - S${pad0(episode.seasonIndex, 2)}E${pad0(episode.index, 2)} - ${episode.title || 'Episode ' + episode.index}`)
                    ),
                    buildNode('div', { class : 'episodeResultMarkers' }, plural(markers.length, 'Marker'))),
                buildMarkerTable(markers, episode),
                buildNode('hr', { class : 'episodeSeparator' })
            )
        );
    }
}

/**
 * Expand or collapse the marker table for the clicked episode.
 * If the user ctrl+clicks the episode, expand/contract for all episodes.
 * @param {MouseEvent} e
 */
function showHideMarkerTable(e) {
    const expanded = !this.parentNode.$$('table').classList.contains('hidden');
    if (e.ctrlKey) {
        let episodeList = $('#episodelist');
        for (const episode of episodeList.children) {
            const table = episode.$$('table');
            // headers don't have a table
            if (!table) {
                continue;
            }

            if (expanded) {
                table.classList.add('hidden');
                episode.$$('.markerExpand').innerHTML = '&#9205; ';
            } else {
                table.classList.remove('hidden');
                episode.$$('.markerExpand').innerHTML = '&#9660; ';
            }
        }
    } else {
        this.parentNode.$$('table').classList.toggle('hidden');
        this.$$('.markerExpand').innerHTML = expanded ? '&#9205; ' : '&#9660; ';
    }
}

/**
 * Takes the given marker data and creates a table to display it, including add/edit/delete options.
 * @param {MarkerData[]} markers The array of markers for `episode`.
 * @param {Object} episode The episode associated with `markers`.
 * @returns {HTMLElement} The marker table for the given episode.
 */
function buildMarkerTable(markers, episode) {
    let container = buildNode('div', { class : 'tableHolder' });
    let table = buildNode('table', { class : 'hidden markerTable' });
    table.appendChild(buildNode('thead').appendChildren(rawTableRow(centeredColumn('Index'), timeColumn('Start Time'), timeColumn('End Time'), dateColumn('Date Added'), centeredColumn('Options'))));
    let rows = buildNode('tbody');
    if (markers.length == 0) {
        rows.appendChild(spanningTableRow('No markers found'));
    }

    // Sort by earliest to latest marker if there are multiple
    markers.sort(indexSort);

    for (const marker of markers) {
        rows.appendChild(tableRow(marker, episode));
    }

    rows.appendChild(spanningTableRow(createTextButton('Add Marker', onMarkerAdd, { metadataId : episode.metadataId })));

    table.appendChild(rows);
    container.appendChild(table);

    return container;
}

/**
 * Return a custom object for rawTableRow to parse, including properties to apply to start/end time columns.
 * @param {string} value The text of the column.
 */
function timeColumn(value) {
    return _classColumn(value, 'timeColumn');
}

/**
 * Return a custom object for rawTableRow to parse that will center the given column.
 * @param {string} value The text of the column.
 */
function centeredColumn(value) {
    return _classColumn(value, 'centeredColumn');
}

/**
 * Returns a column with a fixed width and centered contents.
 * @param {string} value The text of the column.
 */
function dateColumn(value) {
    return _classColumn(value, 'centeredColumn timeColumn');
}

/**
 * Return an object for rawTableRow to parse that will attach the given class name(s) to the column.
 * @typedef {{ value : string, properties : { class : string }}} CustomColumn
 * @param {string} value The text for the column.
 * @param {*} className The class name for the column.
 * @returns {CustomColumn}
 */
function _classColumn(value, className) {
    return {
        value : value,
        properties : {
            class : className
        }
    };
}

/**
 * Creates a table row for a specific marker of an episode
 * @param {MarkerData} marker The marker data.
 * @param {EpisodeData} episode The episode data
 * @returns 
 */
function tableRow(marker, episode) {
    let tr = buildNode('tr', { markerId : marker.id, metadataId : episode.metadataId, startTime : marker.start, endTime : marker.end });
    const td = (column, properties={}) => {
        return buildNode('td', properties, column);
    }

    tr.appendChildren(
        td(marker.index.toString()),
        td(timeData(marker.start)),
        td(timeData(marker.end)),
        td(friendlyDate(marker.createDate, marker.modifiedDate), { class : 'centeredColumn' }),
        td(optionButtons(marker.id))
    );

    return tr;
}

/**
 * Creates a "free-form" table row using the list of columns to add
 * @param {...[string|HTMLElement|CustomColumn]} columns The list of columns to add to the table row.
 */
function rawTableRow(...columns) {
    let tr = buildNode('tr');
    for (const column of columns) {
        if (typeof(column) == 'string' || column instanceof HTMLElement) {
            tr.appendChild(buildNode('td', {}, column));
        } else {
            tr.appendChild(buildNode('td', column.properties, column.value));
        }
    }

    return tr;
}

/**
 * Create a table row that spans the entire length of the table.
 * @param {string|HTMLElement} column The content of the column.
 * @returns {HTMLElement}
 */
function spanningTableRow(column) {
    return buildNode('tr').appendChildren(buildNode('td', { colspan : 5, style : 'text-align: center;' }, column));
}

/**
 * Returns a span of [hh:]mm:ss.000 data, with hover text of the equivalent milliseconds.
 * @param {number} offset The offset, in milliseconds
 */
function timeData(offset) {
    return buildNode('span', { title : offset }, msToHms(offset));
}

/**
 * Return a span that contains a "friendly" date (x [time span] ago), with a tooltip of the exact date.
 * @param {string} date The date the string
 * @param {string} [userModifiedDate] The date the marker was modified by the user, if any.
 */
function friendlyDate(date, userModifiedDate) {
    let node = buildNode('span', { class : userModifiedDate ? 'userModifiedMarker' : '' }, DateUtil.getDisplayDate(date));
    let tooltipText = `Automatically created on ${DateUtil.getFullDate(date)}`;
    if (userModifiedDate) {
        if (userModifiedDate == date) {
            tooltipText = `Manually added on ${DateUtil.getFullDate(date)}`;
        } else {
            tooltipText = `Added on ${DateUtil.getFullDate(date)}<br>Modified by user on ${DateUtil.getFullDate(userModifiedDate)}`;
        }
    }
    Tooltip.setTooltip(node, tooltipText);
    return node;
}

/**
 * Return a div containing edit/delete buttons for a marker.
 * @param {number} markerId The marker's id.
 * @returns {HTMLElement}
 */
function optionButtons(markerId) {
    return buildNode('div').appendChildren(
        createFullButton('Edit', 'edit', 'Edit Marker', 'standard', onMarkerEdit, { markerId : markerId }),
        createFullButton('Delete', 'delete', 'Delete Marker', 'red', confirmMarkerDelete, { markerId : markerId })
    );
}

/** Click handler for adding a marker. Creates a new row in the marker table with editable start/end time inputs. */
function onMarkerAdd() {
    const metadataId = parseInt(this.getAttribute('metadataId'));
    const thisRow = this.parentNode.parentNode;
    const timeStart = thumbnailTimeInput(metadataId);
    const timeEnd = thumbnailTimeInput(metadataId, null, true);
    const addedRow = thisRow.parentNode.insertBefore(rawTableRow('-', timeStart, timeEnd, dateColumn(''), centeredColumn('-')), thisRow);
    buildConfirmCancel(addedRow.children[3], 'Add', '-1', onMarkerAddConfirm, onMarkerAddCancel);
    addedRow.setAttribute('metadataId', metadataId);
    addedRow.setAttribute('markerId', '-1');
    addedRow.children[1].$$('input').focus();
}

/**
 * Return a text input meant for time input.
 * @param {string} [value] The initial value for the time input, if any.
 * @param {boolean} [end=false] Whether the time input is for the end of a marker.
 * @returns {HTMLElement} A text input for a marker.
 */
function timeInput(value, end=false) {
    let events = {};
    if (end) {
        events = { keydown : onEndTimeInput };
    }

    let input = buildNode('input', { type : 'text', maxlength : 12, class : 'timeInput', placeholder : 'ms or mm:ss[.000]', value : value ? value : '' }, 0, events);
    if (end) {
        Tooltip.setTooltip(input, 'Ctrl+Shift+E to replace with the end of the episode');
    }

    return input;
}

/**
 * If available and enabled, return a thumbnail image alongside the time input text.
 * Pressing 'Enter' in the input will refresh the thumbnail.
 * @param {number} metadataId The metadata id of the episode.
 * @param {string} [value] The initial value for the input field, if any.
 * @param {boolean} [end=false] Whether the time input is for the end of a marker.
 * @returns {HTMLElement} A time input, potentially with a thumbnail container attached.
 */
function thumbnailTimeInput(metadataId, value, end=false) {
    let input = timeInput(value, end);
    if (!g_localSettings.useThumbnails || !g_appConfig.useThumbnails || !PlexState.getEpisode(metadataId).hasThumbnails) {
        return input;
    }

    input.setAttribute('metadataId', metadataId);
    input.addEventListener('keyup', onTimeInputKeyup);
    let img = buildNode(
        'img',
        { src : `t/${metadataId}/${value ? parseInt(timeToMs(value) / 1000) : '0' }`, class : 'inputThumb', alt : 'Timestamp Thumbnail', width: '240px' },
        0,
        { error : function() { this.classList.add('hidden'); } });

    Tooltip.setTooltip(img, 'Press Enter after entering a timestamp<br>to update the thumbnail');
    return buildNode('div', { class : 'thumbnailTimeInput'}).appendChildren(input, img);
}

/**
 * Detects 'Enter' keypress in time input fields and fetches a new thumbnail if needed.
 * @param {KeyboardEvent} e
 * @this HTMLElement
 */
function onTimeInputKeyup(e) {
    if (e.keyCode != 13) {
        return;
    }

    const url = `t/${parseInt(this.getAttribute('metadataId'))}/${parseInt(timeToMs(this.value) / 1000)}`;
    let img = this.parentNode.$$('.inputThumb');
    if (!img) {
        this.parentNode.appendChild(
            buildNode(
                'img',
                { src : url, class : 'inputThumb', alt : 'timestamp thumbnail' },
                {},
                { error : () => this.classList.add('hidden') })
        );
    } else {
        img.classList.remove('hidden');
        img.src = url;
    }
}

/**
 * Add 'confirm' and 'cancel' icon buttons to the given container.
 * @param {HTMLElement} container The element to hold the icons.
 * @param {string} operation The type of operation.
 * @param {number} markerId The id of the marker.
 * @param {EventListener} confirmCallback Function to invoke when the 'confirm' button is clicked.
 * @param {EventListener} cancelCallback Function to invoke when the 'cancel' button is clicked.
 * @returns {HTMLElement} `container`
 */
function buildConfirmCancel(container, operation, markerId, confirmCallback, cancelCallback) {
    return container.appendChildren(
        createIconButton('confirm', `Confirm ${operation}`, 'green', confirmCallback, { markerId : markerId, title : `Confirm ${operation}` }),
        createIconButton('cancel', `Cancel ${operation}`, 'red', cancelCallback, { markerId : markerId, title : `Cancel ${operation}` })
    );
}

/**
 * Processes input to the 'End time' input field, entering the end of the episode on Ctrl+Shift+E
 * @param {KeyboardEvent} e
 */
function onEndTimeInput(e) {
    if (!e.shiftKey || !e.ctrlKey || e.key != 'E') {
        return;
    }

    e.preventDefault();
    let metadataId = 0;
    if (this.parentNode.$$('img')) {
        metadataId = this.parentNode.parentNode.parentNode.getAttribute('metadataId');
    } else {
        metadataId = parseInt(this.parentNode.parentNode.getAttribute('metadataId'));
    }

    this.value = msToHms(PlexState.getEpisode(metadataId).duration);
}

/** Handle cancellation of adding a marker - remove the temporary row and reset the 'Add Marker' button. */
function onMarkerAddCancel() {
    this.parentNode.parentNode.removeSelf();
}

/** Map of colors used for icons, which may vary depending on the current theme. */
const colors = {
    _dict : {
        0 /*dark*/ : {
            standard : 'c1c1c1',
            green : '4C4',
            red : 'C44'
        },
        1 /*light*/ : {
            standard : '212121',
            green : '292',
            red : 'A22'
        }
    },

    /**
     * Return the hex color for the given color category.
     * @param {string} color The color category for the button.
     * @returns {string} The hex color associated with the given color category.
     */
    get : function(color) { return this._dict[g_dark ? 0 : 1][color]; }
}

/**
 * Creates a tabbable button in the marker table with an associated icon.
 * @param {string} text The text of the button.
 * @param {string} icon The icon to use.
 * @param {string} altText The alt-text for the button icon.
 * @param {string} color The color of the icon as a hex string (without the leading '#')
 * @param {EventListener} clickHandler The callback to invoke when the button is clicked.
 * @param {Object<string, string>} attributes Additional attributes to set on the button.
 * @returns {HTMLElement}
 */
function createFullButton(text, icon, altText, color, clickHandler, attributes={}) {
    let button = _tableButtonHolder('buttonIconAndText', clickHandler, attributes);
    return button.appendChildren(
        buildNode('img', { src : `/i/${colors.get(color)}/${icon}.svg`, alt : altText, theme : color }),
        buildNode('span', {}, text)
    );
}

/**
 * Creates a tabbable button in the marker table that doesn't have an icon.
 * @param {string} text The text of the button.
 * @param {EventListener} clickHandler The button callback when its clicked.
 * @param {Object<string, string>} [attributes={}] Additional attributes to set on the button.
 * @returns {HTMLElement}
 */
function createTextButton(text, clickHandler, attributes={}) {
    let button = _tableButtonHolder('buttonTextOnly', clickHandler, attributes);
    return button.appendChildren(buildNode('span', {}, text));
}

/**
 * Creates a button with only an icon, no associated label text.
 * @param {string} icon The name of the icon to add to the button.
 * @param {string} altText The alt text for the icon image.
 * @param {string} color The color of the icon, as a hex string (without the leading '#')
 * @param {EventListener} clickHandler The button callback when its clicked.
 * @param {Object<string, string>} attributes Additional attributes to set on the button.
 * @returns {HTMLElement}
 */
function createIconButton(icon, altText, color, clickHandler, attributes={}) {
    let button = _tableButtonHolder('buttonIconOnly', clickHandler, attributes);
    return button.appendChildren(buildNode('img', { src : `/i/${colors.get(color)}/${icon}.svg`, alt : altText, theme : color }));
}

/**
 * Returns an empty button with the given class
 * @param {string} className The class name to give this button.
 * @param {EventListener} clickHandler The callback function when the button is clicked.
 * @param {Object<string, string>} attributes Additional attributes to set on the button.
 */
function _tableButtonHolder(className, clickHandler, attributes) {
    let button = buildNode('div', { class : `button ${className}`, tabindex : '0' }, 0, { click : clickHandler, keyup : tableButtonKeyup });
    for (const [key, value] of Object.entries(attributes)) {
        button.setAttribute(key, value);
    }

    return button;
}

/**
 * Treat 'Enter' on a table "button" as a click.
 * @param {KeyboardEvent} e
 * @this HTMLElement
 */
function tableButtonKeyup(e) {
    if (e.key == 'Enter') {
        e.preventDefault();
        this.click();
    }
}

/**
 * Set the text of a button created by tableButton or tableIconButton.
 * @param {HTMLElement} button
 * @param {string} text
 */
function setTableButtonText(button, text) {
    button.$$('span').innerText = text;
}

/**
 * Attempts to add a marker to the database, first validating that the marker is valid.
 * On success, make the temporary row permanent and rearrange the markers based on their start time.
 */
function onMarkerAddConfirm() {
    const thisRow = this.parentNode.parentNode;
    const metadataId = parseInt(thisRow.getAttribute('metadataId'));
    let inputs = thisRow.$('input[type=text]');
    const startTime = timeToMs(inputs[0].value);
    const endTime = timeToMs(inputs[1].value);

    if (!checkValues(metadataId, startTime, endTime)) {
        return;
    }

    let failureFunc = (response) => {
        Overlay.show(`Sorry, something went wrong trying to add the marker. Please try again later.\n\nServer response:\n${response.Error || response.message}`, 'OK');
    }

    jsonRequest('add', { metadataId : metadataId, start : startTime, end : endTime }, onMarkerAddSuccess.bind(thisRow), failureFunc);
}

/**
 * Callback after we successfully added a marker. Replace the temporary row with a permanent one, and adjust indexes as necessary.
 * @param {Object} response The server response, a serialized version of {@linkcode MarkerData}.
 */
function onMarkerAddSuccess(response) {
    const newMarker = new MarkerData().setFromJson(response);
    let episode = PlexState.getEpisode(newMarker.metadataItemId);
    let newRow = tableRow(newMarker, episode);
    let addRow = this;
    episode.addMarker(newMarker, addRow, newRow);
    episodeMarkerCountFromMarkerRow(newRow).innerText = plural(episode.markerCount(), 'Marker');
}

/**
 * Returns whether a marker the user wants to add/edit is valid.
 * Markers must:
 *  * Have a start time earlier than its end time.
 *  * Not overlap with any existing marker. The database technically supports overlapping markers (multiple versions of an episode with
 *    slightly different intro detection), but since the markers apply to the episode regardless of the specific version, there's no
 *    reason to actually allow overlapping markers.
 * @param {number} metadataId The metadata id of the episode we're modifying.
 * @param {number} startTime The start time of the marker, in milliseconds.
 * @param {number} endTime The end time of the marker, in milliseconds.
 * @param {boolean} [isEdit=false] Whether we're checking an edit operation. Defaults to `false`.
 * @param {number} [editIndex=0] The index of the marker being edited. Unused if `isEdit` is false.
 */
function checkValues(metadataId, startTime, endTime, isEdit=false, editIndex=0) {
    if (isNaN(metadataId)) {
        // If this is NaN, something went wrong on our side, not the user (unless they're tampering with things)
        Overlay.show('Sorry, something went wrong. Please reload the page and try again.', 'OK');
        return false;
    }

    if (isNaN(startTime) || isNaN(endTime)) {
        Overlay.show(`Could not parse start and/or end times. Please make sure they are specified in milliseconds (with no separators), or hh:mm:ss.000`, 'OK');
        return false;
    }

    if (startTime >= endTime) {
        Overlay.show('Start time cannot be greater than or equal to the end time.', 'OK');
        return false;
    }

    const markers = PlexState.getEpisode(metadataId).markers;
    let index = 0;
    for (const marker of markers) {
        if (marker.end >= startTime && marker.start <= endTime && (!isEdit || editIndex != index)) {
            const message = isEdit ? 'Adjust this marker\'s timings or delete the other marker first to avoid overlap.' : 'Edit the existing marker instead';
            Overlay.show(`That marker overlaps with an existing marker (${msToHms(marker.start)}-${msToHms(marker.end)}). ${message}`, 'OK');
            return;
        }

        index += 1;
    }

    return true;
}

/**
 * Parses [hh]:mm:ss.000 input into milliseconds (or the integer conversion of string milliseconds).
 * @param {string} value The time to parse
 * @returns The number of milliseconds indicated by `value`.
 */
function timeToMs(value) {
    let ms = 0;
    if (value.indexOf(':') == -1 && value.indexOf('.') == -1) {
        return parseInt(value);
    }

    // I'm sure this can be improved on.
    let result = /^(?:(\d?\d):)?(?:(\d?\d):)?(\d?\d)\.?(\d{1,3})?$/.exec(value);
    if (!result) {
        return NaN;
    }

    if (result[4]) {
        ms = parseInt(result[4]);
        switch (result[4].length) {
            case 1:
                ms *= 100;
                break;
            case 2:
                ms *= 10;
                break;
            default:
                break;
        }
    }

    if (result[3]) {
        ms += parseInt(result[3]) * 1000;
    }

    if (result[2]) {
        ms += parseInt(result[2]) * 60 * 1000;
    }

    // Because the above regex isn't great, if we have mm:ss.000, result[1]
    // will be populated but result[2] won't. This catches that and adds
    // result[1] as minutes instead of as hours like we do below.
    if (result[1] && !result[2]) {
        ms += parseInt(result[1]) * 60 * 1000;
    }

    if (result[1] && result[2]) {
        ms += parseInt(result[1]) * 60 * 60 * 1000;
    }

    return ms;
}

/**
 * Click handler for editing a marker.
 * Replaces static start/end markers with editable input fields that default to the current [hh]:mm:ss.000 times.
 */
function onMarkerEdit() {
    const markerId = parseInt(this.getAttribute('markerId'));
    let editRow = this.parentNode.parentNode.parentNode;
    if (editRow.classList.contains('editing')) {
        return;
    }

    const metadataId = parseInt(editRow.getAttribute('metadataId'));
    editRow.classList.add('editing');

    let startTime = editRow.children[1];
    let endTime = editRow.children[2];
    let modifiedDate = editRow.children[3];
    startTime.setAttribute('prevtime', startTime.firstChild.innerHTML);
    endTime.setAttribute('prevtime', endTime.firstChild.innerHTML);

    clearEle(startTime);
    clearEle(endTime);
    clearEle(modifiedDate);

    startTime.appendChild(thumbnailTimeInput(metadataId, startTime.getAttribute('prevtime')));
    endTime.appendChild(thumbnailTimeInput(metadataId, endTime.getAttribute('prevtime'), true));
    buildConfirmCancel(modifiedDate, 'Edit', markerId, onMarkerEditConfirm, onMarkerEditCancel);

    startTime.$$('input').focus();
    startTime.$$('input').select();
}

/** Commits a marker edit, assuming it passes marker validation. */
function onMarkerEditConfirm() {
    const markerId = parseInt(this.getAttribute('markerId'));
    const editedRow = $$(`tr[markerid="${markerId}"]`);
    const inputs = editedRow.$('input[type="text"]');
    const startTime = timeToMs(inputs[0].value);
    const endTime = timeToMs(inputs[1].value);

    if (!checkValues(editedRow.getAttribute('metadataId'), startTime, endTime, true /*isEdit*/, parseInt(editedRow.children[0].innerText))) {
        return;
    }

    let failureFunc = (response) => {
        onMarkerEditCancel.bind(this)();
        Overlay.show(`Sorry, something went wrong with that request. Server response:<br><br>${response.Error || response.message}`, 'OK');
    }

    jsonRequest('edit', { id : markerId, start : startTime, end : endTime }, onMarkerEditSuccess, failureFunc.bind(editedRow));
}

/**
 * Callback after a marker has been successfully edited. Replace input fields with the new times, and adjust indexes as necessary.
 * @param {Object} response The response from the server.
 */
function onMarkerEditSuccess(response) {
    const partialMarker = new MarkerData().setFromJson(response);
    const markerId = partialMarker.id;
    let editedRow = $$(`tr[markerid="${markerId}"]`);
    PlexState.getEpisode(partialMarker.metadataItemId).editMarker(partialMarker, editedRow);
    resetAfterEdit(markerId, partialMarker.start, partialMarker.end);
}

const indexSort = (a, b) => a.index - b.index;

/** Cancels an edit operation, reverting the editable row fields with their previous times. */
function onMarkerEditCancel() {
    const markerId = parseInt(this.getAttribute('markerid'));
    const editRow = $$(`tr[markerid="${markerId}"]`)
    resetAfterEdit(markerId, timeToMs(editRow.children[1].getAttribute('prevtime')), timeToMs(editRow.children[2].getAttribute('prevtime')));
}

/**
 * Removes the editable input fields from a marker that was in edit mode,
 * replacing them with the static values provided by newStart and newEnd.
 * @param {number} markerId
 * @param {number} newStart Start of the marker, in milliseconds.
 * @param {number} newEnd End of the marker, in milliseconds.
 */
function resetAfterEdit(markerId, newStart, newEnd) {
    let editRow = markerRowFromMarkerId(markerId);
    let modifiedDateRow = editRow.children[3];
    const metadataId = parseInt(editRow.getAttribute('metadataId'));
    clearEle(modifiedDateRow);
    const marker = PlexState.getEpisode(metadataId).markers[parseInt(editRow.children[0].innerText)];
    let dateNode = friendlyDate(marker.createDate, marker.modifiedDate);
    dateNode.classList.add('centeredColumn');
    modifiedDateRow.appendChild(dateNode)


    clearEle(editRow.children[1]);
    clearEle(editRow.children[2]);
    editRow.children[1].appendChild(timeData(newStart));
    editRow.children[2].appendChild(timeData(newEnd));
    editRow.classList.remove('editing');
}

/** Prompts the user before deleting a marker */
function confirmMarkerDelete() {
    // Build confirmation dialog
    let container = buildNode('div', { class : 'overlayDiv' });
    let header = buildNode('h2', {}, 'Are you sure?');
    let subtext = buildNode('div', {}, 'Are you sure you want to permanently delete this intro marker?');

    let okayButton = buildNode(
        'input',
        {
            type : 'button',
            value : 'Delete',
            class : 'overlayButton confirmDelete',
            markerId : this.getAttribute('markerId')
        },
        0,
        {
            click : onMarkerDelete.bind(this)
        }
    );

    let cancelButton = buildNode(
        'input',
        {
            id : 'deleteMarkerCancel',
            type : 'button',
            value : 'Cancel',
            class : 'overlayButton'
        },
        0,
        {
            click : Overlay.dismiss
        }
    );

    let outerButtonContainer = buildNode("div", { class : "formInput", style : "text-align: center" });
    let buttonContainer = buildNode("div", { style : "float: right; overflow: auto; width: 100%; margin: auto" });
    outerButtonContainer.appendChild(buttonContainer.appendChildren(okayButton, cancelButton));
    container.appendChildren(header, subtext, outerButtonContainer);
    Overlay.build({ dismissible: true, centered: false, setup: { fn : () => $('#deleteMarkerCancel').focus(), args : [] } }, container);
}

/** Makes a request to delete a marker, removing it from the marker table on success. */
function onMarkerDelete() {
    Overlay.dismiss();
    const markerId = parseInt(this.getAttribute('markerId'));

    let failureFunc = (response) => {
        Overlay.show(`Failed to delete marker:<br><br>${response.Error}`, 'OK');
    }

    jsonRequest('delete', { id : markerId }, onMarkerDeleteSuccess, failureFunc);
}

/**
 * Callback after a marker was successfully deleted. Remove its row in the table and adjust indexes as necessary.
 * @param {Object} response The response from the server.
 */
function onMarkerDeleteSuccess(response) {
    const deletedMarker = new MarkerData().setFromJson(response);
    const markerId = response.id;
    const metadataId = response.metadataItemId;
    let deletedRow = markerRowFromMarkerId(markerId);
    let markerCount = episodeMarkerCountFromMarkerRow(deletedRow);
    let episodeData = PlexState.getEpisode(metadataId);

    episodeData.deleteMarker(deletedMarker, deletedRow, episodeData.markerCount() == 1 ? spanningTableRow('No markers found') : null);

    markerCount.innerText = plural(episodeData.markerCount(), 'Marker');
}

/**
 * Return the HTML row for the marker with the given id.
 * @param {number} id The marker id.
 */
function markerRowFromMarkerId(id) {
    return $$(`tr[markerid="${id}"]`);
}

/**
 * From the given row in the marker table, return the associated 'X Markers' column of its episode.
 * @param {HTMLElement} row The marker row.
 * @returns {HTMLElement}
 */
function episodeMarkerCountFromMarkerRow(row) {
    //     <tr><tbody>    <table>   <tableHolder>  <div>     <episodeResult>    <episodeResultMarkers>
    return row.parentNode.parentNode.parentNode.parentNode.$$('.episodeResult').children[1];
}

/**
 * Return 'n text' if n is 1, otherwise 'n texts'.
 * @param {number} n The number of items.
 * @param {string} text The type of item.
 */
function plural(n, text) {
    return `${n} ${text}${n == 1 ? '' : 's'}`;
}

/**
 * Pads 0s to the front of `val` until it reaches the length `pad`.
 * @param {number} val The value to pad.
 * @param {number} pad The minimum length of the string to return.
 */
function pad0(val, pad) {
    val = val.toString();
    return '0'.repeat(Math.max(0, pad - val.length)) + val;
}

/**
 * Convert milliseconds to a user-friendly [h:]mm:ss.000 string.
 * @param {number} ms
 */
function msToHms(ms) {
    let seconds = ms / 1000;
    const hours = parseInt(seconds / 3600);
    const minutes = parseInt(seconds / 60) % 60;
    seconds = parseInt(seconds) % 60;
    const thousandths = ms % 1000;
    let time = pad0(minutes, 2) + ":" + pad0(seconds, 2) + "." + pad0(thousandths, 3);
    if (hours > 0)
    {
        time = hours + ":" + time;
    }

    return time;
}

/**
 * Removes all children from the given element.
 * @param {HTMLElement} ele The element to clear.
 */
function clearEle(ele) {
    while (ele.firstChild) {
        ele.removeChild(ele.firstChild);
    }
}

/**
 * Generic method to make a request to the given endpoint that expects a JSON response.
 * @param {string} endpoint The URL to query.
 * @param {Object<string, any>} parameters URL parameters.
 * @param {Function<Object>} successFunc Callback function to invoke on success.
 * @param {Function<Object>} failureFunc Callback function to invoke on failure.
 */
function jsonRequest(endpoint, parameters, successFunc, failureFunc) {
    let url = new URL(endpoint, window.location.href);
    for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.append(key, value);
    }

    fetch(url, { method : 'POST', headers : { accept : 'application/json' } }).then(r => r.json()).then(response => {
        Log.verbose(response);
        if (!response || response.Error) {
            if (failureFunc) {
                failureFunc(response);
            } else {
                console.error('Request failed: %o', response);
            }

            return;
        }

        successFunc(response);
    }).catch(err => {
        failureFunc(err);
    });
}

/**
 * Custom jQuery-like selector method.
 * If the selector starts with '#' and contains no spaces, return the result of `querySelector`,
 * otherwise return the result of `querySelectorAll`.
 * @param {DOMString} selector The selector to match.
 * @param {HTMLElement} ele The scope of the query. Defaults to `document`.
 */
function $(selector, ele=document) {
    if (selector.indexOf("#") === 0 && selector.indexOf(" ") === -1) {
        return $$(selector, ele);
    }

    return ele.querySelectorAll(selector);
}

/**
 * Like $, but forces a single element to be returned. i.e. querySelector.
 * @param {string} selector The query selector.
 * @param {HTMLElement} [ele=document] The scope of the query. Defaults to `document`.
 */
function $$(selector, ele=document) {
    return ele.querySelector(selector);
}

/**
 * $ operator scoped to a specific element.
 * @param {string} selector The query selector.
 * @type {Function<DOMString>}
 */
Element.prototype.$ = function(selector) {
    return $(selector, this);
};

/**
 * $$ operator scoped to a specific element.
 * @param {string} selector The query selector.
 * @returns {Element}
 * @function
 */
Element.prototype.$$ = function(selector) {
    return $$(selector, this);
};

/**
 * Remote this element from the DOM.
 * @returns Its detached self.
 */
Element.prototype.removeSelf = function() {
     return this.parentNode.removeChild(this);
}

/**
 * Helper method to create DOM elements.
 * @param {string} type The TAG to create.
 * @param {Object<string, string>} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement} [content] The inner content of the element, either a string or an element.
 * @param {Object<string, EventListener>} [events] Map of events (click/keyup/etc) to attach to the element.
 */
function buildNode(type, attrs, content, events) {
    let ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events);
}

/**
 * Helper method to create DOM elements with the given namespace (e.g. SVGs).
 * @param {string} ns The namespace to create the element under.
 * @param {string} type The type of element to create.
 * @param {Object<string, string>} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement} [content] The inner content of the element, either a string or an element.
 * @param {Object<string, EventListener>} [events] Event listeners to add to the element.
 */
function buildNodeNS(ns, type, attrs, content, events) {
    let ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events);
}

/**
 * "Private" core method for buildNode and buildNodeNS, that handles both namespaced and non-namespaced elements.
 * @param {HTMLElement} ele The HTMLElement to attach the given properties to.
 * @param {Object<string, string>} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement} [content] The inner content of the element, either a string or an element.
 * @param {Object<string, EventListener>} [events] Event listeners to add to the element.
 */
function _buildNode(ele, attrs, content, events) {
    if (attrs) {
        for (let [key, value] of Object.entries(attrs)) {
            ele.setAttribute(key, value);
        }
    }

    if (events) {
        for (let [event, func] of Object.entries(events)) {
            ele.addEventListener(event, func);
        }
    }

    if (content) {
        if (content instanceof HTMLElement) {
            ele.appendChild(content);
        } else {
            ele.innerHTML = content;
        }
    }

    return ele;
}

/**
 * Helper to append multiple children to a single element at once.
 * @param {...HTMLElement} elements Elements to append this this `HTMLElement`
 * @returns {Element} Itself
 */
Element.prototype.appendChildren = function(...elements) {
    for (let element of elements) {
        if (element) {
            this.appendChild(element);
        }
    }

    return this;
};

// Ugly hack to let VSCode see the definition of external classes in this client-side JS file without
// causing client-side errors. Some of these classes will resolve correctly without this workaround
// if they're also open in an active editor, but the method below ensures JSDoc is available regardless
// of that.
if (typeof __dontEverDefineThis !== 'undefined') {
    const { ShowData, SeasonData, EpisodeData, MarkerData } = require("../../Shared/PlexTypes");
    const { Chart } = require('./inc/Chart.js');
    const { DateUtil } = require('./inc/DateUtil.js');
    const { Overlay } = require('./inc/Overlay.js');
    const { Tooltip } = require('./inc/Tooltip.js');
}
