import { ConsoleLog, ContextualLog } from '/Shared/ConsoleLog.js';
import { isFeatureSetting, ServerConfigState, ServerSettings } from '/Shared/ServerConfig.js';

import { $$, appendChildren, buildNode } from '../Common.js';
import { errorMessage, errorToast } from '../ErrorHandling.js';
import { Theme, ThemeColors } from '../ThemeColors.js';
import Tooltip, { TooltipTextSize } from '../Tooltip.js';
import ButtonCreator from '../ButtonCreator.js';
import { flashBackground } from '../AnimationHelpers.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import Overlay from '../Overlay.js';
import { ServerCommands } from '../Commands.js';

import { buttonsFromConfigState, settingId, settingInput, settingsDialogIntro } from './ServerSettingsDialogHelper.js';
import { SettingTitles, ValidationInputDelay } from './ServerSettingsDialogConstants.js';
import { GetTooltip } from './ServerSettingsTooltips.js';
import { PathMappingsTable } from './PathMappingsTable.js';


/** @typedef {!import('/Shared/ServerConfig').PathMapping} PathMapping */
/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */
/**
 * @template T
 * @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T>
 * */

const Log = new ContextualLog('ServerConfig');

/**
 * Class that handles displaying and adjusting server settings on the client.
 */
class ServerSettingsDialog {
    /** @type {SerializedConfig} */
    #initialValues;
    /** @type {number} */
    #keyupTimer;
    /** @type {boolean} Whether we're in the middle of validate. */
    #inValidate = false;
    /** @type {PathMappingsTable} */
    #pathMappings;

    /**
     * @param {SerializedConfig} config */
    constructor(config) {
        this.#initialValues = config;
    }

