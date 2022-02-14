window.addEventListener('load', setup);

let plex;

function setup()
{
    $('#showInstructions').addEventListener('click', showHideInstructions);
    $('#libraries').addEventListener('change', libraryChanged);
    $('#search').addEventListener('keyup', onSearchInput);
    plex = new Plex();
    getLibraries();
}

class Plex
{
    constructor()
    {
        this.activeSection = -1;
        this.shows = {};
    }

    async setSection(section) {
        this.activeSection = isNaN(section) ? -1 : section;
        if (this.activeSection != -1) {
            await this._populate_shows();
        }
    }

    search(query, successFunc)
    {
        // Ignore non-word characters to improve matching if there are spacing or quote mismatches. Don't use \W though, since that also clears out unicode characters.
        // Rather than import some heavy package that's aware of unicode word characters, just clear out the most common characters we want to ignore.
        // I could probably figure out how to utilize Plex's spellfix tables, but substring search on display, sort, and original titles should be good enough here.
        query = query.toLowerCase().replace(/[\s,'"_\-!?]/g, '');

        const showList = this.shows[this.activeSection];

        let result = [];
        for (const show of showList) {
            if (show.titleSearch.indexOf(query) != -1 || (show.sort && show.sort.indexOf(query) != -1) || (show.original && show.original.indexOf(query) != -1)) {
                result.push(show);
            }
        }

        const defaultSort = (a, b) => {
            const aTitle = a.sort || a.titleSearch;
            const bTitle = b.sort || b.titleSearch;
            return aTitle.localeCompare(bTitle);
        }

        // Sort the results. Title prefix matches are first, then sort title prefix matches, the original title prefix matches, and alphabetical sort title after that.
        result.sort((a, b) => {
            if (query.length == 0) {
                // Blank query should return all shows, and in that case we just care about sort title order
                return defaultSort(a, b);
            }

            const prefixTitleA = a.titleSearch.startsWith(query);
            const prefixTitleB = b.titleSearch.startsWith(query);
            if (prefixTitleA != prefixTitleB) {
                return prefixTitleA ? -1 : 1;
            }

            const prefixSortA = a.sort && a.sort.startsWith(query);
            const prefixSortB = b.sort && b.sort.startsWith(query);
            if (prefixSortA != prefixSortB) {
                return prefixSortA ? -1 : 1;
            }

            const prefixOrigA = a.original && a.original.startsWith(query);
            const prefixOrigB = b.original && b.original.startsWith(query);
            if (prefixOrigA != prefixOrigB) {
                return prefixOrigA ? -1 : 1;
            }

            return defaultSort(a, b);
        });


        successFunc(result);
    }

    /// <summary>
    /// Async because we don't want to try searching/other operations until we finish the search, so await the result
    /// </summary>
    async _populate_shows() {
        if (this.shows[this.activeSection]) {
            return Promise.resolve();
        }

        const successFunc = (response) => {
            plex.shows[plex.activeSection] = response;
            resolve();
        }

        return new Promise(resolve => {
            jsonRequest(
                'get_section',
                { id : plex.activeSection },
                (res) => {
                    plex.shows[plex.activeSection] = res;
                    resolve()
                },
                (res) => {
                    Overlay.show(`Something went wrong retrieving shows from the selected library, please try again later.<br><br>Server message:<br>${res.Error}`);
                });
        });
    }
}

function showHideInstructions() {
    $('.instructions').forEach(instruction => instruction.classList.toggle('hidden'));
    if (this.innerHTML[0] == '+') {
        this.innerHTML = '- Click to hide details';
    } else {
        this.innerHTML = '+ Click here for details';
    }
}

function getLibraries() {
    let failureFunc = (response) => {
        Overlay.show(`Error getting libraries, please verify you have provided the correct database path and try again. Server Message:<br><br>${response.Error}`, 'OK');
    };

    jsonRequest('get_sections', {}, listLibraries, failureFunc);
}

/// <summary>
/// Populate the library selection dropdown with the items retrieved from the database.
/// If only a single library is returned, automatically select it.
/// </summary>
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

/// <summary>
/// Handles when the selected library changes, clearing any
/// existing data and requesting new show data.
/// </summary>
async function libraryChanged() {
    $('#container').classList.add('hidden');
    let section = parseInt(this.value);
    await plex.setSection(section);
    clearAll();
    if (!isNaN(section) && section != -1) {
        $('#container').classList.remove('hidden');
    }
}

/// <summary>Clear data from the show, season, and episode lists.</summary>
function clearAll() {
    for (const group of [$('#showlist'), $('#seasonlist'), $('#episodelist')])
    {
        clearAndShow(group);
    }
}

/// <summary>
/// Reset a given element - clearing its contents and the hidden flag.
/// </summary>
function clearAndShow(ele) {
    clearEle(ele);
    ele.classList.remove('hidden');
}

let g_searchTimer;

/// </summary>
/// Handle search box input. Invoke a search immediately if 'Enter'
/// is pressed, otherwise set a timeout to invoke a search after
/// a quarter of a second has passed.
/// </summary>
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

/// <summary>Initiate a search to the database for shows.</summary>
function search() {
    // Remove any existing show/season/marker data
    clearAll();
    g_seasonResults = {};
    g_episodeResults = {};
    plex.search($('#search').value, parseShowResults);
}

/// <summary>Map of metadata IDs to show information</summary>
let g_showResults = {}

/// <summary>
/// Takes the results of a show search and creates entries for each match.
/// </summary>
function parseShowResults(data) {
    let showList = $('#showlist');
    clearAndShow(showList);
    g_showResults = {};

    if (data.length == 0) {
        showList.appendChild(buildNode('div', { class : 'showResult' }, "No results found."));
        return;
    }

    for (const show of data) {
        let div = buildShowRow(show);
        showList.appendChild(div);
        g_showResults[show.metadataId] = show;
    }
}

/// <summary>
/// Creates a DOM element for a show result.
/// Each entry contains three columns - the show name, the number of seasons, and the number of episodes.
/// </summary>
/// <param name="selected">True if this row is selected and should be treated like a header opposed to a clickable entry</param>
function buildShowRow(show, selected=false) {
    let titleNode = buildNode('div', {}, show.title);
    if (show.original) {
        titleNode.appendChild(buildNode('span', { class : 'showResultOriginalTitle' }, ` (${show.original})`));
    }

    let events = {};
    if (!selected) {
        events = { click : showClick };
    }

    let row = buildNode('div', { class : 'showResult', metadataId : show.metadataId }, 0, events).appendChildren(
        titleNode,
        buildNode('div', { class : 'showResultSeasons' }, show.seasons + ' Season' + (show.seasons == 1 ? '' : 's')),
        buildNode('div', { class : 'showResultEpisodes' }, show.episodes + ' Episode' + (show.episodes == 1 ? '' : 's'))
    );

    if (selected) {
        row.classList.add('selected');
        row.appendChild(buildNode('div', { class : 'goBack' }).appendChildren(
            buildNode('input', { type : 'button', value : 'Go Back' }, 0, { click : () => {
                clearAndShow($('#seasonlist'));
                clearAndShow($('#episodelist'));
                $('#showlist').classList.remove('hidden');
            }
        })));
    }

    return row;
}

/// <summary>
/// Click handler for clicking a show row. Initiates a request for season details.
/// </summary>
function showClick() {
    // Remove any existing marker data
    clearEle($('#episodelist'));
    g_episodeResults = {};

    let show = g_showResults[this.getAttribute('metadataId')];
    g_showResults['__current'] = show;

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the seasons for ${show.title}.<br>Server message:<br>${response.Error}`, 'OK');
    };

    jsonRequest('get_seasons', { id : show.metadataId }, showSeasons, failureFunc);
}

/// <summary>Map of metadata IDs to season information</summary>
g_seasonResults = {};

/// <summary>
/// Takes the seasons retrieved for a show and creates and entry for each season.
/// </summary>
function showSeasons(seasons) {
    let seasonList = $('#seasonlist');
    clearAndShow(seasonList);
    $('#showlist').classList.add('hidden');
    seasonList.appendChild(buildShowRow(g_showResults['__current'], true /*selected*/))
    seasonList.appendChild(buildNode('hr'));
    g_seasonResults = {};
    for (const season of seasons) {
        seasonList.appendChild(buildSeasonRow(season));
        g_seasonResults[season.metadataId] = season;
    }
}

/// <summary>
/// Creates a DOM element for the given season.
/// Each row contains the season number, the season title (if applicable), and the number of episodes in the season.
/// </summary>
/// <param name="selected">True if this row is selected and should be treated like a header opposed to a clickable entry</param>
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
        buildNode('div', { class : 'showResultEpisodes' }, season.episodes + ' Episode' + (season.episodes == 1 ? '' : 's'))
    );

    if (selected) {
        row.classList.add('selected');
        row.appendChild(buildNode('div', { class : 'goBack' }).appendChildren(
            buildNode('input', { type : 'button', value : 'Go Back' }, 0, { click : () => {
                clearAndShow($('#episodelist'));
                $('#seasonlist').classList.remove('hidden');
            }
        })));
    }

    return row;
}

/// <summary>
/// Click handler for clicking a show row. Initiates a request for all episodes in the given season.
/// </summary>
function seasonClick() {
    let season = g_seasonResults[this.getAttribute('metadataId')];
    g_seasonResults['__current'] = season;

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the episodes for ${season.title}.<br>Server message:<br>${response.Error}`, 'OK');
    };

