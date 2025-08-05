import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';
import { TestLog } from '../TestRunner.js';

import { ServerSettings, SslState } from '../../Shared/ServerConfig.js';
import { getDefaultPlexDataPath } from '../../Server/Config/ConfigHelpers.js';
import { PostCommands } from '../../Shared/PostCommands.js';
import { testHostPort } from '../../Server/ServerHelpers.js';

import { createServer } from 'http';
import { join } from 'path';

/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */
/** @template T @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T> */

export default class ConfigTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.validateEmptyConfig,
            this.testPort,
            this.testHostPort,
            this.testLogLevel,
            this.testAutoOpen,
            this.testExtendedStats,
            this.testPreviewThumbnails,
        ];
    }

    className() { return 'ConfigTest'; }

    /**
     * Ensure that an empty configuration is considered valid */
    async validateEmptyConfig() {
        // NOTE: This class is expected to fail if Marker Editor is unable to find the Plex data path automatically
        const dataPath = getDefaultPlexDataPath();
        /** @type {SerializedConfig} */
        const defaultConfig = {
            dataPath : this.#testValue(null, dataPath),
            database : this.#testValue(null, join(dataPath, 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db')),
            host : this.#testValue(null, 'localhost'),
            port : this.#testValue(null, 3232),
            baseUrl : this.#testValue(null, '/'),
            logLevel : this.#testValue(null, 'Info'),
            sslEnabled : this.#testValue(null, false),
            sslOnly : this.#testValue(null, false),
            sslHost : this.#testValue(null, '0.0.0.0'),
            sslPort : this.#testValue(null, 3233),
            certType :  this.#testValue(null, 'pfx'),
            pfxPath : this.#testValue(null, ''),
            pfxPassphrase : this.#testValue(null, ''),
            pemCert : this.#testValue(null, ''),
            pemKey : this.#testValue(null, ''),
            authEnabled : this.#testValue(null, false),
            authUsername : this.#testValue(null, ''),
            authSessionTimeout : this.#testValue(null, 86_400),
            trustProxy : this.#testValue(null, false),
            autoOpen : this.#testValue(null, true),
            extendedMarkerStats : this.#testValue(null, true),
            previewThumbnails : this.#testValue(null, true),
            preciseThumbnails : this.#testValue(null, false),
            writeExtraData : this.#testValue(null, true),
            autoSuspend : this.#testValue(null, false),
            autoSuspendTimeout : this.#testValue(null, 300),
            pathMappings : this.#testValue(null, [])
        };

        const form = new FormData();
        form.append('config', defaultConfig);
        try {
            /** @type {SerializedConfig} */
            const newConfig = await this.sendBody(PostCommands.ValidateConfig, { config : JSON.stringify(defaultConfig) });
            TestHelpers.verify(newConfig.dataPath?.value === null && newConfig.dataPath?.defaultValue === dataPath);
        }  catch {
            TestHelpers.verify(false, 'ValidateConfig POST command failed');
        }
    }

    /**
     * Ensure various ports are correctly considered valid/invalid. */
    async testPort() {
        const setting = ServerSettings.Port;

        // Test "valid" ports. Note that a port being valid doesn't necessarily mean it can actually be bound.
        // We're really just ensuring that the port is between 1 and 65535.
        for (const testPort of [1, 1025, 3333, 3080, 10000, 20000, 30000, 65535]) {
            const result = await this.#configValueTestResult(setting, this.#testValue(testPort, 3232));
            TestHelpers.verify(result.isValid, `Expected valid port ${testPort} to be marked valid, found invalid.`);
            TestHelpers.verify(
                !result.invalidMessage,
                `Expected valid port to have an empty invalid message, found "${result.invalidMessage}"`);
        }

        // Test invalid ports
        for (const testPort of [-3232, -10, 0, 65536, 100000]) {
            const result = await this.#configValueTestResult(setting, this.#testValue(testPort, 3232));
            TestHelpers.verify(!result.isValid, `Expected invalid port ${testPort} to be marked invalid, found valid.`);
            TestHelpers.verify(result.invalidMessage, `Expected invalid port to have an invalid message, found nothing.`);
        }
    }

    /**
     * Verify various host:port combinations. */
    async testHostPort() {
        const setting = ServerSettings.HostPort;

        // First, test a valid port, digging into ServerHelpers. The obvious downside is that since
        // the server-side validation uses this method, if there's something wrong with the method
        // itself, that won't be caught.
        let goodPort = 3333;
        while (goodPort < 65536) {
            if (testHostPort('localhost', goodPort)) {
                break;
            }

            TestLog.warn(`testHostPort - Could not bind to port ${goodPort}, trying ${goodPort + 1}`);
            ++goodPort;
        }

        const validationData = (host, port) => JSON.stringify({
            host : host,
            port : port,
            sslHost : '',
            sslPort : port,
            sslState : SslState.Disabled,
        });

        const goodHostPort = this.#testValue(validationData('localhost', goodPort));
        /** @type {TypedSetting<string>} */
        let result = await this.#configValueTestResult(setting, goodHostPort);
        TestHelpers.verify(result.isValid, `Expected known good host:port to be valid, but was marked invalid`);
        TestHelpers.verify(!result.invalidMessage, `Expected an empty invalid message, found "${result.invalidMessage}"`);


        // Test in-use port. Can't use test server port, since that's explicitly filtered out.
        const tempServer = createServer();
        await new Promise(resolve => {
            tempServer.listen(goodPort, 'localhost', () => {
                resolve();
            }).on('error', (err) => {
                TestHelpers.verify(false, `Unable to start up temp server to test in-use host/port: ${err.message}.`);
                resolve();
            });
        });

        result = await this.#configValueTestResult(setting, goodHostPort);
        await new Promise(resolve => { tempServer.close(_ => resolve()); });
        TestHelpers.verify(!result.isValid, `Expected known bad host:port to be invalid, but was marked valid.`);
        TestHelpers.verify(result.invalidMessage, `Expected an invalid message, found nothing.`);

        // Test invalid hostnames (makes a reasonable assumption that the given hosts aren't valid)
        const badHosts = ['local7host', '192.168.0', '192.168.1.256', 'github.com'];
        for (const badHost of badHosts) {
            result = await this.#configValueTestResult(setting, this.#testValue(validationData(badHost, goodPort), ''));
            TestHelpers.verify(!result.isValid, `Expected known bad host to be invalid, but was marked valid.`);
            TestHelpers.verify(
                result.invalidMessage?.indexOf('not be found') !== -1 || result.invalidMessage?.indexOf('not available') !== -1,
                `Expected an invalid hostname message, found "${result.invalidMessage}".`);
        }

        // Test invalid ports. Some overlap with testPort(), but good to check in conjunction with the host
        const badPorts = [-3232, -1, 0, 65536];
        for (const badPort of badPorts) {
            result = await this.#configValueTestResult(setting, this.#testValue(validationData('localhost', badPort), ''));
            TestHelpers.verify(!result.isValid, `Expected known bad port to be invalid, but was marked valid.`);
            TestHelpers.verify(result.invalidMessage, `Expected an invalid message, found nothing.`);
        }
    }

    /**
     * Validate log level strings. */
    async testLogLevel() {
        const setting = ServerSettings.LogLevel;

        // Test all valid combinations (2 * 2 * 7 = 28)
        for (const trace of ['', 'Trace']) {
            for (const dark of ['', 'Dark']) {
                // Test case-(in)sensitivity while we're at it
                for (const level of ['extreme', 'TmI', 'VERbOse', 'Info', 'WaRN', 'Error', 'Critical']) {
                    const logString = `${trace}${dark}${level}`;
                    const result = await this.#configValueTestResult(setting, this.#testValue(logString, 'Info'));
                    TestHelpers.verify(result.isValid, `Expected LogLevel "${logString}" to be valid, found invalid`);
                    TestHelpers.verify(!result.invalidMessage,
                        `Expected LogLevel "${logString}" to have no invalid message, found ${result.invalidMessage}`);
                }
            }
        }

        // Random assortment of invalid log levels
        for (const invalidLogLevel of [
            'TracedInfo',
            'TracingDarkInfo',
            'TraceDarkedVerbose',
            'DarkenVerbose',
            'LightVerbose',
            'Infos',
            'Verbosity',
            'KindaCritical',
            true,
            false,
            1,
            10000
        ]) {
            const result = await this.#configValueTestResult(setting, this.#testValue(invalidLogLevel, 'Info'));
            TestHelpers.verify(!result.isValid, `Expected LogLevel "${invalidLogLevel}" to be invalid, found valid`);
            TestHelpers.verify(result.invalidMessage, `Expected LogLevel "${invalidLogLevel}" to have an invalid message, found nothing`);
        }
    }

    /**
     * Test boolean AutoOpen setting validation. */
    async testAutoOpen() {
        await this.#testBooleanSetting(ServerSettings.AutoOpen);
    }

    /**
     * Test boolean ExtendedMarkerStats setting validation. */
    async testExtendedStats() {
        await this.#testBooleanSetting(ServerSettings.ExtendedStats);
    }

    /**
     * Test boolean PreviewThumbnails setting validation. */
    async testPreviewThumbnails() {
        await this.#testBooleanSetting(ServerSettings.PreviewThumbnails);
    }

    /**
     * Generic boolean setting validation.
     * @param {string} setting The setting to test
     * @param {boolean} defaultValue The default value for the given setting */
    async #testBooleanSetting(setting, defaultValue=true) {
        // Only true/false are valid
        for (const validSetting of [true, false]) {
            const result = await this.#configValueTestResult(setting, this.#testValue(validSetting, defaultValue));
            TestHelpers.verify(result.isValid, `Expected '${validSetting}' to be a valid value for '${setting}', found invalid`);
            TestHelpers.verify(!result.invalidMessage,
                `[${setting}:${validSetting}] Expected an empty invalid message, found '${result.invalidMessage}'`);
        }

        // Everything else is invalid, including the strings 'true' and 'false'
        for (const invalid of ['true', 'false', 0, 1, 'yes', 'maybe', 'no', 127]) {
            const result = await this.#configValueTestResult(setting, this.#testValue(invalid, defaultValue));
            TestHelpers.verify(!result.isValid, `Expected '${invalid}' to be an invalid value for '${setting}', found valid`);
            TestHelpers.verify(result.invalidMessage, `[${setting}:${invalid}] Expected an invalid message, found nothing`);
        }
    }

    /**
     * @template T
     * @param {T} value
     * @param {T} defaultValue
     * @returns {TypedSetting<T>}*/
    #testValue(value, defaultValue=null) {
        return {
            value : value,
            defaultValue : defaultValue,
            isValid : true,
            invalidMessage : ''
        };
    }

    /**
     * @template T
     * @param {string} setting
     * @param {TypedSetting<T>} value
     * @returns {Promise<TypedSetting<T>>} */
    #configValueTestResult(setting, value) {
        return this.sendBody(PostCommands.ValidateConfigValue, this.#settingObj(setting, value));
    }

    /**
     * @template T
     * @param {string} setting
     * @param {TypedSetting<T>} value */
    #settingObj(setting, value) {
        return {
            setting : setting,
            value : JSON.stringify(value),
        };
    }
}
