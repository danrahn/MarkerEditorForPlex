/**
 * A thin wrapper around an Error that also stores an HTTP status
 * code (e.g. to distinguish between server errors and user errors)
 */
class ServerError extends Error {
    /** @type {number} HTTP response code. */
    code;

    /**
     * Construct a new ServerError
     * @param {string} message
     * @param {number} code */
    constructor(message, code) {
        super(message);
        this.code = code;
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
