/** Usernames no permitidos (normalizados: minúsculas, sin @). */
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'support',
  'bizponzor',
  'bizponzer',
  'root',
  'api',
  'system',
  'moderator',
  'mod',
  'staff',
  'help',
  'null',
  'undefined',
  'www',
  'mail',
  'ftp',
  'localhost',
  'test',
  'official'
]);

function isReservedUsername(normalized) {
  return RESERVED_USERNAMES.has(String(normalized || '').toLowerCase());
}

module.exports = { RESERVED_USERNAMES, isReservedUsername };
