/** @typedef {!import('http').IncomingMessage} IncomingMessage */

import { CoreCommands, GeneralCommands, PurgeCommands, QueryCommands } from './Commands/AllCommands.js';
import LegacyMarkerBreakdown from './LegacyMarkerBreakdown.js';
import QueryParser from './QueryParse.js';
import ServerError from './ServerError.js';
import { ShiftApplyType } from './Commands/CoreCommands.js';

class ServerCommands {
    /* eslint-disable indent, max-len */
    /**
    * Map endpoints to their corresponding functions. Also breaks out and validates expected query parameters.
    * @type {{[endpoint: string]: (params : QueryParser) => Promise<any>}} */
    static #commandMap = {
        add           : async (params) => await CoreCommands.addMarker(params.raw('type'), ...params.ints('metadataId', 'start', 'end', 'final')),
        edit          : async (params) => await CoreCommands.editMarker(params.raw('type'), ...params.ints('id', 'start', 'end', 'userCreated', 'final')),
        delete        : async (params) => await CoreCommands.deleteMarker(params.i('id')),
        check_shift   : async (params) => await CoreCommands.shiftMarkers(params.i('id'), 0, 0, ShiftApplyType.DontApply, []),
        shift         : async (params) => await CoreCommands.shiftMarkers(
                                                                ...params.ints('id', 'startShift', 'endShift'),
                                                                params.i('force') ? ShiftApplyType.ForceApply : ShiftApplyType.TryApply,
                                                                params.ia('ignored', true)),
        bulk_delete   : async (params) => await CoreCommands.bulkDelete(params.i('id'), params.i('dryRun'), params.ia('ignored', true)),
        bulk_add      : async (params) => await CoreCommands.bulkAdd(params.raw('type'), ...params.ints('id', 'start', 'end', 'final', 'resolveType'), params.ia('ignored')),


        query         : async (params) => await QueryCommands.queryIds(params.ia('keys')),
        get_sections  : async (_)      => await QueryCommands.getLibraries(),
        get_section   : async (params) => await QueryCommands.getLibrary(params.i('id')),
        get_seasons   : async (params) => await QueryCommands.getSeasons(params.i('id')),
        get_episodes  : async (params) => await QueryCommands.getEpisodes(params.i('id')),
        check_thumbs  : async (params) => await QueryCommands.checkForThumbs(params.i('id')),
        get_stats     : async (params) => await QueryCommands.allStats(params.i('id')),
        get_breakdown : async (params) => await QueryCommands.getMarkerBreakdownTree(...params.ints('id', 'includeSeasons')),

        get_config    : async (_)      => await GeneralCommands.getConfig(),
        log_settings  : async (params) => await GeneralCommands.setLogSettings(...params.ints('level', 'dark', 'trace')),

        purge_check   : async (params) => await PurgeCommands.purgeCheck(params.i('id')),
        all_purges    : async (params) => await PurgeCommands.allPurges(params.i('sectionId')),
        restore_purge : async (params) => await PurgeCommands.restoreMarkers(params.ia('markerIds'), ...params.ints('sectionId', 'resolveType')),
        ignore_purge  : async (params) => await PurgeCommands.ignorePurgedMarkers(params.ia('markerIds'), params.i('sectionId')),
    };
    /* eslint-enable */

    /**
     * Reset the state of the command controller. */
    static clear() {
        LegacyMarkerBreakdown.Clear();
    }

    /**
     * Run the given command.
     * @param {string} endpoint
     * @param {IncomingMessage} request
     * @throws {ServerError} If the endpoint does not exist or the request fails. */
    static async runCommand(endpoint, request) {
        if (!ServerCommands.#commandMap[endpoint]) {
            throw new ServerError(`Invalid endpoint: ${endpoint}`, 404);
        }

        return ServerCommands.#commandMap[endpoint](new QueryParser(request));
    }
}

export default ServerCommands;
