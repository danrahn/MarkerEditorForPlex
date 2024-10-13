import ConfigBase from './ConfigBase.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { testFfmpeg } from '../ServerHelpers.js';

/** @typedef {!import('./ConfigBase').ConfigBaseProtected} ConfigBaseProtected */
/** @typedef {!import('./ConfigBase').GetOrDefault} GetOrDefault */
/** @template T @typedef {!import('/Shared/ServerConfig').Setting<T>} Setting<T> */

/**
 * @typedef {{
 *  autoOpen?: boolean,
 *  extendedMarkerStats?: boolean,
 *  previewThumbnails?: boolean,
 *  preciseThumbnails?: boolean
 * }} RawConfigFeatures
 */

const Log = ContextualLog.Create('EditorConfig');

/**
 * Captures the 'features' portion of the configuration file.
 */
export default class PlexFeatures extends ConfigBase {
    /** Protected members of the base class.
     * @type {ConfigBaseProtected} */
    #Base = {};

    /**
     * Setting for opening the UI in the browser on launch
     * @type {Setting<boolean>} */
    autoOpen;

    /**
     * Setting for gathering all markers before launch to compile additional statistics.
     * @type {Setting<boolean>} */
    extendedMarkerStats;

    /** Setting for displaying timestamped preview thumbnails when editing or adding markers.
     * @type {Setting<boolean>} */
    previewThumbnails;

    /** Setting for displaying precise ffmpeg-based preview thumbnails opposed to the pre-generated Plex BIF files.
     * @type {Setting<boolean>} */
    preciseThumbnails;

    /** Sets the application features based on the given json.
     * @param {RawConfigFeatures} json */
    constructor(json) {
        const baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Features not found in config, setting defaults');
        }

        this.autoOpen = this.#getOrDefault('autoOpen', true);
        this.extendedMarkerStats = this.#getOrDefault('extendedMarkerStats', true);
        this.previewThumbnails = this.#getOrDefault('previewThumbnails', true);
        this.preciseThumbnails = this.#getOrDefault('preciseThumbnails', false);

        if (this.previewThumbnails.value() && this.preciseThumbnails.value()) {
            const canEnable = testFfmpeg();
            if (!canEnable) {
                this.preciseThumbnails.setValue(false);
                Log.warn(`Precise thumbnails enabled, but ffmpeg wasn't found in your path! Falling back to BIF`);
            }
        }
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault(key, defaultValue);
    }
}