    /**
     * Entrypoint for displaying the server settings UI. */
    launch() {
        const [title, description] = settingsDialogIntro(this.#initialValues.state);
        const container = buildNode('div', { id : 'serverSettingsContainer', class : 'settingsContainer' });
        const config = this.#initialValues;
        const features = config.features;
        appendChildren(container,
            appendChildren(buildNode('div'),
                buildNode('h1', {}, title),
                buildNode('span', {}, description),
            ),
            buildNode('hr'),
            appendChildren(buildNode('div', { class : 'serverSettingsSettings' }),
                this.#buildStringSetting(ServerSettings.DataPath, config.dataPath, this.#validateDataPath.bind(this)),
                this.#buildStringSetting(ServerSettings.Database, config.database),
                this.#buildStringSetting(ServerSettings.Host, config.host, this.#validateHostPort.bind(this)),
                this.#buildStringSetting(ServerSettings.Port, config.port, this.#validatePort.bind(this)),
                this.#buildLogLevelSetting(),
                this.#buildBooleanSetting(ServerSettings.AutoOpen, features.autoOpen),
                this.#buildBooleanSetting(ServerSettings.ExtendedStats, features.extendedMarkerStats),
                this.#buildBooleanSetting(ServerSettings.PreviewThumbnails,
                    features.previewThumbnails,
                    this.#onPreviewThumbnailsChanged.bind(this)),
                this.#buildBooleanSetting(ServerSettings.FFmpegThumbnails, features.preciseThumbnails),
                this.#buildPathMappings(),
            ),
            buildNode('hr'),
            appendChildren(buildNode('div', { id : 'serverSettingsSubmit' }),
                ButtonCreator.fullButton('Apply', Icons.Confirm, ThemeColors.Green, this.#onApply.bind(this)),
                ...buttonsFromConfigState(this.#initialValues.state)
            ),
        );

        Overlay.build({
            dismissible : false,
            closeButton :  this.#initialValues.state === ServerConfigState.Valid,
            noborder : true,
            centered : true,
            setup : { fn : () => $$('#serverSettingsContainer input[type="text"]').focus() },
        }, container);
    }

    /**
     * Build the UI for a string setting.
     * @param {number} setting
     * @param {TypedSetting<string>} settingInfo */
    #buildStringSetting(setting, settingInfo, customValidate) {
        const input = buildNode('input', { type : 'text', value : settingInfo.value || '' });
        const validateFn = customValidate || this.#validateSingle.bind(this, setting);
        input.addEventListener('change', e => {
            if (this.#keyupTimer) {
                clearTimeout(this.#keyupTimer);
                Tooltip.dismiss();
                this.#keyupTimer = null;
            }

            validateFn(e);
        });

        input.addEventListener('keyup', e => {
            if (this.#keyupTimer) {
                clearTimeout(this.#keyupTimer);
            }

            this.#keyupTimer = setTimeout(validateFn.bind(this, e), ValidationInputDelay);
        });

        return this.#buildSettingEntry(setting, settingInfo, input, { class : 'stringSetting' });
    }

    /**
     * Build UI for a boolean (enabled/disabled) setting.
     * @param {string} settingName
     * @param {TypedSetting<boolean>} settingInfo
     * @param {(e: Event) => void} [changeHandler] */
    #buildBooleanSetting(settingName, settingInfo, changeHandler) {
        const select = appendChildren(buildNode('select'),
            buildNode('option', { value : 0 }, 'Disabled'),
            buildNode('option', { value : 1 }, 'Enabled')
        );

        const input = buildNode('span', { class : 'selectHolder' }, select);
        const defaultValue = settingInfo.value === null ? (settingInfo.defaultValue ? 1 : 0) : (settingInfo.value ? 1 : 0);
        select.value = defaultValue;
        if (changeHandler) {
            select.addEventListener('change', changeHandler);
        }

        return this.#buildSettingEntry(settingName, settingInfo, input);
    }

    /**
     * Build the UI for the log level selection dropdown. */
    #buildLogLevelSetting() {
        const options = [];
        for (let i = ConsoleLog.Level.TMI; i <= ConsoleLog.Level.Error; ++i) {
            options.push(buildNode('option', { value : i }, ConsoleLog.LevelString(i)));
        }

        const levelId = settingId(ServerSettings.LogLevel);
        const darkId = settingId(ServerSettings.LogLevel, 'dark');
        const levelSelect = appendChildren(buildNode('select', { id : levelId }), ...options);
        const settings = this.#initialValues.logLevel;
        const initialValues = Log.getFromString(settings.value || settings.defaultValue);
        levelSelect.value = initialValues.level;

        const darkSelect = appendChildren(buildNode('select', { id : darkId }),
            buildNode('option', { value : 0 }, 'Disabled'),
            buildNode('option', { value : 1 }, 'Enabled')
        );

        darkSelect.value = initialValues.dark ? 1 : 0;

        const input = appendChildren(buildNode('div', { id : 'serverLogLevel' }),
            appendChildren(buildNode('span', { class : 'selectHolder' }),
                buildNode('label', { for : levelId }, 'Level: '),
                levelSelect
            ),
            appendChildren(buildNode('span', { class : 'selectHolder' }),
                buildNode('label', { for : darkId }, 'Dark: '),
                darkSelect
            )
        );

        return this.#buildSettingEntry(ServerSettings.LogLevel, settings, input);
    }

    /**
     * Build and return the editable path mappings table. */
    #buildPathMappings() {
        this.#pathMappings = new PathMappingsTable(this.#initialValues.pathMappings);
        return this.#buildSettingEntry(ServerSettings.PathMappings, this.#initialValues.pathMappings, this.#pathMappings.table());
    }

    /**
     * Core routine that adds a new setting to the dialog.
     * @param {number} setting
     * @param {TypedSetting<any>} settingInfo
     * @param {HTMLElement} userInput */
    #buildSettingEntry(setting, settingInfo, userInput, attributes={}) {
        const id = settingId(setting);
        let realInput = userInput;
        if (!(userInput instanceof HTMLInputElement) && !(userInput instanceof HTMLSelectElement)) {
            realInput = $$('input,select', userInput);
        }

        if (realInput) realInput.id = id;
        if (!settingInfo.isValid) {
            realInput?.classList.add('invalid');
        }

        const icon = buildNode('i',
            { class : 'labelHelpIcon' },
            getSvgIcon(Icons.Help, ThemeColors.Primary, { height : 18 }));
        Tooltip.setTooltip(icon,
            GetTooltip(setting),
            {
                textSize : TooltipTextSize.Smaller,
                maxWidth : 500,
            });
        if (attributes.class) {
            attributes.class += ' serverSetting';
        } else {
            attributes.class = 'serverSetting';
        }

        return appendChildren(buildNode('div', attributes),
            appendChildren(buildNode('span', { class : 'serverSettingTitle' }),
                buildNode('label', { for : id }, SettingTitles[setting]),
                icon
            ),
            appendChildren(buildNode('div'),
                userInput,
                buildNode('span', { class : 'serverSettingDefaultInfo' }, `Default Value: ${this.#getDefault(settingInfo.defaultValue)}`),
            ),
        );
    }

