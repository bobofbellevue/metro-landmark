import { createCheckoutSession, appOriginFromRequest } from '../../api/utils/stripe-checkout.js';

describe('stripe checkout helper', () => {
  test('appOriginFromRequest prefers APP_ORIGIN', () => {
    expect(
      appOriginFromRequest(
        { headers: { host: 'example.vercel.app' } },
        { APP_ORIGIN: 'https://app.example.com/' }
      )
    ).toBe('https://app.example.com');
  });

  test('createCheckoutSession posts form body and returns url', async () => {
    const fetchImpl = async (url, options) => {
      expect(url).toContain('checkout/sessions');
      expect(options.headers.Authorization).toBe('Bearer sk_test_abc');
      expect(options.body.get('line_items[0][price_data][unit_amount]')).toBe('185000');
      return {
        ok: true,
        json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/cs_test_1' }),
      };
    };

    const result = await createCheckoutSession({
      secretKey: 'sk_test_abc',
      payment: { paymentId: 4, amount: 1850, productName: 'Rent' },
      successUrl: 'https://app.example.com/?payments=success',
      cancelUrl: 'https://app.example.com/?payments=cancel',
      fetchImpl,
    });
    expect(result).toEqual({
      ok: true,
      sessionId: 'cs_test_1',
      checkoutUrl: 'https://checkout.stripe.com/c/cs_test_1',
    });
  });

  test('createCheckoutSession surfaces Stripe errors', async () => {
    const result = await createCheckoutSession({
      secretKey: 'sk_test_abc',
      payment: { paymentId: 4, amount: 10, productName: 'Rent' },
      successUrl: 'https://app.example.com/ok',
      cancelUrl: 'https://app.example.com/cancel',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API Key provided' } }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid API Key/);
  });
});
