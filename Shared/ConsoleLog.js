import WindowProxy from './WindowProxy.js';

/**
 * Console logging class. Allows easy timestamped logging with various log levels.
 *
 * Because this class is used on almost every page, some additional manual minification
 * has been done to reduce its overall size. Nothing like unnecessary micro-optimizations!
 *
 * Taken and tweaked from PlexWeb/script/consolelog.js
 * @class
 * @param {Window} [window] The document window, if any. Because this class is used both
 * client- and server-side, this will be empty server-side, but contain the document
 * window client-side.
 */
class ConsoleLog {
    /**
     * Possible log levels, from most to least verbose
     * @readonly
     * @enum {number} */
    static Level = {
        Invalid  : -1,
        Extreme  : 0,
        TMI      : 1,
        Verbose  : 2,
        Info     : 3,
        Warn     : 4,
        Error    : 5,
        Critical : 6,
    };

    /**
     * Get the string representation of the given log level.
     * @param {number} level */
    static LevelString(level) {
        if (level < ConsoleLog.Level.Extreme || level > ConsoleLog.Level.Critical) {
            return '[UNKNOWN]';
        }

        return Object.entries(ConsoleLog.Level).sort((a, b) => a[1] - b[1])[level + 1][0];
    }

    /** Display strings for each log {@linkcode Level} */
    static #logStrings = ['EXTREME', 'TMI', 'VERBOSE', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];

