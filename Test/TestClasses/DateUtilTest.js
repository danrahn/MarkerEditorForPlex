import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

import { getDisplayDate, getFullDate } from '../../Client/Script/inc/DateUtil.js';

/**
 * Tests getDisplayDate from DateUtil. There's some fuzziness involved
 * due to how dates will be calculated depending on when the test is run,
 * but it should cover basic scenarios.
 */
export default class DateUtilTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.testNow,
            this.testSeconds,
            this.testMinutes,
            this.testHours,
            this.testDays,
            this.testWeeks,
            this.testMonths,
            this.testYears,
            this.basicGetFullDate,
        ];
    }

    className() { return 'DateUtilTest'; }

    testNow() {
        this.#testTime(new Date(), 'Just Now');
        this.#testTime(this.#dateDiff(14000), 'Just Now', '14 seconds');
        this.#testTime(this.#dateDiff(-14000), 'Just Now', '14 seconds');
    }

    testSeconds() {
        this.#testPastFuture(16000, '16 seconds', '16 seconds');
        this.#testPastFuture(59000, '59 seconds', '59 seconds');
    }

    testMinutes() {
        this.#testPastFuture(60000, '1 minute', '60 seconds');
        this.#testPastFuture(59 * 60000, '59 minutes', '59 minutes');
    }

    testHours() {
        this.#testPastFuture(60 * 60 * 1000, '1 hour', '60 minutes');
        this.#testPastFuture(70 * 60 * 1000, '1 hour', '70 minutes');
        this.#testPastFuture(119 * 60 * 1000, '1 hour', '119 minutes');
        this.#testPastFuture(2 * 60 * 60 * 1000, '2 hours', '120 minutes');
        this.#testPastFuture(23 * 60 * 60 * 1000, '23 hours', '23 hours');
    }

    testDays() {
        const oneDay = 24 * 60 * 60 * 1000;
        this.#testPastFuture(oneDay, '1 day', '24 hours');
        this.#testPastFuture(6 * oneDay, '6 days', '6 days');

        // Anything under 14 days should be days.
        this.#testPastFuture(7 * oneDay, '7 days', '7 days');
        this.#testPastFuture(13 * oneDay, '13 days', '13 days');
        this.#testPastFuture(13.12345 * oneDay, '13 days', '13.12345 days');
    }

    testWeeks() {
        const oneDay = 24 * 60 * 60 * 1000;
        this.#testPastFuture(14 * oneDay, '2 weeks', '14 days');
        this.#testPastFuture(20 * oneDay, '2 weeks', '20 days');
        this.#testPastFuture(21 * oneDay, '3 weeks', '21 days');
        this.#testPastFuture(22 * oneDay, '3 weeks', '22 days');
        this.#testPastFuture(28 * oneDay, '4 weeks', '28 days');
    }

    testMonths() {
        const oneDay = 24 * 60 * 60 * 1000;
        this.#testPastFuture(29 * oneDay, '1 month', '29 days');
        this.#testPastFuture(40 * oneDay, '1 month', '40 days');
        this.#testPastFuture(47 * oneDay, '2 months', '47 days');
        this.#testPastFuture(364 * oneDay, '12 months', '364 days');
    }

    testYears() {
        const oneDay = 24 * 60 * 60 * 1000;

        // Close enough for what we're testing.
        const oneYear = 367 * oneDay;
        this.#testPastFuture(oneYear, '1 year', '367 days');
        this.#testPastFuture(2 * oneYear, '2 years', '734 days');
        this.#testPastFuture(10 * oneYear, '10 years', '10 years');
    }

    #testPastFuture(diff, dateString, testDescription) {
        // DateUtil should `floor` the date, so add 500 to account for any ms differences
        // between the date being set and the call to getDisplayDate
        this.#testTime(this.#dateDiff(diff + 500), `${dateString} ago`, testDescription);
        this.#testTime(this.#dateDiff(-(diff + 500)), `In ${dateString}`, testDescription);
    }

    #dateDiff(msOffset) {
        return new Date(Date.now() - msOffset);
    }

    #testTime(date, expectedTime, testDescription) {
        // Assume that the given date is passed to DateUtil within ms of the initial calculation from now()
        const result = getDisplayDate(date);
        TestHelpers.verify(result === expectedTime,
            `DateUtilTest: "${testDescription}" - Dates do not match. Expected "${expectedTime}", found "${result}"`);
    }

    basicGetFullDate() {
        // This will need to change if I ever localize this app.
        const d = new Date('7/7/1999 13:01:01');
        TestHelpers.verify(getFullDate(d), 'July 7, 1999 at 1:01 PM');
    }
}
