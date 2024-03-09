/**
 * Custom error class used to distinguish between errors
 * surfaced by an API call and all others. */
export default class FetchError extends Error {
    /**
     * @param {string} message
     * @param {string} stack */
    constructor(message, stack) {
        super(message);
        if (stack) {
            this.stack = stack;
        }
    }
}