    jsonRequest('get_episodes', { id : season.metadataId }, parseEpisodes, failureFunc);
}

/// <summary>Map of metadata IDs to episode details</summary>
g_episodeResults = {};

/// <summary>
/// Takes the given list of episodes and makes a request for marker details for each episode.
/// </summary>
function parseEpisodes(episodes) {
    g_episodeResults = {};
    let queryString = [];
    for (const episode of episodes) {
        g_episodeResults[episode.metadataId] = episode;
        queryString.push(episode.metadataId);
    }

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the markers for these episodes, please try again.<br><br>Server Message:<br>${response.Error}`, 'OK');
    }

    jsonRequest('query', { keys : queryString.join(',') }, showEpisodesAndMarkers, failureFunc);
}

/// <summary>
/// Takes the given list of episode data and creates entries for each episode and its markers.
/// </summary>
function showEpisodesAndMarkers(data) {
    let episodelist = $('#episodelist');
    clearEle(episodelist);
    $('#seasonlist').classList.add('hidden');
    episodelist.appendChild(buildShowRow(g_showResults['__current'], true /*selected*/));
    episodelist.appendChild(buildNode('hr'));
    episodelist.appendChild(buildSeasonRow(g_seasonResults['__current'], true /*selected*/));
    episodelist.appendChild(buildNode('hr'));
    for (const key of Object.keys(data)) {
        const markers = data[key];
        episode = g_episodeResults[key];
        episode.markers = markers;

        episodelist.appendChildren(
            buildNode('div').appendChildren(
                buildNode('div', { class : 'episodeResult', title : 'Click to expand/contract. Control+Click to expand/contract all' }, 0, { click : showHideMarkerTable }).appendChildren(
                    buildNode('div', { class : 'episodeName' }).appendChildren(
                        buildNode('span', { class : 'markerExpand' }, '&#9205; '),
                        buildNode('span', {}, `${episode.showName} - S${pad0(episode.seasonIndex, 2)}E${pad0(episode.index, 2)} - ${episode.title}`)
                    ),
                    buildNode('div', { class : 'episodeResultMarkers' }, markers.length + ' Marker' + (markers.length == 1 ? '' : 's'))),
                buildMarkerTable(markers, episode),
                buildNode('hr', { class : 'episodeSeparator' })
            )
        );
    }
}

/// <summary>
/// Expand or collapse the marker table for the clicked episode.
/// If the user ctrl+clicks the episode, expand/contract for all episodes.
/// </summary>
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

/// <summary>
/// Takes the given marker data and creates a table to display it, including add/edit/delete options.
/// </summary>
function buildMarkerTable(markers, episode) {
    let container = buildNode('div', { class : 'tableHolder' });
    let table = buildNode('table', { class : 'hidden markerTable' });
    table.appendChild(buildNode('thead').appendChildren(rawTableRow(centeredColumn('Index'), timeColumn('Start Time'), timeColumn('End Time'), centeredColumn('Date Added'), centeredColumn('Options'))));
    let rows = buildNode('tbody');
    if (markers.length == 0) {
        rows.appendChild(spanningTableRow('No markers found'));
    }

    // Sort by earliest to latest marker if there are multiple
    markers.sort((a, b) => a.index - b.index);

    for (const marker of markers) {
        rows.appendChild(tableRow(marker, episode));
    }

    rows.appendChild(spanningTableRow(tableButton('Add Marker', onMarkerAdd, { metadataId : episode.metadataId })));

    table.appendChild(rows);
    container.appendChild(table);

    return container;
}

/// <summary>
/// Return a custom object for rawTableRow to parse, including properties to apply to start/end time columns.
/// </summary>
function timeColumn(value) {
    return {
        value : value,
        properties : {
            class : 'timeColumn'
        }
    };
}

/// <summary>
/// Return a custom object for rawTableRow to parse that will center the given column.
/// </summary>
function centeredColumn(value) {
    return {
        value : value,
        properties : {
            class : 'centeredColumn'
        }
    }
}

/// <summary>
/// Creates a table row for a specific marker of an episode
/// </summary>
function tableRow(marker, episode) {
    let tr = buildNode('tr', { markerId : marker.id, metadataId : episode.metadataId, startTime : marker.time_offset, endTime : marker.end_time_offset });
    const td = (column, properties={}) => {
        return buildNode('td', properties, column);
    }

    tr.appendChildren(
        td(marker.index.toString()),
        td(timeData(marker.time_offset)),
        td(timeData(marker.end_time_offset)),
        td(friendlyDate(marker.created_at, marker.thumb_url), { class : 'centeredColumn' }),
        td(optionButtons(marker.id))
    );

    return tr;
}

/// <summary>
/// Creates a "free-form" table row using the list of columns to add
/// </summary>
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

/// <summary>Create a table row that spans the entire length of the table</summary>
function spanningTableRow(column) {
    return buildNode('tr').appendChildren(buildNode('td', { colspan : 5, style : 'text-align: center;' }, column));
}

/// <summary>Returns a span of [hh]:mm:ss.000 data, with hover text of the equivalent milliseconds.</summary>
function timeData(offset) {
    return buildNode('span', { title : offset }, msToHms(offset));
}

/// <summary>
/// Return a span that contains a "friendly" date (x [time span] ago), with a tooltip of the exact date.
/// </summary>
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

/// <summary>
/// Return a div containing edit/delete buttons for a marker.
/// </summary>
function optionButtons(markerId) {
    return buildNode('div').appendChildren(
        tableIconButton('Edit', 'edit', 'Edit Marker', 'c1c1c1', onMarkerEdit, { markerId : markerId }),
        tableIconButton('Delete', 'delete', 'Delete Marker', 'C44', confirmMarkerDelete, { markerId : markerId })
    );
}

/// <summary>
/// Click handler for adding a marker. Creates a new row in the marker table with editable start/end time inputs.
/// </summary>
function onMarkerAdd() {
    if (operationInProgress()) {
        return;
    }

    const metadataId = parseInt(this.getAttribute('metadataId'));
    const thisRow = this.parentNode.parentNode;
    g_modifiedRow = thisRow.parentNode.insertBefore(rawTableRow('-', timeInput(), timeInput(null, true), '-', markerAddConfirmButton(metadataId)), thisRow);
    g_modifiedRow.setAttribute('metadataId', metadataId);
    g_modifiedRow.children[1].children[0].focus();
    setTableButtonText(this, 'Cancel');
    this.removeEventListener('click', onMarkerAdd);
    this.addEventListener('click', onMarkerAddCancel);
}

/// <summary>Return a text input meant for time input.</summary>
/// <param name="end">If provided, indicates that this is the 'end time', and we should bind Ctrl+Shift+E to 'end of the file'</param>
function timeInput(value, end=false) {
    let events = {};
    if (end) {
        events = { keydown : onEndTimeInput };
    }

    let input = buildNode('input', { type : 'text', maxlength : 12, style : 'font-family:monospace;width:130px;margin-left:0', placeholder : 'ms or mm:ss[.000]', value : value ? value : '' }, 0, events);
    if (end) {
        Tooltip.setTooltip(input, 'Ctrl+Shift+E to replace with the end of the episode');
    }

    return input;
}

function onEndTimeInput(e) {
    if (!e.shiftKey || !e.ctrlKey || e.key != 'E') {
        return;
    }

    e.preventDefault();
    this.value = msToHms(g_episodeResults[parseInt(g_modifiedRow.getAttribute('metadataId'))].duration);
}

/// <summary>
/// Handle cancellation of adding a marker - remove the temporary row and reset the 'Add Marker' button.
/// </summary>
function onMarkerAddCancel() {
    this.removeEventListener('click', onMarkerAddCancel);
    this.addEventListener('click', onMarkerAdd);
    g_modifiedRow.parentNode.removeChild(g_modifiedRow);
    g_modifiedRow = null;
    setTableButtonText(this, 'Add Marker');
}

/// <summary>Return a button that will initialize adding a marker.</summary>
function markerAddConfirmButton(metadataId) {
    return tableButton('Add', onMarkerAddConfirm, { metadataId : metadataId });
}

/// <summary>
/// Creates a tabbable button in the marker table with an associated icon.
/// </summary>
/// <param name="text">The text of the button</param>
/// <param name="icon">The name of the icon to add to the button</param>
/// <param name="altText">The alt text for the icon</param>
/// <param name="color">The hex color for the icon (no leading #, 3 or 6 characters)</param>
/// <param name="clickHandler">The click callback for the button</param>
/// <param name="attributes">Any optional attributes to apply to the button</summary>
function tableIconButton(text, icon, altText, color, clickHandler, attributes={}) {
    let button = buildNode('div', { class : 'tableIcon', tabindex : '0' }, 0, { click : clickHandler, keyup : tableButtonKeyup }).appendChildren(
        buildNode('img', { src : `/i/${color}/${icon}.svg`, alt : altText }),
        buildNode('span', {}, text)
    );

    for (const [key, value] of Object.entries(attributes)) {
        button.setAttribute(key, value);
    }

    return button;
}

/// <summary>
/// Creates a tabbable button in the marker table that doesn't have an icon.
/// </summary>
function tableButton(text, clickHandler, attributes={}) {
    let button = buildNode('div', { class : 'tableNoIcon', tabindex : '0' }, '', { click : clickHandler, keyup : tableButtonKeyup }).appendChildren(
        buildNode('span', {}, text)
    );

    for (const [key, value] of Object.entries(attributes)) {
        button.setAttribute(key, value);
    }

    return button;
}

/// <summary>
/// Treat 'Enter' on a table "button" as a click.
/// </summary>
function tableButtonKeyup(e) {
    if (e.key == 'Enter') {
        e.preventDefault();
        this.click();
    }
}

/// <summary>
/// Set the text of a button created by tableButton or tableIconButton.
/// </summary>
function setTableButtonText(button, text) {
    button.$$('span').innerText = text;
}

/// <summary>
/// Attempts to add a marker to the database, first validating that the marker is valid.
/// On success, make the temporary row permanent and rearrange the markers based on their start time.
/// </summary>
function onMarkerAddConfirm() {
    const metadataId = parseInt(this.getAttribute('metadataId'));
    const thisRow = this.parentNode.parentNode;
    let inputs = thisRow.$('input[type=text]');
    const startTime = timeToMs(inputs[0].value);
    const endTime = timeToMs(inputs[1].value);

    if (!checkValues(metadataId, startTime, endTime)) {
        return;
    }

    let successFunc = (response) => {

        // Build the new row
        let tr = tableRow(response, g_episodeResults[response.metadata_item_id.toString()]);

        let tbody = g_modifiedRow.parentNode;

        // If we previously had no markers, remove the 'No marker found' row.
        if (tbody.$('td[colspan="5"]').length == 2) {
            tbody.removeChild(tbody.firstChild);
        }

        tbody.removeChild(g_modifiedRow);
        g_modifiedRow = null;
        
        tbody.insertBefore(tr, tbody.children[response.index]);
        let markers = g_episodeResults[response.metadata_item_id].markers;
        for (let i = response.index + 1; i < tbody.children.length - 1; ++i) {
            let indexData = tbody.children[i].firstChild;
            let newIndex = parseInt(indexData.innerHTML) + 1;
            indexData.innerHTML = newIndex;
            markers[i - 1].index += 1;
        }

        markers.splice(response.index, 0, response);

        let addButton = tbody.$$(`.tableNoIcon[metadataId="${metadataId}"]`);
        addButton.removeEventListener('click', onMarkerAddCancel);
        addButton.addEventListener('click', onMarkerAdd);
        setTableButtonText(addButton, 'Add Marker');
    };

    let failureFunc = (response) => {
        Overlay.show(`Sorry, something went wrong trying to add the marker. Please try again later.\n\nServer response:\n${response.Error}`, 'OK');
    }

    jsonRequest('add', { metadataId : metadataId, start : startTime, end : endTime }, successFunc, failureFunc);
}

/// <summary>
/// Returns whether a marker the user wants to add/edit is valid.
/// Markers must:
///  * Have a start time earlier than its end time.
///  * Not overlap with any existing marker. The database technically supports overlapping markers (multiple versions of an episode with
///    slightly different intro detection), but since the markers apply to the episode regardless of the specific version, there's no
///    reason to actually allow overlapping markers.
/// </summary>
function checkValues(metadataId, startTime, endTime, isEdit=false, editIndex=0) {
    if (isNaN(metadataId)) {
        // If this is NaN, something went wrong on our side, not the user (unless they're tampering with things)
        Overlay.show('Sorry, something went wrong. Please reload the page and try again.');
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
    
    const markers = g_episodeResults[metadataId].markers;
    let index = 0;
    for (const marker of markers) {
        if (marker.end_time_offset >= startTime && marker.time_offset <= endTime && (!isEdit || editIndex != index)) {
            const message = isEdit ? 'Adjust this marker\'s timings or delete the other marker first to avoid overlap.' : 'Edit the existing marker instead';
            Overlay.show(`That marker overlaps with an existing marker (${msToHms(marker.time_offset)}-${msToHms(marker.end_time_offset)}). ${message}`, 'OK');
            return;
        }

        index += 1;
    }

    return true;
}

/// <summary>
/// Parses [hh]:mm:ss.000 input into milliseconds (or the integer conversion of string milliseconds).
/// </summary>
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

/// <summary>
/// Global that stores the current marker that's being edited/deleted/added.
/// Only a single action can be in progress at once, so if this is not null, new edits/adds/deletes cannot occur.
///
/// TODO: Allow multiple items to be edited at once, using click context to determine what action to apply.
/// <summary>
let g_modifiedRow = null;

/// <summary>
/// Click handler for editing a marker.
/// Replaces static start/end markers with editable input fields that default to the current [hh]:mm:ss.000 times.
/// </summary>
function onMarkerEdit() {
    if (operationInProgress()) {
        return;
    }

    const markerId = parseInt(this.getAttribute('markerId'));

    g_modifiedRow = this.parentNode.parentNode.parentNode;
    let startTime = g_modifiedRow.children[1];
    let endTime = g_modifiedRow.children[2];
    startTime.setAttribute('prevtime', startTime.firstChild.innerHTML);
    endTime.setAttribute('prevtime', endTime.firstChild.innerHTML);
    clearEle(startTime);
    clearEle(endTime);

    startTime.appendChild(timeInput(startTime.getAttribute('prevtime')));
    endTime.appendChild(timeInput(endTime.getAttribute('prevtime'), true));

    let tbody = g_modifiedRow.parentNode;
    let addButton = tbody.lastChild.$$('.tableNoIcon');
    addButton.removeEventListener('click', onMarkerAdd);
    addButton.addEventListener('click', onMarkerEditConfirm);
    setTableButtonText(addButton, 'Confirm Edit');
    addButton.setAttribute('markerId', markerId);
    addButton.parentNode.appendChild(tableButton('Cancel', onMarkerEditCancel));
    startTime.children[0].focus();
    startTime.children[0].select();
}

/// <summary>
/// Commits a marker edit, assuming it passes marker validation.
/// </summary>
function onMarkerEditConfirm() {
    const markerId = parseInt(this.getAttribute('markerId'));
    const inputs = g_modifiedRow.$('input[type="text"]');
    const startTime = timeToMs(inputs[0].value);
    const endTime = timeToMs(inputs[1].value);

    if (!checkValues(this.getAttribute('metadataId'), startTime, endTime, true /*isEdit*/, parseInt(g_modifiedRow.children[0].innerText))) {
        return;
    }

    let successFunc = (response) => {
        const oldIndex = parseInt(g_modifiedRow.children[0].innerText);
        if (response.index != oldIndex) {
            let parent = g_modifiedRow.parentElement;
            parent.removeChild(g_modifiedRow);
            parent.insertBefore(g_modifiedRow, parent.children[response.index]);
            for (let i = 0; i < parent.children.length - 1; ++i) {
                parent.children[i].children[0].innerText = i.toString();
            }
        }

        resetAfterEdit(startTime, endTime);
    };

    let failureFunc = (response) => {
        onMarkerEditCancel();
        Overlay.show(`Sorry, something went wrong with that request. Server response:<br><br>${response.Error}`, 'OK');
    }

    jsonRequest('edit', { id : markerId, start : startTime, end : endTime }, successFunc, failureFunc);
}

/// <summary>Cancels an edit operation, reverting the editable row fields with their previous times.</summary>
function onMarkerEditCancel() {
    resetAfterEdit(timeToMs(g_modifiedRow.children[1].getAttribute('prevtime')), timeToMs(g_modifiedRow.children[2].getAttribute('prevtime')));
}

/// <summary>
/// Removes the editable input fields from a marker that was in edit mode, replacing them with the static values provided by newStart and newEnd.
/// </summary>
function resetAfterEdit(newStart, newEnd) {
                                  /*   tbody.       tr.        td.     input*/
    let addButton = g_modifiedRow.parentNode.lastChild.firstChild.firstChild;
    addButton.parentNode.removeChild(addButton.parentNode.lastChild);

    setTableButtonText(addButton, 'Add Marker');
    addButton.removeEventListener('click', onMarkerEditConfirm);
    addButton.addEventListener('click', onMarkerAdd);

    clearEle(g_modifiedRow.children[1]);
    clearEle(g_modifiedRow.children[2]);
    g_modifiedRow.children[1].appendChild(timeData(newStart));
    g_modifiedRow.children[2].appendChild(timeData(newEnd));

    g_modifiedRow = null;
}

/// <summary>
/// Prompts the user before deleting a marker.
/// </summary>
function confirmMarkerDelete() {
    if (operationInProgress()) {
        return;
    }

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

/// <summary>
/// Checks if an existing operation is in progress, and alerts the user (and returns true) if there is.
/// </summary>
function operationInProgress() {
    if (g_modifiedRow) {
        Overlay.show(`It looks like you're in the middle of a different operation. Please complete/cancel that operation before continuing.`, 'OK');
        return true;
    }

    return false;
}

