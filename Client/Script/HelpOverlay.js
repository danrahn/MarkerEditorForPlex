import { $, $a, $append, $div, $h, $hr, $p } from './HtmlHelpers.js';
import { clickOnEnterCallback } from './Common.js';

import Overlay from './Overlay.js';

import { HelpSection, HelpSections } from './HelpSections.js';
import ButtonCreator from './ButtonCreator.js';
import { ThemeColors } from './ThemeColors.js';


// Only create once we actually need it, but only create it once.
/** @type {HTMLElement} */
let helpText;

const getText = () => helpText ??= $append(
    $div({ id : 'helpOverlayHolder' }),
    $append($div({ id : 'helpMain' }),
        $h(1, 'Welcome to Marker Editor for Plex'),
        $append($p(),
            'For full configuration and usage instructions, see the ',
            $a('wiki on GitHub', 'https://github.com/danrahn/MarkerEditorForPlex/wiki'))
    ),
    $hr(),
    HelpSections.Get(HelpSection.TimeInput),
    $hr(),
    HelpSections.Get(HelpSection.KeyboardNavigation),
    HelpSections.Get(HelpSection.Disclaimer),
    ButtonCreator.fullButton('OK', 'confirm', ThemeColors.Green, Overlay.dismiss, { class : 'okButton' })
);

class HelpOverlay {
    static #setup = false;
    static #btn = $('#helpContainer');
    static ShowHelpOverlay() {
        // Note: don't call HelpSections.Reset here, because we want to keep the
        // expand/collapsed state for the main help overlay.
        Overlay.build(
            {   closeButton : true,
                dismissible : true,
                forceFullscreen : true,
                focusBack : HelpOverlay.#btn
            }, getText());
    }

    static SetupHelperListeners() {
        if (HelpOverlay.#setup) {
            return;
        }

        HelpOverlay.#btn.addEventListener('click', HelpOverlay.ShowHelpOverlay);
        HelpOverlay.#btn.addEventListener('keydown', clickOnEnterCallback);
    }
}

export default HelpOverlay;
