import { ServerSettings } from '/Shared/ServerConfig.js';

export const ValidationInputDelay = 500;

/**
 * @enum
 * @type {{ [setting: string]: string }} */
export const SettingTitles = {
    [ServerSettings.DataPath] : 'Data Path',
    [ServerSettings.Database] : 'Database File',
    [ServerSettings.Host] : 'Listen Host',
    [ServerSettings.Port] : 'Listen Port',
    [ServerSettings.BaseUrl] : 'Base URL',
    [ServerSettings.UseSsl] : 'Enable HTTPS',
    [ServerSettings.SslOnly] : 'Force HTTPS',
    [ServerSettings.SslHost] : 'HTTPS Host',
    [ServerSettings.SslPort] : 'HTTPS Port',
    [ServerSettings.CertType] : 'Certificate Type',
    [ServerSettings.PfxPath] : 'PFX Path',
    [ServerSettings.PfxPassphrase] : 'PFX Passphrase',
    [ServerSettings.PemCert] : 'PEM Certificate',
    [ServerSettings.PemKey] : 'PEM Private Key',
    [ServerSettings.UseAuthentication] : 'Authentication',
    [ServerSettings.Username] : 'Username',
    [ServerSettings.Password] : 'Password',
    [ServerSettings.SessionTimeout] : 'Session Timeout',
    [ServerSettings.LogLevel] : 'Log Level',
    [ServerSettings.AutoOpen] : 'Open Browser on Launch',
    [ServerSettings.ExtendedStats] : 'Extended Marker Statistics',
    [ServerSettings.PreviewThumbnails] : 'Use Preview Thumbnails',
    [ServerSettings.FFmpegThumbnails] : 'Use FFmpeg for Thumbnails',
    [ServerSettings.WriteExtraData] : 'Write Extra Data',
    [ServerSettings.AutoSuspend] : 'Auto-Suspend Database Connection',
    [ServerSettings.AutoSuspendTimeout] : 'Auto-Suspend Timeout',
    [ServerSettings.PathMappings] : 'Path Mappings',
};