    /**
     * Transform the given default value to a more user-friendly value.
     * @param {any} defaultValue */
    #getDefault(defaultValue) {
        if (typeof defaultValue === 'boolean') {
            return defaultValue ? 'Enabled' : 'Disabled';
        }

        if (defaultValue === null || defaultValue === undefined) {
            return 'None';
        }

        if (defaultValue instanceof Array) {
            return defaultValue.length === 0 ? 'None' : JSON.stringify(defaultValue);
        }

        return defaultValue;
    }

    /**
     * Validate and set the new config values.
     * @param {MouseEvent} _e */
    async #onApply(_e, button) {
        const newConfig = {
            ...this.#getTopLevelConfigValues(),
            [ServerSettings.Features] : {
                ...this.#getFeatureConfigValues()
            },
            [ServerSettings.PathMappings] : this.#pathMappings.getCurrentPathMappings(),
        };

        let failed = true;
        ButtonCreator.setIcon(button, Icons.Loading, ThemeColors.Primary);
        try {
            const serverConfig = await ServerCommands.validateConfig(newConfig);
            if (this.#checkNewConfig(serverConfig, button)) {
                const result = await ServerCommands.setServerConfig(serverConfig);
                if (result.success) {
                    failed = false;
                    ButtonCreator.setIcon(button, Icons.Confirm, ThemeColors.Green);
                    await this.#notifyConfigSaved(result.config, button);
                } else {
                    errorToast(`Unable to set server config: ${result.message}`, 5000);
                }
            } else {
                errorToast(`One more more settings are invalid.`);
            }
        } catch (ex) {
            errorToast(`Could not apply settings: ${errorMessage(ex)}`, 5000);
        }

        ButtonCreator.setIcon(button, Icons.Confirm, ThemeColors.Green);

        if (failed) {
            flashBackground(button, Theme.getHex(ThemeColors.Red, 8), 2000);
        }
    }

    /**
     * Ensure every relevant config value is valid.
     * @param {SerializedConfig} config */
    #checkNewConfig(config, applyBtn) {
        let allValid = true;
        for (const setting of [
            ServerSettings.DataPath,
            ServerSettings.Database,
            ServerSettings.Host,
            ServerSettings.Port,
            ServerSettings.LogLevel,
            ServerSettings.PathMappings,
            // Feature settings
            ServerSettings.AutoOpen,
            ServerSettings.ExtendedStats,
            ServerSettings.PreviewThumbnails,
            ServerSettings.FFmpegThumbnails
        ]) {
            const input = settingInput(setting);
            /** @type {TypedSetting<any>} */
            const configSetting = isFeatureSetting(setting) ? config.features[setting] : config[setting];
            if (configSetting.isValid) {
                input.classList.remove('invalid');
                Tooltip.removeTooltip(input);
            } else {
                // We can ignore an invalid data path if our database path is explicitly set
                // and we're not using Plex-generated thumbnails
                const wasValid = allValid;
                let invalidClass = 'invalid';
                let tt = configSetting.invalidMessage || 'Invalid value';
                if (setting === ServerSettings.DataPath) {
                    input.classList.remove('invalidSubtle');
                    const pvt = this.#val(config.features.previewThumbnails);
                    const ffmpegThumbs = pvt && this.#val(config.features.preciseThumbnails);
                    if (config.database.value && (!pvt || ffmpegThumbs)) {
                        invalidClass = 'invalidSubtle';
                        tt += ' (but can be ignored due to other settings)';
                    } else {
                        allValid = false;
                    }
                } else {
                    allValid = false;
                }

                input?.classList.add(invalidClass);
                Tooltip.setTooltip(input, tt);
                if (wasValid && !allValid) {
                    flashBackground(applyBtn, Theme.getHex(ThemeColors.Red, 8), 2000);
                }
            }
        }

        return allValid;
    }

    /**
     * We successfully applied the new settings. Ask the user to refresh the page.
     * @param {SerializedConfig} newConfig
     * @param {HTMLElement} button */
    async #notifyConfigSaved(newConfig, button) {
        const newHost = this.#val(newConfig.host);
        const newPort = this.#val(newConfig.port);
        const differentHost = this.#val(this.#initialValues.host) !== newHost;
        const differentPort = this.#val(this.#initialValues.port) !== newPort;
        const needsRedirect = differentHost || differentPort;
        await flashBackground(button, Theme.getHex(ThemeColors.Green, 8), 1000);
        if (needsRedirect) {
            // Overlay refreshing
            Overlay.show(
                `Settings applied! The server needed to reboot to change the host and/or port, which ` +
                `may take a few moments. Press 'Reload' below to go to the new host/port.`,
                'Reload',
                () => { window.location.host = `${newHost}:${newPort}`; }
            );
        } else {
            // Same host/port, can just ask the user to refresh
            Overlay.show(`Settings applied! Press 'Reload' below to reload this page with your new settings.`,
                'Reload',
                () => { window.location.reload(); },
                false /*dismissible*/);
        }

    }

    /**
     * Return the explicitly set value of setting, or the default value if not set.
     * @template T
     * @param {TypedSetting<T>} setting */
    #val(setting) {
        return (setting.value === null || setting.value === undefined) ? setting.defaultValue : setting.value;
    }

    /**
     * Retrieve all the plain top level config values.
     * @returns {{[serverSetting: string]: TypedSetting<any> }} */
    #getTopLevelConfigValues() {
        const values = {};
        for (const setting of [
            ServerSettings.DataPath,
            ServerSettings.Database,
            ServerSettings.Host,
            ServerSettings.Port,
            ServerSettings.LogLevel
        ]) {
            values[setting] = this.#getCurrentConfigValue(setting);
        }

        return values;
    }

    /**
     * Retrieve the boolean `features` settings.
     * @returns {{[serverSetting: string]: TypedSetting<boolean>}} */
    #getFeatureConfigValues() {
        const features = {};
        for (const setting of [
            ServerSettings.AutoOpen,
            ServerSettings.ExtendedStats,
            ServerSettings.PreviewThumbnails,
            ServerSettings.FFmpegThumbnails
        ]) {
            features[setting] = this.#getCurrentBooleanFeatureSetting(setting);
        }

        return features;
    }

    /**
     * Get the current value for the given setting.
     * @param {string} setting
     * @returns {TypedSetting<any>} */
    #getCurrentConfigValue(setting) {
        let isNum = false;
        switch (setting) {
            case ServerSettings.Port:
                isNum = true;
                // __fallthrough
            case ServerSettings.DataPath:
            case ServerSettings.Database:
            case ServerSettings.Host:
            {
                let currentValue = settingInput(setting).value;
                if (isNum && currentValue.length !== 0) {
                    currentValue = +currentValue;
                }

                return {
                    value : currentValue || null,
                    defaultValue : this.#initialValues[setting].defaultValue,
                    isValid : true,
                };
            }
            case ServerSettings.LogLevel:
                return this.#getCurrentLogLevelSettings();
            case ServerSettings.AutoOpen:
            case ServerCommands.ExtendedStats:
            case ServerSettings.PreviewThumbnails:
            case ServerSettings.FFmpegThumbnails:
                return this.#getCurrentBooleanFeatureSetting();
            case ServerSettings.PathMappings:
                return this.#pathMappings.getCurrentPathMappings();
            default:
                throw new Error(`Unexpected server setting "${setting}"`);
        }
    }

    /**
     * Get the current value of the given boolean setting.
     * @param {string} setting
     * @returns {TypedSetting<boolean>} */
    #getCurrentBooleanFeatureSetting(setting) {
        /** @type {TypedSetting<boolean>} */
        const initialSetting = this.#initialValues.features[setting];
        if (!initialSetting) {
            throw new Error(`getCurrentBooleanFeatureSetting called with unknown feature setting "${setting}"`);
        }

        const wasSet = initialSetting.value !== null && initialSetting.value !== undefined;
        const currentValue = +settingInput(setting).value === 1;
        const defaultValue = initialSetting.defaultValue;
        return {
            value : wasSet ? currentValue : (currentValue === defaultValue ? null : currentValue),
            defaultValue : defaultValue,
            isValid : true,
        };
    }

    /**
     * Retrieve the current log level string.
     * @returns {TypedSetting<string>} */
    #getCurrentLogLevelSettings() {
        const newLogLevelString = () => {
            const levelSelect = settingInput(ServerSettings.LogLevel);
            const darkSelect = settingInput(ServerSettings.LogLevel, 'dark');
            return (+darkSelect.value === 1 ? 'Dark' : '') + $$(`option[value="${levelSelect.value}"]`, levelSelect).innerText;
        };

        // If the initial value wasn't set, treat the current value as default
        // if it matches the default, even if it might have been set explicitly.
        const wasSet = this.#initialValues.logLevel.value;
        const newValue = newLogLevelString();
        const defaultValue = this.#initialValues.logLevel.defaultValue;
        const isDefault = !wasSet && newValue === defaultValue;
        return {
            value : (wasSet || !isDefault) ? newValue : null,
            defaultValue : defaultValue,
            isValid : true,
        };
    }

    /**
     * Validate a single server setting.
     * @param {string} setting
     * @param {Event} e */
    async #validateSingle(setting, e) {
        try {
            /** @type {TypedSetting<any>} */
            const originalSetting = isFeatureSetting(setting) ? this.#initialValues.features[setting] : this.#initialValues[setting];

            // Convert 1/0 to true/false if needed
            let newValue = e.target.value || null;
            if (newValue !== null && (typeof originalSetting.defaultValue === 'boolean')) {
                newValue = !!newValue;
            }

            // If the original setting didn't have a value set, and the current value is the
            // default value, keep it blank.
            if ((originalSetting.value === undefined || originalSetting.value === null) && newValue === originalSetting.defaultValue) {
                newValue = null;
            }

            const newSetting = {
                value : newValue,
                defaultValue : originalSetting.defaultValue,
                isValid : originalSetting.isValid,
            };

            /** @type {TypedSetting<any>} */
            const validSetting = await ServerCommands.validateConfigValue(setting, JSON.stringify(newSetting));
            e.target.classList[validSetting.isValid ? 'remove' : 'add']('invalid');
            if (validSetting.isValid) {
                Tooltip.removeTooltip(e.target);
            } else {
                Tooltip.setTooltip(e.target, validSetting.invalidMessage || `Invalid value`, { maxWidth : 450 });
                if (document.activeElement === e.target) {
                    e.target.blur();
                    e.target.focus();
                }
            }
        } catch (ex) {
            errorToast(`Could not validate setting: ${errorMessage(ex)}`, 5000);
            e.target.classList.add('invalid');
        }
    }

    /**
     * Verifies the new host:port value is valid.
     * @param {Event} e */
    async #validatePort(e) {
        await this.#validateSingle(ServerSettings.Port, e);
        /** @type {HTMLInputElement} */
        const portInput = settingInput(ServerSettings.Port);
        if (portInput.classList.contains('invalid')) {
            // The port itself is invalid, so we can't really test the host
            /** @type {HTMLInputElement} */
            const hostInput = settingInput(ServerSettings.Host);
            Tooltip.removeTooltip(hostInput);
            hostInput.classList.remove('invalid');
        } else {
            // Port is valid, so make sure host:port is valid.
            this.#validateHostPort(e);
        }
    }

    /**
     * Ensures the provided (or default) data path is valid, including its potential
     * connection to the database file.
     * @param {Event} e */
    #validateDataPath(e) {
        if (this.#inValidate) {
            // We were called recursively. The second time around, manually validate
            // just the data path.
            this.#inValidate = false;
            return this.#validateSingle(ServerSettings.DataPath, e);
        }

        this.#inValidate = true;
        /** @type {HTMLInputElement} */
        const dataPathInput = settingInput(ServerSettings.DataPath);
        /** @type {HTMLInputElement} */
        const databaseInput = settingInput(ServerSettings.Database);
        /** @type {string} */
        let newDataPath = dataPathInput.value;
        const dbSetting = this.#initialValues.database;
        const slash = dbSetting.defaultValue.includes('/') ? '/' : '\\';
        let i = newDataPath.length - 1;
        while (i >= 0 && newDataPath[i] === slash) {
            --i;
        }

        newDataPath = newDataPath.substring(0, i + 1);
        const dbDefault = `Plug-in Support${slash}Databases${slash}com.plexapp.plugins.library.db`;
        if (newDataPath) {
            dbSetting.defaultValue = newDataPath + slash + dbDefault;
        } else {
            dbSetting.defaultValue = this.#initialValues.dataPath.defaultValue + slash + dbDefault;
        }

        $$('.serverSettingDefaultInfo', databaseInput.parentElement).innerText = `Default Value: ${dbSetting.defaultValue}`;

        dataPathInput.dispatchEvent(new Event('change'));
        databaseInput.dispatchEvent(new Event('change'));
    }

    /**
     * Verifies that the given host:port is a valid combination.
     * @param {Event} e */
    async #validateHostPort(e) {
        /** @type {HTMLInputElement} */
        const hostInput = settingInput(ServerSettings.Host);
        /** @type {HTMLInputElement} */
        const portInput = settingInput(ServerSettings.Port);
        const originalHost = this.#initialValues.host;
        const originalPort = this.#initialValues.port;
        try {
            const newSetting = {
                value : (hostInput.value || originalHost.defaultValue) + ':' + (portInput.value || originalPort.defaultValue),
                defaultValue : `${originalHost.defaultValue}:${originalPort.defaultValue}`,
                isValid : originalHost.isValid && originalPort.isValid,
            };

            const settingResult = await ServerCommands.validateConfigValue(ServerSettings.HostPort, JSON.stringify(newSetting));
            if (settingResult.isValid) {
                Tooltip.removeTooltip(hostInput);
                hostInput.classList.remove('invalid');
                portInput.classList.remove('invalid');
            } else {
                Tooltip.setTooltip(hostInput, settingResult.invalidMessage || `Invalid hostname`, { maxWidth : 450 });
                Tooltip.setTooltip(portInput, settingResult.invalidMessage || `Invalid host+port`, { maxWidth : 450 });
                hostInput.classList.add('invalid');
                portInput.classList.add('invalid');
                if (document.activeElement === originalHost || document.activeElement === originalPort) {
                    document.activeElement.blur();
                    document.activeElement.focus();
                }
            }

        } catch (ex) {
            errorToast(`Could not validate host and port: ${errorMessage(ex)}`, 5000);
            e.target.classList.add('invalid');
        }
    }

    /**
     * Enabled/disables the FFmpeg thumbnail setting when the top-level preview thumbnail setting changes.
     * @param {Event} e */
    #onPreviewThumbnailsChanged(e) {
        /** @type {HTMLElement} */
        const ffmpegSetting = settingInput(ServerSettings.FFmpegThumbnails);
        if (parseInt(e.target.value) === 0) {
            ffmpegSetting.setAttribute('disabled', 1);
        } else {
            ffmpegSetting.removeAttribute('disabled');
        }
    }
}

/**
 * Launches an undismissible server settings dialog if the given config indicates it's invalid or doesn't exist.
 * @param {SerializedConfig} config */
export function LaunchFirstRunSetup(config) {
    if (config.state === ServerConfigState.DoesNotExist || config.state === ServerConfigState.Invalid) {
        new ServerSettingsDialog(config).launch();
        return true;
    }

    return false;
}

/**
 * Launches a dismissible server settings overlay */
export async function LaunchServerSettingsDialog() {
    const config = await ServerCommands.getConfig();
    new ServerSettingsDialog(config).launch();
}
