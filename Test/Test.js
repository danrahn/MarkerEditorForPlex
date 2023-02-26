import { createInterface as createReadlineInterface } from 'readline';
/** @typedef {!import('readline').Interface} Interface */

import { TestLog, TestRunner } from './TestRunner.js';

const testRunner = new TestRunner();
const testClass = getParam('--test_class', '-tc');
try {
    if (testClass) {
        await testRunner.runSpecific(testClass, getParam('--test_method', '-tm'));
    } else if (process.argv.indexOf('--ask-input') != -1) {
        await askForTests();
    } else {
        await testRunner.runAll();
    }
} catch (ex) {
    TestLog.error(`Failed to run tests.`);
    TestLog.error(ex.message);
    TestLog.error(ex.stack ? ex.stack : `[No stack trace available]`);
}

/**
 * Gets user input to determine the test class/method to run. */
async function askForTests() {
    const rl = createReadlineInterface({
        input : process.stdin,
        output : process.stdout });
    const testClass = await askUser('Test Class Name: ', rl);
    const testMethod = await askUser('Test Method (Enter to run all class tests): ', rl);
    rl.close();
    return testRunner.runSpecific(testClass, testMethod);
}

/**
 * Wrap callback-based readline with a Promise.
 * Native promise-based readline is available experimentally in Node 17, but LTS is still on 16.x
 * @param {string} message The question to ask the user
 * @param {Interface} rl ReadLine interface
 * @returns {Promise<string>} */
async function askUser(message, rl) {
    return new Promise((resolve, _) => {
        rl.question(message, resolve);
    });
}

/**
 * Retrieved a named command line parameter, null if it doesn't exist.
 * @param {string} name The full parameter name
 * @param {string} alternate An alternative form of the parameter */
function getParam(name, alternate) {
    let paramIndex = process.argv.indexOf(name);
    if (paramIndex == -1) {
        paramIndex = process.argv.indexOf(alternate);
    }

    if (paramIndex == -1 || paramIndex >= process.argv.length - 1) {
        return null;
    }

    return process.argv[paramIndex + 1];
}
