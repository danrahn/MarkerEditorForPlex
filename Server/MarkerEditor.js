/** External dependencies */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** @typedef {!import('./CLIHandler.js').CLIArguments} CLIArguments */

/** Server+Client shared dependencies */
import { ContextualLog } from '../Shared/ConsoleLog.js';

/** Server dependencies */
import { BackupManager, MarkerBackupManager } from './MarkerBackupManager.js';
import { checkArgs, isTestRun, shouldExitEarly } from './CLIHandler.js';
import { cleanupForShutdown, handleClose, setRestartCallback } from './ServerLifecycle.js';
import { GetServerState, ServerState, SetServerState } from './ServerState.js';
import { MarkerEditorConfig, ProjectRoot } from './Config/MarkerEditorConfig.js';
import { AuthDatabase } from './Authentication/AuthDatabase.js';
import { launchServer } from './HttpServer.js';
import { MarkerCacheManager } from './MarkerCacheManager.js';
import { PlexQueryManager } from './PlexQueryManager.js';
import { registerPostCommands } from './PostCommands.js';
import { ServerConfigState } from '../Shared/ServerConfig.js';
import { ThumbnailManager } from './ThumbnailManager.js';
import { UserAuthentication } from './Authentication/Authentication.js';

import FirstRunConfig from './Config/FirstRunConfig.js';

const Log = ContextualLog.Create('Core');

/** Initializes and starts the server */
async function run() {
    bootstrap();
    const argInfo = checkArgs();
    if (shouldExitEarly(argInfo)) {
        process.exit(0);
    }

    // In docker, the location of the config and backup data files are not the project root.
    const dataRoot = process.env.IS_DOCKER ? '/Data' : ProjectRoot();

    // Initialize auth database before everything else, as it doesn't rely on Config, and
    // FirstRunConfig might need access to it.
    AuthDatabase.Initialize(dataRoot);
    UserAuthentication.Initialize();

    if (!argInfo.isTest) {
        await FirstRunConfig(dataRoot, argInfo.cliSetup);
    }

    // If we don't have a config file, still launch the server using some default values.
    const config = MarkerEditorConfig.Create(argInfo, dataRoot, GetServerState() === ServerState.Suspended);
    const configValid = config.getValid() === ServerConfigState.Valid;

    if (configValid) {
        // Set up the database, and make sure it's the right one.
        const queryManager = PlexQueryManager.CreateInstance(config.databasePath());

        // Some settings can only be validated once the database is up and running.
        config.validateDbSettings();

        MarkerBackupManager.CreateInstance(isTestRun() ? join(dataRoot, 'Test') : dataRoot);

        ThumbnailManager.Create(queryManager.database(), config.metadataPath());
        if (config.extendedMarkerStats()) {
            try {
                MarkerCacheManager.Create(queryManager.database(), queryManager.markerTagId());
                BackupManager.buildAllPurges();
            } catch (err) {
                Log.error(err.message, 'Failed to build marker cache');
                Log.error('Continuing to server creation, but extended marker statistics will not be available.');
                config.disableExtendedMarkerStats();
                MarkerCacheManager.Close();
            }
        }
    }

    Log.info('Creating server...');
    await launchServer();
    if (!configValid) {
        SetServerState(ServerState.RunningWithoutConfig);
    }
}

/**
 * Set up core processes of Marker Editor. */
function bootstrap() {
    // Only need to do this on first boot, not if we're restarting/resuming
    if (GetServerState() !== ServerState.FirstBoot) {
        return;
    }

    // Set the restart callback so ServerLifecycle can call run() without circular imports
    setRestartCallback(run);

    setupTerminateHandlers();
    registerPostCommands();
}

/** Set up process listeners that will shut down the process
 * when it encounters an unhandled exception or SIGINT. */
function setupTerminateHandlers() {
    Log.assert(GetServerState() === ServerState.FirstBoot, `We should only be calling setupTerminateHandlers on first boot!`);
    if (GetServerState() !== ServerState.FirstBoot) {
        return;
    }

    // If we encounter an unhandled exception, handle it somewhat gracefully and exit the process.
    process.on('uncaughtException', (err) => {
        Log.critical(err.message);
        const stack = err.stack ? err.stack : '(Could not find stack trace)';
        isTestRun() ? Log.error(stack) : Log.verbose(stack);
        Log.error('The server ran into an unexpected problem, exiting...');
        writeErrorToFile(err.message + '\n' + stack);
        cleanupForShutdown(true /*fullShutdown*/);
        process.exit(1);
    });

    // Capture Ctrl+C (and other interrupts) and cleanly exit the process
    const signalCallback = (sig) => {
        void handleClose(sig).catch(err => {
            Log.critical(`Failed to handle ${sig}: ${err.message}`);
        });
    };

    process.on('SIGINT', signalCallback);
    process.on('SIGQUIT', signalCallback);
    process.on('SIGTERM', signalCallback);

    // On Windows, Ctrl+Break immediately shuts down without cleanup
    process.on('SIGBREAK', () => {
        Log.warn('Ctrl+Break detected, shutting down immediately.');
        process.exit(1);
    });
}

/**
 * Attempts to write critical errors to a log file, which can be helpful for
 * debugging if the console window closes on process exit.
 * @param {string} message The message to log */
function writeErrorToFile(message) {
    try {
        const logDir = join(ProjectRoot(), 'Logs');
        if (!existsSync(logDir)) {
            mkdirSync(logDir);
        }

        const now = new Date();
        const padLeft = (str, pad=2) => String(str).padStart(pad, '0');
        const time = `${now.getFullYear()}.${padLeft(now.getMonth() + 1)}.${padLeft(now.getDate())}.` +
            `${padLeft(now.getHours())}.${padLeft(now.getMinutes())}.${padLeft(now.getSeconds())}.` +
            `${padLeft(now.getMilliseconds(), 3)}`;
        const filename = `MarkerEditor.${time}.err`;
        writeFileSync(join(logDir, filename), message);
        Log.verbose(`Wrote error file to ${join(logDir, filename)}`);
    } catch (ex) {
        Log.critical(ex.message, 'Unable to write error to log file');
    }
}

export { run };
