// Test dependencies
import TestBase from './TestBase.js';

import BasicCRUD from './TestClasses/BasicCRUDTest.js';
import ImageTest from './TestClasses/ImageTest.js';
import MultipleMarkers from './TestClasses/MultipleMarkersTest.js';

// Server/Shared dependencies
import { ConsoleLog, ContextualLog } from '../Shared/ConsoleLog.js';
import { GetServerState, ServerState } from '../Server/ServerState.js';
import BulkAddTest from './TestClasses/BulkAddTest.js';
import BulkDeleteTest from './TestClasses/BulkDeleteTest.js';
import ChapterTest from './TestClasses/ChapterTest.js';
import ClientTests from './TestClasses/ClientTests.js';
import DateUtilTest from './TestClasses/DateUtilTest.js';
import DeleteAllTest from './TestClasses/DeleteAllTest.js';
import ImportExportTest from './TestClasses/ImportExportTest.js';
import QueryTest from './TestClasses/QueryTest.js';
import ShiftTest from './TestClasses/ShiftTest.js';


/**
 * This is a workaround for the global log level, since for tests
 * we want to suppress verbose/warning messages from the "real" log,
 * but give more information in tests. The real solution would be to
 * allow individual log level overrides.
 */
class CustomLogLevelLog extends ContextualLog {
    #logLevel;

    constructor(prefix) {
        super(prefix);
        this.#logLevel = ConsoleLog.Level.Verbose;
    }

    setLevelOverride(level) { this.#logLevel = level; }
    tmi(obj, description, freeze) { this.#log(obj, description, freeze, super.tmi); }
    verbose(obj, description, freeze) { this.#log(obj, description, freeze, super.verbose); }
    info(obj, description, freeze) { this.#log(obj, description, freeze, super.info); }
    warn(obj, description, freeze) { this.#log(obj, description, freeze, super.warn); }
    error(obj, description, freeze) { this.#log(obj, description, freeze, super.error); }
    critical(obj, description, freeze) { this.#log(obj, description, freeze, super.critical); }
    formattedText(level, text, ...format) { this.#saveRestore(super.formattedText, level, text, ...format); }
    assert(condition, text) { this.#saveRestore(super.assert, condition, text); }

    #log(obj, description, freeze, fn) {
        this.#saveRestore(fn, obj, description, freeze);
    }

    #saveRestore(fn, ...args) {
        const lvlSav = this.getLevel();
        this.setLevel(this.#logLevel);
        fn.bind(this)(...args);
        this.setLevel(lvlSav);
    }
}

// Separate log for testing, since we want to suppress
// most server messages, but have more test details
const TestLog = new CustomLogLevelLog('TestRunner');
TestLog.setLevelOverride(ConsoleLog.Level.Verbose);
TestLog.setDarkConsole(1);

/**
 * Responsible for running all test classes, and smoothly shutting down the test server.
 */
class TestRunner {
    /** @type {{[className : string]: TestBase}} */
    static TestClasses = {
        BasicCRUD,
        MultipleMarkers,
        ImageTest,
        QueryTest,
        ShiftTest,
        BulkDeleteTest,
        BulkAddTest,
        DeleteAllTest,
        ClientTests,
        ImportExportTest,
        ChapterTest,
        DateUtilTest,
    };

    constructor() {
        this.#setTestLog();
    }

    /**
     * Run all available test classes. */
    async runAll() {
        TestLog.info(`Running all tests`);
        const totals = { success : 0, fail : 0 };
        for (const classDef of Object.values(TestRunner.TestClasses)) {
            const testClass = new classDef();
            const result = await testClass.runTests();
            totals.success += result.success;
            totals.fail += result.fail;
        }

        this.printResults(totals);
        return this.#shutdown();
    }

    /**
     * Run a specific test class or, if provided, a specific method of a specific class.
     * @param {string} className
     * @param {string?} testMethod */
    async runSpecific(className, testMethod) {
        TestLog.info(`Running ${className}${testMethod ? '::' + testMethod : ''}`);
        // Could do some manipulation to ignore casing, but require exact casing for now
        if (!TestRunner.TestClasses[className]) {
            throw new Error(`Test class ${className} not found. Make sure casing is correct.`);
        }

        const testClass = new TestRunner.TestClasses[className]();
        const result = await testClass.runTests(testMethod);
        this.printResults(result);
        return this.#shutdown();
    }

    /**
     * Print overall test run stats.
     * @param {{ success : number, fail : number}} totals */
    printResults(totals) {
        const logMethod = totals.fail > 0 ? TestLog.error : TestLog.info;
        logMethod.bind(TestLog)(`Ran ${totals.success + totals.fail} tests, ${totals.success} passed, ${totals.fail} failed.`);
    }

    /**
     * Shut down the test server if necessary. */
    #shutdown() {
        if (GetServerState() !== ServerState.ShuttingDown) {
            return fetch(
                `http://localhost:3233/shutdown`,
                {
                    method : 'POST',
                    headers : { accept : 'application/json' }
                }
            ).then(d => d.json()).then(_ => {
                TestLog.info('Finished running tests, cleaning up and exiting process.');
                TestBase.Cleanup();
            }).catch(err => {
                TestLog.error(err.message, `Trouble shutting down test server`);
            });
        }
    }

    /**
     * Sets the test log's log level, if provided in the command line. */
    #setTestLog() {
        const logInfoIndex = process.argv.indexOf('--test_log_level');
        if (logInfoIndex === -1 || process.argv.length <= logInfoIndex) {
            return;
        }

        TestLog.setFromString(process.argv[logInfoIndex + 1]);
    }
}

export { TestRunner, TestLog };
