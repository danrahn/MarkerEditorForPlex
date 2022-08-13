import { parse } from 'url';
import ServerError from './ServerError.js';

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
    constructor(request) {
        /** @type {ParsedUrlQuery} */
        this.params = parse(request.url, true /*parseQueryString*/).query;
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
        let result = [];
        for (const key of keys) {
            result.push(this.i(key));
        }

        return result;
    }

    /**
     * Parses the comma separated integer values in the given key, returning an array of those values.
     * @param {string} key */
    ia(key) {
        const value = this.raw(key);
        try {
            return value.split(',').map(numStr => parseInt(numStr));
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
}

export default QueryParser;
