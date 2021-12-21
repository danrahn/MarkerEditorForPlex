window.addEventListener('load', setup);

let g_host;
let g_token;

let plex;

function setup()
{
    fetch('config.json').then(res => res.json()).then(gotConfig);
    $('#libraries').addEventListener('change', libraryChanged);
    $('#gosearch').addEventListener('click', search);
    $('#search').addEventListener('keyup', onSearchInput);
}

class Plex
{
    constructor(config)
    {
        this.host = this._normalizeHost(config);
        this.token = config.token;
        this.activeSection = -1;
    }

    setSection(section) {
        this.activeSection = isNaN(section) ? -1 : section;
    }

    get(endpoint, params, successFunc)
    {
        let url = new URL(this.host + endpoint);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        url.searchParams.append('X-Plex-Token', this.token);
        fetch(url, { method : 'GET', headers : { accept : 'application/json' }}).then(res => res.json()).then(j => successFunc(j)).catch(err => this._fail(err));
    }

    search(query, successFunc)
    {
        if (this.activeSection == -1) {
            this._fail('Library section not set');
            return;
        }

        this.get(`/library/sections/${this.activeSection}/all`, { 'type' : 2, 'title' : query }, successFunc);
    }

    _fail(err)
    {
        setStatus(err);
    }

    _normalizeHost(config) {
        let host = config.host;
        if (!host.startsWith('http')) {
            if (smellsLikeLocal(host)) {
                host = `http://${host}`;
            } else {
                host = `https://${host}`;
            }
        }
        
        return `${host}:${config.port}`;
    }
}

function setStatus(text) {
    let status = $('#status');
    clearEle(status);
    status.appendChild(buildNode('span', {}, text));
}

function gotConfig(config) {
    plex = new Plex(config);
    getLibraries();
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
    plex.get('/library/sections', {}, listLibraries);
}

function listLibraries(data) {
    console.log(data);
    let select = document.querySelector('#libraries');
    clearEle(select);
    let libraries = data.MediaContainer.Directory;
    select.appendChild(buildNode(
        'option',
        {
            value: '-1',
            plexType: '-1'
        },
        'Select...')
    );

    libraries.forEach(library => {
        if (['show'].indexOf(library.type) == -1) {
            return;
        }

        select.appendChild(buildNode(
            'option',
            { value: `${library.key}` },
            library.title)
        );
    });
}

function libraryChanged() {
    let section = parseInt(this.value);
    plex.setSection(section);
    if (!isNaN(section) && section != -1) {
        $('#container').classList.remove('hidden');
    } else {
        $('#container').classList.add('hidden');
    }
}

function onSearchInput(e) {
    if (e.keyCode == 13 /*enter*/) {
        search();
    }
}

function search() {
    plex.search($('#search').value, parseShowResults);
}

let g_showResults = {}

function parseShowResults(data) {
    let showlist = $('#showlist');
    clearEle(showlist);
    let media = data.MediaContainer.Metadata;
    g_showResults = {};
    for (const show of media) {
        let div = buildNode('div', { 'ratingKey' : show.ratingKey }, show.title, { click : showClick});
        showlist.appendChild(div);
        g_showResults[show.ratingKey] = show;
    }
}

function showClick() {
    let show = g_showResults[this.getAttribute('ratingKey')];
    plex.get(`/library/metadata/${show.ratingKey}/children`, {}, showSeasons);
}

g_seasonResults = {};
function showSeasons(data) {
    let seasonlist = $('#seasonlist');
    clearEle(seasonlist);
    let media = data.MediaContainer.Metadata;
    g_seasonResults = {};
    for (const season of media) {
        let div = buildNode('div', { 'ratingKey' : season.ratingKey }, season.title, { click : seasonClick });
        seasonlist.appendChild(div);
        g_seasonResults[season.ratingKey] = season;
    }
}

function seasonClick() {
    let season = g_seasonResults[this.getAttribute('ratingKey')];
    plex.get(`/library/metadata/${season.ratingKey}/children`, {}, showEpisodes);
}

g_episodeResults = {};
function showEpisodes(data) {
    let episodes = data.MediaContainer.Metadata;
    g_episodeResults = {};
    let queryString = [];
    for (const episode of episodes) {
        g_episodeResults[episode.ratingKey] = episode;
        queryString.push(episode.ratingKey);
    }

    jsonRequest('query', { keys : queryString.join(',') }, showEpisodesReally);
}

function showEpisodesReally(data) {
    let episodelist = $('#episodelist');
    clearEle(episodelist);
    for (const key of Object.keys(data)) {
        const markers = data[key];
        const episode = g_episodeResults[key.toString()];
        console.log(markers);

        episodelist.appendChildren(buildNode('div', {}, `${episode.grandparentTitle} - S${pad0(episode.parentIndex, 2)}E${pad0(episode.index, 2)} - ${episode.title}`), buildMarkerTable(markers, episode));
    }
}

