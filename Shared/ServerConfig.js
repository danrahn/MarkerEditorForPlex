
/**
 * @template Type
 * @typedef {Object} TypedSetting
 * @property {Type} value The set value
 * @property {Type} defaultValue The default value when not explicitly set
 * @property {boolean} isValid
 * @property {string?} invalidMessage If `isInvalid` is true, this may contain a descriptive error message.
 * @property {boolean} [unchanged] Whether this setting is unchanged from the currently loaded value. Not always present
 */

/**
 * @typedef {Object} PathMapping
 * @property {string} from Map from this path
 * @property {string} to Map to this path
 */

/*
isDefault means value is the default value
*/

/**
 * @typedef {Object} ConfigFeatures
 * @property {TypedSetting<boolean>} autoOpen
 * @property {TypedSetting<boolean>} extendedMarkerStats
 * @property {TypedSetting<boolean>} previewThumbnails
 * @property {TypedSetting<boolean>} preciseThumbnails
 */

/**
 * @typedef {Object} SerializedConfig
 * @property {TypedSetting<string>} dataPath
 * @property {TypedSetting<string>} database
 * @property {TypedSetting<string>} host
 * @property {TypedSetting<number>} port
 * @property {TypedSetting<string>} logLevel
 * @property {ConfigFeatures} features
 * @property {TypedSetting<PathMapping[]>} pathMappings
 * @property {TypedSetting<string>} version
 * @property {number} state
 */

/**
 * @template T
 */
export class Setting {
    /** @type {T?} */
    #value;
    /** @type {T?} */
    #defaultValue;
    /** @type {boolean} */
    #isValid;
    /** @type {string} */
    #invalidMessage;
    /** @type {boolean} */
    #unchanged = true;

    /**
     * @param {T?} value
     * @param {T?} defaultValue */
    constructor(value, defaultValue) {
        this.#value = value;
        this.#defaultValue = defaultValue;
        this.#isValid = true;
    }

    /**
     * @param {TypedSetting<T>} other */
    setFromSerialized(other) {
        this.#value = other.value;
        this.#defaultValue = other.defaultValue;
        this.#isValid = other.isValid;
        return this;
    }

    /**
     * @param {T} value */
    setValue(value) { this.#value = value; }

    /**
     * Retrieve this setting's current value. If no explicit value has been set, returns the default value. */
    value() {
        if (this.#value === null || this.#value === undefined) {
            return this.#defaultValue;
        }

        return this.#value;
    }

    /**
     * Return whether this setting is valid. */
    valid() { return this.#isValid; }

    /**
     * Set whether this setting is valid.
     * @param {boolean} valid
     * @param {string?} invalidMessage If invalid, the message to confer to the client. */
    setValid(valid, invalidMessage) {
        this.#isValid = valid;
        this.#invalidMessage = valid ? undefined : invalidMessage;
    }

    /**
     * Set whether this setting is unchanged from the currently loaded server setting.
     * @param {boolean} unchanged */
    setUnchanged(unchanged) { this.#unchanged = unchanged; }

    /**
     * Return whether this setting is identical to the currently loaded server setting. */
    isUnchanged() { return this.#unchanged; }

    /**
     * Return an object representation of this setting.
     * @returns {TypedSetting<T>} */
    serialize(includeUnchanged) {
        const extra = includeUnchanged ? { unchanged : this.#unchanged } : {};
        return {
            value : this.#value,
            defaultValue : this.#defaultValue,
            isValid : this.#isValid,
            invalidMessage : this.#invalidMessage,
            ...extra
        };
    }
}

/**
 * Available server settings.
 * @enum {String} */
export const ServerSettings = {
    /** @readonly The path to the Plex data directory. */
    DataPath : 'dataPath',
    /** @readonly The path to the Plex database file. */
    Database : 'database',
    /** @readonly The host to listen on. */
    Host : 'host',
    /** @readonly The port to listen on. */
    Port : 'port',
    /** @readonly The server-side logging level. */
    LogLevel : 'logLevel',
    /** @readonly Whether to auto-open a browser window on launch. */
    AutoOpen : 'autoOpen',
    /** @readonly Whether to display extended marker statistics. */
    ExtendedStats : 'extendedMarkerStats',
    /** @readonly Whether to retrieve preview thumbnails. */
    PreviewThumbnails : 'previewThumbnails',
    /** @readonly Whether to use FFmpeg to generate thumbnails. If false, uses Plex-generated preview thumbnails. */
    FFmpegThumbnails : 'preciseThumbnails',
    /** @readonly List of mappings from paths in the Plex database to paths relative to the current system. */
    PathMappings : 'pathMappings',

    /** @readonly The name of the encompassing "features" object of the configuration file. */
    Features : 'features',
    /** @readonly Not a real setting, but used to validate the host and port together. */
    HostPort : 'hostPort',
};

/**
 * Return an array of all standalone settings (i.e. not including special cases like Features and HostPort). */
export function allServerSettings() {
    return [
        ServerSettings.DataPath,
        ServerSettings.Database,
        ServerSettings.Host,
        ServerSettings.Port,
        ServerSettings.LogLevel,
        ServerSettings.AutoOpen,
        ServerSettings.ExtendedStats,
        ServerSettings.PreviewThumbnails,
        ServerSettings.FFmpegThumbnails,
        ServerSettings.PathMappings,
    ];
}

const FeatureSettings = [
    ServerSettings.AutoOpen,
    ServerSettings.ExtendedStats,
    ServerSettings.PreviewThumbnails,
    ServerSettings.FFmpegThumbnails];

/**
 * Return whether the given setting is part of the 'Features' object.
 * @param {string} setting */
export function isFeatureSetting(setting) {
    return FeatureSettings.includes(setting);
}

/**
 * Current state of the config file
 * @enum */
export const ServerConfigState = {
    /** @readonly Default case - everything is good */
    Valid : 0,
    /** @readonly Config file exists, but has invalid values. */
    Invalid : 1,
    /** @readonly There is no configuration file. */
    DoesNotExist : 2,
    /** @readonly The config has been updated and the server needs to restart. */
    ReloadNeeded : 3,
    /** @readonly The config has been updated and the server needs to restart. */
    FullReloadNeeded : 4,
};
