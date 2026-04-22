import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
const dataDir = process.env.DATA_DIR || '/app/data';
const autoPricingConcurrency = 4;

export const config = Object.freeze({
  port: Number(process.env.PORT || 3000),
  publicDir: process.env.PUBLIC_DIR || '/app/public',
  uploadDir,
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'kaspi.db'),
  publicFeedUrl: process.env.PUBLIC_FEED_URL || 'http://web-server.meirlan.ru/',
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || 20),
  kaspiDownloadDir: process.env.KASPI_DOWNLOAD_DIR || '/app/kaspi-downloads',
  kaspiSessionDir: process.env.KASPI_SESSION_DIR || '/app/kaspi-session',
  autoPricingFile: process.env.AUTO_PRICING_FILE || path.join(uploadDir, 'auto-pricing.json'),
  autoPricingIntervalMs: Number(process.env.KASPI_LIGHT_PARSE_INTERVAL_MS || process.env.KASPI_PRICE_UPDATE_INTERVAL_MS || 5 * 60 * 1000),
  fullParseIntervalMs: Number(process.env.KASPI_FULL_PARSE_INTERVAL_MS || 15 * 60 * 1000),
  autoPricingConcurrency,
  otpTimeoutMs: Number(process.env.KASPI_OTP_TIMEOUT_MS || 180_000),
  cityId: process.env.KASPI_CITY_ID || '710000000',

  panel: {
    user: process.env.PANEL_USER || '',
    password: process.env.PANEL_PASSWORD || '',
  },
});