function buildMarkerTable(markers, episode) {
    let table = buildNode('table');
    table.appendChild(buildNode('thead').appendChildren(tableRow('Index', timeColumn('Start Time'), timeColumn('End Time'), 'Date Added', 'Options')));
    let rows = buildNode('tbody');
    if (markers.length == 0) {
        rows.appendChild(spanningTableRow('No markers found'));
    }

    for (const marker of markers) {
        rows.appendChild(tableRow(marker.index.toString(), timeData(marker.time_offset), timeData(marker.end_time_offset), marker.created_at, optionButtons(marker.id)));
    }

    rows.appendChild(spanningTableRow(buildNode('input', { type : 'button', value : 'Add Marker', metadataId :  episode.ratingKey }, '', { click : onMarkerAdd })));

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

function tableRow(...columns) {
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
        console.log('Waiting for a previous operation to complete...');
        return;
    }

    const metadataId = parseInt(this.getAttribute('metadataId'));
    const thisRow = this.parentNode.parentNode;
    g_modifiedRow = thisRow.parentNode.insertBefore(tableRow('-', timeInput(), timeInput(), '-', markerAddConfirm(metadataId)), thisRow);
    this.value = 'Cancel';
    this.removeEventListener('click', onMarkerAdd);
    this.addEventListener('click', onMarkerAddCancel);
    console.log(`Add Click or ${metadataId}!`);
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

function markerAddConfirm(metadataId) {
    return buildNode('input', { type : 'button', value : 'Add', metadataId : metadataId }, '', { click : onMarkerAddConfirm });
}

function onMarkerAddConfirm() {
    const metadataId = parseInt(this.getAttribute('metadataId'));
    const thisRow = this.parentNode.parentNode;
    let inputs = thisRow.$('input[type=text]');
    const startTime = timeToMs(inputs[0].value);
    const endTime = timeToMs(inputs[1].value);

    if (isNaN(metadataId) || isNaN(startTime) || isNaN(endTime)) {
        // TODO: Actually indicate that something went wrong
        return;
    }

    let successFunc = (response) => {
        g_modifiedRow.children[0].innerHTML = response.index;
        clearEle(g_modifiedRow.children[1]);
        g_modifiedRow.children[1].appendChild(timeData(response.time_offset));
        clearEle(g_modifiedRow.children[2]);
        g_modifiedRow.children[2].appendChild(timeData(response.end_time_offset));
        g_modifiedRow.children[3].innerHTML = response.created_at;
        clearEle(g_modifiedRow.children[4]);
        g_modifiedRow.children[4].appendChild(optionButtons(response.id));
        let addButton = g_modifiedRow.parentNode.$$(`input[metadataId="${metadataId}"]`);
        addButton.removeEventListener('click', onMarkerAddCancel);
        addButton.addEventListener('click', onMarkerAdd);
        addButton.value = 'Add Marker';

        // If we previously had no markers, remove the 'No marker found' row.
        if (g_modifiedRow.parentNode.$('td[colspan="5"]').length == 2) {
            g_modifiedRow.parentNode.removeChild(g_modifiedRow.parentNode.firstChild);
        }
        g_modifiedRow = null;
    };

    let failureFunc = () => { g_modifiedRow = null; }
    jsonRequest('add', { metadataId : metadataId, start : startTime, end : endTime }, successFunc, failureFunc);
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

    if (isNaN(markerId) || isNaN(startTime) || isNaN(endTime)) {
        // TODO: Actually indicate that something went wrong
        return;
    }

    let successFunc = () => {
        clearEle(g_modifiedRow.children[1]);
        g_modifiedRow.children[1].appendChild(timeData(startTime));
        clearEle(g_modifiedRow.children[2]);
        g_modifiedRow.children[2].appendChild(timeData(endTime));

        let addButton = g_modifiedRow.parentNode.lastChild.firstChild.firstChild;
        addButton.parentNode.removeChild(addButton.parentNode.lastChild);
        addButton.removeEventListener('click', onMarkerEditConfirm);
        addButton.addEventListener('click', onMarkerAdd);
        addButton.value = 'Add Marker';
        g_modifiedRow = null;
    };

    let failureFunc = () => { g_modifiedRow = null; }
    jsonRequest('edit', { id : markerId, start : startTime, end : endTime }, successFunc, failureFunc);
}

function onMarkerEditCancel() {
    let addButton = this.parentNode.firstChild;
    this.parentNode.removeChild(this);

    addButton.removeEventListener('click', onMarkerEditConfirm);
    addButton.addEventListener('click', onMarkerAdd);
    addButton.value = 'Add Marker';

    clearEle(g_modifiedRow.children[1]);
    g_modifiedRow.children[1].appendChild(timeData(timeToMs(g_modifiedRow.children[1].getAttribute('prevtime'))));
    clearEle(g_modifiedRow.children[2]);
    g_modifiedRow.children[2].appendChild(timeData(timeToMs(g_modifiedRow.children[2].getAttribute('prevtime'))));
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