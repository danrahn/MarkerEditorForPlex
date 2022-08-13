import { IncomingMessage } from 'http';
import { Log } from '../Shared/ConsoleLog.js';

import { CoreCommands, GeneralCommands, PurgeCommands, QueryCommands } from './Commands/AllCommands.js';

import LegacyMarkerBreakdown from './LegacyMarkerBreakdown.js';
import QueryParser from './QueryParse.js';
import ServerError from './ServerError.js';

class ServerCommands {

    /** @type {CoreCommands} */
    #cc;
    /** @type {QueryCommands} */
    #qc;
    /** @type {GeneralCommands} */
    #gc;
    /** @type {PurgeCommands} */
    #pc;

    /**
    * Map endpoints to their corresponding functions. Also breaks out and validates expected query parameters.
    * @type {{[endpoint: string]: (params : QueryParser) => Promise<any>}} */
    #commandMap = {
        add           : async (params) => await this.#cc.addMarker(...params.ints('metadataId', 'start', 'end')),
        edit          : async (params) => await this.#cc.editMarker(...params.ints('id', 'start', 'end', 'userCreated')),
        delete        : async (params) => await this.#cc.deleteMarker(params.i('id')),

        query         : async (params) => await this.#qc.queryIds(params.ia('keys')),
        get_sections  : async (_     ) => await this.#qc.getLibraries(),
        get_section   : async (params) => await this.#qc.getShows(params.i('id')),
        get_seasons   : async (params) => await this.#qc.getSeasons(params.i('id')),
        get_episodes  : async (params) => await this.#qc.getEpisodes(params.i('id')),
        get_stats     : async (params) => await this.#qc.allStats(params.i('id')),
        get_breakdown : async (params) => await this.#qc.getShowMarkerBreakdownTree(...params.ints('id', 'includeSeasons')),

        get_config    : async (_     ) => await this.#gc.getConfig(),
        log_settings  : async (params) => await this.#gc.setLogSettings(...params.ints('level', 'dark', 'trace')),

        purge_check   : async (params) => await this.#pc.purgeCheck(params.i('id')),
        all_purges    : async (params) => await this.#pc.allPurges(params.i('sectionId')),
        restore_purge : async (params) => await this.#pc.restoreMarkers(params.ia('markerIds'), params.i('sectionId')),
        ignore_purge  : async (params) => await this.#pc.ignorePurgedMarkers(params.ia('markerIds'), params.i('sectionId')),
    };

    /**
     * Create a new ServerCommands object. */
    constructor() {
        Log.tmi('Initializing Command Groups');
        LegacyMarkerBreakdown.Clear();
        this.#cc = new CoreCommands();
        this.#qc = new QueryCommands();
        this.#gc = new GeneralCommands();
        this.#pc = new PurgeCommands();
    }

    /**
     * Reset the state of this command controller, which will ensure
     * any subsequent attempted requests will fail. */
    clear() {
        LegacyMarkerBreakdown.Clear();
        this.#cc = null;
        this.#qc = null;
        this.#gc = null;
        this.#pc = null;
    }

    /**
     * Run the given command.
     * @param {string} endpoint
     * @param {IncomingMessage} request
     * @throws {ServerError} If the endpoint does not exist or the request fails. */
    async runCommand(endpoint, request) {
        if (!this.#commandMap[endpoint]) {
            throw new ServerError(`Invalid endpoint: ${endpoint}`, 404);
        }

        return this.#commandMap[endpoint](new QueryParser(request));
    }
}

export default ServerCommands;
