import { TestLog, TestRunner } from './TestRunner.js'

const testRunner = new TestRunner();
let testClass = getParam('--test_class', '-tc');
try {
    if (!testClass) {
        await testRunner.runAll();
    } else {
        await testRunner.runSpecific(testClass, getParam('--test_method', '-tm'));
    }
} catch (ex) {
    TestLog.error(`Failed to run all tests.`);
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
