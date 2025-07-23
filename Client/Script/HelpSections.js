import { $, $$, $append, $br, $code, $div, $h, $li, $p, $span, $sup, $table, $tbody, $td, $th, $thead, $tr, $ul,
    toggleClass } from './HtmlHelpers.js';
import { slideDown, slideUp } from './AnimationHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import Overlay from './Overlay.js';
import { ThemeColors } from './ThemeColors.js';

const Log = ContextualLog.Create('HelpSections');

/**
 * All possible help sections.
 * @enum */
export const HelpSection = {
    /** @readonly A group that contains both the time input methods and shortcuts. */
    TimeInput : 1,
    /** @readonly Describes different ways to enter a timestamp. */
    TimeInputMethods : 2,
    /** @readonly Describes keyboard shortcuts for time input. */
    TimeInputShortcuts : 3,
    /** @readonly A group that contains both marker table and base item navigation tables. */
    KeyboardNavigation : 4,
    /** @readonly A table of navigation keys when a marker table has focus. */
    MarkerTableFocusNavigation : 5,
    /** @readonly A table of navigation keys when a base item (or show/season) has focus. */
    BaseItemRowFocusShortcuts : 6,
    /** @readonly A small disclaimer absolving me of blame. */
    Disclaimer : 7,
};

/**
 * Cache of help UI that has already been built, so we don't have
 * to recreate everything from scratch every time.
 * @type {[key: number]: HTMLElement} */
const cached = {};

/**
 * Map help sections to the functions that build them. */
const builders = {
    [HelpSection.KeyboardNavigation] : buildKeyboardNav,
    [HelpSection.MarkerTableFocusNavigation] : buildMarkerTableNav,
    [HelpSection.BaseItemRowFocusShortcuts] : buildBaseItemNav,
    [HelpSection.Disclaimer] : buildDisclaimer,
    [HelpSection.TimeInput] : buildTimeInputHelp,
    [HelpSection.TimeInputMethods] : buildTimeInputMethods,
    [HelpSection.TimeInputShortcuts] : buildTimeInputShortcuts,
};

/*
 * A class that manages the creation and retrieval of help sections.
 */
export class HelpSections {
    static Get(section) {
        if (!cached[section]) Log.verbose(`Building help section ${section}`);
        return cached[section] ??= builders[section]();
    }

    /**
     * Resets all help sections to their default collapsed state.
     * This is necessary because the state is sticky due to our caching. */
    static Reset() {
        for (const section of Object.values(cached)) {
            for (const icon of $('.expandIcon', section)) {
                expandContract(icon, true /*contract*/);
            }
        }
    }

    /**
     * Expand or contract a specific help section.
     * @param {string} section
     * @param {boolean} collapse */
    static ExpandCollapse(section, collapse=true) {
        cached[section] ??= HelpSections.Get(section);
        const icon = $$('.expandIcon', cached[section]);
        expandContract(icon, collapse);
    }
}

/**
 * Adds a reference (or references) to a table cell.
 * @param {string|HTMLElement} text
 * @param {number[]} refs */
function addRef(text, ...refs) {
    const prefix = text instanceof Element ? $append(text, ' ') : text + ' ';
    return $append($span(), prefix, ...refs.map(ref => $sup(`[${ref}]`)));
}

/**
 * Adds a reference row for each note in notes, referred to by items created via addRef.
 * @param {HTMLTableSectionElement} tbody
 * @param {string[]} notes
 * @param {number} colspan */
function getRefRows(colspan, ...notes) {
    let i = 0;
    return notes.map(note => $append($tr(),
        $td($append($span(`[${++i}]: `), note), { class : 'noteRow', colspan : colspan })
    ));
}

/**
 * Navigate to the next available help section when the user presses the up or down arrow keys.
 * @param {KeyboardEvent} e */
function nextSection(e) {
    // Assumes we only show help via an overlay
    const allSections = Array.from($('.helpSubsection', Overlay.get()));
    const up = e.key === 'ArrowUp';
    let thisSection = e.target;
    while (thisSection && !thisSection.classList.contains('helpSubsection')) {
        thisSection = thisSection.parentElement;
    }

    if (!thisSection) {
        return;
    }

    const index = allSections.indexOf(thisSection);
    if (index === -1) {
        return;
    }

    const nextIndex = up ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= allSections.length) {
        return;
    }

    $$('.expandableHeader', allSections[nextIndex])?.focus();
}

