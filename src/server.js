import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { config } from './config.js';
import { createApp } from './app.js';
import { initDatabase, getProductCount, importFromCatalog, importAutoPricingState, abortRunningParseSessions } from './db.js';
import { initRealtime } from './realtime.js';
import { startScheduler } from './services/scheduler.js';
import { logRuntime } from './logger.js';

await fs.mkdir(config.uploadDir, { recursive: true });
await fs.mkdir(config.publicDir, { recursive: true });
await fs.mkdir(config.dataDir, { recursive: true });
await fs.mkdir(config.kaspiDownloadDir, { recursive: true });
await fs.mkdir(config.kaspiSessionDir, { recursive: true });
await fs.mkdir(path.dirname(config.autoPricingFile), { recursive: true });

// Initialize database
initDatabase(config.dbPath);
console.log(`Database initialized at ${config.dbPath}`);
logRuntime('server', 'info', `База данных инициализирована: ${config.dbPath}`);
const abortedParseSessions = abortRunningParseSessions();
if (abortedParseSessions) {
  logRuntime('product_parse', 'error', `Прерванные сессии парсинга отмечены: ${abortedParseSessions}`);
}

// Migrate existing data on first run
const counts = getProductCount();
if (counts.total === 0) {
  try {
    const { parseKaspiCatalog } = await import('./kaspiPriceList.js');
    const xmlPath = path.join(config.publicDir, 'index.xml');
    const xml = await fs.readFile(xmlPath, 'utf8');
    const catalog = parseKaspiCatalog(xml);
    const result = importFromCatalog(catalog);
    console.log(`Migrated ${result.imported} products from existing XML`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log('XML migration skipped:', e.message);
  }

  try {
    const raw = await fs.readFile(config.autoPricingFile, 'utf8');
    const state = JSON.parse(raw);
    const result = importAutoPricingState(state);
    console.log(`Migrated auto-pricing state for ${result.count} products`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log('Auto-pricing migration skipped:', e.message);
  }
}

const app = createApp();
const server = http.createServer(app);
initRealtime(server);

server.listen(config.port, () => {
  console.log(`Kaspi panel is listening on ${config.port}`);
  logRuntime('server', 'success', `Kaspi panel слушает порт ${config.port}`);
});

startScheduler();
