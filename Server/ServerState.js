
/**
 * Set of possible server states. */
const ServerState = {
    /** Server is booting up. */
    FirstBoot : 0,
    /** Server is booting up after a restart. */
    ReInit : 1,
    /** Server is running normally. */
    Running : 2,
    /** Server is in a suspended state. */
    Suspended : 3,
    /** The server is in the process of shutting down. Either permanently or during a restart. */
    ShuttingDown : 4,
}

export default ServerState;