    /** Spacing for more readable logs. Also includes formatted brackets for over-optimization. */
    static #formattedLogStrings = [
        '[%cEXTREME%c]',
        '[%cTMI    %c]',
        '[%cVERBOSE%c]',
        '[%cINFO   %c]',
        '[%cWARN   %c]',
        '[%cERROR  %c]',
        '[%cCRITICAL%c]'];

    /** Console color definitions for each log {@linkcode Level} */
    static #consoleColors = [
        // Light Title, Dark Title, Light Text, Dark Text
        ['#009900', '#006600', '#AAA', '#888'],
        ['#00CC00', '#00AA00', '#AAA', '#888'],
        ['#c661e8', '#c661e8', 'inherit', 'inherit'],
        ['blue', '#88C', 'inherit', 'inherit'],
        ['E50', '#C40', 'inherit', 'inherit'],
        ['inherit', 'inherit', 'inherit', 'inherit'],
        ['inherit; font-size: 2em', 'inherit; font-size: 2em', '#800; font-size: 2em', '#C33; font-size: 2em'],
    ];

    /** Trace color definitions for each log level. */
    static #traceColors = [
        ConsoleLog.#consoleColors[0],
        ConsoleLog.#consoleColors[1],
        ConsoleLog.#consoleColors[2],
        ConsoleLog.#consoleColors[3],
        [
            '#E50; background: #FFFBE5',
            '#C40; background: #332B00',
            'inherit; background: #FFFBE5',
            '#DFC185; background: #332B00'
        ],
        [
            'red; background: #FEF0EF',
            '#D76868; background: #290000',
            'red; background: #FEF0EF',
            '#D76868; background: #290000'
        ],
        [
            'red; font-size: 2em',
            'red; font-size: 2em',
            '#800; font-size: 2em',
            '#C33; font-size: 2em'
        ],
    ];

    /** The current log level. Anything below this will not be logged.
     * @type {Level} */
    static #currentLogLevel;

    /** Determine whether we should add a trace to every log event, not just errors.
     * @type {number} */
    static #traceLogging;

    /** Tweak colors a bit based on whether the user is using a dark console theme.
     * @type {number} 0 for light, 1 for dark. */
    static #darkConsole;

    static BaseSetup() {

        /** The current log level. Anything below this will not be logged. */
        ConsoleLog.#currentLogLevel = parseInt(WindowProxy.localStorage.getItem('loglevel'));
        if (isNaN(ConsoleLog.#currentLogLevel)) {
            ConsoleLog.#currentLogLevel = ConsoleLog.Level.Info;
        }

        /** Determine whether we should add a trace to every log event, not just errors. */
        ConsoleLog.#traceLogging = parseInt(WindowProxy.localStorage.getItem('logtrace'));
        if (isNaN(ConsoleLog.#traceLogging)) {
            ConsoleLog.#traceLogging = 0;
        }

        /** Tweak colors a bit based on whether the user is using a dark console theme */
        ConsoleLog.#darkConsole = parseInt(WindowProxy.localStorage.getItem('darkconsole'));
        if (isNaN(ConsoleLog.#darkConsole)) {
            // Default to system browser theme (if available)
            let mediaMatch = WindowProxy.matchMedia('(prefers-color-scheme: dark)');
            mediaMatch = mediaMatch !== 'not all' && mediaMatch.matches;
            ConsoleLog.#darkConsole = mediaMatch ? 1 : 0;
        }
    }

    constructor() {
        // Ensure our core log has been initialized.
        if ((this instanceof ContextualLog) && !WindowProxy) {
            console.error(
                `[${ConsoleLog.#getTimestring()}][ERROR  ] ` +
                `ContextualLog initialized before BaseLog. That shouldn't happen!`);
        }
    }

    /** Test ConsoleLog by outputting content for each log level */
    testConsolelog() {
        const old = ConsoleLog.#currentLogLevel;
        this.setLevel(-1);
        this.tmi('TMI!');
        this.setLevel(0);
        this.verbose('Verbose!');
        this.info('Info!');
        this.warn('Warn!');
        this.error('Error!');
        this.critical('Crit!');
        this.formattedText(
            ConsoleLog.Level.Info,
            '%cFormatted%c,%c Text!%c', 'color: green', 'color: red', 'color: orange', 'color: inherit');
        this.setLevel(old);
    }

    /**
     * Sets the new minimum logging severity.
     * @param {Level} level The new log level. */
    setLevel(level) {
        WindowProxy.localStorage.setItem('loglevel', level);
        ConsoleLog.#currentLogLevel = level;
    }

    /**
     * @returns The current minimum logging severity. */
    getLevel() {
        return ConsoleLog.#currentLogLevel;
    }

    /**
     * Set text to be better suited for dark versus light backgrounds.
     * @param {number} dark `1` to adjust colors for dark consoles, `0` for light. */
    setDarkConsole(dark) {
        WindowProxy.localStorage.setItem('darkconsole', dark);
        ConsoleLog.#darkConsole = dark ? 1 : 0;
    }

    /** @returns Whether the current color scheme is best suited for dark consoles. */
    getDarkConsole() {
        return ConsoleLog.#darkConsole;
    }

    /**
     * Set whether to print stack traces for each log. Helpful when debugging.
     * @param {number} trace `1` to enable trace logging, `0` otherwise. */
    setTrace(trace) {
        WindowProxy.localStorage.setItem('logtrace', trace);
        ConsoleLog.#traceLogging = trace ? 1 : 0;
    }

    /** @returns Whether stack traces are printed for each log. */
    getTrace() {
        return ConsoleLog.#traceLogging;
    }

    /**
     * Sets the log parameters from the given string, of the regex form (trace)?(dark?)(levelString).
     * Trace and Dark will be set to false if not present.
     * @param {string} logString
     * @param {number} levelDefault The default level if we are unable to parse the logString. */
    setFromString(logString, levelDefault=ConsoleLog.Level.Info) {
        const values = this.getFromString(logString);
        this.setTrace(values.trace ? 1 : 0);
        this.setDarkConsole(values.dark ? 1 : 0);
        if (values.level === ConsoleLog.Level.Invalid) {
            console.warn(
                `[${ConsoleLog.#getTimestring()}][WARN   ] ` +
                `ConsoleLog.setFromString: Got invalid level "${logString}". ` +
                `Defaulting to "${ConsoleLog.#logStrings[levelDefault]}".`);
            this.setLevel(levelDefault);
        } else {
            this.setLevel(values.level);
        }
    }

    /**
     * Parse log level/dark mode/trace mode from the given log level string.
     * @param {string} logString */
    getFromString(logString) {
        const match = /^(?<t>trace)?(?<d>dark)?(?<l>extreme|tmi|verbose|info|warn|error|critical)?$/i.exec(logString);
        const level = match?.groups.l ? ConsoleLog.#logStrings.indexOf(match.groups.l.toUpperCase()) : ConsoleLog.Level.Invalid;
        return {
            level : level,
            trace : !!match?.groups.t,
            dark : !!match?.groups.d,
        };
    }

    /**
     * Log TMI (Too Much Information) output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    tmi(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.TMI);
    }

    /**
     * Log Verbose output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    verbose(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.Verbose);
    }

    /**
     * Log Info level output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    info(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.Info);
    }

    /**
     * Log a warning using `console.warn`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    warn(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.Warn);
    }

    /**
     * Log a error using `console.error`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    error(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.Error);
    }

    /**
     * Log a critical error using `console.error`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    critical(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.Critical);
    }

    /**
     * Log formatted text to the console.
     * @param {Level} level The severity of the log.
     * @param {string} text The formatted text string.
     * @param {...any} format The arguments for {@linkcode text} */
    formattedText(level, text, ...format) {
        this.log('', text, false /*freeze*/, level, true /*textOnly*/, ...format);
    }

    /**
     * Verify that the given condition is true, logging a warning if it's not.
     * @param {boolean} condition The condition to test.
     * @param {string} text The warning to give if the assertion fails. */
    assert(condition, text) {
        if (!condition) {
            this.warn(`Assertion Failed: ${text}`);
        }
    }

    /**
     * Core logging routine. Prefixes a formatted timestamp based on the level
     * @param {any} obj The object or string to log.
     * @param {string} [description] A description for the object being logged.
     * Largely used when `obj` is an array/dictionary and not a string.
     * @param {boolean} freeze If true, freezes the current state of obj before logging it.
     * This prevents subsequent code from modifying the console output.
     * @param {Level} level The Log level. Determines the format colors as well as where
     * to display the message (info, warn err). If traceLogging is set, always outputs to {@linkcode console.trace}
     * @param {boolean} [textOnly] True if only {@linkcode description} is set, and `obj` should be ignored.
     * @param {...any} [more] A list of additional formatting to apply to the description.
     * Note that this cannot apply to `obj`, only `description`.
     */
    log(obj, description, freeze, level, textOnly, ...more) {
        if (level < ConsoleLog.#currentLogLevel) {
            return;
        }

        const timestring = ConsoleLog.#getTimestring();
        const colors = ConsoleLog.#traceLogging ? ConsoleLog.#traceColors : ConsoleLog.#consoleColors;
        const type = (object) => typeof (object) == 'string' ? '%s' : '%o';

        if (ConsoleLog.#currentLogLevel === ConsoleLog.Level.Extreme) {
            this.#write(
                console.debug,
                `%c[%c${timestring}%c][%cEXTREME%c] Called log with '${description ? description + ': ' : ''}${type(obj)},${level}'`,
                ConsoleLog.#currentState(obj, freeze),
                ConsoleLog.Level.Extreme,
                colors,
                ...more
            );
        }

        let desc = '';
        if (description) {
            desc = textOnly ? description : `${description}: ${type(obj)}`;
        } else if (typeof (obj) == 'string') {
            desc = obj;
            obj = '';
        }

        this.#write(
            this.#getOutputStream(level),
            `%c[%c${timestring}%c]${ConsoleLog.#formattedLogStrings[level]} ${desc}`,
            ConsoleLog.#currentState(obj, freeze),
            level,
            colors,
            ...more);
    }

    /**
     * Internal function that actually writes the formatted text to the console.
     * @param {Function} outputStream The method to use to write our message (e.g. console.log, console.warn, etc)
     * @param {string} text The text to log.
     * @param {*} [object] The raw object to log, if present.
     * @param {Level} [logLevel] The log severity.
     * @param {Array.<Array.<string>>} colors The color palette to use.
     * This will be `traceColors` if trace logging is enabled, otherwise `consoleColors`.
     * @param {...any} [more] Any additional formatting properties that will be applied to `text`. */
    #write(outputStream, text, object, logLevel, colors, ...more) {
        const textColor = `color: ${colors[logLevel][2 + ConsoleLog.#darkConsole]}`;
        const titleColor = `color: ${colors[logLevel][ConsoleLog.#darkConsole]}`;
        outputStream(text, textColor, titleColor, textColor, titleColor, textColor, ...more, object);
    }

    /** @returns The log timestamp in the form YYYY.MM.DD HH:MM:SS.000 */
    static #getTimestring() {
        const padLeft = (str, pad = 2) => ('00' + str).substr(-pad);

        const time = new Date();
        return `${time.getFullYear()}.${padLeft(time.getMonth() + 1)}.${padLeft(time.getDate())} ` +
            `${padLeft(time.getHours())}:${padLeft(time.getMinutes())}:${padLeft(time.getSeconds())}.${padLeft(time.getMilliseconds(), 3)}`;
    }

    /**
     * Retrieve the printed form of the given object.
     * @param {Object|string} object The object or string to convert.
     * @param {boolean} freeze Freeze the current state of `object`.
     * This prevents subsequent code from modifying the console output.
     * @param {boolean} [str=false] Whether to convert `object` to a string regardless of its actual type. */
    static #currentState(object, freeze, str = false) {
        if (typeof (object) == 'string') {
            return object;
        }

        if (str) {
            return JSON.stringify(object);
        }

        return freeze ? JSON.parse(JSON.stringify(object)) : object;
    }

    /** Return the correct output stream for the given log level */
    #getOutputStream(level) {
        return ConsoleLog.#traceLogging ? console.trace :
            level > ConsoleLog.Level.Warn ? console.error :
                level > ConsoleLog.Level.Info ? console.warn :
                    level > ConsoleLog.Level.TMI ? console.info :
                        console.debug;
    }

    /** Prints a help message to the console */
    consoleHelp() {
        // After initializing everything we need, print a message to the user to give some basic tips
        const logLevelSav = ConsoleLog.#currentLogLevel;
        ConsoleLog.#currentLogLevel = 2;
        this.info(' ');
        console.log('Welcome to the console!\n' +
            "If you're debugging an issue, here are some tips:\n" +
            '  1. Set dark/light mode for the console via Log.setDarkConsole(isDark), where isDark is 1 or 0.\n' +
            '  2. Set the log level via Log.setLevel(level), where level is a value from the ConsoleLog.Level dictionary ' +
            '(e.g. Log.setLevel(ConsoleLog.Level.Verbose);)\n' +
            '  3. To view the stack trace for every logged event, call Log.setTrace(1). To revert, Log.setTrace(0)\n\n');
        ConsoleLog.#currentLogLevel = logLevelSav;
    }
}


