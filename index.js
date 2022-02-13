window.addEventListener('load', setup);

let g_host;
let g_token;

let plex;

function setup()
{
    $('#libraries').addEventListener('change', libraryChanged);
    $('#gosearch').addEventListener('click', search);
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

        // Sort the results. Title prefix matches are first, then sort title prefix matches, the original title prefix matches, and alphabetical sorting after that.
        result.sort((a, b) => {
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

            return a.title.localeCompare(b.title);
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

        // TODO: Handle failure gracefully
        return new Promise(resolve => {
            jsonRequest('get_section', { id : plex.activeSection }, (res) => { plex.shows[plex.activeSection] = res; resolve(); });
        });
    }
}

function setStatus(text) {
    let status = $('#status');
    clearEle(status);
    status.appendChild(buildNode('span', {}, text));
}

// Check for localhost and other IPv4 addresses reserved for private networks
function smellsLikeLocal(host) {
    // easy ones, /8 and /16 allocations
    if (host == 'localhost'
        || host.startsWith('127.')
        || host.startsWith('10.')
        || host.startsWith('192.168.')) {
        return true;
    }

    // a bit more annoying, /12
    if (host.startsWith('172.')) {
        // 172.16.0.0-172.31.255.255
        let n = parseInt(host.substr(4,3));
        if (!isNaN(n) && n >= 16 && n <= 31) {
            return true;
        }
    }

    return false;

}

function libraryFail(response) {
    console.log('Something went wrong!');
    console.log(response);
}

function getLibraries() {
    let failureFunc = (response) => {
        Overlay.show(`Error getting libraries, please verify you have provided the correct database path and try again. Server Message:<br><br>${response.Error}`, 'OK');
    };

    jsonRequest('get_sections', {}, listLibraries, failureFunc);
}

function listLibraries(libraries) {
    console.log(libraries);
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
        'Select...')
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

async function libraryChanged() {
    $('#container').classList.add('hidden');
    let section = parseInt(this.value);
    await plex.setSection(section);
    if (!isNaN(section) && section != -1) {
        $('#container').classList.remove('hidden');
    }
}

function onSearchInput(e) {
    if (e.keyCode == 13 /*enter*/) {
        search();
    }
}

function search() {
    // Remove any existing season/marker data
    clearEle($('#seasonlist'));
    clearEle($('#episodelist'));
    g_seasonResults = {};
    g_episodeResults = {};
    plex.search($('#search').value, parseShowResults);
}

let g_showResults = {}

function parseShowResults(data) {
    let showList = $('#showlist');
    clearEle(showList);

    $('#showlist').classList.remove('hidden');
    g_showResults = {};

    if (data.length == 0) {
        showList.appendChild(buildNode('div', {}, "No results found."));
        return;
    }

    for (const show of data) {
        let div = buildShowRow(show);
        showList.appendChild(div);
        g_showResults[show.metadataId] = show;
    }
}

function buildShowRow(show, forSeasons=false) {
    let titleNode = buildNode('div', {}, show.title);
    if (show.original) {
        titleNode.appendChild(buildNode('span', { class : 'showResultOriginalTitle' }, ` (${show.original})`));
    }

    let events = {};
    if (!forSeasons) {
        events = { click : showClick };
    }

    return buildNode('div', { class : 'showResult', metadataId : show.metadataId }, 0, events).appendChildren(
        titleNode,
        buildNode('div', { class : 'showResultSeasons' }, show.seasons + ' Season' + (show.seasons == 1 ? '' : 's')),
        buildNode('div', { class : 'showResultEpisodes' }, show.episodes + ' Episode' + (show.episodes == 1 ? '' : 's'))
    );
}

function showClick() {
    // Remove any existing marker data
    clearEle($('#episodelist'));
    g_episodeResults = {};

    let show = g_showResults[this.getAttribute('metadataId')];
    g_showResults['__current'] = show.metadataId;

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the seasons for ${show.title}.<br>Server message:<br>${response.Error}`, 'OK');
    };

    jsonRequest('get_seasons', { id : show.metadataId }, showSeasons, failureFunc);
}

g_seasonResults = {};
function showSeasons(seasons) {
    let seasonlist = $('#seasonlist');
    clearEle(seasonlist);
    $('#showlist').classList.add('hidden');
    seasonlist.appendChild(buildShowRow(g_showResults[g_showResults['__current']], true /*forSeasons*/))
    seasonlist.appendChild(buildNode('hr'));
    g_seasonResults = {};
    for (const season of seasons) {
        seasonlist.appendChild(buildSeasonRow(season));
        g_seasonResults[season.metadataId] = season;
    }
}

function buildSeasonRow(season, forEpisodes=false) {
    let titleNode = buildNode('div', {}, `Season ${season.index}`);
    if (season.title.toLowerCase() != `season ${season.index}`) {
        titleNode.appendChild(buildNode('span', { class : 'seasonTitle' }, ` (${season.title})`));
    }

    let events = {};
    if (!forEpisodes) {
        events = { click : seasonClick };
    }

    return buildNode('div', { class : 'seasonResult', metadataId : season.metadataId }, 0, events).appendChildren(
        titleNode,
        buildNode('div', { class : 'showResultEpisodes' }, season.episodes + ' Episode' + (season.episodes == 1 ? '' : 's'))
    );
}

function seasonClick() {
    let season = g_seasonResults[this.getAttribute('metadataId')];

    let failureFunc = (response) => {
        Overlay.show(`Something went wrong when retrieving the episodes for ${season.title}.<br>Server message:<br>${response.Error}`, 'OK');
    };

    jsonRequest('get_episodes', { id : season.metadataId }, showEpisodes, failureFunc);
}

g_episodeResults = {};
function showEpisodes(episodes) {
    g_episodeResults = {};
    let queryString = [];
    for (const episode of episodes) {
        g_episodeResults[episode.metadataId] = episode;
        queryString.push(episode.metadataId);
    }

    jsonRequest('query', { keys : queryString.join(',') }, showEpisodesReally);
}

function showEpisodesReally(data) {
    let episodelist = $('#episodelist');
    clearEle(episodelist);
    for (const key of Object.keys(data)) {
        const markers = data[key];
        episode = g_episodeResults[key];
        episode.markers = markers;

        episodelist.appendChildren(buildNode('div', {}, `${episode.showName} - S${pad0(episode.seasonIndex, 2)}E${pad0(episode.index, 2)} - ${episode.title}`), buildMarkerTable(markers, episode));
    }
}

function buildMarkerTable(markers, episode) {
    let table = buildNode('table');
    table.appendChild(buildNode('thead').appendChildren(rawTableRow('Index', timeColumn('Start Time'), timeColumn('End Time'), 'Date Added', 'Options')));
    let rows = buildNode('tbody');
    if (markers.length == 0) {
        rows.appendChild(spanningTableRow('No markers found'));
    }

    // Sort by earliest to latest marker if there are multiple
    markers.sort((a, b) => a.index - b.index);

    for (const marker of markers) {
        rows.appendChild(tableRow(marker, episode));
    }

    rows.appendChild(spanningTableRow(buildNode('input', { type : 'button', value : 'Add Marker', metadataId :  episode.metadataId }, '', { click : onMarkerAdd })));

    table.appendChild(rows);

    return table;
}

function timeColumn(value) {
    return {
        value : value,
        properties : {
            class : 'timeColumn'
        }
    };
}

/// <summary>
/// Creates a table row for a specific marker of an episode
/// </summary>
function tableRow(marker, episode) {
    let tr = buildNode('tr', { markerId : marker.id, metadataId : episode.metadataId, startTime : marker.time_offset, endTime : marker.end_time_offset });
    const td = (column) => {
        return buildNode('td', {}, column);
    }

    tr.appendChildren(
        td(marker.index.toString()),
        td(timeData(marker.time_offset)),
        td(timeData(marker.end_time_offset)),
        td(marker.created_at),
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

function spanningTableRow(column) {
    return buildNode('tr').appendChildren(buildNode('td', { colspan : 5, style : 'text-align: center;' }, column));
}

function timeData(offset) {
    return buildNode('span', { title : offset }, msToHms(offset));
}

function optionButtons(markerId) {
    return buildNode('div').appendChildren(
        buildNode('input', { type : 'button', value : 'Edit', markerId : markerId }, '', { click : onMarkerEdit }),
        buildNode('input', { type : 'button', value : 'Delete', markerId : markerId }, '', { click : onMarkerDelete })
    );
}

function onMarkerAdd() {
    if (g_modifiedRow) {
        Overlay.show(`It looks like you're in the middle of a different operation. Please complete/cancel that operation before continuing.`, 'OK');
        console.log('Waiting for a previous operation to complete...');
        return;
    }

    const metadataId = parseInt(this.getAttribute('metadataId'));
    console.log(g_episodeResults[metadataId].markers);
    const thisRow = this.parentNode.parentNode;
    g_modifiedRow = thisRow.parentNode.insertBefore(rawTableRow('-', timeInput(), timeInput(), '-', markerAddConfirmButton(metadataId)), thisRow);
    g_modifiedRow.setAttribute('metadataId', metadataId);
    this.value = 'Cancel';
    this.removeEventListener('click', onMarkerAdd);
    this.addEventListener('click', onMarkerAddCancel);
}

