import { ContextualLog } from '../Shared/ConsoleLog.js';
import { MarkerType } from '../Shared/MarkerType.js';
import ServerError from './ServerError.js';

/** @typedef {!import('./PlexQueryManager').RawMarkerData} RawMarkerData */
/** @typedef {!import('./SqliteDatabase').default} SqliteDatabase */
/** @typedef {!import('./SqliteDatabase').DbDictParameters} DbDictParameters */

/** @typedef {{ query: string, parameters: DbDictParameters }} DbQuery */

const Log = ContextualLog.Create('MediaAnalysisWriter');

const AttributeKeys = {
    Intro : 'pv:intros',
    Credits : 'pv:credits',
    Ads : 'pv:commercials',
};

/**
 * Parse and validate the given raw extra_data JSON string, returning the given key attribute within the JSON.
 * @param {string} raw
 * @param {string} key */
function getMarkerJson(raw, key) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        Log.warn('Failed to parse extra_data as JSON, cannot write extra_data');
        throw e;
    }

    if (!Object.prototype.hasOwnProperty.call(parsed, 'url')) {
        Log.warn('Extra data did not have url key, cannot write extra_data');
        throw new Error();
    }

    try {
        return JSON.parse(parsed[key]);
    } catch (e) {
        Log.warn(`Failed to parse ${key} JSON, cannot write extra_data`);
        throw e;
    }
}

/**
 * Validate that the given object has the expected keys and types, and no unexpected keys.
 * @param {Object} obj
 * @param {{[key: string]: string}} expectedFields
 * @param {{[key: string]: string}} optionalFields */
function validateKeys(obj, expectedFields, optionalFields={}) {
    if (typeof obj !== 'object') {
        Log.warn('Marker data was not an object, cannot write extra_data');
        return false;
    }

    const expectedKeys = new Set(Object.keys(expectedFields));
    const actualKeys = new Set(Object.keys(obj).filter(k => Object.prototype.hasOwnProperty.call(obj, k)));

    const validateType = (value, expectedType) => {
        if (expectedType === 'array') {
            return value instanceof Array;
        }

        return typeof value === expectedType;
    };

    for (const key of expectedKeys) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
            Log.warn(`Object did not have expected key '${key}', cannot write extra_data`);
            return false;
        }

        if (!validateType(obj[key], expectedFields[key])) {
            Log.warn(`Expected key '${key}' to be of type ${expectedFields[key]}, but was ${typeof obj[key]}. Cannot write extra_data`);
            return false;
        }

        actualKeys.delete(key);
    }

    const optionalKeys = new Set(Object.keys(optionalFields));
    for (const key of optionalKeys) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && !validateType(obj[key], optionalFields[key])) {
            Log.warn(`Expected key '${key}' to be of type ${optionalFields[key]}, but was ${typeof obj[key]}. Cannot write extra_data`);
            return false;
        }

        actualKeys.delete(key);
    }

    // If we have any keys left over, they are unexpected.
    if (actualKeys.size > 0) {
        Log.warn(`Intros had unexpected keys '${Array.from(actualKeys).join(', ')}', cannot write extra_data`);
        return false;
    }

    return true;
}

/**
 * Class that encapsulates re-writing media analysis data in the Plex database.
 */
export class MediaAnalysisWriter {
    /** @type {number} */
    #metadataId;
    /** @type {SqliteDatabase} */
    #db;
    constructor(metadataId, db) {
        this.#metadataId = metadataId;
        this.#db = db;
    }

    /** @type {Promise<[boolean, boolean, boolean]>} */
    static #validating;

