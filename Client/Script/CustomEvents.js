/**
 * List of Marker Editor's custom events. */
export const CustomEvents = {
    /** @readonly Triggered when the stickiness setting changes. */
    StickySettingsChanged : 'stickySettingsChanged',
    /** @readonly Triggered when we attempt to reach out to the server when it's paused. */
    ServerPaused : 'serverPaused',
    /** @readonly The user committed changes to client settings. */
    ClientSettingsApplied : 'clientSettingsApplied',
    /** @readonly The user applied new filter settings. */
    MarkerFilterApplied : 'markerFilterApplied',
    /** @readonly The active UI section changed or was cleared. */
    UISectionChanged : 'uiSectionChanged',
};
