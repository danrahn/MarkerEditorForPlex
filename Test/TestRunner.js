// External dependencies
import fetch from 'node-fetch';

// Test dependencies
import TestBase from './TestBase.js';
import BasicCRUD from './TestClasses/BasicCRUDTest.js';
import MultipleMarkers from './TestClasses/MultipleMarkersTest.js';

// Server/Shared dependencies
import { getState, ServerState } from '../Server/PlexIntroEditor.js';
import { ConsoleLog } from '../Shared/ConsoleLog.js';

// Separate log for testing, since we want to suppress
// most server messages, but have more test details
const TestLog = new ConsoleLog();
TestLog.setLevel(ConsoleLog.Level.Tmi);
TestLog.setDarkConsole(1);

/**
 * Responsible for running all test classes, and smoothly shutting down the test server.
 */
class TestRunner {
    /** @type {{[className : string]: TestBase}} */
    static TestClasses = {
        BasicCrud : BasicCRUD,
        MultipleMarkers : MultipleMarkers,
    };

    /**
     * Run all available test classes. */
    async runAll() {
        this.#setTestLog();
        try {
            let totals = { success : 0, fail : 0 };
            for (const classDef of Object.values(TestRunner.TestClasses)) {
                let testClass = new classDef();
                const result = await testClass.runTests();
                totals.success += result.success;
                totals.fail += result.fail;
            }

            const logMethod = totals.fail > 0 ? TestLog.error : TestLog.info;
            logMethod.bind(TestLog)(`Ran ${totals.success + totals.fail} tests, ${totals.success} passed, ${totals.fail} failed.`);

            return this.#shutdown();
        } catch (ex) {
            TestLog.error(`TestRunner::runAll - Encountered an exception - ${ex.message}`);
            return Promise.reject();
        }
    }

    /**
     * Shut down the test server if necessary. */
    async #shutdown() {
        if (getState() == ServerState.Running || getState() == ServerState.Suspended) {
            return fetch(`http://localhost:3233/shutdown`, { method : 'POST', headers : { accept : 'application/json' } }).then(d => d.json()).then(_ => {
                TestLog.info('Finished running tests, cleaning up and exiting process.');
                TestBase.Cleanup();
            }).catch(err => {
                TestLog.error(err.message, `Trouble shutting down test server`);
            });
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Sets the test log's log level, if provided in the command line. */
    #setTestLog() {
        const logInfoIndex = process.argv.indexOf('--test_log_level');
        if (logInfoIndex == -1 || process.argv.length <= logInfoIndex) {
            return;
        }

        TestLog.setFromString(process.argv[logInfoIndex + 1]);
    }
}

export { TestRunner, TestLog };
