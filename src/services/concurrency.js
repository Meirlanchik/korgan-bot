import { config } from '../config.js';
import { getSetting } from '../db.js';

export function getAutoPricingConcurrency() {
  return normalizeConcurrency(
    getSetting('auto_pricing_concurrency', String(config.autoPricingConcurrency)),
    config.autoPricingConcurrency || 4,
  );
}

export function normalizeConcurrency(value, fallback = 4) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const fallbackNumber = Number(fallback);
    if (!Number.isFinite(fallbackNumber) || fallbackNumber <= 0) {
      return null;
    }
    return Math.max(1, Math.floor(fallbackNumber));
  }

  return Math.max(1, Math.floor(number));
}
