import { parse } from 'url';

/**
 * Identical to a regular Error. Used to differentiate between "user bad"
 * exceptions (HTTP 4XX) and unexpected internal errors (HTTP 5XX).
 */
class QueryParameterException extends Error {
    constructor(message) {
        super(message);
    }
}

/*Small helper class to handle query parameters. */
class QueryParameterParser {
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
     * @param {string} key The string query parameter to parse.
     * @param {Function.<string>} func The function to apply to `key`.
     * @returns The result of applying the given `func` to `key`.
     * @throws {QueryParameterException} if `key` does not exist or cannot be handled by `func`.
     */
    custom(key, func) {
        const value = this.raw(key);
        try {
            return func(value);
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

export const Parser = QueryParameterParser;
export const ParserException = QueryParameterException;