const navKeys = new Set([' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Handles potential keyboard navigation for help section headers.
 * @param {KeyboardEvent} e */
function expandContractKey(e) {
    if (!navKeys.has(e.key)) {
        return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        return nextSection(e);
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        return expandContract(e.target, e.key === 'ArrowLeft');
    }

    expandContract(e.target);
}

/**
 * @param {MouseEvent} e */
function expandContractClick(e)  {
    if (e.ctrlKey) {
        const thisCollapsed = $$('.expandIcon', e.target).classList.contains('collapsed');
        const targets = $('.expandIcon', Overlay.get());
        for (const target of targets) {
            expandContract(target, !thisCollapsed);
        }
    } else {
        expandContract(e.target);
    }
}

/**
 * Expands or contracts the collapsible content associated with the given target.
 * @param {EventTarget|HTMLElement} target
 * @param {boolean|null} collapse Whether to collapse or expand the section. null if it should be toggled. */
function expandContract(target, collapse=null) {
    let header = target;
    while (header && !header.classList.contains('expandableHeader')) {
        header = header.parentElement;
    }

    if (!header) {
        return;
    }

    const icon = $$('.expandIcon', header);
    const isCollapsed = icon.classList.contains('collapsed');
    if (collapse !== null && collapse === isCollapsed) {
        return;
    }

    toggleClass(icon, 'collapsed', !isCollapsed);

    let subsection = header;
    while (subsection && !subsection.classList.contains('helpSubsection')) {
        subsection = subsection.parentElement;
    }

    if (!subsection) {
        return;
    }

    const expandables = $(':scope > .expandable', subsection);
    for (const expandable of expandables) {
        expandable.classList.remove('hidden');
        const height = expandable.getBoundingClientRect().height;
        const duration = Math.max(200, Math.min(height * 0.7, 700));
        if (isCollapsed) {
            slideDown(expandable, height + 'px', duration);
        } else {
            slideUp(expandable, duration, () => expandable.classList.add('hidden'));
        }
    }
}

/**
 * Creates a help section with a header that will expand/collapse the associated content.
 * @param {string} text The header text
 * @param {number} hLevel The heading level (1-7) */
function getExpandableHeader(text, hLevel=3) {
    return $h(hLevel,
        $append($span(),
            getSvgIcon(Icons.Arrow, ThemeColors.Primary, { class : 'expandIcon collapsed' }),
            text),
        { class : 'expandableHeader noSelect', tabindex : 0 },
        { click : expandContractClick, keyup : expandContractKey }
    );
}

/** @typedef {{ hLevel: number, justify: boolean }} CollapsableSectionOptions */

/**
 * @param {string} title
 * @param {CollapsableSectionOptions} options
 * @param {{[attribute: string]: string}} attributes
 * @param  {...(Element|string)} children */
function getCollapsableSection(title, options, attributes={}, ...children) {
    const holder = $div(attributes);
    holder.classList.add('helpSubsection');

    const justify = options.justify || false;
    return $append(
        holder,
        getExpandableHeader(title, options.hLevel),
        $append($div({ class : 'expandable hidden' + (justify ? ' justify' : '') }), ...children),
    );

}

/**
 * Create a row of header or standard table cells
 * @param {$td|$th} fn
 * @param {string|HTMLElement|[string|HTMLElement, Object]} cells */
const createRowCore = (fn, ...cells) =>
    $append($tr(), ...cells.map(cell => cell instanceof Array ? fn(cell[0], cell[1]) : fn(cell)));

/**
 * Create a row of standard table cells
 * @type {(cells: string|HTMLElement|[string|HTMLElement, Object]) => HTMLTableRowElement} */
const createRow = (...cells) => createRowCore($td, ...cells);

/**
 * Create a row of header table cells
 * @type {(cells: string|[string|HTMLElement, Object]) => HTMLTableRowElement} */
const createHeaderRow = (...cells) => createRowCore($th, ...cells);

/**
 * Create a table with the given attributes, header rows, and body rows.
 * @param {{[attribute: string]: string}} attributes
 * @param {(string|HTMLElement)[]} headerRows
 * @param {...(string|HTMLElement)} bodyRows
 * @returns {HTMLTableElement} */
function buildTable(attributes, headerRows, ...bodyRows) {
    const table = $table(attributes);
    const thead = $thead();
    const tbody = $tbody();

    $append(thead, ...headerRows);
    $append(tbody, ...bodyRows);

    return $append(table, thead, tbody);
}

/**
 * Creates a help section that combines the two inner sections for keyboard navigation. */
function buildKeyboardNav() {
    return $append(
        $div({ class : 'helpSection' }),
        $h(2, 'Keyboard Navigation'),
        HelpSections.Get(HelpSection.MarkerTableFocusNavigation),
        HelpSections.Get(HelpSection.BaseItemRowFocusShortcuts),
    );
}

/**
 * Creates the help section for marker table keyboard navigation. */
function buildMarkerTableNav() {

    const notes = [
        'If a dropdown is focused, goes to the next/previous row, as normal up/down changes the selected option.',
        'Visible marker table.',
    ];

    const table = buildTable({ class : 'helpTable wideHelpTable' },
        [
            createHeaderRow(['Base Key', { rowspan : 2 }], ['Modifier(s)', { colspan : 6 }]),
            createHeaderRow('None', 'Ctrl', 'Alt', 'Shift', 'Ctrl+Shift', 'Ctrl+Alt+Shift'),
        ],
        createRow('ArrowUp',
            'Previous row or base item',
            addRef('First table row', 1),
            'Previous base row',
            addRef('Previous table', 2),
            'First focusable item',
            addRef('First table', 2)),
        createRow('ArrowDown',
            'Next row or base item',
            addRef('Last table row', 1),
            'Next base row',
            addRef('Next table', 2),
            'Last focusable item',
            addRef('Last table', 2)),
        createRow('ArrowLeft', 'Previous row input', 'First row input'),
        createRow('ArrowRight', 'Next row input', 'Last row input'),
        ...getRefRows(7, ...notes)
    );

    return getCollapsableSection(
        'Marker Table Navigation',
        { hLevel : 3 },
        { class : 'helpTableHolder wideHelpTableHolder' },
        $div({ class : 'helpTableDescription' }, 'Navigation keys when a marker table is focused.'),
        table
    );
}

/**
 * Creates the help section for base item row navigation. */
function buildBaseItemNav() {
    const notes = [
        `Previous/next navigable item. It could be the last row of the previous base item's marker table, ` +
                 `a bulk action, or another movie/episode row.`,
        `Also applies when a show/season is focused.`,
        `Does not include header rows like section options, bulk actions, and 'back to seasons/results'.`,
        'Visible marker table.',
    ];

    const table = buildTable({ class : 'helpTable' },
        [
            createHeaderRow(['Base Key', { rowspan : 2 }], ['Modifier(s)', { colspan : 5 }]),
            createHeaderRow('None', 'Ctrl', 'Alt', 'Shift', 'Ctrl+Shift'),
        ],
        createRow('ArrowUp',
            addRef('Previous item', 1, 2),
            addRef('First item', 2, 3),
            addRef('Previous marker table', 4),
            addRef('Previous item', 2),
            'First focusable item'),
        createRow('ArrowDown',
            addRef('Next item', 1, 2),
            addRef('Last item', 2),
            addRef('Next marker table', 4),
            addRef('Next item', 2),
            'Last focusable item'),
        createRow('ArrowLeft', 'Hide marker table', 'Hide all marker tables'),
        createRow('ArrowRight', 'Show marker table', 'Show all marker tables'),
        ...getRefRows(6, ...notes)
    );

    return getCollapsableSection(
        'Base Item Row Navigation',
        { hLevel : 3 },
        { class : 'helpTableHolder wideHelpTableHolder' },
        $div({ class : 'helpTableDescription' }, 'Navigation keys when a base item row is focused.'),
        table,
    );
}

/**
 * Creates the disclaimer section for the main help page. */
function buildDisclaimer() {
    const disclaimer = $p(`
        This application interacts directly with your Plex database in a way that is not officially supported. While it should
        be safe to perform various create/update/delete actions, there are no guarantees that it won't break things now or in
        the future. The author is not responsible for any database corruption that may occur; use at your own risk.`,
    { style : 'margin-top:0;margin-bottom:0;padding-bottom:16px' }); // Margin messes with animations, replace with padding.
    return getCollapsableSection('Disclaimer', { hLevel : 4 }, { id : 'helpDisclaimer', class : 'themeIconOrange' }, disclaimer);
}

/**
 * Creates the help section for time input help, combining the two inner time input help sections. */
function buildTimeInputHelp() {
    return $append(
        $div({ class : 'helpSection' }),
        $h(2, 'Entering Timestamps'),
        HelpSections.Get(HelpSection.TimeInputMethods),
        HelpSections.Get(HelpSection.TimeInputShortcuts),
    );
}

/**
 * Creates the help section for time input methods (plain vs. expression syntax). */
function buildTimeInputMethods() {
    const mainText = `
        There are multiple ways to enter a timestamp in the time input fields. The simplest forms are using plain milliseconds, or
        hh:mm:ss.000 (hours, minutes, seconds, and thousandths of a second). Timestamps can also be negative, indicating an offset
        from the end of the media item. The following are all valid timestamps:`;

    /* eslint-disable quote-props */
    const examples = {
        '12345'    : '12.345 seconds',
        '1.2'      : '1.2 seconds (1200ms)',
        '1:00'     : '1 minute',
        '1:00.005' : '1 minute, 5ms',
        '90:00'    : '1 hour, 30 minutes',
        '1:30:00'  : '1 hour, 30 minutes',
        '-0'       : 'End of the video',
        '-1:00'    : '1 minute from the end',
    };
    /* eslint-enable quote-props */

    const planExampleTable = buildTable({ class : 'helpTable helpTableSmaller' },
        [
            createHeaderRow('Timestamp', 'Description'),
        ],
        ...Object.entries(examples).map(([key, value]) => createRow($code(key), value))
    );

    const expressionText = `
        In addition to the above, you can use also use expression syntax to calculate a timestamp.
        Expressions start with a '=', and can include:`;

    /** @typedef {{ syntax: string, meaning: string, description: string }} ExpressionDescription */
    /** @type {(syntax: string, meaning: string, description: string) => ExpressionDescription} */
    const expPart = (syntax, meaning, description) => ({ syntax, meaning, description });
    const expressionSyntax = [
        expPart('M@', 'Marker type', `Must directly follow the '=', and is only allowed for start timestamps. ` +
                'M is the marker type, and must be I (intro) C (credits) or A (ad). Case-sensitive.'),
        expPart('MNL', 'Marker reference', 'Reference an existing marker of type M (M for any, or I, C, or A), at ' +
                'index N (1-based, can be negative to count from the end), and location L (S for start, E for end). ' +
                'If L is omitted, it defaults to E for start markers and S for end markers (to help avoid overlap).'),
        expPart('ChNL', 'Chapter reference', 'Reference a chapter by index N, (starting at 1, can also be negative) at location ' +
                'L (S for start, E for end). If L is omitted, defaults to S for start timestamps and E for end timestamps.'),
        expPart('Ch(Name)', 'Chapter name reference', 'Reference a chapter by name. The name must be enclosed in parentheses, ' +
                `is case-insensitive, and must describe the full chapter name (E.g. '=Ch(Chap)' does not match 'Chapter'). ` +
                `Also supports wildcards * (0 or more characters) and ? (exactly one character).`),
        expPart('Ch(/regex/[i])', 'Chapter regex reference', 'Reference a chapter by name using a regular expression. By default the ' +
                'expression is case-sensitive, but the i flag can be added to make it case-insensitive.'),
        expPart('hh:mm:ss.000', 'Timestamp', 'A standard timestamp.'),
        expPart('ms', 'Milliseconds', 'A number of milliseconds.'),
    ];

    const expressionSyntaxList = $append($ul({ class : 'codeStart' }),
        ...expressionSyntax.map(exp =>
            $append($li(),
                $code(exp.syntax),
                $span(` - ${exp.meaning}: ${exp.description}`, { class : 'syntaxDescription' }))));

    const expressionExampleText = `With that, all of the following are valid expressions:`;

    const expressionExamples = {
        '=I1S'            : 'Start of the first intro marker.',
        '=M-1'            : 'The last marker, with an inferred start/end.',
        '=Ch1E'           : 'End of the first chapter.',
        '=Ch(Chapter 1)S' : 'Start of the chapter named "Chapter 1".',
        '=Ch(op*)'        : 'A chapter that starts with "op" (case-insensitive).',
        '=Ch(/^op/i)'     : `A chapter that starts with 'op' (case-insensitive).`,
        '=Ch(/Preview/)S' : `The start of a chapter that contains 'Preview' (case-sensitive).`,
        '=C@Ch-1S + 1:00' : 'Create a credits marker 1 minute after the start of the last chapter.',
        '=1:00'           : '1 minute.',
        '=60000'          : '1 minute.',
    };

    const expressionExampleTable = buildTable({ class : 'helpTable helpTableSmaller' },
        [
            createHeaderRow('Expression', 'Description'),
        ],
        ...Object.entries(expressionExamples).map(([key, value]) => createRow($code(key), value))
    );

    const expressionLimitsText = `However, there are some limitations to expressions. You cannot:`;
    const expressionLimits = [
        $append($span(), 'Have more than one marker or chapter reference in an expression - ', $code('=M1+M2'), ', ',
            $code('=Ch1+Ch2'), ', and ', $code('=M1+Ch1'), ' are not valid.'),
        $append($span(), 'Subtract marker/chapter references - ', $code('=1:00-M1'), ' is not valid.'),
        $append($span(), `Create a negative timestamp if there's a marker/chapter reference. If chapter 1 starts at 0, `,
            $code('=Ch1S-1:00'), ' is not valid. However, ', $code('=-1:00'), ' is valid, as there are no references.'),
    ];

    const expressionLimitsList = $append($ul(),
        ...expressionLimits.map(limit => $append($li({ class : 'syntaxDescription' }), limit)));

    return getCollapsableSection(
        'Time Input Methods',
        { hLevel : 3, justify : true },
        { class : 'helpTableHolder', id : 'timeInputMethods' },
        mainText,
        planExampleTable,
        getCollapsableSection(
            'Complex Expressions',
            { hLevel : 4, justify : true },
            { class : 'helpTableHolder', id : 'expressionSyntax' },
            expressionText,
            expressionSyntaxList,
            expressionExampleText,
            expressionExampleTable,
            expressionLimitsText,
            expressionLimitsList,
        ),
    );
}

/**
 * Creates the help section for time input keyboard shortcuts. */
function buildTimeInputShortcuts() {
    const desc = `When in a time input, the following shortcuts are available to help you quickly adjust a timestamp:`;

    const notes = [
        $append($span(), 'Due to input overlap, when in expression mode (', $code('='), ' at the start), ',
            $code('-'), ' and ', $code('='), ' are replaced with ', $code('o'), ' and ', $code('p'), '.'),
    ];

    const keySpan = (ch1, ch2) =>
        $append($span(), $code(ch1, { class : 'obviousCode' }), '/', $code(ch2, { class : 'obviousCode' }));

    const mainTable = buildTable({ class : 'helpTable' },
        [
            createHeaderRow(['Key', { rowspan : 2 }], ['Description', { rowspan : 2 }], ['Modifier(s)', { colspan : 3 }]),
            createHeaderRow('Shift', 'Alt', 'Alt+Shift'),
        ],
        createRow(addRef(keySpan('=', '+'), 1),   '+10 seconds',  '+60 seconds', '+50 seconds', '+5 minutes'),
        createRow(addRef(keySpan('-', '_'), 1),   '-10 seconds',  '-60 seconds', '-50 seconds', '-5 minutes'),
        createRow(keySpan(']', '}'),                '+1 second', '+0.1 seconds',  '+5 seconds', '+0.5 seconds'),
        createRow(keySpan('[', '{'),                '-1 second', '-0.1 seconds',  '-5 seconds', '-0.5 seconds'),
        createRow(keySpan('\\', '|'), 'Round to nearest second',  'nearest 0.1',   'nearest 5', 'nearest 0.5'),
        ...getRefRows(5, ...notes),
    );

    const c = text => $code(text, { class : 'topAligned' });

    const shortcutDescription = $append($div(), 'The main idea is that ',
        $code('+'), ' and ', $code('-'), ` are the "big" modifiers, and `, $code('Shift'), ' makes them bigger. Similarly, ',
        c('['), ' and ', c(']'), ` are the "small" modifiers, and `, $code('Shift'), ' makes them smaller. ',
        $code('Alt'), ' always multiplies by 5.');

    const markerTableOnlyText = `In addition to the above shortcuts, the following are also available when editing ` +
        `a marker in a marker table (i.e. when not in a bulk action):`;

    const markerTableOnlyShortcuts = buildTable({ class : 'helpTable' },
        [
            createHeaderRow('Key', 'Action'),
        ],
        createRow($code('i'), 'Switch to an Intro marker'),
        createRow($code('c'), 'Switch to a Credits marker'),
        createRow($code('a'), 'Switch to an Ad marker'),
        createRow($code('t'), 'Show/hide thumbnails (if enabled)'),
    );

    return getCollapsableSection(
        'Time Input Shortcuts',
        { hLevel : 3, justify : true },
        { class : 'helpTableHolder', id : 'timeInputMethods' },
        desc,
        mainTable,
        shortcutDescription,
        $br(),
        markerTableOnlyText,
        markerTableOnlyShortcuts
    );
}
