import { isSmallScreen } from './WindowResizeEventHandler.js';
import { plural } from './Common.js';

/**
 * Pretty-print date functions.
 *
 * Adapted from PlexWeb/script/DateUtil.js
 */

const Timespans = {
    Second  : { long : 'second', short : 's'  },
    Minute  : { long : 'minute', short : 'm'  },
    Hour    : { long : 'hour',   short : 'h'  },
    Day     : { long : 'day',    short : 'd'  },
    Week    : { long : 'week',   short : 'w'  },
    Month   : { long : 'month',  short : 'mo' },
    Year    : { long : 'year',   short : 'y'  },
    Invalid : { long : '???',    short : '?'  },
};

/**
 * Helper that returns "In X" or "X ago" depending on whether the given value
 * is in the past or the future.
 * @param {string} val The user-friendly timespan
 * @param {boolean} isFuture */
function tense(val, isFuture) { return isFuture ? `In ${val}` : `${val} ago`; }

/**
 * Get the display text for the given count of str.
 * For desktop screens, this will be something like '2 weeks'.
 * For small screens, this weill be something like '2w'.
 * @param {number} count
 * @param {keyof Timespans} timespan */
function getText(count, timespan) {
    const ts = Timespans[timespan] || Timespans.Invalid;
    return isSmallScreen() ? count + ts.short : plural(count, ts.long);
}

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
    return tense(getText(count, stringVal), value < 0);
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

    const underTwoWeeks = checkDate(dateDiff /= 1000, 60, 'Second')
        || checkDate(dateDiff /= 60, 60, 'Minute')
        || checkDate(dateDiff /= 60, 24, 'Hour')
        || checkDate(dateDiff /= 24, 14, 'Day');

    if (underTwoWeeks) {
        return underTwoWeeks;
    }

    const isFuture = dateDiff < 0;
    dateDiff = Math.abs(dateDiff);

    if (dateDiff <= 29) {
        const weeks = Math.floor(dateDiff / 7);
        return tense(getText(weeks, 'Week'), isFuture);
    }

    if (dateDiff < 365) {
        const months = Math.round(dateDiff / 30.4); // "X / 30" is a bit more more natural than "May 1 - March 30 = 2 months"
        return tense(getText(months || 1, 'Month'), isFuture);
    }

    return tense(getText(Math.abs(now.getFullYear() - date.getFullYear()), 'Year'), isFuture);
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
