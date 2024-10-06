import { parse } from 'url';

import FormDataParse from './FormDataParse.js';
import ServerError from './ServerError.js';

/** @typedef {!import('express').Request} ExpressRequest */
/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('querystring').ParsedUrlQuery} ParsedUrlQuery */
/** @typedef {!import('./FormDataParse.js').ParsedFormData} ParsedFormData */

/**
 * Identical to a regular Error. Used to differentiate between "user bad"
 * exceptions (HTTP 4XX) and unexpected internal errors (HTTP 5XX).
 */
class QueryParameterException extends ServerError {
    /** @param {string} message */
    constructor(message) {
        super(message, 400);
    }
}

/** Internal check used to ensure that QueryParers are only initialized via getQueryParser */
let initGuard = false;

/*Small helper class to handle query parameters. */
export class QueryParser {
    /** @type {ExpressRequest} */
    #request;

    /** @type {ExpressResponse} */
    #response;

    /** @type {ParsedFormData} */
    #formData = null;

    /** @type {ParsedUrlQuery} */
    #params;

    /**
     * @param {ExpressRequest} request
     * @param {ExpressResponse} response */
    constructor(request, response) {
        if (!initGuard) {
            throw new ServerError(`QueryParser should only be instantiated via getQueryParser.`, 500);
        }

        /** @type {ParsedUrlQuery} */
        this.#params = parse(request.url, true /*parseQueryString*/).query;
        this.#request = request;
        this.#response = response;
    }

    /**
     * Initialize this query parser, loading any form data if applicable. */
    async init() {
        this.#formData = await FormDataParse.parseRequest(this.#request, 1024 * 1024 * 32);
        return this;
    }

    /**
     * Return the raw request.
     * @returns {ExpressRequest} */
    r() {
        return this.#request;
    }

    /**
     * @param {string} key A string that can be parsed as an integer.
     * @returns The integer value of `key`.
     * @throws {QueryParameterException} if `key` doesn't exist or is not an integer. */
    i(key) {
        const value = this.s(key);
        const intVal = parseInt(value);
        if (isNaN(intVal)) {
            throw new QueryParameterException(`Expected integer parameter for ${key}, found ${this.#params[key]}`);
        }

        return intVal;
    }

    /**
     * @param {...string} keys Strings that can be parsed as integers.
     * @returns An array of query parameters parsed as integers.
     * @throws {QueryParameterException} if any string in `keys` is not an integer. */
    is(...keys) {
        const result = [];
        for (const key of keys) {
            result.push(this.i(key));
        }

        return keys.length === 1 ? result[0] : result;
    }

    /**
     * Parses the comma separated integer values in the given key, returning an array of those values.
     * @param {string} key
     * @param {boolean} allowEmpty If true, returns an empty array if the given field isn't present*/
    ia(key, allowEmpty=false) {
        let value;
        try {
            value = this.s(key);
        } catch (ex) {
            if (allowEmpty && ex instanceof QueryParameterException) {
                return [];
            }

            throw ex;
        }

        try {
            return value.length === 0 ? [] : value.split(',').map(numStr => parseInt(numStr));
        } catch (e) {
            throw new QueryParameterException(`Invalid value provided for ${key}`);
        }
    }

    /**
     * @param {string} key The query parameter to retrieve.
     * @returns {string} The value associated with `key`.
     * @throws {QueryParameterException} if `key` is not present in the query parameters. */
    s(key) {
        if (!(key in this.#params)) {
            throw new QueryParameterException(`Parameter '${key}' not found.`);
        }

        return this.#params[key];
    }

    /**
     * Retrieve a value from the request's form-data.
     * @param {string} key */
    fi(key) {
        const value = parseInt((this.fs(key)));
        if (isNaN(value)) {
            throw new QueryParameterException(`Expected an integer for '${key}', found something else.`);
        }

        return value;
    }

    /**
     * Retrieve a custom object from the request's form data.
     * @param {string} key The form field to retrieve.
     * @param {(v: string) => any} transform The function that transforms the raw string to a custom object. */
    fc(key, transform) {
        // transform should take care of any exceptions.
        return transform(this.fs(key));
    }

    /**
     * Retrieve the raw string associated with the given key from the request's form data.
     * @param {string} key The form field to retrieve */
    fs(key) {
        return this.fr(key).data;
    }

    /**
     * Return the raw form object for the given key.
     * @param {string} key The form field to retrieve */
    fr(key) {
        if (!this.#formData) {
            throw new ServerError(`Attempting to access form data without calling init().`, 500);
        }

        const value = this.#formData[key];
        if (value === undefined) {
            throw new QueryParameterException(`Form data field '${key}' not found.`);
        }

        return value;
    }

    response() { return this.#response; }
}

/**
 * @param {ExpressRequest} request
 * @param {ExpressResponse} response */
export async function getQueryParser(request, response) {
    initGuard = true;
    const parser = new QueryParser(request, response);
    initGuard = false;
    await parser.init();
    return parser;
}
