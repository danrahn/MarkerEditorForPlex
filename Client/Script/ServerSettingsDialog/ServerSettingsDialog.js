import { ConsoleLog, ContextualLog } from '/Shared/ConsoleLog.js';
import { ServerConfigState, ServerSettings } from '/Shared/ServerConfig.js';

import { $, $$, $id, appendChildren, buildNode, buildText } from '../Common.js';
import { errorMessage, errorToast } from '../ErrorHandling.js';
import { flashBackground, slideDown, slideUp } from '../AnimationHelpers.js';
import { Theme, ThemeColors } from '../ThemeColors.js';
import Tooltip, { TooltipTextSize } from '../Tooltip.js';
import ButtonCreator from '../ButtonCreator.js';
import { getSvgIcon } from '../SVGHelper.js';
import Icons from '../Icons.js';
import Overlay from '../Overlay.js';
import { ServerCommands } from '../Commands.js';

import { buttonsFromConfigState, settingId, settingInput, settingsDialogIntro } from './ServerSettingsDialogHelper.js';
import { SettingTitles, ValidationInputDelay } from './ServerSettingsDialogConstants.js';
import { GetTooltip } from './ServerSettingsTooltips.js';
import { PathMappingsTable } from './PathMappingsTable.js';


/** @typedef {!import('/Shared/ServerConfig').SerializedConfig} SerializedConfig */
/** @typedef {!import('/Shared/ServerConfig').PathMapping} PathMapping */
/**
 * @template T
 * @typedef {!import('/Shared/ServerConfig').TypedSetting<T>} TypedSetting<T>
 * */

const Log = new ContextualLog('ServerConfig');

/**
 * Elements IDs for authentication password fields. */
const EleIds = {
    /** @readonly Old password confirmation when changing the password. */
    OldPass : 'newAuthOld',
    /** @readonly New password. */
    NewPass : 'newAuthNew',
    /** @readonly Confirmation of new password. */
    ConfPass : 'newAuthConf',
    /** @readonly Current password confirmation to disable auth. */
    DisableConf : 'authDisableConfirm',
    /** @readonly Container for password change confirmations. */
    ChangePassHolder : 'changePasswordHolder',
    /** @readonly 'Apply' button */
    ApplyChanges : 'applyServerSettings',
};

/**
 * All possible outcomes of #preprocessAuthChanges. */
