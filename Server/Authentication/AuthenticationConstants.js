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
    created_at INTEGER NOT NULL    DEFAULT (strftime('%s', 'now'))
);`.replace(/ +/g, ' ');

const authSchemaVersion = 1;
const schemaVersionTable = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER
);
INSERT INTO schema_version (version) SELECT ${authSchemaVersion} WHERE NOT EXISTS (SELECT * FROM schema_version);
`;

export const AuthDatabaseSchema = `${sessionTable} ${userTable} ${secretTable} ${schemaVersionTable}`;
