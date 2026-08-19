/* eslint-env node */
/**
 * Optional Stripe Checkout via the REST API (no Stripe SDK).
 * Used when STRIPE_SECRET_KEY is set; the payments ledger works without it.
 */
import { stripeSecretKey } from '../../src/utils/payments.js';

const STRIPE_CHECKOUT_URL = 'https://api.stripe.com/v1/checkout/sessions';

export function appOriginFromRequest(req, env = process.env) {
  const fromEnv = env.APP_ORIGIN || env.PUBLIC_APP_URL || env.VITE_APP_URL;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim().replace(/\/$/, '');
  }
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (!host) return '';
  return `${proto}://${host}`.replace(/\/$/, '');
}

/**
 * @param {object} args
 * @param {string} args.secretKey
 * @param {object} args.payment
 * @param {string} args.successUrl
 * @param {string} args.cancelUrl
 * @param {typeof fetch} [args.fetchImpl]
 */
export async function createCheckoutSession({
  secretKey,
  payment,
  successUrl,
  cancelUrl,
  fetchImpl = fetch,
}) {
  const key = secretKey || stripeSecretKey();
  if (!key) {
    return { ok: false, error: 'Stripe is not configured on this deploy.' };
  }
  const amountCents = Math.round(Number(payment.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents < 50) {
    return { ok: false, error: 'Stripe Checkout requires an amount of at least $0.50.' };
  }

  const name = payment.productName || payment.leaseLabel || 'Payment';
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: String(payment.paymentId || payment.payment_id || ''),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amountCents),
    'line_items[0][price_data][product_data][name]': String(name).slice(0, 120),
  });

  const response = await fetchImpl(STRIPE_CHECKOUT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.id) {
    const message =
      json?.error?.message ||
      json?.error ||
      `Stripe Checkout failed (${response.status}).`;
    return { ok: false, error: String(message) };
  }

  return {
    ok: true,
    sessionId: json.id,
    checkoutUrl: json.url || null,
  };
}
