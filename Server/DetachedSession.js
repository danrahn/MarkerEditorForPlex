import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { isTestRun } from './CLIHandler.js';
import { ProjectRoot } from './Config/MarkerEditorConfig.js';
import ServerError from './ServerError.js';

/**@typedef {!import('./MarkerBackupManager').MarkerAction} MarkerAction */

const Log = ContextualLog.Create('DetachedSession');

/**
 * @typedef {{
 *  mode: 'live'|'detached',
 *  liveDatabasePath: string|null,
 *  forkDatabasePath: string|null,
 *  actionCheckpoint: number,
 *  startedAt: number,
 *  staleForks: string[],
 *  recoveryCheckpointStart: number,
 *  recoveryCheckpointEnd: number,
 *  recoveryPending: boolean
 * }} DetachedSessionState
 *
 * @typedef {{
 *  markerId: number,
 *  sectionId: number,
 *  sectionUuid: string,
 *  baselineAction: MarkerAction|null,
 *  latestAction: MarkerAction|null,
 *  actions: MarkerAction[],
 * }} PendingActionSnapshot
 */

/** @type {DetachedSessionManager} */
let Instance;

/**
 * Singleton manager for the detached mode session state. Persisted to a JSON file under Backup/. */
class DetachedSessionManager {
    static #defaultState() {
        return {
            mode : 'live',
            liveDatabasePath : null,
            forkDatabasePath : null,
            actionCheckpoint : 0,
            startedAt : 0,
            staleForks : [],
            recoveryCheckpointStart : 0,
            recoveryCheckpointEnd : 0,
            recoveryPending : false,
        };
    }

    /** @type {DetachedSessionState} */
    #state = DetachedSessionManager.#defaultState();

    /** Root directory for the backup data (Test/Backup or Backup, depending on environment). */
    #backupRoot;

    /** Directory where fork databases are created. */
    #detachedRoot;

    /** Path to the persisted session state file. */
    #sessionFile;

    /**
     * Create (or recreate) the singleton, reading persisted state from disk. Safe to call on
     * every server boot, including after suspend/resume - disk state is re-read each time so
     * recovery triggers (e.g. fork file deleted while suspended) are picked up.
     * @param {string} dataRoot */
    static CreateInstance(dataRoot) {
        Instance = new DetachedSessionManager(dataRoot);
        Instance.#load();
        return Instance;
    }

    static Close() { Instance = null; }

    /**
     * @param {string} dataRoot */
    constructor(dataRoot) {
        const root = dataRoot || (process.env.IS_DOCKER ? '/Data' : ProjectRoot());
        this.#backupRoot = join(isTestRun() ? join(root, 'Test') : root, 'Backup');
        this.#detachedRoot = join(this.#backupRoot, 'Detached');
        this.#sessionFile = join(this.#backupRoot, 'detachedSession.json');
    }

    /**
     * Load persisted state from disk and clean up any stale forks left from prior sessions. */
    #load() {
        this.#state = this.#readFromDisk();
        // If reading triggered recovery, persist that immediately so the next boot sees the recovered state.
        if (this.#state.staleForks.length > 0 || this.#state.recoveryPending) {
            this.#writeToDisk();
        }

        this.cleanupStaleForks();
    }

    /**
     * Resolve the upper bound of a pending recovery window once the backup manager is available.
     * @param {number} latestActionId */
    finalizeRecovery(latestActionId) {
        if (!this.#state.recoveryPending) {
            return;
        }

        const end = Number.isInteger(latestActionId) && latestActionId >= 0 ? latestActionId : 0;
        this.#state.recoveryCheckpointEnd = Math.max(this.#state.recoveryCheckpointStart, end);
        this.#state.recoveryPending = false;
        this.#writeToDisk();
    }

    active() { return this.#state.mode === 'detached'; }
    runtimeDatabasePath() { return this.active() ? this.#state.forkDatabasePath : null; }
    actionCheckpoint() { return this.active() ? this.#state.actionCheckpoint : 0; }
    liveDatabasePath() { return this.active() ? this.#state.liveDatabasePath : null; }
    forkDatabasePath() { return this.active() ? this.#state.forkDatabasePath : null; }

    /**
     * Recovery window covering actions taken during a previous detached session that was abandoned,
     * or null if no recovery is in progress.
     * @returns {{start: number, end: number}|null} */
    recoveryWindow() {
        const { recoveryCheckpointStart, recoveryCheckpointEnd } = this.#state;
        if (recoveryCheckpointEnd <= recoveryCheckpointStart) {
            return null;
        }

        return { start : recoveryCheckpointStart, end : recoveryCheckpointEnd };
    }

    status() {
        const { recoveryCheckpointStart, recoveryCheckpointEnd } = this.#state;
        const incompleteActionIds = Math.max(0, recoveryCheckpointEnd - recoveryCheckpointStart);
        return {
            active : this.active(),
            mode : this.#state.mode,
            startedAt : this.#state.startedAt || null,
            actionCheckpoint : this.#state.actionCheckpoint,
            liveDatabasePath : this.#state.liveDatabasePath,
            forkDatabasePath : this.#state.forkDatabasePath,
            staleForks : this.#state.staleForks.length,
            incompleteActionIds : incompleteActionIds,
        };
    }

    /**
     * Start detached mode and persist the resulting state.
     * @param {string} liveDatabasePath
     * @param {number} actionCheckpoint */
    start(liveDatabasePath, actionCheckpoint) {
        if (this.active()) {
            throw new ServerError('Detached mode is already active.', 409);
        }

        const checkpoint = Number.isInteger(actionCheckpoint) && actionCheckpoint >= 0 ? actionCheckpoint : 0;
        const forkDatabasePath = this.#createForkDatabase(liveDatabasePath);
        this.#state = {
            ...DetachedSessionManager.#defaultState(),
            mode : 'detached',
            liveDatabasePath : liveDatabasePath,
            forkDatabasePath : forkDatabasePath,
            actionCheckpoint : checkpoint,
            startedAt : Math.floor(Date.now() / 1000),
            staleForks : this.#state.staleForks,
        };

        this.#writeToDisk();
        return this.status();
    }

    /**
     * End detached mode and return to live mode. The fork database is marked for deferred cleanup. */
    finish() {
        if (!this.active()) {
            return this.status();
        }

        const oldFork = this.#state.forkDatabasePath;
        this.#state = {
            ...DetachedSessionManager.#defaultState(),
            staleForks : [...this.#state.staleForks, ...(oldFork ? [oldFork] : [])],
        };

        this.#writeToDisk();
        return this.status();
    }

    /**
     * Attempt to clean up stale fork databases from prior completed sessions.
     * Forks that cannot be removed (e.g. temporarily locked files) are retained.
     * @returns {number} Number of forks successfully removed. */
    cleanupStaleForks() {
        if (this.#state.staleForks.length === 0) {
            return 0;
        }

        const remaining = [];
        let removedCount = 0;
        for (const staleFork of this.#state.staleForks) {
            if (this.#tryRemoveForkFiles(staleFork)) {
                ++removedCount;
            } else {
                remaining.push(staleFork);
            }
        }

        if (remaining.length !== this.#state.staleForks.length) {
            this.#state.staleForks = remaining;
            this.#writeToDisk();
        }

        return removedCount;
    }

    /**
     * @param {string} forkPath
     * @returns {boolean} True if every companion file was removed (or already absent). */
    #tryRemoveForkFiles(forkPath) {
        for (const path of [forkPath, `${forkPath}-wal`, `${forkPath}-shm`]) {
            if (!existsSync(path)) {
                continue;
            }

            try {
                rmSync(path, { force : true });
            } catch (_err) {
                return false;
            }
        }

        return true;
    }

    /**
     * Generate a unique filename for a fork database based on the current timestamp and process id. */
    #newForkFilename() {
        const now = new Date();
        const padN = (value, size=2) => value.toString().padStart(size, '0');
        return `fork-${now.getFullYear()}.${padN(now.getMonth() + 1)}.${padN(now.getDate())}-` +
            `${padN(now.getHours())}.${padN(now.getMinutes())}.${padN(now.getSeconds())}` +
            `.${padN(now.getMilliseconds(), 3)}-${process.pid}.db`;
    }

    /**
     * @param {string} liveDatabasePath
     * @returns {string} */
    #createForkDatabase(liveDatabasePath) {
        const liveStats = statSync(liveDatabasePath, { throwIfNoEntry : false });
        if (!liveStats || !liveStats.isFile()) {
            throw new ServerError(`Cannot start detached mode: live Plex database path is invalid (${liveDatabasePath})`, 400);
        }

        mkdirSync(this.#detachedRoot, { recursive : true });
        const forkDatabasePath = join(this.#detachedRoot, this.#newForkFilename());
        copyFileSync(liveDatabasePath, forkDatabasePath);

        for (const suffix of ['-wal', '-shm']) {
            const source = `${liveDatabasePath}${suffix}`;
            if (existsSync(source)) {
                copyFileSync(source, `${forkDatabasePath}${suffix}`);
            }
        }

        return forkDatabasePath;
    }

    /**
     * @returns {DetachedSessionState} */
    #readFromDisk() {
        if (!existsSync(this.#sessionFile)) {
            return DetachedSessionManager.#defaultState();
        }

        let raw;
        try {
            raw = JSON.parse(readFileSync(this.#sessionFile, { encoding : 'utf-8' }));
        } catch (err) {
            Log.warn(`Failed to parse detached session file: ${err?.message ?? err}`);
            return DetachedSessionManager.#defaultState();
        }

        return this.#normalize(raw);
    }

    /**
     * Coerce a parsed JSON object into a valid DetachedSessionState, recovering when state is detached
     * but its fork database is missing.
     * @param {any} raw
     * @returns {DetachedSessionState} */
    #normalize(raw) {
        if (!raw || typeof raw !== 'object') {
            return DetachedSessionManager.#defaultState();
        }

        const state = {
            ...DetachedSessionManager.#defaultState(),
            ...raw,
            mode : raw.mode === 'detached' ? 'detached' : 'live',
            liveDatabasePath : typeof raw.liveDatabasePath === 'string' && raw.liveDatabasePath ? raw.liveDatabasePath : null,
            forkDatabasePath : typeof raw.forkDatabasePath === 'string' && raw.forkDatabasePath ? raw.forkDatabasePath : null,
            actionCheckpoint : +raw.actionCheckpoint || 0,
            startedAt : +raw.startedAt || 0,
            recoveryCheckpointStart : +raw.recoveryCheckpointStart || 0,
            recoveryCheckpointEnd : +raw.recoveryCheckpointEnd || 0,
            staleForks : Array.isArray(raw.staleForks) ? raw.staleForks : [],
            recoveryPending : !!raw.recoveryPending,
        };

        // If we think we should be in detached mode but don't have the data required to recover, reset to live mode.
        if (state.mode === 'detached') {
            if (!state.liveDatabasePath || !state.forkDatabasePath) {
                return this.#recoverIncomplete(state, 'Detached session state is missing database paths, resetting to live mode.');
            }

            if (!existsSync(state.forkDatabasePath)) {
                return this.#recoverIncomplete(state, 'Detached session fork database was not found, resetting to live mode.');
            }
        }

        return state;
    }

    /**
     * Build a recovered live-mode state from an abandoned detached session. The upper bound of the
     * recovery window is filled in by finalizeRecovery() once the backup manager exists.
     * @param {DetachedSessionState} state
     * @param {string} reason
     * @returns {DetachedSessionState} */
    #recoverIncomplete(state, reason) {
        Log.warn(reason);
        const recoveryStart = Math.max(state.recoveryCheckpointStart, state.actionCheckpoint);
        return {
            ...DetachedSessionManager.#defaultState(),
            staleForks : [...state.staleForks, ...(state.forkDatabasePath ? [state.forkDatabasePath] : [])],
            recoveryCheckpointStart : recoveryStart,
            recoveryCheckpointEnd : recoveryStart,
            recoveryPending : true,
        };
    }

    /** Atomically persist the current state to disk. */
    #writeToDisk() {
        mkdirSync(this.#backupRoot, { recursive : true });
        const tempPath = `${this.#sessionFile}.tmp`;
        writeFileSync(tempPath, JSON.stringify(this.#state, null, 2), { encoding : 'utf-8' });
        renameSync(tempPath, this.#sessionFile);
    }
}

export { DetachedSessionManager, Instance as DetachedSession };
