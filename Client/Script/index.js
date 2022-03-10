import { $, $$, appendChildren, buildNode, clearEle, errorMessage, jsonRequest, pad0, plural } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';
import { ShowData, SeasonData } from '../../Shared/PlexTypes.js';

import Overlay from './inc/Overlay.js';
import Tooltip from './inc/Tooltip.js';

import ButtonCreator from './ButtonCreator.js';
import ClientEpisodeData from './ClientEpisodeData.js';
import ClientSettingsManager from './ClientSettings.js';
import MarkerBreakdownManager from './MarkerBreakdownChart.js';
import PlexClientState from './PlexClientState.js';

window.Log = Log; // Let the user interact with the class to tweak verbosity/other settings.

window.addEventListener('load', setup);

/** @type {PlexClientState} */
let PlexState;

/** @type {ClientSettingsManager} */
let Settings;

/** Initial setup on page load. */
function setup()
{
    Settings = new ClientSettingsManager(onSettingsApplied);
    $('#showInstructions').addEventListener('click', showHideInstructions);
    $('#libraries').addEventListener('change', libraryChanged);
    $('#search').addEventListener('keyup', onSearchInput);
    PlexState = new PlexClientState();

    // MarkerBreakdownManager is self-contained - we don't need anything from it,
    // and it doesn't need anything from us, so no need to keep a reference to it.
    new MarkerBreakdownManager(PlexState);
    mainSetup();
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
        Overlay.show(`Error getting libraries, please verify you have provided the correct database path and try again. Server Message:<br><br>${errorMessage(response)}`, 'OK');
    };

    let gotConfig = (config) => {
        Settings.parseServerConfig(config);
        jsonRequest('get_sections', {}, listLibraries, failureFunc);
    }

    let noConfig = () => {
        Log.warn('Unable to get app config, assume everything is disabled.');
        Settings.parseServerConfig({});
        jsonRequest('get_sections', {}, listLibraries, failureFunc);
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

    const savedSection = Settings.lastSection();

    // We might not find the section if we're using a different database or the library was deleted,
    let lastSectionExists = false;
    libraries.forEach(library => {
        lastSectionExists = lastSectionExists || library.id == savedSection;
        select.appendChild(buildNode(
            'option',
            { value: `${library.id}` },
            library.name)
        );
    });

    if (savedSection != -1 && !lastSectionExists) {
        Log.info(`Found a cached library section (${savedSection}), but it doesn't exist anymore!`);
    }

    // Select a library automatically if there's only one TV show library
    // or we have an existing cached library section.
    let preSelect = libraries.length == 1 ? libraries[0].id : lastSectionExists ? savedSection : -1;
    if (preSelect != -1) {
        select.value = preSelect;
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
        Settings.setLastSection(section);
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

/** Callback invoked when settings are applied.
 * @param {boolean} shouldResetView Whether a setting that affects the display of markers
 * was changed, requiring the current view to be reset. */
function onSettingsApplied(shouldResetView) {
    if (shouldResetView) {
        clearAll();
    }

    // If the search input is visible, clear its input and give it focus.
    const searchInput = $('#search');
    if (!searchInput.classList.contains('hidden')) {
        searchInput.value = '';
        searchInput.focus();
    }
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

    let row = appendChildren(buildNode('div', { class : 'showResult', metadataId : show.metadataId }, 0, events),
        titleNode,
        buildNode('div', { class : 'showResultSeasons' }, plural(show.seasonCount, 'Season')),
        buildNode('div', { class : 'showResultEpisodes' }, getEpisodeDisplay(show))
    );

    if (selected) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
            ButtonCreator.fullButton('Back to results', 'back', 'Go back', 'standard', () => {
                clearAndShow($('#seasonlist'));
                clearAndShow($('#episodelist'));
                $('#showlist').classList.remove('hidden');
            })
        );
    }

    return row;
}

/**
 * Get the episode summary display, which varies depending on whether extended marker information is enabled.
 * @param {ShowData|SeasonData} item
 * @returns A basic 'X Episode(s)' string if extended marker information is disabled, otherwise a Span
 * that shows how many episodes have at least one marker, with tooltip text with a further breakdown of
 * how many episodes have X markers.
 */
