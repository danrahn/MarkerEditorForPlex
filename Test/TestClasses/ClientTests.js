import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

import { roundDelta } from '../../Client/Script/TimeInput.js';

class ClientTests extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.markerTimestampRoundingTest,
        ];
    }

    className() { return 'ClientTests'; }

    markerTimestampRoundingTest() {
        /*              ms     max   factor expected*/
        this.#roundTest(1234,  2000, 5000,     0);
        this.#roundTest(1234,  2000, 1000,  1000);
        this.#roundTest(1234,  2000,  500,  1000);
        this.#roundTest(1234,  2000,  100,  1200);
        this.#roundTest(1255,  2000,  500,  1500);
        this.#roundTest(1555,  1999, 1000,  1000);
        this.#roundTest(7600, 15000, 5000, 10000);
        this.#roundTest(7600, 15000, 1000,  8000);
        this.#roundTest(7600, 15000,  500,  7500);
        this.#roundTest(7600, 15000,  100,  7600);
        this.#roundTest(5000, 15000, 5000,  5000);
        this.#roundTest(5000, 15000, 1000,  5000);
        this.#roundTest(5000, 15000,  500,  5000);
        this.#roundTest(5000, 15000,  100,  5000);
    }

    #roundTest(current, max, factor, expected) {
        const delta = roundDelta(current, max, factor);
        const result = current + delta;
        TestHelpers.verify(result === expected, `Expected roundTo(${current}, ${max}, ${factor}) to return ${expected}, got ${result}`);
    }
}

export default ClientTests;
