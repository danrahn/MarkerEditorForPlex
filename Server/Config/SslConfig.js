import { existsSync, readFileSync } from 'fs';
import { createServer as createHttpsServer } from 'https';

import ConfigBase from './ConfigBase.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

/** @typedef {!import('./ConfigBase').ConfigBaseProtected} ConfigBaseProtected */
/** @typedef {!import('./ConfigBase').GetOrDefault} GetOrDefault */
/** @template T @typedef {!import('/Shared/ServerConfig').Setting<T>} Setting<T> */

/**
 * @typedef {{
*  enabled?: boolean,
*  sslHost?: string,
*  sslPort?: number,
*  certType?: 'pfx'|'pem',
*  pfxPath?: string,
*  pfxPassphrase?: string,
*  pemCert?: string,
*  pemKey?: string,
*  sslOnly?: boolean,
* }} RawSslConfig
*/

const Log = ContextualLog.Create('EditorConfig');

export default class SslConfig extends ConfigBase {
    /** @type {ConfigBaseProtected} */
    #Base = {};
    /** @type {Setting<boolean>} */
    enabled;

    /** @type {Setting<string>} */
    sslHost;
    /** @type {Setting<number>} */
    sslPort;

    /** @type {Setting<string>} */
    certType;

    /** @type {Setting<string>} */
    pfxPath;
    /** @type {Setting<string>} */
    pfxPassphrase;

    /** @type {Setting<string>} */
    pemCert;
    /** @type {Setting<string>} */
    pemKey;

    /** @type {Setting<boolean>} */
    sslOnly;

    constructor(json) {
        const baseClass = {};
        super(json, baseClass);
        this.#Base = baseClass;
        if (!json) {
            Log.warn('Authentication not found in config, setting defaults');
        }

        this.enabled = this.#getOrDefault('enabled', false);
        this.sslHost = this.#getOrDefault('sslHost', '0.0.0.0');
        this.sslPort = this.#getOrDefault('sslPort', 3233);
        this.certType = this.#getOrDefault('certType', 'pfx');
        this.pfxPath = this.#getOrDefault('pfxPath', '');
        this.pfxPassphrase = this.#getOrDefault('pfxPassphrase', '');
        this.pemCert = this.#getOrDefault('pemCert', '');
        this.pemKey = this.#getOrDefault('pemKey', '');
        this.sslOnly = this.#getOrDefault('sslOnly', false);

        if (!this.enabled.value()) {
            // Not enabled, we don't care if anything's invalid.
            return;
        }

        const pfxSet = this.pfxPath.value() && this.pfxPassphrase.value();
        const pemSet = this.pemCert.value() && this.pemKey.value();
        if (!pfxSet && !pemSet) {
            Log.warn('SSL enabled, but no valid PFX or PEM certificate. Disabling SSL');
            this.enabled.setValue(false);
            return;
        }

        const certType = this.certType.value();
        if (!certType) {
            // No cert type - prefer PFX, but if not set, try PEM
            this.certType.setValue(pfxSet ? 'pfx' : 'pem');
        } else if (certType.toLowerCase() === 'pfx' ? !pfxSet : !pemSet) {
            Log.warn(`SSL enabled with ${certType}, but cert/key not set. Disabling SSL`);
            this.enabled.setValue(false);
            return;
        }

        // Make sure we keep the lowercase version to make our lives easier
        this.certType.setValue(this.certType.value().toLowerCase());

        // Ensure files exist
        if (this.certType.value() === 'pfx') {
            if (!existsSync(this.pfxPath.value())) {
                Log.warn(`PFX file "${this.pfxPath.value()}" could not be found. Disabling SSL`);
                this.enabled.setValue(false);
                return;
            }
        } else if (!existsSync(this.pemCert.value()) || !existsSync(this.pemKey.value())) {
            Log.warn('PEM cert/key not found. Disabling SSL');
            this.enabled.setValue(false);
            return;
        }

        // Ensure cert/key are valid.
        try {
            createHttpsServer(this.sslKeys(), () => {}).close();
        } catch (err) {
            Log.warn(err.message, `SSL server creation failed`);
            Log.warn('Disabling SSL.');
            this.enabled.setValue(false);
        }
    }

    /**
     * Return the certificate options given the selected certificate type. */
    sslKeys() {
        const opts = {};
        if (this.certType.value().toLowerCase() === 'pfx') {
            opts.pfx = readFileSync(this.pfxPath.value());
            opts.passphrase = this.pfxPassphrase.value();
        } else {
            opts.cert = readFileSync(this.pemCert.value());
            opts.key = readFileSync(this.pemKey.value());
        }

        return opts;
    }

    /** Forwards to {@link ConfigBase}s `#getOrDefault`
     * @type {GetOrDefault} */
    #getOrDefault(key, defaultValue=null) {
        return this.#Base.getOrDefault(key, defaultValue);
    }
}