/**
 * An extension of ConsoleLog that prefixes each call with a given string, used to
 * better categorize log messages. */
class ContextualLog extends ConsoleLog {
    static #longestPrefix = 0;
    /** @type {{ [prefix: string]: ContextualLog }} */
    static #logs = {};
    /** @type {boolean} Ensures logs are only created via ContextualLog.Create */
    static #createGuard = false;
    #prefix = '';
    #formattedPrefix = '';

    static Create(prefix) {
        const existing = ContextualLog.#logs[prefix];
        if (existing) {
            return ContextualLog.#logs[prefix];
        }

        ContextualLog.#createGuard = true;
        const log = new ContextualLog(prefix);
        ContextualLog.#createGuard = false;
        return log;
    }

    constructor(prefix, force=false) {
        if (!force && !ContextualLog.#createGuard) {
            throw new Error('Contextual logs should only be created via ContextualLog.Create');
        }

        super();
        ContextualLog.#logs[prefix] = this;
        if (prefix) {
            this.#prefix = prefix;
            if (this.#prefix.length > ContextualLog.#longestPrefix) {
                ContextualLog.#longestPrefix = this.#prefix.length;
                ContextualLog.#notifyNewContextualLog();
            } else {
                this.#preComputeSpaces();
            }
        }
    }