/// <summary>
/// Makes a request to delete a marker, removing it from the marker table on success.
/// </summary>
function onMarkerDelete() {
    Overlay.dismiss();
    const markerId = parseInt(this.getAttribute('markerId'));
    g_modifiedRow = this.parentNode.parentNode.parentNode;
    let successFunc = () => {
        let markerTable = g_modifiedRow.parentNode;
        markerTable.removeChild(g_modifiedRow);
        g_modifiedRow = null;

        // If we're removing the last marker, add the 'No marker found' row.
        if (markerTable.children.length == 1) {
            markerTable.insertBefore(spanningTableRow('No markers found'), markerTable.firstChild);
        } else {
            // Update indexes if needed
            for (let marker = 0; marker < markerTable.children.length - 1; ++marker) {
                markerTable.children[marker].firstChild.innerHTML = marker;
            }
        }
    }

    let failureFunc = (response) => {
        Overlay.show(`Failed to delete marker:<br><br>${response.Error}`, 'OK');
        g_modifiedRow = null;
    }

    jsonRequest('delete', { id : markerId }, successFunc, failureFunc);
}

/// <summary>
/// Prefixes 0s to the given value until its length is 'pad'.
/// </summary>
function pad0(val, pad) {
    val = val.toString();
    return '0'.repeat(Math.max(0, pad - val.length)) + val;
}

