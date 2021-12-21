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

    fetch('query?keys=' + queryString.join(','), { method : 'POST', headers : { accept : 'application/json' }}).then(r => r.json()).then(showEpisodesReally);
}

function showEpisodesReally(data) {
    let episodelist = $('#episodelist');
    clearEle(episodelist);
    for (const key of Object.keys(data)) {
        const markers = data[key];
        const episode = g_episodeResults[key.toString()];
        console.log(markers);

        episodelist.appendChildren(buildNode('div', {}, `${episode.grandparentTitle} - S${pad0(episode.parentIndex, 2)}E${pad0(episode.index, 2)} - ${episode.title}`), buildMarkerTable(markers));
    }
}

function buildMarkerTable(markers) {
    let table = buildNode('table');
    table.appendChild(buildNode('thead').appendChildren(tableRow('Index', 'Start Time', 'End Time', 'Date Added', 'Options')));
    let rows = buildNode('tbody');
    if (markers.length == 0) {
        rows.appendChild(spanningTableRow('No markers found'));
    }

    for (const marker of markers) {
        rows.appendChild(tableRow(marker.index.toString(), timeData(marker.time_offset), timeData(marker.end_time_offset), marker.created_at, optionButtons()));
    }

    rows.appendChild(spanningTableRow(buildNode('input', { type : 'button', value : 'Add Marker' }, '', { click : onMarkerAdd })));

    table.appendChild(rows);

    return table;
}

function tableRow(...columns) {
    let tr = buildNode('tr');
    for (const column of columns) {
        tr.appendChild(buildNode('td', {}, column));
    }

    return tr;
}

function spanningTableRow(column) {
    return buildNode('tr').appendChildren(buildNode('td', { colspan : 5, style : 'text-align: center;' }, column));
}

function timeData(offset) {
    return buildNode('span', { title : offset }, msToHms(offset));
}

function optionButtons() {
    return buildNode('div').appendChildren(
        buildNode('input', { type : 'button', value : 'Edit' }, '', { click : onMarkerEdit }),
        buildNode('input', { type : 'button', value : 'Delete' }, '', { click : onMarkerDelete })
    );
}

function onMarkerAdd() {
    console.log('Add Click!');
}

function onMarkerEdit() {
    console.log('Edit Click!');
}

function onMarkerDelete() {
    console.log('Delete Click!');
}

function pad0(val, pad) {
    val = val.toString();
    return '0'.repeat(Math.max(0, pad - val.length)) + val;
}

/// <summary>
/// Convert milliseconds to a user-friendly [h:]mm:ss.00
/// </summary>
function msToHms(ms)
{
    let seconds = ms / 1000;
    const hours = parseInt(seconds / 3600);
    const minutes = parseInt(seconds / 60) % 60;
    seconds = parseInt(seconds) % 60;
    const hundredths = parseInt(ms / 10) % 100;
    let pad2 = (time) => time < 10 ? "0" + time : time;
    let time = pad2(minutes) + ":" + pad2(seconds) + "." + pad2(hundredths);
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