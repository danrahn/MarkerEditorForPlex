import { $, $$, appendChildren, buildNode, plural } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { animateOpacity } from './AnimationHelpers.js';
import ButtonCreator from './ButtonCreator.js';

/** @typedef {{[version: string]: { ignoreType : number, ignoreDate : number}}} UpdateCheckSettings */


const Log = new ContextualLog('VersionManager');

/**
 * Handles checking whether a new version of the app is available on GitHub
 */
class VersionManager {
    static async CheckForUpdates(currentVersionString) {
        new VersionManager(currentVersionString).checkForUpdates();
    }

    /** Key used to store version check/ignore settings. */
    static #localStorageKey = 'updateCheckSettings';

    /** @type {Version} The current version of this application. */
    #currentVersion;
    /** @type {Version} The latest version available. */
    #latestVersion;
    /** @type {HTMLElement} */
    #updateBar;

    /**
     * @param {string} currentVersionString The reported version of this app */
    constructor(currentVersionString) {
        this.#currentVersion = new Version(currentVersionString);
    }

    /**
     * Kick off the version check process */
    async checkForUpdates() {
        if (!this.#currentVersion.valid()) {
            Log.warn(`Invalid current version given, can't check for updates`);
            return;
        }

        if (!this.#shouldCheckForUpdates()) {
            Log.verbose(`User blocked update check, not checking`);
            return;
        }

        const releaseUrl = `https://api.github.com/repos/danrahn/MarkerEditorForPlex/releases`;
        const headers = { accept : `application/vnd.github+json` };
        try {
            /** @type {any[]} */
            const releases = await (await fetch(releaseUrl, { headers })).json();
            // Sure, just add on to the returned JSON with our custom object
            releases.forEach(release => release.version = new Version(release.tag_name));
            const releaseMap = {};
            releases.forEach(release => releaseMap[release.version.toString()] = release);

            // It looks like GitHub orders releases by date already, but be paranoid and order them ourselves.
            /** @type {Version[]} */
            const releasesOrdered = releases.map(r => r.version);
            releasesOrdered.sort(Version.CompareReverse); // Largest to smallest
            const newer = [];
            for (const release of releasesOrdered) {
                if (!release.valid()) {
                    Log.warn(release.toString(), `Found unexpected version string on GitHub, can't parse`);
                    continue;
                }

                if (this.#currentVersion.compareTo(release) < 0) {
                    newer.push(releaseMap[release.toString()]);
                } else {
                    // Already sorted, nothing new after this.
                    break;
                }
            }

            if (newer.length === 0) {
                Log.info(`Version ${this.#currentVersion.toString()} is up to date!`);
            } else {
                this.#latestVersion = newer[0];
                Log.info(newer.map(r => r.version.toString()).join(', '), `${newer.length} newer version(s) found`);
                this.#showUpdateBar(newer);
            }
        } catch (err) {
            // Don't show anything if we fail, it's not a strictly necessary task
            Log.warn(err.message, `Unable to parse release info from GitHub, can't check for updates`);
        }
    }

    /**
     * Show the 'update available' banner
     * @param {{version: Version}[]} newer */
    #showUpdateBar(newer) {
        const select = buildNode('select', { id : 'updateRemind', name : 'updateRemind' });
        for (const [option, value] of Object.entries(IgnoreOptions)) {
            const optionText = value < IgnoreOptions.Never ? `In 1 ${option}` : `${option} for this version`;
            select.appendChild(buildNode('option', { value }, optionText));
        }

