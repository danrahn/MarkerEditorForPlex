/**
 * A thin wrapper around an Error that also stores an HTTP status
 * code (e.g. to distinguish between server errors and user errors)
 */
class ServerError extends Error {
    /** @type {number} HTTP response code. */
    code;

    /** @type {boolean} Whether this is an expected error. */
    expected;

    /**
     * Construct a new ServerError
     * @param {string} message
     * @param {number} code */
    constructor(message, code, expected=false) {
        super(message);
        this.code = code;
        this.expected = expected;
    }

    /**
     * Return a new server error based on the given database error,
     * which will always be a 500 error.
     * @param {Error} err */
    static FromDbError(err) {
        return new ServerError(err.message, 500);
    }
}

export default ServerError;
