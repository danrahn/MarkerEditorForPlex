
/**
 * @template Type
 * @typedef {Object} TypedSetting
 * @property {Type} value The set value
 * @property {Type} defaultValue The default value when not explicitly set
 * @property {boolean} isValid
 * @property {string?} invalidMessage If `isInvalid` is true, this may contain a descriptive error message.
 * @property {boolean} [unchanged] Whether this setting is unchanged from the currently loaded value. Not always present
 * @property {boolean} [isDisabled] Whether this setting is disabled. Not always present
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
 * @typedef {Object} SslSettings
 * @property {TypedSetting<boolean>} enabled Whether to enable the HTTPS server
 * @property {TypedSetting<string>} sslHost The address to listen on.
 * @property {TypedSetting<number>} sslPort The port to host the HTTPS server on.
 * @property {TypedSetting<'pfx'|'pem'>} certType The type of certificate to use ("pfx" or "pem")
 * @property {TypedSetting<string>} pfxPath Path to a PFX file
 * @property {TypedSetting<string>} pfxPassphrase Passphrase for the given PFX  file
 * @property {TypedSetting<string>} pemCert Path to a PEM cert file
 * @property {TypedSetting<string>} pemKey Path to a PEM private key file
 * @property {TypedSetting<boolean>} sslOnly Only enable the HTTPS server
 */

/**
 * @typedef {Object} AuthenticationSettings
 * @property {TypedSetting<boolean>} enabled
 * @property {TypedSetting<number>} sessionTimeout
 * @property {TypedSetting<boolean|string|number>} trustProxy
 */

/**
 * @typedef {Object} ConfigFeatures
 * @property {TypedSetting<boolean>} autoOpen Whether to open a browser window on boot
 * @property {TypedSetting<boolean>} extendedMarkerStats
 * @property {TypedSetting<boolean>} previewThumbnails Whether to enable preview thumbnails
 * @property {TypedSetting<boolean>} preciseThumbnails Whether to use FFmpeg thumbnails over the ones Plex generates
 * @property {TypedSetting<boolean>} writeExtraData Whether to write extra_data to the Plex database
 */

/**
 * @typedef {Object} RawSerializedConfig
 * @property {TypedSetting<string>} dataPath
 * @property {TypedSetting<string>} database
 * @property {TypedSetting<string>} host
 * @property {TypedSetting<number>} port
 * @property {TypedSetting<string>} baseUrl
 * @property {TypedSetting<string>} logLevel
 * @property {SslSettings} ssl
 * @property {AuthenticationSettings} authentication
 * @property {ConfigFeatures} features
 * @property {TypedSetting<PathMapping[]>} pathMappings
 * @property {TypedSetting<string>} version
 * @property {number} state
 */

/**
 * @typedef {Object} SerializedConfig
 * @property {TypedSetting<string>} dataPath
 * @property {TypedSetting<string>} database
 * @property {TypedSetting<string>} host
 * @property {TypedSetting<number>} port
 * @property {TypedSetting<number>} port
 * @property {TypedSetting<string>} logLevel
 * @property {TypedSetting<boolean>} sslEnabled Whether to enable the HTTPS server
 * @property {TypedSetting<string>} sslHost The address to listen on.
 * @property {TypedSetting<number>} sslPort The port to host the HTTPS server on.
 * @property {TypedSetting<'pfx'|'pem'>} certType The type of certificate to use ("pfx" or "pem")
 * @property {TypedSetting<string>} pfxPath Path to a PFX file
 * @property {TypedSetting<string>} pfxPassphrase Passphrase for the given PFX  file
 * @property {TypedSetting<string>} pemCert Path to a PEM cert file
 * @property {TypedSetting<string>} pemKey Path to a PEM private key file
 * @property {TypedSetting<boolean>} sslOnly Only enable the HTTPS server
 * @property {TypedSetting<boolean>} authEnabled
 * @property {TypedSetting<number>} authSessionTimeout
 * @property {TypedSetting<boolean|string|number>} trustProxy
 * @property {TypedSetting<boolean>} autoOpen Whether to open a browser window on boot
 * @property {TypedSetting<boolean>} extendedMarkerStats
 * @property {TypedSetting<boolean>} previewThumbnails Whether to enable preview thumbnails
 * @property {TypedSetting<boolean>} preciseThumbnails Whether to use FFmpeg thumbnails over the ones Plex generates
 * @property {TypedSetting<boolean>} writeExtraData Whether to write extra_data to the Plex database
 * @property {TypedSetting<boolean>} autoSuspend Whether to automatically suspend the connection to the Plex database due to user inactivity
 * @property {TypedSetting<number>} autoSuspendTimeout The time to wait before automatically suspending the connection to the database.
 * @property {TypedSetting<PathMapping[]>} pathMappings
 * @property {TypedSetting<string>} version
 * @property {TypedSetting<string>?} authUsername The username, if authentication is enabled.
 * @property {TypedSetting<string>?} authPassword The user password. Used to authenticate requests to disable authentication.
 * @property {number} state
 * @property {boolean} isDocker
 */