        const newest = newer[0].version.toString();
        const current = this.#currentVersion.toString();
        this.#updateBar = appendChildren(buildNode('div', { id : 'updateBar', }),
            buildNode('span',
                { id : 'updateString' },
                `New version (${newest}) available, ${plural(newer.length, 'version')} ahead of ${current}`),
            ButtonCreator.textButton('Go to Release', this.#updateCallback.bind(this), { auxclick : true }),
            buildNode('br'),
            buildNode('label', { for : 'updateRemind', id : 'updateRemindLabel' }, 'Or, remind me: '),
            select,
            ButtonCreator.textButton('Ignore for Now', this.#ignoreCallback.bind(this)));
        const frame = $$('#plexFrame');
        frame.insertBefore(this.#updateBar, frame.children[0]);
    }

    /**
     * Determine whether we should check for updates based on previous user actions. */
    #shouldCheckForUpdates() {
        const versionSettings = this.#getIgnoreInfo();
        const versionInfo = versionSettings[this.#currentVersion.toString()];
        if (!versionInfo) {
            return true;
        }

        const ignoreDate = versionInfo.ignoreDate;
        const now = Date.now();
        const dateDiff = now - ignoreDate;
        let cutoff = 0;
        switch (versionInfo.ignoreType) {
            // Could just return the values below, but set it to a variable for logging.
            case IgnoreOptions.Hour:
                cutoff = IgnoreTimings.Hour;
                break;
            case IgnoreOptions.Day:
                cutoff = IgnoreTimings.Day;
                break;
            case IgnoreOptions.Week:
                cutoff = IgnoreTimings.Week;
                break;
            case IgnoreOptions.Never:
                cutoff = -1;
                break;
            default:
                cutoff = 0;
                break;
        }

        Log.verbose(`ShouldCheckForUpdates: Time since last check (ms): ${dateDiff}. Cutoff: ${cutoff}`);
        if (cutoff === -1) { return false; }

        if (cutoff === 0) { return true; }

        return dateDiff >= cutoff;
    }

    /**
     * Retrieve update check information from local storage.
     * @returns {UpdateCheckSettings} */
    #getIgnoreInfo() {
        try {
            return JSON.parse(localStorage.getItem(VersionManager.#localStorageKey)) || {};
        } catch (err) {
            return {};
        }
    }

    /**
     * Save new update check settings to local storage.
     * @param {UpdateCheckSettings} info */
    #setIgnoreInfo(info) {
        localStorage.setItem(VersionManager.#localStorageKey, JSON.stringify(info));
    }

    /**
     * Open the latest release URL when the user clicks 'go to release' */
    #updateCallback() {
        window.open(this.#latestVersion.html_url, '_blank', 'noreferrer');
        animateOpacity(this.#updateBar, 1, 0, 500, true /*deleteAfterTransition*/);
    }

    /**
     * Dismiss the update banner and store any user ignore settings. */
    #ignoreCallback() {
        const ignoreType = parseInt($('#updateRemind').value);
        const info = this.#getIgnoreInfo();
        info[this.#currentVersion.toString()] = { ignoreType : ignoreType, ignoreDate : Date.now() };
        this.#setIgnoreInfo(info);
        animateOpacity(this.#updateBar, 1, 0, 500, true /*deleteAfterTransition*/);
    }
}

/**
 * Possible ignore timeframes for the current version. */
const IgnoreOptions = {
    Hour  : 1,
    Day   : 2,
    Week  : 3,
    Never : 4,
};

/**
 * Maps hour/day/week to milliseconds */
const IgnoreTimings = {
    Hour  : 60 * 60 * 1000,
    Day   : 60 * 60 * 24 * 1000,
    Week  : 60 * 60 * 24 * 7 * 1000,
};

/**
 * Represents a semantic-ish version of Marker Editor
 */
class Version {
    /**
     * Parse a version number, a limited subset of semantic versioning that accepts:
     * * A leading 'v' (which is ignored)
     * * 0.0.0, where 0 is any number with 1 or more digits
     * * An optional postfix, starting with a dash (-), followed by:
     *     * `alpha`
     *     * `beta`
     *     * `rc.0`, where 0 is any number with 1 or more digits */
    static #versionRegex = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<type>alpha|beta|rc\.(?<rcVersion>\d+)))?/;

    /**
     * Compare two `Version`s, ordering from smallest to largest
     * @param {Version} versionA
     * @param {Version} versionB
     * @returns {number} Negative number if A is less than B, 0 if equal, positive of A is greater than B. */
    static Compare(versionA, versionB) {
        /* eslint-disable padding-line-between-statements */
        let diff = versionA.major - versionB.major;
        if (diff !== 0) { return diff; }
        diff = versionA.minor - versionB.minor;
        if (diff !== 0) { return diff; }
        diff = versionA.patch - versionB.patch;
        if (diff !== 0) { return diff; }
        diff = versionA.releaseTypeInfo.type - versionB.releaseTypeInfo.type;
        if (diff !== 0) { return diff; }
        if (versionA.releaseTypeInfo.type === PrereleaseType.ReleaseCandidate) {
            return versionA.releaseTypeInfo.rcVersion - versionB.releaseTypeInfo.rcVersion;
        }
        /* eslint-enable */

        return 0;
    }

    /**
     * Compare two `Version`s, ordering from largest to smallest
     * @param {Version} versionA
     * @param {Version} versionB
     * @returns {number} The opposite of `Compare` (b - a) */
    static CompareReverse(versionA, versionB) { return Version.Compare(versionB, versionA); }

    /** @type {string} Full version string */
    #str = '';
    /** @type {number} Major version number */
    major = -1;
    /** @type {number} Minor version number */
    minor = -1;
    /** @type {number} Patch version number */
    patch = -1;
    /** Prerelease version info, if any */
    releaseTypeInfo = {
        type : PrereleaseType.Released,
        rcVersion : -1,
    };

    /**
     * Constructs the version based on the given version string, if valid.
     * @param {string} versionString */
    constructor(versionString) {
        this.#str = versionString;
        const parts = Version.#versionRegex.exec(versionString);
        if (!parts) {
            return;
        }

        this.major = parseInt(parts.groups.major);
        this.minor = parseInt(parts.groups.minor);
        this.patch = parseInt(parts.groups.patch);
        if (parts.groups.type) {
            const partLower = parts.groups.type.toLowerCase();
            switch (partLower) {
                case 'alpha':
                    this.releaseTypeInfo.type = PrereleaseType.Alpha;
                    break;
                case 'beta':
                    this.releaseTypeInfo.type = PrereleaseType.Beta;
                    break;
                default:
                    Log.assert(
                        partLower.startsWith('rc') && parts.groups.rcVersion,
                        `Version: Expected rc with a valid rc number if not alpha or beta, found ${partLower}.`);

                    this.releaseTypeInfo.type = PrereleaseType.ReleaseCandidate;
                    this.releaseTypeInfo.rcVersion = parseInt(parts.groups.rcVersion);
                    break;
            }
        }
    }

    /** Return whether this Version represents a valid Marker Editor version. */
    valid() { return this.major !== -1; }
    /** Return the full version string. */
    toString() {
        // Strip leading 'v', if any
        return this.#str.substring(this.#str[0] === 'v' ? 1 : 0);
    }
    /** Compare this version to the given version
     * @param {Version} versionOther
     * @returns {number} Negative if this is smaller than `versionOther`, you can guess the rest */
    compareTo(versionOther) { return Version.Compare(this, versionOther); }
}

/**
 * Expected release types */
const PrereleaseType = {
    Alpha : 0,
    Beta : 1,
    ReleaseCandidate : 2,
    Released : 3,
};

export default VersionManager;
