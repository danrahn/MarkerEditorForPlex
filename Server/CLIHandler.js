import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { AssetRoot } from './Config/MarkerEditorConfig.js';
import { ContextualLog } from '../Shared/ConsoleLog.js';
import { isBinary } from './ServerHelpers.js';

/**
 * @typedef {Object} CLIArguments
 * @property {boolean} isTest Indicates this is a test run
 * @property {string?} configOverride The path to a config file to override the existing one
 * @property {boolean} version The user passed `-v`/`--version` to the command line
 * @property {boolean} help The user passed `-h`/`--help`/`--?` to the command line
 * @property {boolean} cliSetup The user wants to set up Marker Editor using the command line, not a browser.
 */

const Log = ContextualLog.Create('CLI');

/** Global flag indicating if the server is running tests. */
let IsTest = false;

/**
 * Returns whether the server is running in test mode.
 * @returns {boolean} */
export function isTestRun() { return IsTest; }

/**
 * Parse command line arguments.
 * @returns {CLIArguments} */
export function checkArgs() {
    /** @type {CLIArguments} */
    const argInfo = {
        isTest : false,
        configOverride : null,
        version : false,
        help : false,
        cliSetup : false,
    };

    const argsLower = process.argv.map(x => x.replace(/_/g, '-').toLowerCase());
    if (argsLower.includes('-v') || argsLower.includes('--version')) {
        argInfo.version = true;
    }

    if (argsLower.includes('-h')
        || argsLower.includes('/h')
        || argsLower.includes('--help')
        || argsLower.includes('-?')
        || argsLower.includes('/?')) {
        argInfo.help = true;
    }

    if (argsLower.includes('--cli-setup')) {
        argInfo.cliSetup = true;
    }

    if (argsLower.includes('--test')) {
        argInfo.isTest = true;
        IsTest = true;

        // Tests default to testConfig.json, but it can be overridden below
        argInfo.configOverride = 'testConfig.json';
    }

    const coi = argsLower.indexOf('--config-override');
    if (coi !== -1) {
        if (process.argv.length <= coi - 1) {
            Log.critical('Invalid config override file detected, aborting...');
            // We're very early into boot. Just get out of here.
            process.exit(1);
        }

        argInfo.configOverride = process.argv[coi + 1];
    }

    return argInfo;
}

/**
 * Process command line arguments, spits out info if needed, and returns
 * whether we should exit the program early.
 * @param {CLIArguments} args
 * @returns {boolean} */
export function shouldExitEarly(args) {
    if (args.version || args.help) {
        const packagePath = join(AssetRoot(), 'package.json');

        let version;
        if (existsSync(packagePath)) {
            try {
                version = JSON.parse(readFileSync(packagePath).toString()).version;
            } catch (_err) {
                // Error will be output below.
            }
        }

        if (version) {
            console.log(`Marker Editor version ${version}`);
        } else {
            console.log('Error retrieving version info.');
        }

        if (args.version) {
            return true;
        }
    }

    if (args.help) {
        const isWin = process.platform === 'win32';
        const invoke = (isBinary() ? (isWin ? '.\\MarkerEditor.exe' : './MarkerEditor') : 'node app.js');
        console.log(`Usage: ${invoke} [options]`);
        console.log();
        console.log(`  OPTIONS`);
        console.log(`    -v | --version              Print out the current version of MarkerEditor.`);
        console.log(`    -h | --help                 Print out this help text.`);
        console.log(`    --cli-setup                 Set up Marker Editor using the command line instead of a browser.`);
        console.log(`    --config-override [config]  Use the given config file instead of the standard config.json`);
        console.log(`    --test                      Indicates we're launching MarkerEditor for tests. Do not set manually.`);
        console.log('\n    For setup and usage instructions, visit https://github.com/danrahn/MarkerEditorForPlex/wiki.');
        return true;
    }

    return false;
}
