/**
 * Options for remembering modified settings/toggles.
 * @enum */
export const StickySettingsType = {
    /** @readonly Never remember. */
    None : 0,
    /** @readonly Remember the current session. */
    Session : 1,
    /** @readonly Remember across sessions. */
    Always : 2,
};
