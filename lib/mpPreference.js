/**
 * Mercado Pago — preferencias (pagos únicos) y consulta de pagos.
 */
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function getAccessToken() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || token === 'TU_ACCESS_TOKEN_AQUI') return null;
  return token;
}

function getPreferenceClient() {
  const accessToken = getAccessToken();
  if (!accessToken) return null;
  return new Preference(
    new MercadoPagoConfig({ accessToken, options: { timeout: 15000 } })
  );
}

function getPaymentClient() {
  const accessToken = getAccessToken();
  if (!accessToken) return null;
  return new Payment(
    new MercadoPagoConfig({ accessToken, options: { timeout: 15000 } })
  );
}

function normalizeMpPayload(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const inner = raw.response;
  if (inner && typeof inner === 'object') {
    return {
      ...raw,
      ...inner,
      id: inner.id ?? raw.id,
      status: inner.status ?? raw.status,
      external_reference:
        inner.external_reference ?? raw.external_reference
    };
  }
  return raw;
}

module.exports = {
  getAccessToken,
  getPreferenceClient,
  getPaymentClient,
  normalizeMpPayload
};