function getEpisodeDisplay(item) {
    if (!Settings.showExtendedMarkerInfo()) {
        return plural(item.episodeCount, 'Episode');
    }

    let atLeastOne = 0;
    let tooltipText = `${plural(item.episodeCount, 'Episode')}<br>`;
    let keys = Object.keys(item.markerBreakdown);
    keys.sort((a, b) => parseInt(a) - parseInt(b));
    for (const key of keys) {
        const episodeCount = item.markerBreakdown[key];
        tooltipText += `${episodeCount} ${episodeCount == 1 ? 'has' : 'have'} ${plural(parseInt(key), ' marker')}<br>`;
        if (key != 0) {
            atLeastOne += episodeCount;
        }
    }

    if (!tooltipText) {
        tooltipText = 'No markers';
    }

    const percent = (atLeastOne / item.episodeCount * 100).toFixed(2);
    let episodeDisplay = buildNode('span', {}, `${atLeastOne}/${item.episodeCount} (${percent}%)`);
    Tooltip.setTooltip(episodeDisplay, tooltipText);
    return episodeDisplay;
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
        Overlay.show(`Something went wrong when retrieving the seasons for ${show.title}.<br>Server message:<br>${errorMessage(response)}`, 'OK');
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

    let row = appendChildren(buildNode('div', { class : 'seasonResult', metadataId : season.metadataId }, 0, events),
        titleNode,
        buildNode('div'), // empty to keep alignment w/ series
        buildNode('div', { class : 'showResultEpisodes' }, getEpisodeDisplay(season))
    );

    if (selected) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
            ButtonCreator.fullButton('Back to seasons', 'back', 'Go back', 'standard', () => {
                clearAndShow($('#episodelist'));
                $('#seasonlist').classList.remove('hidden');
            })
        );
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
        Overlay.show(`Something went wrong when retrieving the episodes for ${season.title}.<br>Server message:<br>${errorMessage(response)}`, 'OK');
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
        PlexState.addEpisode(new ClientEpisodeData().setFromJson(episode));
        queryString.push(episode.metadataId);
    }

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the markers for these episodes, please try again.<br><br>Server Message:<br>${errorMessage(response)}`, 'OK');
    }

    jsonRequest('query', { keys : queryString.join(',') }, showEpisodesAndMarkers, failureFunc);
}

/**
 * Takes the given list of episode data and creates entries for each episode and its markers.
 * @param {{[metadataId: number]: Object[]}} data Map of episode ids to an array of
 * serialized {@linkcode MarkerData} for the episode.
 */
function showEpisodesAndMarkers(data) {
    let episodelist = $('#episodelist');
    clearEle(episodelist);
    $('#seasonlist').classList.add('hidden');
    episodelist.appendChild(buildShowRow(PlexState.getActiveShow(), true /*selected*/));
    episodelist.appendChild(buildNode('hr'));
    episodelist.appendChild(buildSeasonRow(PlexState.getActiveSeason(), true /*selected*/));
    episodelist.appendChild(buildNode('hr'));
    for (const metadataId of Object.keys(data)) {
        let episode = PlexState.getEpisode(parseInt(metadataId));
        episode.createMarkerTable(data[metadataId]);

        appendChildren(episodelist,
            appendChildren(buildNode('div'),
                appendChildren(buildNode('div', { class : 'episodeResult', title : 'Click to expand/contract. Control+Click to expand/contract all' }, 0, { click : showHideMarkerTable }),
                    appendChildren(buildNode('div', { class : 'episodeName' }),
                        buildNode('span', { class : 'markerExpand' }, '&#9205; '),
                        buildNode('span', {}, `${episode.showName} - S${pad0(episode.seasonIndex, 2)}E${pad0(episode.index, 2)} - ${episode.title || 'Episode ' + episode.index}`)
                    ),
                    buildNode('div', { class : 'episodeResultMarkers' }, plural(episode.markerCount(), 'Marker'))),
                episode.markerTable(),
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
    const expanded = !$$('table', this.parentNode).classList.contains('hidden');
    if (e.ctrlKey) {
        let episodeList = $('#episodelist');
        for (const episode of episodeList.children) {
            const table = $$('table', episode);
            // headers don't have a table
            if (!table) {
                continue;
            }

            if (expanded) {
                table.classList.add('hidden');
                $$('.markerExpand', episode).innerHTML = '&#9205; ';
            } else {
                table.classList.remove('hidden');
                $$('.markerExpand', episode).innerHTML = '&#9660; ';
            }
        }
    } else {
        $$('table', this.parentNode).classList.toggle('hidden');
        $$('.markerExpand', this).innerHTML = expanded ? '&#9205; ' : '&#9660; ';
    }
}

export { PlexState, Settings }
