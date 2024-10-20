import { $, $$, $append, $table, $tbody, $td, $textInput, $thead, $tr } from '../HtmlHelpers.js';
import { errorMessage, errorToast } from '../ErrorHandling.js';
import { ServerSettings, Setting } from '/Shared/ServerConfig.js';
import ButtonCreator from '../ButtonCreator.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import Icons from '../Icons.js';
import { ServerCommands } from '../Commands.js';
import { settingId } from './ServerSettingsDialogHelper.js';
import { ThemeColors } from '../ThemeColors.js';
import Tooltip from '../Tooltip.js';
import { ValidationInputDelay } from './ServerSettingsDialogConstants.js';

const Log = ContextualLog.Create('PathMappings');

/**
 * Encapsulates the UI of the editable path mappings table in the server settings dialog.
 */
export class PathMappingsTable {
    /** @type {HTMLTableElement} */
    #table;
    /** @type {Setting<PathMapping[]>} */
    #initialValue;

    /** @type {number} */
    #keyupTimer;

    /**
     * @param {TypedSetting<PathMapping[]>} initialValue */
    constructor(initialValue) {
        this.#initialValue = new Setting().setFromSerialized(initialValue);
        this.build();
    }

    /**
     * Return the HTML table that holds the path mappings */
    table() { return this.#table; }

    /**
     * Build the path mappings table based on the initial mappings. */
    build() {
        const tbody = $tbody();
        const table = $append($table({ id : settingId(ServerSettings.PathMappings) }),
            $thead($append($tr(),
                $td('From'),
                $td('To'),
                $td(
                    ButtonCreator.iconButton(Icons.Delete, 'Delete all mappings', ThemeColors.Red, this.#onDeleteAllMappings.bind(this)),
                    { class : 'deleteMappingHeader' }))
            ),
            tbody
        );

        table.addEventListener('change', this.#onPathMappingsChanged.bind(this));


        const mappings = this.#initialValue.value();
        for (const mapping of mappings) {
            tbody.appendChild(this.#realPathMappingRow(mapping.from, mapping.to));
        }

        if (mappings.length === 0) {
            tbody.appendChild(this.#noPathMappingsRow());
        }

        tbody.appendChild($append($tr({ class : 'newMapping' }),
            $td(ButtonCreator.textButton('New Mapping', this.#onNewMapping.bind(this)), { colspan : 3 })
        ));

        this.#table = table;
    }

    /**
     * Return a "no path mappings" spanning table row. */
    #noPathMappingsRow() {
        return $tr('tr', { class : 'noPathMappings' }, $td('No path mappings', { colspan : 3 }));
    }

    /**
     * Return an editable path mapping row with the given initial values.
     * @param {string?} from
     * @param {string?} to */
    #realPathMappingRow(from=undefined, to=undefined) {
        const fromAttrib = {};
        const toAttrib = {};
        if (from) fromAttrib.value = from;
        if (to) toAttrib.value = to;

        /**
         * @type {() => void} */
        const autoValidate = function () {
            if (this.#keyupTimer) {
                clearTimeout(this.#keyupTimer);
            }

            this.#keyupTimer = setTimeout(this.#onPathMappingsChanged.bind(this), ValidationInputDelay);
        }.bind(this);

        return $append($tr({ class : 'realPathMapping' }),
            $td($textInput({ placeholder : 'Map from', ...fromAttrib }, { keyup : autoValidate })),
            $td($textInput({ placeholder : 'Map to', ...toAttrib }, { keyup : autoValidate })),
            $td(ButtonCreator.iconButton(Icons.Delete, 'Delete mapping', ThemeColors.Red, this.#onDeleteMapping.bind(this))),
        );
    }

    /**
     * Validates path mappings when a value changes.
     * TODO: I could be much smarter about this - no need to verify every path when a single value changes.
     * @param {Event} _e */
    async #onPathMappingsChanged(_e) {
        /** @type {HTMLTableRowElement[]} */
        const realMappings = Array.from($('.realPathMapping', this.#table));
        if (realMappings.length === 0) {
            this.#table.classList.remove('invalid');
            return;
        }

        $('td input', this.#table).forEach(td => {
            td.classList.remove('invalid');
            Tooltip.removeTooltip(td);
        });

        const newSetting = this.getCurrentPathMappings();

        try {
            const result = await ServerCommands.validateConfigValue(ServerSettings.PathMappings, JSON.stringify(newSetting));
            if (result.isValid) {
                Tooltip.removeTooltip(this.#table);
                return;
            }

            // pathMappings validation is the only response where we expect an encoded JSON response on error.
            /** @type {{ row: number, fromError?: string, toError?: string }[]} */
            let validationErrors;
            try {
                validationErrors = JSON.parse(result.invalidMessage);
            } catch (ex) {
                const message = `Could not validate path mappings - invalid request: "${result.invalidMessage}"`;
                errorToast(message, 5000);
                this.#table.classList.add('invalid');
                Tooltip.setTooltip(this.#table, message);
                return;
            }

            Log.assert(validationErrors.length <= realMappings.length);
            for (const validationError of validationErrors) {
                const row = realMappings[validationError.row];
                if (validationError.fromError) {
                    const fromInput = $$('input', row.children[0]);
                    Tooltip.setTooltip(fromInput, validationError.fromError);
                    fromInput.classList.add('invalid');
                    if (document.activeElement === fromInput) {
                        fromInput.blur();
                        fromInput.focus();
                    }
                }

                if (validationError.toError) {
                    const toInput = $$('input', row.children[1]);
                    Tooltip.setTooltip(toInput, validationError.toError);
                    toInput.classList.add('invalid');
                    if (document.activeElement === toInput) {
                        toInput.blur();
                        toInput.focus();
                    }
                }
            }
        } catch (ex) {
            errorToast(`Could not validate path mappings: ${errorMessage(ex)}`, 5000);
            this.#table.classList.add('invalid');
        }
    }

    /**
     * Return the current ~valid path mappings (has both 'from' and 'to' set, regardless if the paths exist).
     * @returns {TypedSetting<PathMapping[]>} */
    getCurrentPathMappings() {
        /** @type {HTMLTableRowElement[]} */
        const realMappings = Array.from($('.realPathMapping', this.#table) || []);
        const newMappings = [];
        for (const mapping of realMappings) {
            const fromValue = $$('input', mapping.children[0]).value;
            const toValue = $$('input', mapping.children[1]).value;
            if (fromValue && toValue) {
                newMappings.push({ from : fromValue, to : toValue });
            }
        }

        return {
            value : newMappings.length === 0 ? null : newMappings,
            defaultValue : [],
            isInvalid : false,
        };
    }

    /**
     * Delete the mapping that this row belongs to.
     * TODO: Ask for confirmation? Especially for #onDeleteAllMappings below.
     * @param {MouseEvent} _e
     * @param {HTMLElement} button */
    #onDeleteMapping(_e, button) {
        /** @type {HTMLTableRowElement} */
        const tr = button.parentElement.parentElement;
        if (!(tr instanceof HTMLTableRowElement)) {
            Log.warn(`Expected button's parent to be a table row, but it wasn't. ` +
                `We probably aren't going to do the right thing.`);
        }

        Tooltip.dismiss();
        const tbody = tr.parentElement;
        tbody.removeChild(tr);
        if (tbody.childNodes.length === 1) {
            tbody.insertBefore(this.#noPathMappingsRow(), tbody.lastChild);
        }
    }

    /**
     * Delete all existing path mappings.
     * @param {MouseEvent} _e
     * @param {HTMLElement} _button */
    #onDeleteAllMappings(_e, _button) {

        /** @type {NodeListOf<DOMString>} */
        const allPaths = $('.realPathMapping', this.#table);
        allPaths.forEach(tr => {
            tr.parentElement.removeChild(tr);
        });

        if (allPaths.length !== 0) {
            const tbody = $$('tbody', this.#table);
            tbody.insertBefore(this.#noPathMappingsRow(), tbody.lastChild);
        }
    }

    /**
     * Add a new path mapping row.
     * @param {MouseEvent} _e
     * @param {HTMLElement} _button */
    #onNewMapping(_e, _button) {
        const tbody = $$('tbody', this.#table);
        const npm = $$('.noPathMappings', tbody);
        if (npm) {
            npm.parentElement.removeChild(npm);
        }

        const newRow = this.#realPathMappingRow();
        tbody.insertBefore(newRow, tbody.lastChild);
        $$('input', newRow)?.focus();
    }
}
