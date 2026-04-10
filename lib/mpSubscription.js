/**
 * Mercado Pago — cliente y utilidades para suscripciones (PreApproval / recurring).
 */
const { MercadoPagoConfig, PreApproval } = require('mercadopago');

function getAccessToken() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || token === 'TU_ACCESS_TOKEN_AQUI') return null;
  return token;
}

function createMercadoPagoClient() {
  const accessToken = getAccessToken();
  if (!accessToken) return null;
  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 15000 }
  });
}

function getPreApprovalClient() {
  const config = createMercadoPagoClient();
  if (!config) return null;
  return new PreApproval(config);
}

/**
 * Mapea status de PreApproval de Mercado Pago a status de nuestra tabla `subscriptions`.
 * @see https://www.mercadopago.com/developers/en/reference/subscriptions/_preapproval_id/get
 */
function mapPreapprovalStatusToDb(mpStatus) {
  const s = (mpStatus || '').toLowerCase();
  if (s === 'authorized') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'cancelled' || s === 'canceled' || s === 'paused') return 'cancelled';
  return 'pending';
}

function isDemoMode() {
  return !getAccessToken();
}

/**
 * El SDK de Mercado Pago v2 a veces devuelve el cuerpo plano y otras veces `{ response: { ... } }`.
 */
function normalizePreapprovalPayload(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const inner = raw.response;
  if (inner && typeof inner === 'object') {
    return {
      ...raw,
      ...inner,
      id: inner.id ?? raw.id,
      status: inner.status ?? raw.status,
      external_reference: inner.external_reference ?? raw.external_reference
    };
  }
  return raw;
}

module.exports = {
  getAccessToken,
  createMercadoPagoClient,
  getPreApprovalClient,
  mapPreapprovalStatusToDb,
  isDemoMode,
  normalizePreapprovalPayload
};
