/**
 * @typedef {Object} DBUser
 * @property {number} id
 * @property {string} username
 * @property {string} user_norm
 * @property {string} password
 */

export const SessionTableName = 'sessions';
export const UserTableName = 'users';
export const SessionSecretTableName = 'secrets';

const sessionTable = `
CREATE TABLE IF NOT EXISTS ${SessionTableName} (
    session_id TEXT    NOT NULL PRIMARY KEY,
    session    JSON    NOT NULL,
    expire     INTEGER NOT NULL
);`.replace(/ +/g, ' '); // Extra spaces are nice for readability, but they're entered as-is
//                         into the database, which can make changing the schema more difficult.

const userTable = `
CREATE TABLE IF NOT EXISTS ${UserTableName} (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT    NOT NULL    UNIQUE,
    user_norm TEXT    NOT NULL    UNIQUE,
    password  TEXT    NOT NULL
);`.replace(/ +/g, ' ');

const secretTable = `
CREATE TABLE IF NOT EXISTS ${SessionSecretTableName} (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL,
    https      INTEGER DEFAULT 0,` /* V2: Differentiate between HTTP and HTTPS secrets. */ + `
    created_at INTEGER NOT NULL    DEFAULT (strftime('%s', 'now'))
);`.replace(/ +/g, ' ');

export const authSchemaVersion = 2;
const schemaVersionTable = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER
);
INSERT INTO schema_version (version) SELECT ${authSchemaVersion} WHERE NOT EXISTS (SELECT * FROM schema_version);
`;

/** @type {(table: string) => string} Create "DROP TABLE IF EXISTS" statement for the given table. */
const dtii = table => `DROP TABLE IF EXISTS ${table};`;

export const AuthDatabaseSchema = `${sessionTable} ${userTable} ${secretTable} ${schemaVersionTable}`;

/**
 * Array of database queries to run when upgrading to a particular schema version. */
export const authSchemaUpgrades = [
    // Version 0 - no existing database, so create everything.
    `${dtii(SessionTableName)} ${dtii(UserTableName)} ${dtii(SessionSecretTableName)} ${dtii('schema_version')}
    ${AuthDatabaseSchema}`,

    // Version 1 -> 2: Add https column to secrets table.
    `ALTER TABLE ${SessionSecretTableName} ADD COLUMN https INTEGER DEFAULT 0;
    UPDATE schema_version SET version=2;`
];

