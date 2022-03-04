/**
 * Pretty-print date functions.
 *
 * Taken from PlexWeb/script/DateUtil.js
 */
let DateUtil = new function()
{
    /**
     * Determine how long ago a date is from the current time.
     * @param {Date|string} date A Date object, or a string that represents a date.
     * @returns A string of the form "X [time units] ago".
     */
    this.getDisplayDate = function(date)
    {
        if (!(date instanceof Date))
        {
            date = new Date(date);
        }

        let now = new Date();
        let dateDiff = Math.abs(now - date);
        if (dateDiff < 15000)
        {
            return "Just Now";
        }

        let underTwoWeeks = _checkDate(dateDiff /= 1000, 60, "second") ||
            _checkDate(dateDiff /= 60, 60, "minute") ||
            _checkDate(dateDiff /= 60, 24, "hour") ||
            _checkDate(dateDiff /= 24, 14, "day");

        if (underTwoWeeks)
        {
            return underTwoWeeks;
        }

        if (dateDiff <= 28)
        {
            let weeks = Math.floor(dateDiff / 7);
            return `${weeks} week${weeks == 1 ? "" : "s"} ago`;
        }

        if (dateDiff < 365)
        {
            let months = (now.getMonth() + (now.getFullYear() == date.getFullYear() ? 0 : 12)) - date.getMonth();
            return `${months == 0 ? 1 : months} month${months == 1 ? "" : "s"} ago`;
        }

        let yearDiff = now.getFullYear() - date.getFullYear();
        return `${yearDiff == 0 ? 1 : yearDiff} year${yearDiff == 1 ? "" : "s"} ago`;
    };

    /**
     * Get the long form of the given date.
     * @param {Date|string} date A Date object, or a string that represents a date.
     * @returns The full date, 'Month d, yyy, h:.. [AM:PM]'
     */
    this.getFullDate = function(date)
    {
        if (!(date instanceof Date))
        {
            date = new Date(date);
        }

        let tooltipDateOptions =
        {
            month : "long",
            day : "numeric",
            year : "numeric",
            hour : "numeric",
            minute : "numeric"
        };

        return date.toLocaleDateString("en-US", tooltipDateOptions);
    };

    /**
     * Determine if the given value meets our cutoff criteria.
     * @param {number} value The value to test.
     * @param {number} cutoff The cutoff for the given value.
     * @param {string} stringVal The time unit that's being tested (minute, hour, day, etc).
     * @returns 'value stringVal(s) ago' if `value` exceeds `cutoff`, otherwise an empty string.
     */
    let _checkDate = function(value, cutoff, stringVal)
    {
        if (value < cutoff)
        {
            let count = Math.floor(value);
            return `${count} ${stringVal}${count == 1 ? "" : "s"} ago`;
        }

        return "";
    };
}();

// Hack for VSCode intellisense.
if (typeof __dontEverDefineThis !== 'undefined') {
    module.exports = { DateUtil };
}
