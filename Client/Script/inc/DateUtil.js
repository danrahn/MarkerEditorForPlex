import { plural } from '../Common.js';

/**
 * Pretty-print date functions.
 *
 * Adapted from PlexWeb/script/DateUtil.js
 */

/**
 * Helper that returns "In X" or "X ago" depending on whether the given value
 * is in the past or the future.
 * @param {string} val The user-friendly timespan
 * @param {boolean} isFuture */
function tense(val, isFuture) { return isFuture ? `In ${val}` : `${val} ago`; }

/**
 * Determine if the given value meets our cutoff criteria.
 * @param {number} value The value to test.
 * @param {number} cutoff The cutoff for the given value.
 * @param {string} stringVal The time unit that's being tested (minute, hour, day, etc).
 * @returns 'value stringVal(s) ago' if `value` exceeds `cutoff`, otherwise an empty string. */
function checkDate(value, cutoff, stringVal) {
    const abs = Math.abs(value);
    if (abs >= cutoff) {
        return false;
    }

    const count = Math.floor(abs);
    // Really shouldn't be happening, but handle future dates
    return tense(plural(count, stringVal), value < 0);
}


/**
 * Get a "pretty-print" string for the given date, e.g. "2 hours ago" or "5 years ago".
 * @param {Date|string} date A Date object, or a string that represents a date.
 * @returns {string} A string of the form "X [time units] ago" (or "In X [time units]" for future dates) */
export function getDisplayDate(date) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    const now = new Date();
    let dateDiff = now - date;
    if (Math.abs(dateDiff) < 15000) {
        return 'Just Now';
    }

    const underTwoWeeks = checkDate(dateDiff /= 1000, 60, 'second')
        || checkDate(dateDiff /= 60, 60, 'minute')
        || checkDate(dateDiff /= 60, 24, 'hour')
        || checkDate(dateDiff /= 24, 14, 'day');

    if (underTwoWeeks) {
        return underTwoWeeks;
    }

    const isFuture = dateDiff < 0;
    dateDiff = Math.abs(dateDiff);

    if (dateDiff <= 29) {
        const weeks = Math.floor(dateDiff / 7);
        return tense(plural(weeks, 'week'), isFuture);
    }

    if (dateDiff < 365) {
        const months = Math.round(dateDiff / 30.4); // "X / 30" is a bit more more natural than "May 1 - March 30 = 2 months"
        return tense(plural(months || 1, 'month'), isFuture);
    }

    return tense(plural(Math.abs(now.getFullYear() - date.getFullYear()), 'year'), isFuture);
}

/**
 * Get the long form of the given date.
 * @param {Date|string} date A Date object, or a string that represents a date.
 * @returns {string} The full date, 'Month d, yyyy, h:.. [AM|PM]' */
export function getFullDate(date) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    const fullDateOptions = {
        month : 'long',
        day : 'numeric',
        year : 'numeric',
        hour : 'numeric',
        minute : 'numeric'
    };

    // TODO: Localization?
    return date.toLocaleDateString('en-US', fullDateOptions);
}