const AuthChangeResult = {
    /** @readonly No auth related changes were made. */
    NoChanges       : 0x0,
    /** @readonly The auth password was successfully changed. */
    PasswordChanged : 0x1,
    /** @readonly An auth related change could not be applied. */
    Failed          : 0x2,
};

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
        appendChildren(container,
            appendChildren(buildNode('div', { id : 'serverSettingsScroll' }),
                appendChildren(buildNode('div'),
                    buildNode('h1', {}, title),
                    buildNode('span', {}, description),
                ),
                buildNode('hr'),
                appendChildren(buildNode('div', { class : 'serverSettingsSettings' }),
                    this.#buildStringSetting(ServerSettings.DataPath, config.dataPath, this.#validateDataPath.bind(this)),
                    this.#buildStringSetting(ServerSettings.Database, config.database),
                    this.#buildStringSetting(ServerSettings.Host, config.host, this.#validateHostPort.bind(this)),
                    this.#buildNumberSetting(ServerSettings.Port, config.port, this.#validatePort.bind(this), 1, 65535),
                    ...this.#buildAuthenticationSettings(),
                    this.#buildLogLevelSetting(),
                    this.#buildBooleanSetting(ServerSettings.AutoOpen, config.autoOpen),
                    this.#buildBooleanSetting(ServerSettings.ExtendedStats, config.extendedMarkerStats),
                    this.#buildBooleanSetting(ServerSettings.PreviewThumbnails,
                        config.previewThumbnails,
                        this.#onPreviewThumbnailsChanged.bind(this)),
                    this.#buildBooleanSetting(ServerSettings.FFmpegThumbnails, config.preciseThumbnails),
                    this.#buildPathMappings(),
                ),
            ),
            buildNode('hr'),
            appendChildren(buildNode('div', { id : 'serverSettingsSubmit' }),
                ButtonCreator.fullButton('Apply', Icons.Confirm, ThemeColors.Green, this.#onApply.bind(this), { id : EleIds.ApplyChanges }),
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

    #buildNumberSetting(setting, settingInfo, customValidate, min, max, attributes={}) {
        const input = buildNode('input', { type : 'number', min : min, max : max, value : settingInfo.value || '' });
        return this.#buildInputSetting(input, setting, settingInfo, customValidate, attributes);
    }

    #buildStringSetting(setting, settingInfo, customValidate, attributes={}) {
        const input = buildNode('input', { type : 'text', value : settingInfo.value || '' });
        return this.#buildInputSetting(input, setting, settingInfo, customValidate, attributes);
    }

    /**
     * Build the UI for an input setting (number/text).
     * @param {HTMLInputElement} input
     * @param {string} setting
     * @param {TypedSetting<string>} settingInfo
     * @param {(setting: string, e: Event) => void} [customValidate]
     * @param {Object} attributes Custom attributes to apply to the setting/input. */
    #buildInputSetting(input, setting, settingInfo, customValidate, attributes={}) {
        const outerAttrs = { ...attributes };

        // Some attributes should be applied to the input itself, not the setting container.
        const applyInputAttr = (attribute) => {
            if (attributes[attribute]) {
                input.setAttribute(attribute, attributes[attribute]);
                delete outerAttrs[attribute];
            }
        };

        applyInputAttr('disabled');
        applyInputAttr('maxlength');

        const validateFn = customValidate || this.#validateSingle.bind(this, setting, false /*successBackground*/);
        input.addEventListener('change', this.#timedChangeListener(validateFn));
        input.addEventListener('keyup', this.#timedKeyupListener(validateFn));
        input.addEventListener('keydown', this.#inputKeydownListener.bind(this));

        outerAttrs.class = (outerAttrs.class ? outerAttrs.class + ' ' : '') + 'stringSetting';
        return this.#buildSettingEntry(setting, settingInfo, input, outerAttrs);
    }

    /**
     * Returns a 'change' listener that triggers validation after a setting input loses focus.
     * @param {(e: Event) => void} validateFn
     * @returns {(e: Event) => void} */
    #timedChangeListener(validateFn) {
        return e => {
            if (this.#keyupTimer) {
                clearTimeout(this.#keyupTimer);
                Tooltip.dismiss();
                this.#keyupTimer = null;
            }

            validateFn(e);
        };
    }

    /**
     * Returns a keyup listener that triggers validation after a brief period of inactivity.
     * @param {(e: Event) => void} validateFn
     * @returns {(e: Event) => void} */
    #timedKeyupListener(validateFn) {
        return e => {
            if (this.#keyupTimer) {
                clearTimeout(this.#keyupTimer);
            }

            this.#keyupTimer = setTimeout(validateFn.bind(this, e), ValidationInputDelay);
        };
    }

    /**
     * Attempt to apply settings if Ctrl+Enter is pressed on an input.
     * @param {KeyboardEvent} e */
    #inputKeydownListener(e) {
        if (!e.repeat && e.ctrlKey && e.key === 'Enter') {
            this.#onApply(e, $id(EleIds.ApplyChanges));
        }
    }

    /**
     * Build a button setting. Used to trigger additional options (e.g. to change the user password)
     * @param {string} setting The string setting
     * @param {string} settingInfo The setting values
     * @param {string} value The button text
     * @param {(e: Event) => any} onClick Method to invoke when the button is clicked
     * @param {Object} [attributes={}] Any additional attributes to apply to the input/element. */
    #buildButtonSetting(setting, settingInfo, value, onClick, attributes={}) {
        const input = buildNode('input', { type : 'button', value : value });
        const outerAttrs = { ...attributes };
        if (attributes.disabled) {
            input.setAttribute('disabled', 1);
            delete outerAttrs.disabled;
        }

        input.addEventListener('click', onClick);
        input.addEventListener('keydown', this.#inputKeydownListener.bind(this));

        input.addEventListener('keyup', e => {
            if (e.key === 'Enter') {
                input.click();
            }
        });

        // Disable default "enter on button input == click", as that can cause
        // a cascade of show/hide notifications if the key is held down.
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
        });

        outerAttrs.class = (outerAttrs.class ? outerAttrs.class + ' ' : '') + 'buttonSetting';
        return this.#buildSettingEntry(setting, settingInfo, input, outerAttrs);
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

        select.addEventListener('keydown', this.#inputKeydownListener.bind(this));

        return this.#buildSettingEntry(settingName, settingInfo, input);
    }

    /**
     * Build UI for authentication related settings.
     *
     * There are four main components:
     * 1. Main toggle - enables/disables user authentication for Marker Editor
     * 2. Disable confirmation - if authentication is enabled, disabling it requires entering the current password.
     * 3. Authentication settings:
     *    * Session Timeout - how long before an inactive session is destroyed.
     *    * Username - the username required for authentication.
     *    * Password - the password required for authentication. This is a button that triggers #4
     * 4. Password change - a collection of three "settings" that asks for the old password, the new password,
     *    and confirmation of the new password.
     *
     * #2 is only shown when authentication was enabled and the user wants to disable it.
     * #4 is only shown after the user clicks 'Click to Change' */
    #buildAuthenticationSettings() {
        const select = appendChildren(buildNode('select'),
            buildNode('option', { value : 0 }, 'Disabled'),
            buildNode('option', { value : 1 }, 'Enabled')
        );

        const useAuth = this.#initialValues.authEnabled;
        const authInput = buildNode('span', { class : 'selectHolder' }, select);
        const defaultValue = useAuth.value === null ? (useAuth.defaultValue ? 1 : 0) : (useAuth.value ? 1 : 0);
        select.value = defaultValue;

        const subAttributes = {
            class : 'subSetting authSubSetting'
        };

        // If auth is disabled, make sure sub-settings are initially disabled.
        if (!defaultValue) {
            subAttributes.disabled = 1;
            subAttributes.class += ' disabledSetting';
        }

        select.addEventListener('change', this.#onAuthChanged.bind(this));

        const disableConfirmHolder = appendChildren(buildNode('div', { id : 'disableAuthHolder', class : 'hidden' }),
            this.#plainAuthInput(
                'Confirm with Password',
                EleIds.DisableConf,
                { style : 'margin-bottom: 15px' },
                this.#validateSingle.bind(this, ServerSettings.Password, true /*successBackground*/),
                'Current Password'),
            buildNode('br')
        );

        const oldAttributes = { ...subAttributes };
        if (this.#initialValues.authPassword.value === null) {
            // Auth has never been enabled, there's no "old password"
            oldAttributes.disabled = 1;
            oldAttributes.class += ' staticDisabledSetting';
        }

        const oldPasswordInput = this.#plainAuthInput('Old Password', EleIds.OldPass, oldAttributes);
        if (this.#initialValues.authPassword.value === null) {
            Tooltip.setTooltip($$('input', oldPasswordInput), 'Auth has never been enabled, there is no existing password.');
        }

        const newPassHolder = appendChildren(buildNode('div', { id : EleIds.ChangePassHolder, class : 'hidden' }),
            oldPasswordInput,
            this.#plainAuthInput('New Password', EleIds.NewPass, subAttributes, this.#onPassInputChanged.bind(this)),
            this.#plainAuthInput('Confirm Password', EleIds.ConfPass, subAttributes, this.#onPassInputChanged.bind(this)),
        );

        return [
            this.#buildSettingEntry(ServerSettings.UseAuthentication, useAuth, authInput),
            disableConfirmHolder,
            this.#buildNumberSetting(
                ServerSettings.SessionTimeout, this.#initialValues.authSessionTimeout, null, 300, Number.MAX_SAFE_INTEGER, subAttributes),
            this.#buildStringSetting(
                ServerSettings.Username, this.#initialValues[ServerSettings.Username], null, { maxlength : 256, ...subAttributes }),
            this.#buildButtonSetting(
                ServerSettings.Password,
                this.#initialValues[ServerSettings.Password],
                'Click to Change',
                this.#showHidePasswordUpdate.bind(this),
                subAttributes
            ),
            buildNode('br'),
            newPassHolder
        ];
    }

    /**
     * Callback invoked when the authentication is enabled/disabled in the dropdown.
     * When enabled, ensures all sub-settings are enabled. When disabled, ensures all
     * sub-settings are disabled, and the password change UI is hidden. */
    #onAuthChanged() {
        const disableConfirmHolder = $$('#disableAuthHolder');
        const disableConfirmInput = $$('.authSubSetting', disableConfirmHolder);
        const value = +settingInput(ServerSettings.UseAuthentication).value;
        for (const setting of $('.authSubSetting')) {
            if (setting === disableConfirmInput) {
                continue;
            }

            if (setting.classList.contains('staticDisabledSetting')) {
                continue;
            }

            setting.classList.toggle('disabledSetting');

            $('input', setting).forEach(input => {
                if (value) {
                    input.removeAttribute('disabled');
                } else {
                    input.setAttribute('disabled', 1);
                }
            });
        }

        if (value) {
            if (this.#initialValues.authEnabled.value) {
                slideUp(disableConfirmHolder, 250, () => {
                    disableConfirmHolder.classList.add('hidden');
                });
            }
        } else {
            if (!$id(EleIds.ChangePassHolder).classList.contains('hidden')) {
                this.#showHidePasswordUpdate();
            }

            if (this.#initialValues.authEnabled.value) {
                // Disabling auth when previously enabled. Require password confirmation.
                disableConfirmHolder.classList.remove('hidden');
                const newHeight = disableConfirmHolder.getBoundingClientRect().height + 'px';
                slideDown(disableConfirmHolder, newHeight, 250);
            }
        }
    }

    /**
     * Ensures the 'new password' and 'confirm password' values are equal.
     * @param {Event} e */
    #onPassInputChanged(e) {
        const newPass = $id(EleIds.NewPass);
        const confPass = $id(EleIds.ConfPass);
        if (!confPass.value || newPass.value === confPass.value) {
            confPass.classList.remove('invalid');
            Tooltip.removeTooltip(e.target);
            if (confPass.value) {
                newPass.classList.add('valid');
                confPass.classList.add('valid');
            } else {
                newPass.classList.remove('valid');
                confPass.classList.remove('valid');
            }
        } else {
            newPass.classList.remove('valid');
            confPass.classList.remove('valid');
            confPass.classList.add('invalid');
            Tooltip.setTooltip(e.target, 'Passwords do not match.');
            if (document.activeElement === e.target) {
                e.target.blur();
                e.target.focus();
            }
        }
    }

    /**
     * Returns an element that is similar to a standard setting element, but without a tooltip or default value.
     * @param {string} title The title for the element
     * @param {string} id The element's ID
     * @param {function} [validate] The validation function. Defaults to `#validateSingle`
     * @param {string} [placeholder=''] The placeholder text, if any */
    #plainAuthInput(title, id, attributes, validate, placeholder='') {
        const validateFn = validate || this.#validateSingle.bind(this, ServerSettings.Password, true /*successBackground*/);
        const input = buildNode('input', { id : id, type : 'password', placeholder : placeholder }, 0, {
            change : this.#timedChangeListener(validateFn),
            keyup : this.#timedKeyupListener(validateFn),
            keydown : this.#inputKeydownListener.bind(this),
        });

        const outerAttributes = { ...attributes };
        if (outerAttributes.disabled) {
            input.setAttribute('disabled', 1);
            delete outerAttributes.disabled;
        }

        attributes.class = (attributes.class ? attributes.class + ' ' : '') + 'serverSetting stringSetting subSetting authSubSetting';

        return appendChildren(buildNode('div', attributes),
            appendChildren(buildNode('span', { class : 'serverSettingTitle' }),
                buildNode('label', { for : id }, title)
            ),
            appendChildren(buildNode('div'), input));
    }

    /**
     * Shows or hides the password change UI. */
    #showHidePasswordUpdate() {
        const holder = $id(EleIds.ChangePassHolder);
        if (holder.classList.contains('hidden')) {
            holder.classList.remove('hidden');
            slideDown(holder, holder.getBoundingClientRect().height + 'px', 250, () => {
                settingInput(ServerSettings.Password).value = 'Click to Cancel';
            });
        } else {
            slideUp(holder, 250, () => {
                holder.classList.add('hidden');
                settingInput(ServerSettings.Password).value = 'Click to Change';
            });
        }
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
     * @param {string} setting
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

        const subSetting = attributes.class && /\bsubSetting\b/.test(attributes.class);
        const icon = buildNode('i',
            { class : 'labelHelpIcon' },
            getSvgIcon(Icons.Help, ThemeColors.Primary, { height : subSetting ? 14 : 18 }));
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
     * @param {Event} _e
     * @param {HTMLInputElement} button */
    async #onApply(_e, button) {
        const newConfig = { ...this.#getConfigValues() };
        const authResult = await this.#preprocessAuthChanges(newConfig);
        if (authResult & AuthChangeResult.Failed) {
            flashBackground(button, Theme.getHex(ThemeColors.Red, 8), 2000);
            if (authResult & AuthChangeResult.PasswordChanged) {
                errorToast('Successfully updated password, but other changes were not applied.');
            }

            return;
        }

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
     * Apply (or set up) any auth related changes.
     * @param {SerializedConfig} newConfig */
    async #preprocessAuthChanges(newConfig) {
        // Process password changes first, as that's done outside of the standard config update routine.

        let result = AuthChangeResult.NoChanges;
        const passChangeVisible = !$id(EleIds.ChangePassHolder).classList.contains('hidden');
        /** @type {HTMLInputElement} */const oldP = $id(EleIds.OldPass);
        /** @type {HTMLInputElement} */const newP = $id(EleIds.NewPass);
        /** @type {HTMLInputElement} */const confP = $id(EleIds.ConfPass);
        const green = i => i.classList.contains('valid');
        if (passChangeVisible && this.#initialValues.authPassword.value !== null) { // Only consider if a previous password exists.
            if (oldP.value || newP.value || confP.value) {
                // All fields should be green
                if (!green(oldP) || !green(newP) || !green(confP)) {
                    errorToast('Cannot update password. Make sure the current password is correct, and ' +
                        'the new password and its confirmation are identical.');
                    return AuthChangeResult.Failed;
                }

                // Everything's green, try to change the password.
                // Note that we pass in the old username. Even if we're updating both the username and password,
                // update the username as a separate operation during the normal config update process.
                try {
                    await ServerCommands.changePassword(this.#val(this.#initialValues.authUsername), oldP.value, newP.value);
                    result = AuthChangeResult.PasswordChanged;
                } catch (err) {
                    errorToast(`Failed to update password: ${err.message}`);
                    return AuthChangeResult.Failed;
                }
            }
        }

        // Enabling/disabling authentication goes through the standard config. Use current client-side state
        // to make some assumptions about validity, but make sure everything's actually validated server-side

        const useAuth = this.#val(newConfig.authEnabled);
        const useAuthChanged = useAuth !== this.#val(this.#initialValues.authEnabled);
        if (useAuthChanged) {
            if (useAuth) {
                // Enabling auth. Verify that the username is set. If it is, the behavior then depends on
                // whether we're setting up auth for the first time (current password === null). If we are
                // setting up auth for the first time, ensure the new pass/confirm pass UI is visible and
                // valid. If we aren't setting up for the first time, just make sure the username is set.
                // Note that this isn't 100% reliable - we're relying on client-side validation that can
                // be manipulated by the user. I'm okay with this though, since the worst case scenario is
                // that the user forces us to enable auth without a valid username or password, in which
                // case they'll be immediately redirected to the login page and asked to supply a valid
                // username and password, which isn't the best user experience, but it's their own fault.
                if (!this.#val(newConfig.authUsername)) {
                    errorToast('Username and password must be set to enable authentication.', 5000);
                    return result | AuthChangeResult.Failed;
                }

                if (this.#initialValues[ServerSettings.Password].value === null) {
                    if (passChangeVisible && green(newP) && green(confP)) {
                        try {
                            await ServerCommands.changePassword(this.#val(newConfig[ServerSettings.Username]), '', newP.value);
                            return AuthChangeResult.PasswordChanged;
                        } catch (err) {
                            errorToast(
                                appendChildren(buildNode('div'),
                                    buildText('Failed to initialize authentication. Please try again later.'),
                                    buildNode('br'),
                                    buildNode('br'),
                                    buildText(`Error: ${err.message}`)
                                )
                            );

                            return result | AuthChangeResult.Failed;
                        }
                    } else {
                        errorToast(`Authentication has not been enabled before. ` +
                            `Please set a password in addition to a username`, 5000);
                        this.#showHidePasswordUpdate();
                        newP.classList.add('invalid');
                        confP.classList.add('invalid');
                        return result | AuthChangeResult.Failed;
                    }
                }

            } else if ($id(EleIds.DisableConf).classList.contains('valid')) {
                // Disabling auth, and we think the password is correct. Set the password
                // as a pseudo setting and let standard validation do its thing.
                newConfig[ServerSettings.Password] = {
                    value : $id(EleIds.DisableConf).value,
                    defaultValue : '',
                    isValid : true,
                };

                return result;
            } else {
                // Disabling auth, but password confirmation is not correct.
                errorToast(`Cannot disable authentication - password confirmation is invalid.`, 5000);
                return result | AuthChangeResult.Failed;
            }
        }

        // No auth changes
        return result;
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
            ServerSettings.UseAuthentication,
            ServerSettings.SessionTimeout,
            ServerSettings.AutoOpen,
            ServerSettings.ExtendedStats,
            ServerSettings.PreviewThumbnails,
            ServerSettings.FFmpegThumbnails,
        ]) {
            const input = settingInput(setting);
            /** @type {TypedSetting<any>} */
            const configSetting = config[setting];
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
                    const pvt = this.#val(config.previewThumbnails);
                    const ffmpegThumbs = pvt && this.#val(config.preciseThumbnails);
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
        const authChanged = this.#val(newConfig.authEnabled) !== this.#val(this.#initialValues.authEnabled)
            || (this.#val(newConfig.authEnabled)
                && this.#val(newConfig.authSessionTimeout) !== this.#val(this.#initialValues.authSessionTimeout));
        await flashBackground(button, Theme.getHex(ThemeColors.Green, 8), 1000);
        if (needsRedirect) {
            // Overlay refreshing
            Overlay.show(
                `Settings applied! The server needed to reboot to change the host and/or port, which ` +
                `may take a few moments. Press 'Reload' below to go to the new host/port.`,
                'Reload',
                () => { window.location.host = `${newHost}:${newPort}`; }
            );
        } else if (authChanged) {
            Overlay.show(
                `Settings applied! The server needs to reboot to change authentication options, which ` +
                `may take a few moments. Press 'Reload' below to refresh the page once the server has been rebooted.`,
                'Reload',
                () => { window.location = '/'; }
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
    #getConfigValues() {
        const values = {};

        // TODO: Is it worth considering cases where session timeout/username changes, but
        //       auth is also being disabled? For now, no.
        for (const setting of [
            ServerSettings.DataPath,
            ServerSettings.Database,
            ServerSettings.Host,
            ServerSettings.Port,
            ServerSettings.LogLevel,
            ServerSettings.UseAuthentication,
            ServerSettings.Username,
            ServerSettings.SessionTimeout,
            ServerSettings.AutoOpen,
            ServerSettings.ExtendedStats,
            ServerSettings.PreviewThumbnails,
            ServerSettings.FFmpegThumbnails,
            ServerSettings.PathMappings,
        ]) {
            values[setting] = this.#getCurrentConfigValue(setting);
        }

        return values;
    }

    /**
     * Get the current value for the given setting.
     * @param {string} setting
     * @returns {TypedSetting<any>} */
    #getCurrentConfigValue(setting) {
        let isNum = false;
        switch (setting) {
            case ServerSettings.Port:
            case ServerSettings.SessionTimeout:
                isNum = true;
                // __fallthrough
            case ServerSettings.DataPath:
            case ServerSettings.Database:
            case ServerSettings.Host:
            case ServerSettings.Username:
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
            case ServerSettings.UseAuthentication:
            case ServerSettings.AutoOpen:
            case ServerSettings.ExtendedStats:
            case ServerSettings.PreviewThumbnails:
            case ServerSettings.FFmpegThumbnails:
                return this.#getCurrentBooleanSetting(setting);
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
    #getCurrentBooleanSetting(setting) {
        /** @type {TypedSetting<boolean>} */
        const initialSetting = this.#initialValues[setting];
        if (!initialSetting) {
            throw new Error(`getCurrentBooleanSetting called with unknown setting "${setting}"`);
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
     * @param {boolean} successBackground Whether to highlight the background when the value is valid.
     *                                    Used for password confirmations
     * @param {Event} e */
    async #validateSingle(setting, successBackground, e) {
        try {
            /** @type {TypedSetting<any>} */
            const originalSetting = this.#initialValues[setting];

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
            if (successBackground) e.target.classList[validSetting.isValid ? 'add' : 'remove']('valid');
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
        await this.#validateSingle(ServerSettings.Port, false /*successBackground*/, e);
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
            return this.#validateSingle(ServerSettings.DataPath, false /*successBackground*/, e);
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
