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
let ConsoleLog = function(window)
{
    /**
     * Possible log levels, from most to least verbose
     * @readonly
     * @enum {number}
     */
    this.Level = {
        Extreme : -1, // Log every time something is logged
        Tmi : 0,
        Verbose : 1,
        Info : 2,
        Warn : 3,
        Error : 4,
        Critical : 5
    };

    const logStrings = ["TMI", "VERBOSE", "INFO", "WARN", "ERROR", "CRITICAL"];
    const _inherit = "inherit";
    this.window = window;

    /** Console color definitions for each log level */
    const consoleColors =
    [
        // Light Title, Dark Title, Light Text, Dark Text
        ["#00CC00", "#00AA00", "#AAA", "#888"],
        ["#c661e8", "#c661e8", _inherit, _inherit],
        ["blue", "#88C", _inherit, _inherit],
        ["E50", "#C40", _inherit, _inherit],
        [_inherit, _inherit, _inherit, _inherit],
        ["inherit; font-size: 2em", "inherit; font-size: 2em", "#800; font-size: 2em", "#C33; font-size: 2em"],
        ["#009900", "#006600", "#AAA", "#888"]
    ];

    /** Trace color definitions for each log level */
    const traceColors =
    [
        consoleColors[0],
        consoleColors[1],
        consoleColors[2],
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
        consoleColors[6]
    ];

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
    let currentLogLevel = parseInt(this.window.localStorage.getItem("loglevel"));
    if (isNaN(currentLogLevel))
    {
        currentLogLevel = this.Level.Info;
    }

    /** Determine whether we should add a trace to every log event, not just errors. */
    let traceLogging = parseInt(this.window.localStorage.getItem("logtrace"));
    if (isNaN(traceLogging))
    {
        traceLogging = 0;
    }

    /** Tweak colors a bit based on whether the user is using a dark console theme */
    let darkConsole = parseInt(this.window.localStorage.getItem("darkconsole"));
    if (isNaN(darkConsole))
    {
        // Default to system browser theme (if available)
        let mediaMatch = this.window.matchMedia("(prefers-color-scheme: dark)");
        mediaMatch = mediaMatch != "not all" && mediaMatch.matches;
        darkConsole = mediaMatch ? 1 : 0;
    }

    /** Test ConsoleLog by outputting content for each log level */
    this.testConsolelog = function()
    {
        const old = currentLogLevel;
        this.setLevel(-1);
        this.tmi("TMI!");
        this.setLevel(0);
        this.verbose("Verbose!");
        this.info("Info!");
        this.warn("Warn!");
        this.error("Error!");
        this.critical("Crit!");
        this.formattedText(Log.Level.Info, "%cFormatted%c,%c Text!%c", "color: green", "color: red", "color: orange", "color: inherit");
        this.setLevel(old);
    };

    /**
     * Sets the new minimum logging severity.
     * @param {Log.Level} level The new log level.
     */
    this.setLevel = function(level)
    {
        this.window.localStorage.setItem("loglevel", level);
        currentLogLevel = level;
    };

    /**
     * @returns The current minimum logging severity.
     */
    this.getLevel = function()
    {
        return currentLogLevel;
    };

    /**
     * Set text to be better suited for dark versus light backgrounds.
     * @param {boolean} dark `true` to adjust colors for dark consoles, `false` for light.
     */
    this.setDarkConsole = function(dark)
    {
        this.window.localStorage.setItem("darkconsole", dark);
        darkConsole = dark;
    };

    /**
     * @returns Whether the current color scheme is best suited for dark consoles.
     */
    this.getDarkConsole = function()
    {
        return darkConsole;
    };

    /**
     * Set whether to print stack traces for each log. Helpful when debugging.
     * @param {boolean} trace `true` to enable trace logging, `false` otherwise.
     */
    this.setTrace = function(trace)
    {
        this.window.localStorage.setItem("logtrace", trace);
        traceLogging = trace;
    };

    /**
     * Log TMI (Too Much Information) output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console.
     */
    this.tmi = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Tmi);
    };

    /**
     * Log Verbose output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console.
     */
    this.verbose = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Verbose);
    };

    /**
     * Log Info level output.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console.
     */
    this.info = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Info);
    };

    /**
     * Log a warning using `console.warn`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console.
     */
    this.warn = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Warn);
    };

    /**
     * Log a error using `console.error`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console.
     */
    this.error = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Error);
    };

    /**
     * Log a critical error using `console.error`.
     * @param {any} obj The object or string to log.
     * @param {string} [description] If provided, will be prefixed to the output before `obj`.
     * @param {boolean} [freeze] True to freeze the state of `obj` before sending it to the console.
     */
    this.critical = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Critical);
    };

    /**
     * Log formatted text to the console.
     * @param {Log.Level} level The severity of the log.
     * @param {string} text The formatted text string.
     * @param {...any} format The arguments for {@linkcode text}
     */
    this.formattedText = function(level, text, ...format)
    {
        this.log("", text, false /*freeze*/, level, true /*textOnly*/, ...format);
    };

    /**
     * Core logging routine. Prefixes a formatted timestamp based on the level
     * @param {any} obj The object or string to log.
     * @param {string} [description] A description for the object being logged.
     * Largely used when `obj` is an array/dictionary and not a string.
     * @param {boolean} freeze If true, freezes the current state of obj before logging it.
     * This prevents subsequent code from modifying the console output.
     * @param {Log.Level} level The Log level. Determines the format colors as well as where
     * to display the message (info, warn err). If traceLogging is set, always outputs to {@linkcode console.trace}
     * @param {boolean} [textOnly] True if only {@linkcode description} is set, and `obj` should be ignored.
     * @param {...any} [more] A list of additional formatting to apply to the description.
     * Note that this cannot apply to `obj`, only `description`.
     */
    this.log = function(obj, description, freeze, level, textOnly, ...more)
    {
        if (level < currentLogLevel)
        {
            return;
        }

        let timestring = getTimestring();
        let colors = traceLogging ? traceColors : consoleColors;
        let type = (object) => typeof(object) == "string" ? "%s" : "%o";

        if (currentLogLevel == Log.Level.Extreme)
        {
            write(
                console.debug,
                `%c[%cEXTREME%c][%c${timestring}%c] Called log with '${description ? description + ": " : ""}${type(obj)},${level}'`,
                currentState(obj, freeze),
                6,
                colors,
                ...more
            );
        }

        let desc = "";
        if (description)
        {
            desc = textOnly ? description : `${description}: ${type(obj)}`;
        }
        else if (typeof(obj) == "string")
        {
            desc = obj;
            obj = "";
        }

        write(
            getOutputStream(level),
            `%c[%c${logStrings[level]}%c][%c${timestring}%c] ${desc}`,
            currentState(obj, freeze),
            level,
            colors,
            ...more);
    };

    /**
     * Internal function that actually writes the formatted text to the console.
     * @param {method} outputStream The method to use to write our message (e.g. console.log, console.warn, etc)
     * @param {string} text The text to log.
     * @param {*} [object] The raw object to log, if present.
     * @param {Level} [logLevel] The log severity.
     * @param {Array.<Array.<string>>} colors The color palette to use.
     * This will be `traceColors` if trace logging is enabled, otherwise `consoleColors.
     * @param {...any} [more] Any additional formatting properties that will be applied to `text`.
     */
    const write = function(outputStream, text, object, logLevel, colors, ...more)
    {
        console.error
        let textColor = `color: ${colors[logLevel][2 + darkConsole]}`;
        let titleColor = `color: ${colors[logLevel][darkConsole]}`;
        outputStream(text, textColor, titleColor, textColor, titleColor, textColor, ...more, object);
    };

    /**
     * @returns The log timestamp in the form YYYY.MM.DD HH:MM:SS.000
     */
    let getTimestring = function()
    {
        let padLeft = (str, pad=2) => ("00" + str).substr(-pad);

        let time = new Date();
        return `${time.getFullYear()}.${padLeft(time.getMonth()+1)}.${padLeft(time.getDate())} ` +
            `${padLeft(time.getHours())}:${padLeft(time.getMinutes())}:${padLeft(time.getSeconds())}.${padLeft(time.getMilliseconds(), 3)}`;
    };

    /**
     * Retrieve the printed form of the given object.
     * @param {Object|string} object The object or string to convert.
     * @param {boolean} freeze Freeze the current state of `object`.
     * This prevents subsequent code from modifying the console output.
     * @param {boolean} [str=false] Whether to convert `object` to a string regardless of its actual type.
     */
    let currentState = function(object, freeze, str=false)
    {
        if (typeof(object) == "string")
        {
            return object;
        }

        if (str)
        {
            return JSON.stringify(object);
        }

        return freeze ? JSON.parse(JSON.stringify(object)) : object;
    };

    /** Return the correct output stream for the given log level */
    let getOutputStream = function(level)
    {
        return traceLogging ? console.trace :
            level > Log.Level.Warn ? console.error :
                level > Log.Level.Info ? console.warn :
                    level > Log.Level.Tmi ? console.info :
                        console.debug;
    };

    /** Prints a help message to the console */
    this.consoleHelp = function()
    {
        // After initializing everything we need, print a message to the user to give some basic tips
        const logLevelSav = currentLogLevel;
        currentLogLevel = 2;
        Log.info(" ");
        console.log("Welcome to the console!\n" +
        "If you're debugging an issue, here are some tips:\n" +
        "  1. Set dark/light mode for the console via Log.setDarkConsole(isDark), where isDark is 1 or 0.\n" +
        "  2. Set the log level via Log.setLevel(level), where level is a value from the Log.Level dictionary " +
            "(e.g. Log.setLevel(Log.Level.Verbose);)\n" +
        "  3. To view the stack trace for every logged event, call Log.setTrace(1). To revert, Log.setTrace(0)\n\n");
        currentLogLevel = logLevelSav;
    };

};
// Hack to work around this file being used both client and server side.
// Server side we want to export Log, but we want to ignore this client-side.
/** @type {ConsoleLog} */
let Log;
if (typeof module !== 'undefined') {
    Log = new ConsoleLog();
    /** Formatted logger */
    module.exports = { ConsoleLog };
} else {
    Log = new ConsoleLog(window);
    Log.info("Welcome to the console! For debugging help, call Log.consoleHelp()");
    if (typeof __dontEverDefineThis !== 'undefined') {
        module.exports = { Log };
    }
}