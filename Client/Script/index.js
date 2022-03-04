/**
 * @typedef {!import('../../Shared/PlexTypes').ShowMap} ShowMap
 */

window.addEventListener('load', setup);

/** @type {PlexClientState} */
let PlexState;

/** @type {ClientSettingsManager} */
let Settings;

/** Initial setup on page load. */
function setup()
{
    Settings = new ClientSettingsManager();
    $('#showInstructions').addEventListener('click', showHideInstructions);
    $('#libraries').addEventListener('change', libraryChanged);
    $('#search').addEventListener('keyup', onSearchInput);
    $('#settings').addEventListener('click', Settings.showSettings.bind(Settings));
    setupMarkerBreakdown();
    PlexState = new PlexClientState();
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
        Overlay.show(`Error getting libraries, please verify you have provided the correct database path and try again. Server Message:<br><br>${response.Error}`, 'OK');
    };

    let gotConfig = (config) => {
        Settings.parseServerConfig(config);
        jsonRequest('get_sections', {}, listLibraries, failureFunc);
    }

    let noConfig = () => {
        Log.warn('Unable to get app config, defaulting to no preview thumbnails.');
        Settings.parseServerConfig({ useThumbnails : false });
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
        appendChildren(buildNode('div'),
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
        appendChildren(buildNode('div', { style : 'text-align: center' }), chart));
}

/**
 * Let the user know something went wrong if we failed to grab marker stats.
 * @param {Object} response JSON failure message.
 */
function markerBreakdownFailed(response) {
    Overlay.destroy();
    Overlay.show(
        appendChildren(buildNode('div'),
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

    let row = appendChildren(buildNode('div', { class : 'showResult', metadataId : show.metadataId }, 0, events),
        titleNode,
        buildNode('div', { class : 'showResultSeasons' }, plural(show.seasonCount, 'Season')),
        buildNode('div', { class : 'showResultEpisodes' }, plural(show.episodeCount, 'Episode'))
    );

    if (selected) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' }),
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

    let row = appendChildren(buildNode('div', { class : 'seasonResult', metadataId : season.metadataId }, 0, events),
        titleNode,
        buildNode('div'), // empty to keep alignment w/ series
        buildNode('div', { class : 'showResultEpisodes' }, plural(season.episodeCount, 'Episode'))
    );

    if (selected) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' }),
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
        Overlay.show(`Something went wrong when retrieving the markers for these episodes, please try again.<br><br>Server Message:<br>${response.Error || response.message}`, 'OK');
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

        appendChildren(episodelist,
            appendChildren(buildNode('div'),
                appendChildren(buildNode('div', { class : 'episodeResult', title : 'Click to expand/contract. Control+Click to expand/contract all' }, 0, { click : showHideMarkerTable }),
                    appendChildren(buildNode('div', { class : 'episodeName' }),
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

/**
 * Takes the given marker data and creates a table to display it, including add/edit/delete options.
 * @param {MarkerData[]} markers The array of markers for `episode`.
 * @param {Object} episode The episode associated with `markers`.
 * @returns {HTMLElement} The marker table for the given episode.
 */
function buildMarkerTable(markers, episode) {
    let container = buildNode('div', { class : 'tableHolder' });
    let table = buildNode('table', { class : 'hidden markerTable' });
    table.appendChild(buildNode('thead').appendChild(rawTableRow(centeredColumn('Index'), timeColumn('Start Time'), timeColumn('End Time'), dateColumn('Date Added'), centeredColumn('Options'))));
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

    appendChildren(tr,
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
    return appendChildren(buildNode('tr'), buildNode('td', { colspan : 5, style : 'text-align: center;' }, column));
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
    return appendChildren(buildNode('div'),
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
    $$('input', addedRow.children[1]).focus();
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
    if (!Settings.useThumbnails() || !PlexState.getEpisode(metadataId).hasThumbnails) {
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
    return appendChildren(buildNode('div', { class : 'thumbnailTimeInput'}), input, img);
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
    let img = $$('.inputThumb', this.parentNode);
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
    return appendChildren(container,
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
    if ($$('img', this.parentNode)) {
        metadataId = this.parentNode.parentNode.parentNode.getAttribute('metadataId');
    } else {
        metadataId = parseInt(this.parentNode.parentNode.getAttribute('metadataId'));
    }

    this.value = msToHms(PlexState.getEpisode(metadataId).duration);
}

/** Handle cancellation of adding a marker - remove the temporary row and reset the 'Add Marker' button. */
function onMarkerAddCancel() {
    let grandparent = this.parentNode.parentNode;
    let greatGrandparent = grandparent.parentNode;
    greatGrandparent.removeChild(grandparent);
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
    return appendChildren(button,
        buildNode('img', { src : `/i/${ThemeColors.get(color)}/${icon}.svg`, alt : altText, theme : color }),
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
    return appendChildren(button, buildNode('span', {}, text));
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
    return appendChildren(button, buildNode('img', { src : `/i/${ThemeColors.get(color)}/${icon}.svg`, alt : altText, theme : color }));
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
 * Attempts to add a marker to the database, first validating that the marker is valid.
 * On success, make the temporary row permanent and rearrange the markers based on their start time.
 */
function onMarkerAddConfirm() {
    const thisRow = this.parentNode.parentNode;
    const metadataId = parseInt(thisRow.getAttribute('metadataId'));
    let inputs = $('input[type=text]', thisRow);
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

    $$('input', startTime).focus();
    $$('input', startTime).select();
}

/** Commits a marker edit, assuming it passes marker validation. */
function onMarkerEditConfirm() {
    const markerId = parseInt(this.getAttribute('markerId'));
    const editedRow = $$(`tr[markerid="${markerId}"]`);
    const inputs = $('input[type="text"]', editedRow);
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
    outerButtonContainer.appendChild(appendChildren(buttonContainer, okayButton, cancelButton));
    appendChildren(container, header, subtext, outerButtonContainer);
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
    //                        <tr><tbody>    <table>   <tableHolder>  <div>
    const tableHolderParent = row.parentNode.parentNode.parentNode.parentNode;
    return $$('.episodeResult', tableHolderParent).children[1];
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

// Ugly hack to let VSCode see the definition of external classes in this client-side JS file without
// causing client-side errors. Some of these classes will resolve correctly without this workaround
// if they're also open in an active editor, but the method below ensures JSDoc is available regardless
// of that.
if (typeof __dontEverDefineThis !== 'undefined') {
    const { Log } = require('../../Shared/ConsoleLog.js');
    const { ShowData, SeasonData, EpisodeData, MarkerData } = require("../../Shared/PlexTypes");
    const { PlexClientState } = require('./PlexClientState');
    const { ClientSettingsManager } = require('./ClientSettings');
    const { ThemeColors } = require('./ThemeColors');
    const { clearEle, jsonRequest, $, $$, buildNode, appendChildren  } = require('./Common');
    const { Chart } = require('./inc/Chart');
    const { DateUtil } = require('./inc/DateUtil');
    const { Overlay } = require('./inc/Overlay');
    const { Tooltip } = require('./inc/Tooltip');
}
