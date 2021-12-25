/// <summary>
/// Console logging class. Allows easy timestamped logging with various log levels
///
/// Because this class is used on almost every page, some additional manual minification
/// has been done to reduce its overall size. Nothing like unnecessary micro-optimizations!
///
/// Taken from PlexWeb/script/consolelog.js
/// </summary>
let Log = new function()
{
    /// <summary>
    /// All possible log levels, from most to least verbose
    /// </summary>
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
    this.logErrorId = 26;

    /// <summary>
    /// Console color definitions for each log level
    /// </summary>
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

    /// <summary>
    /// Trace color definitions for each log level
    /// </summary>
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

    /// <summary>
    /// The current log level. Anything below this will not be logged
    /// </summary>
    let currentLogLevel = parseInt(localStorage.getItem("loglevel"));
    if (isNaN(currentLogLevel))
    {
        currentLogLevel = this.Level.Info;
    }

    /// <summary>
    /// Determine whether we should add a trace to every log event, not just errors
    /// </summary>
    let traceLogging = parseInt(localStorage.getItem("logtrace"));
    if (isNaN(traceLogging))
    {
        traceLogging = 0;
    }

    /// <summary>
    /// Tweak colors a bit based on whether the user is using a dark console theme
    /// </summary>
    let darkConsole = parseInt(localStorage.getItem("darkconsole"));
    if (isNaN(darkConsole))
    {
        // Default to system browser theme (if available)
        let mediaMatch = window.matchMedia("(prefers-color-scheme: dark)");
        mediaMatch = mediaMatch != "not all" && mediaMatch.matches;
        darkConsole = mediaMatch ? 1 : 0;
    }

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
        this.log("Crit!", undefined, false /*freeze*/, Log.Level.Critical);
        this.formattedText(Log.Level.Info, "%cFormatted%c,%c Text!%c", "color: green", "color: red", "color: orange", "color: inherit");
        this.setLevel(old);
    };

    this.setLevel = function(level)
    {
        localStorage.setItem("loglevel", level);
        currentLogLevel = level;
    };

    this.getLevel = function()
    {
        return currentLogLevel;
    };

    this.setDarkConsole = function(dark)
    {
        localStorage.setItem("darkconsole", dark);
        darkConsole = dark;
    };

    this.getDarkConsole = function()
    {
        return darkConsole;
    };

    /// <summary>
    /// Sets whether to print stack traces for each log. Helpful when debugging
    /// </summary>
    this.setTrace = function(trace)
    {
        localStorage.setItem("logtrace", trace);
        traceLogging = trace;
    };

    this.tmi = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Tmi);
    };

    this.verbose = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Verbose);
    };

    this.info = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Info);
    };

    this.warn = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Warn);
    };

    this.error = function(obj, description, freeze)
    {
        this.log(obj, description, freeze, Log.Level.Error);
    };

    this.formattedText = function(level, text, ...format)
    {
        this.log("", text, false /*freeze*/, level, true /*textOnly*/, ...format);
    };

    /// <summary>
    /// Core logging routine. Prefixes a formatted timestamp based on the level
    /// </summary>
    /// <param name="obj">The object to log</param>
    /// <param name="description">
    /// A description for the object we're logging.
    /// Largely used when 'obj' is an array/dictionary and not a string
    /// </param>
    /// <param name="freeze">
    /// If true, freezes the current state of obj before logging it
    /// This prevents subsequent code from modifying the console output.
    /// </param>
    /// <param name="logLevel">
    /// The LOG level. Determines the format colors, as well as where
    /// to display the message (info, warn, err). If g_traceLogging is set,
    /// always outputs to console.trace
    /// </param>
    /// <param name="more">
    /// A list of additional formatting to apply to the description
    /// Note that this cannot apply to `obj`, only `description`.
    /// </param>
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

        if (level > Log.Level.Warn)
        {
            let encode = encodeURIComponent;
            fetch(`process_request.php?type=${Log.logErrorId}&error=${encode(currentState(obj, true, true))}&stack=${encode(Error().stack)}`);
        }
    };

    /// <summary>
    /// Internal function that actually writes the formatted text to the console
    /// </summary>
    const write = function(outputStream, text, object, logLevel, colors, ...more)
    {
        let textColor = `color: ${colors[logLevel][2 + darkConsole]}`;
        let titleColor = `color: ${colors[logLevel][darkConsole]}`;
        outputStream(text, textColor, titleColor, textColor, titleColor, textColor, ...more, object);
    };

    /// <summary>
    /// Returns the log timestamp in the form YYYY.MM.DD HH:MM:SS.000
    /// </summary>
    let getTimestring = function()
    {
        let padLeft = (str, pad=2) => ("00" + str).substr(-pad);

        let time = new Date();
        return `${time.getFullYear()}.${padLeft(time.getMonth()+1)}.${padLeft(time.getDate())} ` +
            `${padLeft(time.getHours())}:${padLeft(time.getMinutes())}:${padLeft(time.getSeconds())}.${padLeft(time.getMilliseconds(), 3)}`;
    };

    /// <summary>
    /// Returns the printed form of the given object
    /// </summary>
    /// <param name="object">The object to display</param>
    /// <param name="freeze">Whether to preserve the current state of the object</param>
    /// <param name="str">Whether to return text regardless of the object type</param>
    let currentState = function(object, freeze, str=0)
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

    /// <summary>
    /// Returns the correct output stream for the given log level
    /// </summary>
    let getOutputStream = function(level)
    {
        return traceLogging ? console.trace :
            level > Log.Level.Warn ? console.error :
                level > Log.Level.Info ? console.warn :
                    level > Log.Level.Tmi ? console.info :
                        console.debug;
    };

    /// <summary>
    /// Prints a help message to the console
    /// </summary>
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

}();

Log.info("Welcome to the console! For debugging help, call Log.consoleHelp()");