function timeInput(value) {
    return buildNode('input', { type : 'text', maxlength : 12, style : 'font-family:monospace;width:130px', placeholder : 'ms or mm:ss[.000]', value : value ? value : '' });
}

function onMarkerAddCancel() {
    this.removeEventListener('click', onMarkerAddCancel);
    this.addEventListener('click', onMarkerAdd);
    g_modifiedRow.parentNode.removeChild(g_modifiedRow);
    g_modifiedRow = null;
    this.value = 'Add Marker';
}

function markerAddConfirmButton(metadataId) {
    return buildNode('input', { type : 'button', value : 'Add', metadataId : metadataId }, '', { click : onMarkerAddConfirm });
}

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

        let addButton = tbody.$$(`input[metadataId="${metadataId}"]`);
        addButton.removeEventListener('click', onMarkerAddCancel);
        addButton.addEventListener('click', onMarkerAdd);
        addButton.value = 'Add Marker';
    };

    let failureFunc = (response) => {
        Overlay.show(`Sorry, something went wrong trying to add the marker. Please try again later.\n\nServer response:\n${response.Error}`, 'OK');
    }

    jsonRequest('add', { metadataId : metadataId, start : startTime, end : endTime }, successFunc, failureFunc);
}

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

let g_modifiedRow = null;
function onMarkerEdit() {
    if (g_modifiedRow) {
        console.log('Waiting for a previous operation to complete...');
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
    endTime.appendChild(timeInput(endTime.getAttribute('prevtime')));

    let tbody = g_modifiedRow.parentNode;
    let addButton = tbody.lastChild.$$('input');
    addButton.removeEventListener('click', onMarkerAdd);
    addButton.addEventListener('click', onMarkerEditConfirm);
    addButton.value = 'Confirm Edit';
    addButton.setAttribute('markerId', markerId);
    addButton.parentNode.appendChild(buildNode('input', { type : 'button', value : 'Cancel' }, '', { click : onMarkerEditCancel }));
    console.log(`Edit Click for ${markerId}!`);
}

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

function onMarkerEditCancel() {
    resetAfterEdit(timeToMs(g_modifiedRow.children[1].getAttribute('prevtime')), timeToMs(g_modifiedRow.children[2].getAttribute('prevtime')));
}

function resetAfterEdit(newStart, newEnd) {
                                  /*   tbody.       tr.        td.     input*/
    let addButton = g_modifiedRow.parentNode.lastChild.firstChild.firstChild;
    addButton.parentNode.removeChild(addButton.parentNode.lastChild);

    addButton.removeEventListener('click', onMarkerEditConfirm);
    addButton.addEventListener('click', onMarkerAdd);
    addButton.value = 'Add Marker';

    clearEle(g_modifiedRow.children[1]);
    clearEle(g_modifiedRow.children[2]);
    g_modifiedRow.children[1].appendChild(timeData(newStart));
    g_modifiedRow.children[2].appendChild(timeData(newEnd));

    g_modifiedRow = null;
}

function onMarkerDelete() {
    // TODO: 'Are you sure?'
    // TODO: Additional (or any) indication that we failed/succeeded
    if (g_modifiedRow) {
        console.log('Waiting for a previous operation to complete...');
        return;
    }

    const markerId = parseInt(this.getAttribute('markerId'));
    g_modifiedRow = this.parentNode.parentNode.parentNode;
    let successFunc = () => {

        // If we're removing the last marker, add the 'No marker found' row.
        if (g_modifiedRow.parentNode.children.length == 2) {
            g_modifiedRow.parentNode.insertBefore(spanningTableRow('No markers found'), g_modifiedRow.parentNode.firstChild);
        } else {
            // Update indexes if needed
            let index = parseInt(g_modifiedRow.firstChild.innerHTML);
            if (index != g_modifiedRow.parentNode.children.length - 2) { // Our deleted index isn't at the end
                for (let i = index + 1; i < g_modifiedRow.parentNode.children.length - 1; ++i) {
                    let indexColumn = g_modifiedRow.parentNode.children[i].firstChild;
                    indexColumn.innerHTML = parseInt(indexColumn.innerHTML) - 1; // We're assuming that the fire-and-forget index adjustments server-side succeeded
                }
            }
        }

        g_modifiedRow.parentNode.removeChild(g_modifiedRow);
        g_modifiedRow = null;
    }

    let failureFunc = () => { g_modifiedRow = null; }

    jsonRequest('delete', { id : markerId }, successFunc, failureFunc);

    console.log(`Delete Click for ${markerId}!`);
}

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

function clearEle(ele)
{
  while (ele.firstChild)
  {
    ele.removeChild(ele.firstChild);
  }
}

function jsonRequest(endpoint, parameters, successFunc, failureFunc) {
    let url = new URL(endpoint, window.location.href);
    for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.append(key, value);
    }

    fetch(url, { method : 'POST', headers : { accept : 'application/json' } }).then(r => r.json()).then(response => {
        if (!response || response.Error) {
            if (failureFunc) {
                failureFunc(response);
            } else {
                console.error('Request failed: %o', response);
            }

            return;
        }

        successFunc(response);
    });
}

function $(selector, ele=document)
{
    if (selector.indexOf("#") === 0 && selector.indexOf(" ") === -1)
    {
        return $$(selector, ele);
    }

    return ele.querySelectorAll(selector);
}
function $$(selector, ele=document)
{
    return ele.querySelector(selector);
}
Element.prototype.$ = function(selector)
{
    return $(selector, this);
};
Element.prototype.$$ = function(selector)
{
    return $$(selector, this);
};

function buildNode(type, attrs, content, events)
{
    let ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events);
}

function buildNodeNS(ns, type, attrs, content, events)
{
    let ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events);
}

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