/// <summary>
/// Convert milliseconds to a user-friendly [h:]mm:ss.000
/// </summary>
function msToHms(ms)
{
    let seconds = ms / 1000;
    const hours = parseInt(seconds / 3600);
    const minutes = parseInt(seconds / 60) % 60;
    seconds = parseInt(seconds) % 60;
    const thousandths = ms % 1000;
    let pad2 = (time) => time < 10 ? "0" + time : time;
    const pad3 = (time) => time < 10 ? "00" + time : time < 100 ? "0" + time : time;
    let time = pad2(minutes) + ":" + pad2(seconds) + "." + pad3(thousandths);
    if (hours > 0)
    {
        time = hours + ":" + time;
    }

    return time;
}

/// <summary>
/// Removes all children from the given element.
/// </summary>
function clearEle(ele)
{
  while (ele.firstChild)
  {
    ele.removeChild(ele.firstChild);
  }
}

/// <summary>
/// Generic method to make a request to the given endpoint that expects a JSON response.
/// </summary>
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

/// <summary>
/// Custom jQuery-like selector method.
/// If the selector starts with '#' and contains no spaces, return the
/// result of querySelector, otherwise return the result of querySelectorAll
/// </summary>
function $(selector, ele=document)
{
    if (selector.indexOf("#") === 0 && selector.indexOf(" ") === -1)
    {
        return $$(selector, ele);
    }

    return ele.querySelectorAll(selector);
}

