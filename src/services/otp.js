import { config } from '../config.js';

let pendingOtpResolver = null;

export function waitForKaspiOtp() {
  return new Promise((resolve) => {
    pendingOtpResolver = resolve;
    setTimeout(() => {
      if (pendingOtpResolver === resolve) {
        pendingOtpResolver = null;
        resolve(null);
      }
    }, config.otpTimeoutMs);
  });
}

export function resolveOtp(code) {
  if (!pendingOtpResolver) {
    return false;
  }

  pendingOtpResolver(code);
  pendingOtpResolver = null;
  return true;
}

export function hasPendingOtp() {
  return pendingOtpResolver !== null;
}