    /**
     * Recompute all whitespace after a new log is added. */
    static #notifyNewContextualLog() {
        for (const log of Object.values(ContextualLog.#logs)) {
            log.#preComputeSpaces();
        }
    }

    /**
     * Cache our prefix string that includes whitespace for better log parsing. */
    #preComputeSpaces() {
        this.#formattedPrefix = this.#prefix + ' '.repeat(ContextualLog.#longestPrefix - this.#prefix.length);
    }

    /**
     * Log TMI (Too Much Information) output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    tmi(obj, description, freeze) {
        this.#addPrefixAndCall(obj, description, freeze, ConsoleLog.Level.TMI);
    }

    /**
     * Log Verbose output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    verbose(obj, description, freeze) {
        this.#addPrefixAndCall(obj, description, freeze, ConsoleLog.Level.Verbose);
    }

    /**
     * Log Info level output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    info(obj, description, freeze) {
        this.#addPrefixAndCall(obj, description, freeze, ConsoleLog.Level.Info);
    }

    /**
     * Log a warning using `console.warn`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    warn(obj, description, freeze) {
        this.#addPrefixAndCall(obj, description, freeze, ConsoleLog.Level.Warn);
    }

    /**
     * Log a error using `console.error`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    error(obj, description, freeze) {
        this.#addPrefixAndCall(obj, description, freeze, ConsoleLog.Level.Error);
    }

    /**
     * Log a critical error using `console.error`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    critical(obj, description, freeze) {
        this.#addPrefixAndCall(obj, description, freeze, ConsoleLog.Level.Critical);
    }

    /**
     * Log formatted text to the console.
     * @param {Level} level The severity of the log.
     * @param {string} text The formatted text string.
     * @param {...any} format The arguments for {@linkcode text} */
    formattedText(level, text, ...format) {
        if (this.#prefix) {
            text = `${this.#prefix}${this.#formattedPrefix}: ${text}`;
        }

        super.log('', text, false /*freeze*/, level, true /*textOnly*/, ...format);
    }

    /**
     * Verify that the given condition is true, logging a warning if it's not.
     * @param {boolean} condition The condition to test.
     * @param {string} text The warning to give if the assertion fails. */
    assert(condition, text) {
        if (!condition) {
            super.warn(`Assertion Failed: ${this.#formattedPrefix} - ${text}`);
        }
    }

    /**
     * Adds the contextual prefix to the log message before handing it off to the base log.
     * @param {any} obj The object or string to log.
     * @param {string} [description] A description for the object being logged.
     * Largely used when `obj` is an array/dictionary and not a string.
     * @param {boolean} freeze If true, freezes the current state of obj before logging it.
     * This prevents subsequent code from modifying the console output.
     * @param {Level} level The Log level. Determines the format colors as well as where
     * to display the message (info, warn err). If traceLogging is set, always outputs to {@linkcode console.trace}
     * Note that this cannot apply to `obj`, only `description`. */
    #addPrefixAndCall(obj, description, freeze, level) {
        if (description) {
            description = `${this.#formattedPrefix} - ${description}`;
        } else if (typeof obj == 'string') {
            obj = `${this.#formattedPrefix} - ${obj}`;
        }

        super.log(obj, description, freeze, level);
    }
}


const isDOM = typeof window !== 'undefined';
ConsoleLog.BaseSetup();
const BaseLog = new ConsoleLog();
if (isDOM) {
    BaseLog.info('Welcome to the console! For debugging help, call Log.consoleHelp()');
}

export { BaseLog, ConsoleLog, ContextualLog };