/** setTimeout's max value is 2^31 - 1, but that's in milliseconds. So the max integer timeout is that value divided by 1000. */
export const MaxAutoSuspendTimeout = 2_147_483;

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
    /** @type {boolean} */
    #isDisabled = false; // Reuses #invalidMessage

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
        this.#isDisabled = other.isDisabled;
        return this;
    }

    /**
     * @param {T} value */
    setValue(value) { this.#value = value; return this; }

    /**
     * Retrieve this setting's current value. If no explicit value has been set, returns the default value. */
    value() { return this.isDefault() ? this.#defaultValue : this.#value; }

    /**
     * Return whether this setting is valid. */
    valid() { return this.#isValid; }

    /** Return the invalid message, if any. */
    message() { return this.#invalidMessage; }

    /**
     * Set whether this setting is valid.
     * @param {boolean} valid
     * @param {string?} invalidMessage If invalid, the message to confer to the client. */
    setValid(valid, invalidMessage) {
        this.#isValid = valid;
        this.#invalidMessage = valid ? undefined : invalidMessage;
        return this;
    }

    /** Mark a setting disabled (can't be enabled even if the user wants it). */
    setDisabled(disabled, disabledMessage) {
        this.#isDisabled = disabled;
        if (disabled) {
            // Disabled overrides invalid. Though in theory we shouldn't
            // ever have a disabled setting that's in an invalid state.
            this.#invalidMessage = disabledMessage;
        }

        return this;
    }

    /**
     * Set whether this setting is unchanged from the currently loaded server setting.
     * @param {boolean} unchanged */
    setUnchanged(unchanged) { this.#unchanged = unchanged; return this; }

    /**
     * Return whether this setting is identical to the currently loaded server setting. */
    isUnchanged() { return this.#unchanged; }

    /**
     * Return whether this value is explicitly set or using the default. */
    isDefault() { return this.#value === null || this.#value === undefined; }

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
            isDisabled : this.#isDisabled,
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
    /** @readonly The base URL for this application. Useful for reverse proxies. */
    BaseUrl : 'baseUrl',
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
    /** @readonly Whether to write extra_data to the Plex database */
    WriteExtraData : 'writeExtraData',
    /** @readonly Whether to automatically suspend the connection to the Plex database due to user inactivity. */
    AutoSuspend : 'autoSuspend',
    /** @readonly The time (in seconds) to wait before automatically suspending the connection to the database. */
    AutoSuspendTimeout : 'autoSuspendTimeout',
    /** @readonly Whether to enable simple single-user authentication. */
    UseAuthentication : 'authEnabled',
    /** @readonly Authentication username. This is a pseudo setting, as it's stored in auth.db, not config.json. */
    Username : 'authUsername',
    /** @readonly Authentication password. This is a pseudo setting, as it's stored in auth.db, not config.json. */
    Password : 'authPassword',
    /** @readonly How long in seconds a session will live without user interaction. */
    SessionTimeout : 'authSessionTimeout',
    /** @readonly The 'trust proxy' settings to use for Express (https://expressjs.com/en/guide/behind-proxies.html). */
    TrustProxy : 'trustProxy',
    /** @readonly List of mappings from paths in the Plex database to paths relative to the current system. */
    PathMappings : 'pathMappings',
    /** @readonly Whether to enable SSL (HTTPS) */
    UseSsl : 'sslEnabled',
    /** @readonly The address the HTTPS server should listen on. */
    SslHost : 'sslHost',
    /** @readonly The port to use for the HTTPS server. */
    SslPort : 'sslPort',
    /** @readonly The type of certificate to use ("pfx" or "pem"). */
    CertType : 'certType',
    /** @readonly Path to a PFX certificate file. */
    PfxPath : 'pfxPath',
    /** @readonly Password for the PFX certificate. */
    PfxPassphrase : 'pfxPassphrase',
    /** @readonly Path to a PEM certificate file. */
    PemCert : 'pemCert',
    /** @readonly Path to a PEM private key file. */
    PemKey : 'pemKey',
    /** @readonly Don't launch the HTTP server, only HTTPS */
    SslOnly : 'sslOnly',

    /** @readonly The name of the encompassing "features" object of the configuration file. */
    Features : 'features',
    /** @readonly Not a real setting, but used to validate the host and port together. */
    HostPort : 'hostPort',
    /** @readonly Used to validate a PFX certificate and its associated passphrase. */
    Pfx : 'pfx',
    /** @readonly Used to validate a PEM certificate and private key. */
    Pem : 'pem',
};

/**
 * Return an array of all standalone settings (i.e. not including special cases like Features and HostPort). */
export function allServerSettings() {
    return [
        ServerSettings.DataPath,
        ServerSettings.Database,
        ServerSettings.Host,
        ServerSettings.Port,
        ServerSettings.BaseUrl,
        ServerSettings.LogLevel,
        ServerSettings.UseSsl,
        ServerSettings.SslHost,
        ServerSettings.SslPort,
        ServerSettings.CertType,
        ServerSettings.PfxPath,
        ServerSettings.PfxPassphrase,
        ServerSettings.PemCert,
        ServerSettings.PemKey,
        ServerSettings.SslOnly,
        ServerSettings.UseAuthentication,
        ServerSettings.Username,
        ServerSettings.SessionTimeout,
        ServerSettings.TrustProxy,
        ServerSettings.AutoOpen,
        ServerSettings.ExtendedStats,
        ServerSettings.PreviewThumbnails,
        ServerSettings.FFmpegThumbnails,
        ServerSettings.WriteExtraData,
        ServerSettings.AutoSuspend,
        ServerSettings.AutoSuspendTimeout,
        ServerSettings.PathMappings,
    ];
}

/**
 * Return whether the given setting is part of the SSL settings group.
 * @param {string} setting */
export function isSslSetting(setting) {
    switch (setting) {
        default:
            return false;
        case ServerSettings.UseSsl:
        case ServerSettings.SslHost:
        case ServerSettings.SslPort:
        case ServerSettings.CertType:
        case ServerSettings.PfxPath:
        case ServerSettings.PfxPassphrase:
        case ServerSettings.PemCert:
        case ServerSettings.PemKey:
        case ServerSettings.SslOnly:
            return true;
    }
}

/**
 * Return whether the given setting is part of the Authentication settings group.
 * @param {string} setting */
export function isAuthSetting(setting) {
    switch (setting) {
        default:
            return false;
        case ServerSettings.UseAuthentication:
        case ServerSettings.Username:
        case ServerSettings.Password:
        case ServerSettings.SessionTimeout:
        case ServerSettings.TrustProxy:
            return true;
    }
}

/**
 * Return whether the given setting is part of the Features settings group.
 * @param {string} setting */
export function isFeaturesSetting(setting) {
    switch (setting) {
        default:
            return false;
        case ServerSettings.AutoOpen:
        case ServerSettings.ExtendedStats:
        case ServerSettings.PreviewThumbnails:
        case ServerSettings.FFmpegThumbnails:
        case ServerSettings.WriteExtraData:
        case ServerSettings.AutoSuspend:
        case ServerSettings.AutoSuspendTimeout:
            return true;
    }
}

/**
 * SSL state */
export const SslState = {
    /** @readonly SSL is not enabled */
    Disabled : 0,
    /** @readonly SSL is enabled */
    Enabled : 1,
    /** @readonly SSL is forced (no HTTP) */
    Forced : 2
};

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
