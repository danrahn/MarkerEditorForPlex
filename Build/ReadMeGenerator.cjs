/**
 * Very simple README generator that takes a given 'recipe' and converts it into
 * a fixed-width document surrounded in a box.
 *
 * Completely unnecessary for its current use. This only exists because I was curious
 * about how easy this would be to create. */
class ReadMeGenerator {
    /** The maximum width of the README file (including formatting characters) */
    #width = 80;
    /** @type {string} */
    #blankLine;
    /** @type {string} */
    #lineBreak;

    /**
     * Initialize a new generator with the given maximum width, which defaults to 80 characters.
     * @param {number} width */
    constructor(width=80) {
        this.#width = width;
        this.#blankLine = `|${' '.repeat(this.#width - 2)}|`;
        this.#lineBreak = `+${'-'.repeat(this.#width - 2)}+`;
    }

    /**
     * Converts the given text to the fixed-width README.
     * Currently supported markers are:
     *  * `~`: Insert a line break (`+---...---+`)
     *  * `!`: Insert a blank line (`|   ...   |`)
     *  * `-:-{text}`: Insert centered text (`|   text   |`)
     *  * `||`: Continue from the previous line
     *  * `{text}!!#`: Inserts a normal text line. If there's overflow, indent
     *    subsequent lines # spaces. E.g. `LongText...!!3` would become:
     *    ```
     *    | LongText...  |
     *    |    Continued |
     *    ```
     * @param {string} recipe The text to convert */
    parse(recipe) {
        const lines = [];
        const split = recipe.split('\n');

        const merged = [];
        // First pass - merge any continuation lines ('||')
        for (const line of split) {
            if (line.startsWith('||')) {
                if (merged.length === 0) {
                    merged.push(line.substring(2));
                } else {
                    merged[merged.length - 1] += ' ' + line.substring(2);
                }

            } else {
                merged.push(line);
            }
        }

        for (let line of merged) {
            if (line === '') {
                continue;
            }

            if (line === '~') {
                lines.push(this.#lineBreak);
                continue;
            }

            if (line === '!') {
                lines.push(this.#blankLine);
                continue;
            }

            if (line.startsWith('-:-')) {
                lines.push(this.#textLine(line.substring(3), -1));
                continue;
            }

            if (line.startsWith('\\')) {
                if ((line.length > 1 && ['~', '!'].includes(line[1]))
                    || (line.length > 2 && ['||'].includes(line.substring(1, 3)))) {
                    line = line.substring(1);
                }
            }

            if (line.startsWith('\\') && line.length > 1 && ['~', '!'].includes(line[1])) {
                line = line.substring(1);
            }

            const match = /(?<content>.*)!!(?<indent>\d+)$/.exec(line);
            if (match) {
                lines.push(this.#textLine(match.groups.content, parseInt(match.groups.indent)));
            } else {
                lines.push(this.#textLine(line));
            }

        }

        return lines.join('\n') + '\n';
    }

    /**
     * Center the given text within the specified width.
     * @param {string} text */
    #centeredLine(text) {
        // If #textLine's poor splitting algorithm results in a line longer than the width, just return that
        if (text.length > this.#width - 4) {
            return `| ${text} |`;
        }

        const padLeft = ' '.repeat(this.#width / 2 - 1 - (text.length / 2) + (text.length % 2 === 1 ? 1 : 0));
        const padRight = ' '.repeat(this.#width / 2 - 1 - (text.length / 2));
        return `|${padLeft}${text}${padRight}|`;
    }

    /**
     * Format the given text line, breaking it down into multiple lines if
     * it's too long for the specified width.
     * @param {string} text
     * @param {number} indent The amount of spaces to indent subsequent lines that had to be split.
     *                        -1 indicates the text should be centered. */
    #textLine(text, indent=0) {
        const lines = [];
        if (text.length > this.#width - 4) {
            const words = text.split(' ');
            let tmp = '';
            for (const word of words) {
                if ((tmp + word + ' ').length > this.#width - 4) {
                    lines.push(tmp.trimEnd());
                    tmp = indent === -1 ? '' : ' '.repeat(indent);
                }

                tmp += word + ' ' + (word.length === 0 ? ' ' : '');
            }

            lines.push(tmp.trimEnd());
        } else {
            lines.push(text.trimEnd());
        }

        if (indent === -1) {
            return lines.map(line => this.#centeredLine(line)).join('\n');
        }

        return lines.map(line => `| ${line}${' '.repeat(this.#width - 3 - line.length)}|`).join('\n');
    }
}

module.exports = ReadMeGenerator;
