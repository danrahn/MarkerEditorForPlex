/**
 * Dictionary of all current style sheets. */
const DefaultStyleSheets = {
    Main : 'style',
    ThemeDark : 'themeDark',
    ThemeLight : 'themeLight',
    Tooltip : 'Tooltip',
    Overlay : 'Overlay',
    OverlayDark : 'OverlayDark',
    OverlayLight : 'OverlayLight',
    Settings : 'Settings',
    MarkerTable : 'MarkerTable',
    BulkAction : 'BulkActionOverlay',
    BulkActionDark : 'BulkActionOverlayDark',
    BulkActionLight : 'BulkActionOverlayLight',
    DetachedMode : 'DetachedMode',
};

// Webpack will inject __HASHED_STYLES__ at build time, which will replace the above values with hashed filenames for cache busting.
/* global __HASHED_STYLES__ */
const StyleSheets = typeof __HASHED_STYLES__ === 'object' && __HASHED_STYLES__ ? __HASHED_STYLES__ : DefaultStyleSheets;

export default StyleSheets;