/// <summary>
/// Like $, but forces a single element to be returned. i.e. querySelector
/// </summary>
function $$(selector, ele=document)
{
    return ele.querySelector(selector);
}

/// <summary>
/// $ operator scoped to a specific element
/// </summary>
Element.prototype.$ = function(selector)
{
    return $(selector, this);
};

/// <summary>
/// $$ operator scoped to a specific element
/// </summary>
Element.prototype.$$ = function(selector)
{
    return $$(selector, this);
};

/// <summary>
/// Helper method to create DOM elements.
/// </summary>
/// <param name="type">The TAG to create</param>
/// <param name="attrs">Attributes to apply to the element (e.g. class, id, or custom attributes)</param>
/// <param name="content">The inner content for the element. Accepts both text and HTMLElements</param>
/// <param name="events">Map of events (click/keyup/etc) to attach to the element</param>
function buildNode(type, attrs, content, events)
{
    let ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events);
}

/// <summary>
/// Helper method to create DOM elements with the given namespace (e.g. SVGs).
/// </summary>
function buildNodeNS(ns, type, attrs, content, events)
{
    let ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events);
}

/// <summary>
/// "Private" core method for buildNode and buildNodeNS, that handles both namespaced and non-namespaced elements.
/// </summary>
function _buildNode(ele, attrs, content, events)
{
    if (attrs)
    {
        for (let [key, value] of Object.entries(attrs))
        {
            ele.setAttribute(key, value);
        }
    }

    if (events)
    {
        for (let [event, func] of Object.entries(events))
        {
            ele.addEventListener(event, func);
        }
    }

    if (content)
    {
        if (content instanceof HTMLElement) {
            ele.appendChild(content);
        } else {
            ele.innerHTML = content;
        }
    }

    return ele;
}

/// <summary>
/// Helper to append multiple children to a single element at once
/// </summary>
/// <returns>The element to facilitate chained calls</returns>
Element.prototype.appendChildren = function(...elements)
{
    for (let element of elements)
    {
        if (element)
        {
            this.appendChild(element);
        }
    }

    return this;
};