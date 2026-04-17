/**
 * IP del cliente detrás de proxy (Railway, etc.).
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim().slice(0, 64);
  }
  if (req.ip) return String(req.ip).slice(0, 64);
  if (req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress).slice(0, 64);
  return '';
}

module.exports = { getClientIp };