    /**
     * Checks if the database has the expected data for intros, credits, and commercials.
     * @param {SqliteDatabase} db */
    static async hasExpectedData(db) {
        // Only validate once per session.
        if (!MediaAnalysisWriter.#validating) {
            MediaAnalysisWriter.#validating = Promise.all([
                MediaAnalysisWriter.#validateMarkerType(db, 'intros', AttributeKeys.Intro, 'pv:intros":"{'),
                MediaAnalysisWriter.#validateMarkerType(db, 'credits', AttributeKeys.Credits, 'pv:credits":"{'),
                MediaAnalysisWriter.#validateMarkerType(db, 'commercials', AttributeKeys.Ads, 'pv:commercials":"{')
            ]);
        }

        const result = await MediaAnalysisWriter.#validating;
        return result.every(r => r);
    }

    /**
     * Validate database extra_data for the given marker type.
     * Picks from a random sample of 10 media parts in an attempt to avoid potential issues with
     * reading from bad data that we previously wrote.
     * @param {SqliteDatabase} db
     * @param {string} markerType
     * @param {string} attributeKey
     * @param {string} likeClause */
    static async #validateMarkerType(db, markerType, attributeKey, likeClause) {
        const query = `SELECT extra_data FROM media_parts WHERE extra_data LIKE '%${likeClause}%' ORDER BY RANDOM() LIMIT 10`;
        const markerTypeData = await db.all(query);
        if (markerTypeData.length === 0) {
            Log.verbose(`No ${markerType} found, cannot validate intro extra_data`);
            return true;
        }

        let semiValidated = false;
        for (const data of markerTypeData) {
            let markersData;
            try {
                markersData = getMarkerJson(data.extra_data, attributeKey);
            } catch {
                return false;
            }

            if (!validateKeys(markersData, { MediaPartMarkersArray : 'object' })) {
                return false;
            }

            const markersObject = markersData.MediaPartMarkersArray;
            const markersObjectKeys = { version : 'number', attributeName : 'string' };
            const optionalMarkerObjectKeys = {};
            if (attributeKey === AttributeKeys.Credits) {
                optionalMarkerObjectKeys.MediaPartMarker = 'array';
            } else {
                markersObjectKeys.MediaPartMarker = 'array';
            }

            if (!validateKeys(markersObject, markersObjectKeys, optionalMarkerObjectKeys)) {
                return false;
            }

            if (markersObject.attributeName !== markerType) {
                Log.warn(`${markerType} did not have expected attributeName (${markersObject.attributeName}), cannot write extra_data`);
                return false;
            }

            if (attributeKey === AttributeKeys.Credits) {
                // An item analyzed for credits, but with no credits found will have a skeleton object
                // without a MediaPartMarker array. Continue on in hopes of finding an item with actual credits.
                if (!markersObject.MediaPartMarker) {
                    semiValidated = true;
                    continue;
                }
            } else if (markersObject.MediaPartMarker.length === 0) {
                Log.warn(`An item without ${markerType} is expected to have an empty value, ` +
                    `but valid JSON was found. Cannot write extra_data`);
                return false;
            }

            const optionalKeys = attributeKey === AttributeKeys.Credits ? { final : 'boolean' } : {};
            if (!validateKeys(markersObject.MediaPartMarker[0], { startTimeOffset : 'number', endTimeOffset : 'number' }, optionalKeys)) {
                return false;
            }

            return true;
        }

        if (semiValidated) {
            Log.verbose(`Found credits extra_data, but no actual credits. Assuming this is a valid state.`);
        }

        return true;
    }

    /**
     * @param {RawMarkerData[]} markers */
    async getExtraData(markers) {
        const data = await this.#getExtraData();
        /** @type {Promise<DbQuery>[]} */
        const promises = [];
        for (const extraData of data) {
            promises.push(this.#getUpdateStatement(extraData.extra_data, extraData.part_id, markers));
        }

        return Promise.all(promises);
    }

    async #getExtraData() {

        const query = `
SELECT media_parts.extra_data AS extra_data, b.id AS part_id FROM media_parts
INNER JOIN media_items ON media_parts.media_item_id=media_items.id
INNER JOIN metadata_items b ON media_items.metadata_item_id=b.id WHERE b.id=?;`;

        /** @type {{ extra_data: string, part_id: number }} */
        const data = (await this.#db.all(query, [this.#metadataId]));
        if (!data) {
            throw new ServerError(`No underlying media items found for metadata id ${this.#metadataId}`, 400);
        }

        return data;
    }

    /**
     * @param {string} existingData
     * @param {number} partId
     * @param {RawMarkerData[]} markers
     * @returns {DbQuery} */
    #getUpdateStatement(existingData, partId, markers) {
        // Caller must validate that the database is new enough to have JSON extra_data.
        const asJson = JSON.parse(existingData);
        const { url : _, ...coreObj } = asJson;

        this.#setIntroData(markers, coreObj);
        this.#setCreditData(markers, coreObj);
        this.#setAdData(markers, coreObj);

        // Plex writes out properties alphabetically, so make sure they're sorted before finalizing.
        const sorted = {};
        Object.keys(coreObj).sort().forEach(key => sorted[key] = coreObj[key]);
        this.#finalizeExtraData(sorted);
        return {
            query : `UPDATE media_parts SET extra_data=$extraData WHERE id=$partId`,
            parameters : { $extraData : JSON.stringify(sorted), $partId : partId }
        };
    }

    /**
     * Sets extraData's intros attribute based on the markers.
     * @param {RawMarkerData[]} markers
     * @param {Object} extraData */
    #setIntroData(markers, extraData) {
        const intros = markers.filter(m => m.marker_type === MarkerType.Intro);
        if (intros.length === 0) {
            extraData[AttributeKeys.Intro] = '';
            return;
        }

        const introData = {
            MediaPartMarkersArray : {
                attributeName : 'intros',
                version : 5,
                MediaPartMarker : intros.map(m => ({
                    startTimeOffset : m.start,
                    endTimeOffset : m.end,
                })),
            }
        };

        extraData[AttributeKeys.Intro] = introData;
    }

    /**
     * @param {RawMarkerData[]} markers
     * @param {Object} extraData */
    #setCreditData(markers, extraData) {
        const credits = markers.filter(m => m.marker_type === MarkerType.Credits);
        if (credits.length === 0) {
            extraData[AttributeKeys.Credits] = {
                attributeName : 'credits',
                version : 4,
            };
            return;
        }

        const creditData = {
            MediaPartMarkersArray : {
                attributeName : 'credits',
                version : 4,
                MediaPartMarker : credits.map(m => {
                    const obj = {
                        startTimeOffset : m.start,
                        endTimeOffset : m.end,
                    };

                    if (m.final) {
                        obj.final = true;
                    }

                    return obj;
                }),
            }
        };

        extraData[AttributeKeys.Credits] = creditData;
    }

    /**
     * @param {RawMarkerData[]} markers
     * @param {Object} extraData */
    #setAdData(markers, extraData) {
        const ads = markers.filter(m => m.marker_type === MarkerType.Ads);
        if (ads.length === 0) {
            // Small sample size, but based on my database, if there are no ad markers,
            // there is no pv:commercial attribute. Interesting that each marker type
            // seems to have a different way of dealing with empty values.
            delete extraData[AttributeKeys.Ads];
            return;
        }

        const adData = {
            MediaPartMarkersArray : {
                attributeName : 'commercials',
                version : -1,
                MediaPartMarker : ads.map(m => ({
                    startTimeOffset : m.start,
                    endTimeOffset : m.end,
                })),
            }
        };

        extraData[AttributeKeys.Ads] = JSON.stringify(adData);
    }

    /**
     * Finalize the extra data by ensuring all values are strings, and add the url-encoded value of the object.
     * @param {Object} extraData */
    #finalizeExtraData(extraData) {
        let url = '';
        for (const key of Object.keys(extraData)) {
            // All values should be strings/numbers, so if we have an object, we know we need to stringify it.
            const value = extraData[key];
            if (typeof value === 'object') {
                extraData[key] = JSON.stringify(value);
            }

            url += `&${encodeURIComponent(key)}=${encodeURIComponent(extraData[key])}`;
        }

        extraData.url = url.substring(1);
    }
}
