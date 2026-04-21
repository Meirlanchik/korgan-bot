import { Router } from 'express';
import { config } from '../config.js';
import { parseKaspiProductById } from '../kaspiParser.js';
import { getCurrentStatus } from '../kaspiPriceList.js';
import {
  parseAndStoreProductData,
  parseAndStoreAllProducts,
  recalculateUploadPriceForSku,
  runDbAutoPricingForSku,
} from '../autoPricing.js';
import { refreshScheduler, runAutoPricingNow } from '../services/scheduler.js';
import { getAutoPricingConcurrency } from '../services/concurrency.js';
import { generateAndSaveXml } from '../services/kaspiSync.js';
import {
  getFinanceDashboard,
  getFinanceSettings,
  saveFinanceProductInputs,
  saveFinanceSettings,
} from '../services/kaspiFinance.js';
import {
  getAllProducts,
  getFinanceProducts,
  getProduct,
  upsertProduct,
  deleteProduct,
  bulkUpdateProducts,
  getWarehouses,
  upsertWarehouse,
  getSellers,
  getSellerContext,
  replaceSellers,
  getDashboardStats,
  getProductCount,
  getSetting,
  setSetting,
  getSyncLogs,
  getParseSessions,
  startParseSession,
  finishParseSession,
  importFromKaspiJson,
} from '../db.js';

const router = Router();

// ─── Dashboard ──────────────────────────────────────────

