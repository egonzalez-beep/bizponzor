/**
 * Rate limit in-memory por IP para POST /login (MVP).
 * Ventana deslizante: máx. 5 fallos en 15 min; éxito borra el contador.
 */

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

const loginRate = new Map();

function pruneStale() {
  const now = Date.now();
  for (const [ip, e] of loginRate) {
    if (now - e.firstFail > LOGIN_WINDOW_MS * 2) loginRate.delete(ip);
  }
}

setInterval(pruneStale, 60 * 1000).unref?.();

function loginRateAllowed(ip) {
  const now = Date.now();
  const e = loginRate.get(ip);
  if (!e || now - e.firstFail > LOGIN_WINDOW_MS) return true;
  return e.fails < LOGIN_MAX_FAILS;
}

function loginRateRecordFailure(ip) {
  const now = Date.now();
  let e = loginRate.get(ip);
  if (!e || now - e.firstFail > LOGIN_WINDOW_MS) {
    e = { fails: 0, firstFail: now };
  }
  e.fails++;
  loginRate.set(ip, e);
}

function loginRateReset(ip) {
  loginRate.delete(ip);
}

module.exports = {
  loginRateAllowed,
  loginRateRecordFailure,
  loginRateReset,
  LOGIN_MAX_FAILS,
  LOGIN_WINDOW_MS
};
