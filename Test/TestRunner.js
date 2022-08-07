// External dependencies
import fetch from 'node-fetch';

// Test dependencies
import TestBase from './TestBase.js';
import BasicCRUD from './TestClasses/BasicCRUD.js';

// Server/Shared dependencies
import { getState, ServerState } from '../Server/PlexIntroEditor.js';
import { ConsoleLog, Log } from '../Shared/ConsoleLog.js';

/**
 * Responsible for running all test classes, and smoothly shutting down the test server.
 */
class TestRunner {
    /** @type {{[className : string]: TestBase}} */
    static TestClasses = {
        BasicCrud : BasicCRUD
    };

    /**
     * Run all available test classes. */
    async runAll() {
        try {
            for (const classDef of Object.values(TestRunner.TestClasses)) {
                let testClass = new classDef();
                await testClass.runTests();
            }
    
            return this.#shutdown();
        } catch (ex) {
            Log.error(`TestRunner::runAll - Encountered an exception - ${ex.message}`);
            return Promise.reject();
        }
    }

    /**
     * Shut down the test server if necessary. */
    async #shutdown() {
        if (getState() == ServerState.Running || getState() == ServerState.Suspended) {
            return fetch(`http://localhost:3233/shutdown`, { method : 'POST', headers : { accept : 'application/json' } }).then(d => d.json()).then(j => {
                Log.setLevel(ConsoleLog.Level.Info);
                Log.info('Finished running tests, cleaning up and exiting process.');
                TestBase.Cleanup();
            }).catch(err => {
                Log.error(err.message, `Trouble shutting down test server`);
            });
        } else {
            return Promise.resolve();
        }
    }
}

export default TestRunner;