router.get('/status', async (_req, res, next) => {
  try {
    const xmlStatus = await getCurrentStatus(config.publicDir);
    const stats = getDashboardStats();
    res.json({ ...xmlStatus, ...stats });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', (_req, res) => {
  res.json(getDashboardStats());
});

// ─── Products ───────────────────────────────────────────

router.get('/products', (req, res) => {
  const { sort, order, search, available } = req.query;
  res.json(getAllProducts({ sort, order, search, available }));
});

router.post('/products/parse-all', async (req, res, next) => {
  const products = getAllProducts({}).filter((p) => p.shop_link || p.kaspi_id || p.sku || p.model);
  const concurrency = Number(req.body?.concurrency || getAutoPricingConcurrency());
  const session = startParseSession({
    type: 'all_products_api',
    totalCount: products.length,
    concurrency,
    message: `API парсинг всех товаров запущен: ${products.length} товаров`,
  });
  try {
    const results = await parseAndStoreAllProducts({ concurrency });
    const failed = results.filter((r) => r.error).length;
    const success = results.length - failed;
    finishParseSession(session.id, {
      status: success === 0 && failed > 0 ? 'error' : failed ? 'partial' : 'success',
      totalCount: results.length,
      successCount: success,
      errorCount: failed,
      positionsFound: results.filter((r) => Number(r.myPosition || 0) > 0).length,
      concurrency,
      retryCount: results.filter((r) => Number(r.retryAttempt || 0) > 0).length,
      message: `API парсинг завершен: ${results.length} товаров, ошибок ${failed}`,
      details: { results },
    });
    res.json({ sessionId: session.id, results });
  } catch (error) {
    finishParseSession(session.id, {
      status: 'error',
      totalCount: products.length,
      successCount: 0,
      errorCount: products.length,
      positionsFound: 0,
      concurrency,
      message: error.message,
      details: { error: error.message },
    });
    next(error);
  }
});

router.get('/products/:sku', (req, res) => {
  const product = getProduct(req.params.sku);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  const warehouses = getWarehouses(req.params.sku);
  const sellers = getSellers(req.params.sku);
  res.json({ ...product, warehouses, sellers });
});

router.post('/products/:sku', (req, res) => {
  try {
    upsertProduct({ sku: req.params.sku, ...req.body });
    const product = recalculateUploadPriceForSku({ sku: req.params.sku }).product;
    res.json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/products/:sku', (req, res) => {
  deleteProduct(req.params.sku);
  res.json({ ok: true });
});

router.post('/products/bulk/update', (req, res) => {
  try {
    const { skus, updates } = req.body;
    if (!Array.isArray(skus) || !skus.length) {
      return res.status(400).json({ error: 'Выберите товары' });
    }
    bulkUpdateProducts(skus, updates);
    for (const sku of skus) {
      recalculateUploadPriceForSku({ sku });
    }
    res.json({ ok: true, count: skus.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── Warehouses ─────────────────────────────────────────

router.get('/products/:sku/warehouses', (req, res) => {
  res.json(getWarehouses(req.params.sku));
});

router.post('/products/:sku/warehouses/:storeId', (req, res) => {
  try {
    upsertWarehouse(req.params.sku, req.params.storeId, req.body);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── Sellers ────────────────────────────────────────────

router.get('/products/:sku/sellers', (req, res) => {
  const sellers = getSellers(req.params.sku);
  res.json(sellers);
});

router.get('/products/:sku/seller-context', (req, res) => {
  const product = getProduct(req.params.sku);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  const context = getSellerContext(req.params.sku, getSetting('merchant_id', ''));
  res.json(context);
});

router.post('/products/:sku/parse', async (req, res, next) => {
  try {
    const result = await parseAndStoreProductData({ sku: req.params.sku });
    await generateAndSaveXml().catch(() => { });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── Parser ─────────────────────────────────────────────

router.get('/parser/:kaspiId', async (req, res, next) => {
  try {
    res.json(await parseKaspiProductById(req.params.kaspiId));
  } catch (error) {
    next(error);
  }
});

// ─── Auto-pricing ───────────────────────────────────────

router.post('/auto-pricing/run', async (_req, res, next) => {
  try {
    res.json(await runAutoPricingNow({ triggerSource: 'manual' }));
  } catch (error) {
    next(error);
  }
});

router.post('/auto-pricing/:sku/run', async (req, res, next) => {
  try {
    const result = await runDbAutoPricingForSku({ sku: req.params.sku });
    // Regenerate XML
    await generateAndSaveXml().catch(() => { });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── Settings ───────────────────────────────────────────

router.get('/settings', (_req, res) => {
  res.json({
    auto_pricing_interval_ms: getSetting('auto_pricing_interval_ms', '300000'),
    auto_pricing_enabled: getSetting('auto_pricing_enabled', '1'),
    full_parse_interval_ms: getSetting('full_parse_interval_ms', '900000'),
    full_parse_enabled: getSetting('full_parse_enabled', '1'),
    kaspi_pull_interval_ms: getSetting('kaspi_pull_interval_ms', '0'),
    kaspi_pull_enabled: getSetting('kaspi_pull_enabled', '0'),
    kaspi_push_interval_ms: getSetting('kaspi_push_interval_ms', '0'),
    kaspi_push_enabled: getSetting('kaspi_push_enabled', '0'),
    merchant_id: getSetting('merchant_id', ''),
    merchant_name: getSetting('merchant_name', ''),
    ignored_merchant_ids: getSetting('ignored_merchant_ids', getSetting('merchant_id', '')),
  });
});

router.post('/settings', (req, res) => {
  const allowed = [
    'auto_pricing_interval_ms',
    'auto_pricing_enabled',
    'full_parse_interval_ms',
    'full_parse_enabled',
    'kaspi_pull_interval_ms',
    'kaspi_pull_enabled',
    'kaspi_push_interval_ms',
    'kaspi_push_enabled',
    'merchant_id',
    'merchant_name',
    'ignored_merchant_ids',
  ];
  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) {
      setSetting(key, value);
    }
  }
  refreshScheduler();
  res.json({ ok: true });
});

// ─── Finance ───────────────────────────────────────────

router.get('/finance/settings', (_req, res) => {
  res.json(getFinanceSettings());
});

router.post('/finance/settings', (req, res) => {
  try {
    res.json(saveFinanceSettings(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/finance/products', (req, res) => {
  const skus = req.query.sku
    ? (Array.isArray(req.query.sku) ? req.query.sku : [req.query.sku])
    : [];
  res.json(getFinanceProducts(skus));
});

router.post('/finance/products', (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    res.json(saveFinanceProductInputs(items));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/finance/report', async (req, res, next) => {
  try {
    res.json(await getFinanceDashboard(req.query));
  } catch (error) {
    next(error);
  }
});

// ─── Sync Log ───────────────────────────────────────────

router.get('/sync-log', (req, res) => {
  const limit = Number(req.query.limit || 50);
  const type = req.query.type || null;
  res.json(getSyncLogs(limit, type));
});

router.get('/parse-sessions', (req, res) => {
  const limit = Number(req.query.limit || 100);
  res.json(getParseSessions({
    limit,
    type: req.query.type || '',
    status: req.query.status || '',
    triggerSource: req.query.triggerSource || '',
  }));
});

// ─── XML ────────────────────────────────────────────────

router.post('/xml/generate', async (_req, res, next) => {
  try {
    const result = await generateAndSaveXml();
    res.json({ ok: true, offersCount: result.offersCount });
  } catch (error) {
    next(error);
  }
});

// ─── Import ─────────────────────────────────────────────

router.post('/import/kaspi-json', (req, res) => {
  try {
    const result = importFromKaspiJson(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
