/**
 * Set of possible server states. */
const ServerState = {
    /** @readonly Server is booting up. */
    FirstBoot : 0,
    /** @readonly Server is booting up after a restart. */
    ReInit : 1,
    /** @readonly Server is booting up, but the HTTP server is already running. */
    SoftBoot : 2,
    /** @readonly Server is running normally. */
    Running : 3,
    /** @readonly Server is running, but settings have not been configured (or are misconfigured). */
    RunningWithoutConfig : 4,
    /** @readonly Server is in a suspended state. */
    Suspended : 5,
    /** @readonly Server is suspended due to user inactivity. */
    AutoSuspended : 6,
    /** @readonly The server is in the process of shutting down. Either permanently or during a restart. */
    ShuttingDown : 7,
    /** Returns whether the server is currently in a static state (i.e. not booting up or shutting down) */
    Stable : () => StableStates.has(CurrentState),
};

const StableStates = new Set([ServerState.RunningWithoutConfig, ServerState.Running, ServerState.Suspended, ServerState.AutoSuspended]);

/**
 * Indicates whether we're in the middle of shutting down the server, and
 * should therefore immediately fail all incoming requests.
 * @type {number} */
let CurrentState = ServerState.FirstBoot;

/**
 * Set the current server state.
 * @param {number} state */
function SetServerState(state) { CurrentState = state; }

/**
 * Retrieve the current {@linkcode ServerState} */
function GetServerState() { return CurrentState; }

export { SetServerState, GetServerState, ServerState };
