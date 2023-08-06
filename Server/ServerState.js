/**
 * Set of possible server states. */
const ServerState = {
    /** Server is booting up. */
    FirstBoot : 0,
    /** Server is booting up after a restart. */
    ReInit : 1,
    /** Server is booting up, but the HTTP server is already running. */
    SoftBoot : 2,
    /** Server is running normally. */
    Running : 3,
    /** Server is in a suspended state. */
    Suspended : 4,
    /** The server is in the process of shutting down. Either permanently or during a restart. */
    ShuttingDown : 5,
    /** Returns whether the server is currently in a static state (i.e. not booting up or shutting down) */
    Stable : () => CurrentState === ServerState.Running || CurrentState === ServerState.Suspended
};

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
