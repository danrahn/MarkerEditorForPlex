import { $$, $a, $append, $p, $span } from '../HtmlHelpers.js';
import { BaseLog } from '/Shared/ConsoleLog.js';
import ButtonCreator from '../ButtonCreator.js';
import Icons from '../Icons.js';
import Overlay from '../Overlay.js';
import { ServerCommands } from '../Commands.js';
import { ServerConfigState } from '/Shared/ServerConfig.js';
import { ThemeColors } from '../ThemeColors.js';

/** Retrieve the HTML element id associated with the given setting */
export function settingId(setting, extra=null) {
    return `setting_${setting}` + (extra ? `_${extra}` : '');
}

/**
 * Retrieve the input element for the given setting.
 * @param {string} setting The ServerSettings value
 * @param {string?} extra Any extra data to append to the settings (e.g. "dark" for the log level dark mode toggle)
 * @returns {HTMLInputElement|HTMLSelectElement}*/
export function settingInput(setting, extra=null) {
    return $$(`#${settingId(setting, extra)}`);
}

/**
 * Retrieve the setting's top-level DIV container.
 * @param {string|HTMLElement} setting
 * @param {string?} extra Any extra data to append to the setting. */
export function settingHolder(setting, extra=null) {
    const input = typeof setting === 'string' ? settingInput(setting, extra) : setting;
    if (!input) { return input; }

    let parent = input;
    while (parent && !parent.classList.contains('serverSetting')) {
        parent = parent.parentElement;
    }

    return parent;
}

/**
 * Return the title and description for this dialog, as the intent differs
 * depending on the current state of the config file.
 * @param {ServerConfigState} state
 * @returns {[string, HTMLElement]} */
export function settingsDialogIntro(state) {
    const footer = $append($p(),
        `For more details about a setting, hover over the question mark icon, or visit `,
        $a('the configuration wiki', 'https://github.com/danrahn/MarkerEditorForPlex/wiki/configuration'),
        '.'
    );

    switch (state) {
        case ServerConfigState.Valid:
            return ['Server Settings', footer];
        case ServerConfigState.DoesNotExist:
            return ['Marker Editor Setup', $append($span(),
                $p(`Welcome to Marker Editor! It looks like you don't have a configuration file set up yet. ` +
                    `Please adjust the values below to your liking. If a value isn't provided, the default value listed will be used.`),
                footer)
            ];
        case ServerConfigState.Invalid:
            return ['Marker Editor Setup', $append($span(),
                $p('It looks like one or more values in config.json are no longer valid. Please correct them ' +
                'below before continuing.'),
                footer)
            ];
        default:
            throw new Error(`Unexpected config state in ServerSettingsDialog`);
    }
}

/**
 * Shut down the server when the user asks to do it. */
function onShutdown() {
    BaseLog.warn('First run setup not completed, user requested shutdown.');
    ServerCommands.shutdown();
    Overlay.show('Setup aborted, application is shutting down', 'Close Window', window.close, false /*dismissible*/);
}

/**
 * Retrieve any extra buttons to add to the bottom of the dialog, based on the current config state. */
export function buttonsFromConfigState(state) {
    const shutdown = ButtonCreator.fullButton('Shut Down', Icons.Cancel, ThemeColors.Red, onShutdown);
    switch (state) {
        case ServerConfigState.Valid:
            return [ButtonCreator.fullButton('Cancel', Icons.Cancel, ThemeColors.Red, Overlay.dismiss)];
        case ServerConfigState.DoesNotExist:
            return [shutdown];
        case ServerConfigState.Invalid:
            return [shutdown];
        default:
            throw new Error(`Unexpected config state in ServerSettingsDialog`);
    }
}
