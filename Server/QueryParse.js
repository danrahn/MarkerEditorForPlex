import { parse } from 'url';

import FormDataParse from './FormDataParse.js';
import ServerError from './ServerError.js';

/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('./FormDataParse.js').ParsedFormData} ParsedFormData */

/**
 * Identical to a regular Error. Used to differentiate between "user bad"
 * exceptions (HTTP 4XX) and unexpected internal errors (HTTP 5XX).
 */
class QueryParameterException extends ServerError {
    constructor(message) {
        super(message, 400);
    }
}

/*Small helper class to handle query parameters. */
class QueryParser {
    /** @type {IncomingMessage} */
    #request;
    /** @type {ParsedFormData} */
    #formData;

    constructor(request) {
        /** @type {ParsedUrlQuery} */
        this.params = parse(request.url, true /*parseQueryString*/).query;
        this.#request = request;
    }

    /**
     * @param {string} key A string that can be parsed as an integer.
     * @returns The integer value of `key`.
     * @throws {QueryParameterException} if `key` doesn't exist or is not an integer.
     */
    i(key) {
        const value = this.raw(key);
        const intVal = parseInt(value);
        if (isNaN(intVal)) {
            throw new QueryParameterException(`Expected integer parameter for ${key}, found ${this.params[key]}`);
        }

        return intVal;
    }

    /**
     * @param {...string} keys Strings that can be parsed as integers.
     * @returns An array of query parameters parsed as integers.
     * @throws {QueryParameterException} if any string in `keys` is not an integer.
     */
    ints(...keys) {
        const result = [];
        for (const key of keys) {
            result.push(this.i(key));
        }

        return result;
    }

    /**
     * Parses the comma separated integer values in the given key, returning an array of those values.
     * @param {string} key
     * @param {boolean} allowEmpty If true, returns an empty array if the given field isn't present*/
    ia(key, allowEmpty=false) {
        let value;
        try {
            value = this.raw(key);
        } catch (ex) {
            if (allowEmpty && ex instanceof QueryParameterException) {
                return [];
            }

            throw ex;
        }

        try {
            return value.length == 0 ? [] : value.split(',').map(numStr => parseInt(numStr));
        } catch (e) {
            throw new QueryParameterException(`Invalid value provided for ${key}`);
        }
    }

    /**
     * @param {string} key The query parameter to retrieve.
     * @returns {string} The value associated with `key`.
     * @throws {QueryParameterException} if `key` is not present in the query parameters.
     */
    raw(key) {
        if (!(key in this.params)) {
            throw new QueryParameterException(`Parameter '${key}' not found.`);
        }

        return this.params[key];
    }

    /**
     * Retrieve a value from the request's form-data.
     * @param {string} key */
    async formInt(key) {
        const value = parseInt((await this.formRaw(key)).data);
        if (isNaN(value)) {
            throw new QueryParameterException(`Expected an integer for '${key}', found something else.`);
        }

        return value;
    }

    /**
     * Retrieve a custom object from the request's form data.
     * @param {string} key The form field to retrieve.
     * @param {(v: string) => any} transform The function that transforms the raw string to a custom object. */
    async formCustom(key, transform) {
        // transform should take care of any exceptions.
        return transform((await this.formRaw(key)).data);
    }

    /**
     * Retrieve a string from the request's form data.
     * @param {string} key The form field to retrieve. */
    async formString(key) {
        return (await this.formRaw(key)).data;
    }

    /**
     * Retrieve the raw string associated with the given key from the request's form data.
     * @param {string} key The form field to retrieve */
    async formRaw(key) {
        // All data starts as a string, so just return raw.
        if (!this.#formData) {
            this.#formData = await FormDataParse.parseRequest(this.#request, 1024 * 1024 * 32);
        }

        const value = this.#formData[key];
        if (value === undefined) {
            throw new QueryParameterException(`Form data field '${key} not found.`);
        }

        return value;
    }
}

export default QueryParser;
