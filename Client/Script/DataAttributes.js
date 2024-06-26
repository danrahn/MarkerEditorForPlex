/**
 * List of custom data attributes that we can add to element. */
export const Attributes = {
    /** @readonly Associate a metadata id with an element. */
    MetadataId : 'data-metadata-id',
    /** @readonly Sets whether this element represents the start or end of a chapter. */
    ChapterFn : 'data-chapterFn',
    /** @readonly Indicates that this element can be focused to when navigating result rows. */
    TableNav : 'data-nav-target',
    /** @readonly Used to indicate that bulk add is updating internal state. */
    BulkAddUpdating : 'data-switching-episode',
    /** @readonly Holds the resolve type message for bulk shift operations. */
    BulkShiftResolveMessage : 'data-shift-resolve-message',
    /** @readonly Indicates that a button should use the default tooltip. */
    UseDefaultTooltip : 'data-default-tooltip',
    /** @readonly The tooltip to display for an element. */
    TooltipText : 'data-tt',
    /** @readonly Time in ms to delay showing a tooltip after it gets focus/hovered. */
    TooltipDelay : 'data-tt-delay',
    /** @readonly The custom max-width of a tooltip */
    TooltipWidth : 'data-tt-width',
    /** @readonly The size of the text: -1, 0, or 1 */
    TooltipTextSize : 'data-tt-text-size',
    /** @readonly Indicates the tooltip text should be centered. */
    TooltipCentered : 'data-tt-centered',
    /** @readonly Indicates the tooltip should avoid wrapping text whenever possible. */
    TooltipNoBreak : 'data-tt-no-break',
    /** @readonly Indicates whether the overlay can be dismissed by the user. */
    OverlayDismissible : 'data-dismissible',
    /** @readonly Library type of a library in the selection dropdown. */
    LibraryType : `data-lib-type`,
    /** @readonly Data attribute for an animation property reset flag. */
    PropReset : prop => `data-${prop}-reset`,
};

export const TableNavDelete = 'delete';
