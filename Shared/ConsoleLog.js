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
        Extreme: -1,
        Tmi: 0,
        Verbose: 1,
        Info: 2,
        Warn: 3,
        Error: 4,
        Critical: 5
    }

    /** Display strings for each log {@linkcode Level} */
    static #logStrings = ["TMI", "VERBOSE", "INFO", "WARN", "ERROR", "CRITICAL"];

    /** Console color definitions for each log {@linkcode Level} */
    static #consoleColors = [
        // Light Title, Dark Title, Light Text, Dark Text
        ["#00CC00", "#00AA00", "#AAA", "#888"],
        ["#c661e8", "#c661e8", "inherit", "inherit"],
        ["blue", "#88C", "inherit", "inherit"],
        ["E50", "#C40", "inherit", "inherit"],
        ["inherit", "inherit", "inherit", "inherit"],
        ["inherit; font-size: 2em", "inherit; font-size: 2em", "#800; font-size: 2em", "#C33; font-size: 2em"],
        ["#009900", "#006600", "#AAA", "#888"]
    ];

    /** Trace color definitions for each log level. */
    static #traceColors = [
        ConsoleLog.#consoleColors[0],
        ConsoleLog.#consoleColors[1],
        ConsoleLog.#consoleColors[2],
        [
            "#E50; background: #FFFBE5",
            "#C40; background: #332B00",
            "inherit; background: #FFFBE5",
            "#DFC185; background: #332B00"
        ],
        [
            "red; background: #FEF0EF",
            "#D76868; background: #290000",
            "red; background: #FEF0EF",
            "#D76868; background: #290000"
        ],
        [
            "red; font-size: 2em",
            "red; font-size: 2em",
            "#800; font-size: 2em",
            "#C33; font-size: 2em"
        ],
        ConsoleLog.#consoleColors[6]
    ];

    /** The current log level. Anything below this will not be logged.
     * @type {Level} */
    #currentLogLevel;

    /** Determine whether we should add a trace to every log event, not just errors.
     * @type {boolean} */
    #traceLogging;

    /** Tweak colors a bit based on whether the user is using a dark console theme.
     * @type {number} 0 for light, 1 for dark. */
    #darkConsole;

    constructor(window) {
        this.window = window;

        // We use ConsoleLog both on both the server and client side.
        // Server-side, create a stub of localStorage and window so nothing breaks
        if (!this.window) {
            class LS {
                constructor() {
                    this._dict = {};
                }

                getItem(item) { return this._dict[item]; }
                setItem(item, value) { this._dict[item] = value; }
            }
            class W {
                matchMedia() { return false; }
                localStorage = new LS();
            }

            this.window = new W();
        }

        /** The current log level. Anything below this will not be logged. */
        this.#currentLogLevel = parseInt(this.window.localStorage.getItem("loglevel"));
        if (isNaN(this.#currentLogLevel)) {
            this.#currentLogLevel = ConsoleLog.Level.Info;
        }

        /** Determine whether we should add a trace to every log event, not just errors. */
        this.#traceLogging = parseInt(this.window.localStorage.getItem("logtrace"));
        if (isNaN(this.#traceLogging)) {
            this.#traceLogging = 0;
        }

        /** Tweak colors a bit based on whether the user is using a dark console theme */
        this.#darkConsole = parseInt(this.window.localStorage.getItem("darkconsole"));
        if (isNaN(this.#darkConsole)) {
            // Default to system browser theme (if available)
            let mediaMatch = this.window.matchMedia("(prefers-color-scheme: dark)");
            mediaMatch = mediaMatch != "not all" && mediaMatch.matches;
            this.#darkConsole = mediaMatch ? 1 : 0;
        }
    }

    /** Test ConsoleLog by outputting content for each log level */
    testConsolelog() {
        const old = this.#currentLogLevel;
        this.setLevel(-1);
        this.tmi("TMI!");
        this.setLevel(0);
        this.verbose("Verbose!");
        this.info("Info!");
        this.warn("Warn!");
        this.error("Error!");
        this.critical("Crit!");
        this.formattedText(ConsoleLog.Level.Info, "%cFormatted%c,%c Text!%c", "color: green", "color: red", "color: orange", "color: inherit");
        this.setLevel(old);
    };

    /**
     * Sets the new minimum logging severity.
     * @param {Level} level The new log level. */
    setLevel(level) {
        this.window.localStorage.setItem("loglevel", level);
        this.#currentLogLevel = level;
    }

    /**
     * @returns The current minimum logging severity. */
    getLevel() {
        return this.#currentLogLevel;
    }

    /**
     * Set text to be better suited for dark versus light backgrounds.
     * @param {boolean} dark `true` to adjust colors for dark consoles, `false` for light. */
    setDarkConsole(dark) {
        this.window.localStorage.setItem("darkconsole", dark);
        this.#darkConsole = dark;
    }

    /** @returns Whether the current color scheme is best suited for dark consoles. */
    getDarkConsole() {
        return this.#darkConsole;
    }

    /**
     * Set whether to print stack traces for each log. Helpful when debugging.
     * @param {boolean} trace `true` to enable trace logging, `false` otherwise. */
    setTrace(trace) {
        this.window.localStorage.setItem("logtrace", trace);
        this.#traceLogging = trace;
    }

    /**
     * Log TMI (Too Much Information) output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console. */
    tmi(obj, description, freeze) {
        this.log(obj, description, freeze, ConsoleLog.Level.Tmi);
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
    info = function (obj, description, freeze) {
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
        this.log("", text, false /*freeze*/, level, true /*textOnly*/, ...format);
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
        if (level < this.#currentLogLevel) {
            return;
        }

        let timestring = ConsoleLog.#getTimestring();
        let colors = this.#traceLogging ? ConsoleLog.#traceColors : ConsoleLog.#consoleColors;
        let type = (object) => typeof (object) == "string" ? "%s" : "%o";

        if (this.#currentLogLevel == ConsoleLog.Level.Extreme) {
            this.#write(
                console.debug,
                `%c[%cEXTREME%c][%c${timestring}%c] Called log with '${description ? description + ": " : ""}${type(obj)},${level}'`,
                ConsoleLog.#currentState(obj, freeze),
                6,
                colors,
                ...more
            );
        }

        let desc = "";
        if (description) {
            desc = textOnly ? description : `${description}: ${type(obj)}`;
        }
        else if (typeof (obj) == "string") {
            desc = obj;
            obj = "";
        }

        this.#write(
            this.#getOutputStream(level),
            `%c[%c${ConsoleLog.#logStrings[level]}%c][%c${timestring}%c] ${desc}`,
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
        console.error;
        let textColor = `color: ${colors[logLevel][2 + this.#darkConsole]}`;
        let titleColor = `color: ${colors[logLevel][this.#darkConsole]}`;
        outputStream(text, textColor, titleColor, textColor, titleColor, textColor, ...more, object);
    }

    /** @returns The log timestamp in the form YYYY.MM.DD HH:MM:SS.000 */
    static #getTimestring() {
        let padLeft = (str, pad = 2) => ("00" + str).substr(-pad);

        let time = new Date();
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
        if (typeof (object) == "string") {
            return object;
        }

        if (str) {
            return JSON.stringify(object);
        }

        return freeze ? JSON.parse(JSON.stringify(object)) : object;
    }

    /** Return the correct output stream for the given log level */
    #getOutputStream(level) {
        return this.#traceLogging ? console.trace :
            level > ConsoleLog.Level.Warn ? console.error :
                level > ConsoleLog.Level.Info ? console.warn :
                    level > ConsoleLog.Level.Tmi ? console.info :
                        console.debug;
    }

    /** Prints a help message to the console */
    consoleHelp() {
        // After initializing everything we need, print a message to the user to give some basic tips
        const logLevelSav = this.#currentLogLevel;
        this.#currentLogLevel = 2;
        this.info(" ");
        console.log("Welcome to the console!\n" +
            "If you're debugging an issue, here are some tips:\n" +
            "  1. Set dark/light mode for the console via Log.setDarkConsole(isDark), where isDark is 1 or 0.\n" +
            "  2. Set the log level via Log.setLevel(level), where level is a value from the ConsoleLog.Level dictionary " +
            "(e.g. Log.setLevel(ConsoleLog.Level.Verbose);)\n" +
            "  3. To view the stack trace for every logged event, call Log.setTrace(1). To revert, Log.setTrace(0)\n\n");
            this.#currentLogLevel = logLevelSav;
    }
}

let w = typeof window == 'undefined' ? null : window;
const Log = new ConsoleLog(w);
if (w) {
    Log.info("Welcome to the console! For debugging help, call Log.consoleHelp()");
}

export { Log, ConsoleLog };
