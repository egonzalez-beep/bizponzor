/**
 * Versiones legales y flag de desarrollo (omitir checkboxes en registro).
 */
module.exports = {
  TERMS_VERSION: 'v1.0',
  PRIVACY_VERSION: 'v1.0',
  SKIP_LEGAL: process.env.SKIP_LEGAL === 'true'
};
