/**
 * Server-side product brand configuration.
 * Mirrors src/config/brand.js: product name drives display identity;
 * optional FROM_* / email knobs remain independent.
 */
import {
  DEFAULT_PRODUCT_NAME,
  deriveBrandFromProductName,
  firstNonEmpty,
} from '../../src/config/brand-derive.js';

const productName =
  firstNonEmpty(process.env.PRODUCT_NAME, process.env.VITE_PRODUCT_NAME) ||
  DEFAULT_PRODUCT_NAME;

const derived = deriveBrandFromProductName(productName);

const referenceOperatorName =
  firstNonEmpty(
    process.env.REFERENCE_OPERATOR_NAME,
    process.env.VITE_REFERENCE_OPERATOR_NAME
  ) || derived.referenceOperatorName;

export const brand = {
  productName: derived.productName,
  referenceOperatorName,

  fromEmail: firstNonEmpty(
    process.env.FROM_EMAIL,
    process.env.SENDGRID_FROM_EMAIL,
    'noreply@example.com'
  ),

  fromName: firstNonEmpty(
    process.env.FROM_NAME,
    process.env.SENDGRID_FROM_NAME,
    derived.productName
  ),

  emailFooterName: firstNonEmpty(
    process.env.EMAIL_FOOTER_NAME,
    `${derived.productName} Property Management`
  ),

  emailSystemName: firstNonEmpty(
    process.env.EMAIL_SYSTEM_NAME,
    `${derived.productName} Property Management System`
  ),
};
