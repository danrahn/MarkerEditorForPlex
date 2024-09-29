import { createInterface as createReadlineInterface } from 'readline/promises';
/** @typedef {!import('readline').Interface} Interface */

import { TestLog, TestRunner } from './TestRunner.js';

const testRunner = new TestRunner();
const testClass = getParam('--test_class', '-tc');
try {
    if (testClass) {
        await testRunner.runSpecific(testClass, getParam('--test_method', '-tm'));
    } else if (~process.argv.indexOf('--ask-input')) {
        await askForTests();
    } else {
        await testRunner.runAll();
    }
} catch (ex) {
    TestLog.error(`Failed to run tests.`);
    TestLog.error(ex.message || ex);
    TestLog.error(ex.stack ? ex.stack : `[No stack trace available]`);
}

/**
 * Gets user input to determine the test class/method to run. */
async function askForTests() {
    const rl = createReadlineInterface({
        input : process.stdin,
        output : process.stdout });
    const tcName = await rl.question('Test Class Name: ');
    const testMethod = await rl.question('Test Method (Enter to run all class tests): ');
    rl.close();
    return testRunner.runSpecific(tcName, testMethod || null);
}

/**
 * Retrieved a named command line parameter, null if it doesn't exist.
 * @param {string} name The full parameter name
 * @param {string} alternate An alternative form of the parameter */
function getParam(name, alternate) {
    let paramIndex = process.argv.indexOf(name);
    if (paramIndex === -1) {
        paramIndex = process.argv.indexOf(alternate);
    }

    if (paramIndex === -1 || paramIndex >= process.argv.length - 1) {
        return null;
    }

    return process.argv[paramIndex + 1];
}
