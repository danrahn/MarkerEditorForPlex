const URL = require('url');

/// <summary>
/// Identical to a regular Error. Used to differentiate between "user bad"
/// exceptions (HTTP 400) and unexpected internal errors (HTTP 500)
/// </summary>
class QueryParameterException extends Error {
    constructor(message) {
        super(message);
    }
}

/// <summary>
/// Small helper class to handle query parameters
/// </summary>
class QueryParameterParser {
    constructor(request) {
        this.params = URL.parse(request.url, true /*parseQueryString*/).query;
    }

    /// <summary>
    /// Return the given query parameter as an integer.
    /// Throws if the parameter does not exist or it's not an integer.
    /// </summary>
    i(key) {
        const value = this.raw(key);
        const intVal = parseInt(value);
        if (isNaN(intVal)) {
            throw new QueryParameterException(`Expected integer parameter for ${key}, found ${this.params[key]}`);
        }
    
        return intVal;
    }

    /// <summary>
    /// Returns an array of query parameters as integers.
    /// Fails the same as `i` above.
    /// <summary>
    ints(...keys) {
        let result = [];
        for (const key of keys) {
            result.push(this.i(key));
        }

        return result;
    }

    /// <summary>
    /// Returns the given query parameter after the supplied function is applied to it.
    /// Throws if the parameter does not exist or the function could not be applied.
    /// </summary>
    custom(key, func) {
        const value = this.raw(key);
        try {
            return func(value);
        } catch (e) {
            throw new QueryParameterException(`Invalid value provided for ${key}`);
        }
    }

    /// <summary>
    /// Returns the raw value for the given query parameter. Throws if it does not exist.
    /// </summary>
    raw(key) {
        if (!(key in this.params)) {
            throw new QueryParameterException(`Parameter '${key}' not found.`);
        }

        return this.params[key];
    }
}

module.exports = {
    Parser : QueryParameterParser,
    QueryParameterException : QueryParameterException
};
