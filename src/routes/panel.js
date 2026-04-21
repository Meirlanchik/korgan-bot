import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import {
  parseMerchantIds,
  parseAndStoreProductData,
  recalculateUploadPriceForSku,
  runDbAutoPricingForSku,
} from '../autoPricing.js';
import {
  defaultConfigFromEnv,
  getCurrentStatus,
  processPriceList,
  writeCurrentXml,
  parseKaspiCatalog,
} from '../kaspiPriceList.js';
import { productFromForm, warehousesFromForm } from '../helpers/product.js';
import { generateAndSaveXml } from '../services/kaspiSync.js';
import {
  getAutoPricingSchedulerState,
  getKaspiDownloadSchedulerState,
  getFullParseSchedulerState,
  isAutoPricingRunning,
  isFullParseRunning,
  isKaspiPullRunning,
  isKaspiPushRunning,
  getKaspiUploadSchedulerState,
  queueProductCardBuild,
  refreshScheduler,
  runAutoPricingNow,
  startKaspiDownloadNow,
  startFullParseNow,
  startKaspiUploadNow,
} from '../services/scheduler.js';
import { renderHome } from '../views/home.js';
import { renderHistoryPage } from '../views/history.js';
import { renderProductsPage } from '../views/products.js';
import { renderProductDetailPage } from '../views/productDetail.js';
import { renderSettingsPage } from '../views/settings.js';
import { renderFinancePage } from '../views/finance.js';
import { renderParseSessionDetailPage } from '../views/parseSessions.js';
import { renderXmlUploadPage } from '../views/xmlUpload.js';
import {
  getFinanceDashboard,
  saveFinanceProductInputs,
  saveFinanceSettings,
} from '../services/kaspiFinance.js';
import {
  getAllProducts,
  getProduct,
  upsertProduct,
  deleteProduct,
  bulkUpdateProducts,
  getWarehouses,
  upsertWarehouse,
  deleteWarehousesForProduct,
  getSellers,
  getProductHistory,
  getAllProductHistory,
  getSellerContext,
  getDashboardStats,
  getProductCount,
  getProductsBySkus,
  getSetting,
  setSetting,
  getSyncLogs,
  getSyncLogsInRange,
  getParseSessions,
  getParseSession,
  deleteParseSession,
  clearParseSessions,
  startParseSession,
  finishParseSession,
  addSyncLog,
  addProductHistoryEvent,
  importFromCatalog,
} from '../db.js';
import { logRuntime } from '../logger.js';

const router = Router();
const RESERVED_PRODUCT_ROUTE_SEGMENTS = new Set(['delete', 'bulk', 'new']);

let _upload;
function getUpload() {
  if (!_upload) {
    _upload = multer({
      dest: config.uploadDir,
      limits: { fileSize: config.maxUploadSizeMb * 1024 * 1024 },
    });
  }
  return _upload;
}

// ─── Dashboard ──────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const status = await getCurrentStatus(config.publicDir);
    const stats = getDashboardStats();
    const sessions = getParseSessions({ limit: 30 });
    res.type('html').send(renderHome({
      status,
      stats,
      recentLogs: getSyncLogs(10),
      automationState: {
        autoPricing: getAutoPricingSchedulerState(),
        fullParse: getFullParseSchedulerState(),
        kaspiPull: getKaspiDownloadSchedulerState(),
        kaspiPush: getKaspiUploadSchedulerState(),
      },
      latestSessions: {
        price: sessions.find((session) => ['light_parse', 'auto_pricing'].includes(session.type)) || null,
        build: sessions.find((session) => ['full_parse', 'selected_products', 'single_product'].includes(session.type)) || null,
        pull: sessions.find((session) => session.type === 'kaspi_download') || null,
        push: sessions.find((session) => session.type === 'kaspi_upload') || null,
      },
      message: req.query.message,
      error: req.query.error,
      publicFeedUrl: config.publicFeedUrl,
    }));
  } catch (error) {
    next(error);
  }
});

// ─── Products List ──────────────────────────────────────

router.get('/products', (req, res) => {
  try {
    const { sort, order, search, available } = req.query;
    const products = getAllProducts({ sort, order, search, available });
    const merchantId = getSetting('merchant_id', defaultConfigFromEnv().merchantId);
    const sessions = getParseSessions({ limit: 50 });
    const priceCalculationSessions = sessions
      .filter((session) => ['light_parse', 'auto_pricing'].includes(session.type));
    const currentPriceCalculationSession = priceCalculationSessions.find((session) => session.status === 'running') || null;
    // Attach warehouses summary for each product
    const enriched = products.map((p) => {
      const warehouses = getWarehouses(p.sku);
      return { ...p, warehouses };
    });
    const buildStatesBySku = getBuildStatesBySku(sessions);
    res.type('html').send(renderProductsPage({
      products: enriched,
      counts: getProductCount(),
      message: req.query.message,
      error: req.query.error,
      sort: sort || 'sku',
      order: order || 'asc',
      search: search || '',
      availableFilter: available ?? '',
      merchantId,
      priceCalculationState: getAutoPricingSchedulerState(),
      latestPriceCalculationSession: priceCalculationSessions[0] || null,
      currentPriceCalculationSession,
      priceCalculationProductsCount: getAllProducts({}).filter((product) => Number(product.auto_pricing_enabled) === 1).length,
      buildStatesBySku,
    }));
  } catch (error) {
    res.redirect(`/panel/?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/parse-all', (req, res) => {
  try {
    const products = getAllProducts({}).filter((p) => p.shop_link || p.kaspi_id || p.sku || p.model);
    const session = startBackgroundParseSession({
      products,
      type: 'full_parse',
      logPrefix: 'Сформировать карточки всех товаров',
    });

    const message = `Формирование карточек всех товаров запущено. Сессия #${session.id}.`;
    if (sendActionSuccess(req, res, {
      message,
      redirectTo: '/panel/products',
      status: 202,
      data: { sessionId: session.id },
    })) {
      return;
    }
    res.redirect(303, '/panel/products?message=' + encodeURIComponent(message));
  } catch (error) {
    if (sendActionError(req, res, error, { redirectTo: '/panel/products' })) {
      return;
    }
    res.redirect(303, '/panel/products?error=' + encodeURIComponent(error.message));
  }
});

router.post('/products/bulk/parse', (req, res) => {
  try {
    const skus = asArray(req.body.skus).map((sku) => String(sku || '').trim()).filter(Boolean);
    if (!skus.length) {
      throw new Error('Выберите товары для парсинга.');
    }

    const skuSet = new Set(skus);
    const products = getAllProducts({})
      .filter((product) => skuSet.has(product.sku))
      .filter((product) => product.shop_link || product.kaspi_id || product.sku || product.model);

    if (!products.length) {
      throw new Error('Не найдено товаров, которые можно спарсить.');
    }

    const session = startBackgroundParseSession({
      products,
      type: 'selected_products',
      logPrefix: 'Сформировать карточки выбранных товаров',
    });

    const message = `Формирование карточек выбранных товаров запущено. Сессия #${session.id}.`;
    if (sendActionSuccess(req, res, {
      message,
      redirectTo: '/panel/products',
      status: 202,
      data: { sessionId: session.id, count: products.length },
    })) {
      return;
    }
    res.redirect(303, `/panel/products?message=${encodeURIComponent(message)}`);
  } catch (error) {
    if (sendActionError(req, res, error, { redirectTo: '/panel/products' })) {
      return;
    }
    res.redirect(303, `/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/bulk/light-parse', (req, res) => {
  try {
    const skus = asArray(req.body.skus).map((sku) => String(sku || '').trim()).filter(Boolean);
    if (!skus.length) {
      throw new Error('Выберите товары для расчета цены.');
    }
    if (isAutoPricingRunning()) {
      throw new Error('Расчет цены уже выполняется.');
    }
    if (isFullParseRunning()) {
      throw new Error('Сейчас выполняется формирование карточек. Дождитесь завершения.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Сейчас выполняется загрузка товаров из Kaspi. Дождитесь завершения.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Сейчас выполняется загрузка в Kaspi. Дождитесь завершения.');
    }

    const skuSet = new Set(skus);
    const products = getAllProducts({})
      .filter((product) => skuSet.has(product.sku))
      .filter((product) => product.shop_link || product.kaspi_id || product.sku || product.model);

    if (!products.length) {
      throw new Error('Не найдено товаров, для которых можно запустить расчет цены.');
    }

    runAutoPricingNow({
      products,
      triggerSource: 'manual',
      type: 'light_parse',
      onMessage: async (msg) => console.log(`[price-calculation] ${msg}`),
    }).catch((error) => {
      logRuntime('auto_pricing', 'error', `Ручной расчет цены завершился ошибкой: ${error.message}`);
    });

    const message = `Расчет цены запущен: ${products.length} товаров. Смотрите сессии.`;
    if (sendActionSuccess(req, res, {
      message,
      redirectTo: '/panel/products',
      status: 202,
      data: { count: products.length },
    })) {
      return;
    }
    res.redirect(303, `/panel/products?message=${encodeURIComponent(message)}`);
  } catch (error) {
    if (sendActionError(req, res, error, { redirectTo: '/panel/products' })) {
      return;
    }
    res.redirect(303, `/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/delete', async (req, res) => {
  const sku = String(req.body.sku || '').trim();
  try {
    if (!sku) throw new Error('Не указан SKU для удаления.');
    if (isFullParseRunning()) {
      throw new Error('Нельзя удалять товары во время парсинга.');
    }
    if (isAutoPricingRunning()) {
      throw new Error('Нельзя удалять товары во время расчета цены.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Нельзя удалять товары во время загрузки из Kaspi.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Нельзя удалять товары во время загрузки в Kaspi.');
    }

    const result = deleteProduct(sku);
    if (!result.changes) {
      throw new Error(`Товар ${sku} не найден или уже удален.`);
    }
    await generateAndSaveXml().catch(() => { });
    logRuntime('product_update', 'success', `Удален товар ${sku}`);
    res.redirect(`/panel/products?message=${encodeURIComponent(`Товар ${sku} удален`)}`);
  } catch (error) {
    res.redirect(`/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/bulk/delete', async (req, res) => {
  try {
    if (isFullParseRunning()) {
      throw new Error('Нельзя удалять товары во время парсинга.');
    }
    if (isAutoPricingRunning()) {
      throw new Error('Нельзя удалять товары во время расчета цены.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Нельзя удалять товары во время загрузки из Kaspi.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Нельзя удалять товары во время загрузки в Kaspi.');
    }

    const skus = req.body.skus ? (Array.isArray(req.body.skus) ? req.body.skus : [req.body.skus]) : [];
    if (!skus.length) throw new Error('Выберите товары');

    let deleted = 0;
    for (const sku of skus) {
      const result = deleteProduct(String(sku || '').trim());
      deleted += Number(result.changes || 0);
    }

    await generateAndSaveXml().catch(() => { });
    logRuntime('product_update', 'success', `Удалено товаров: ${deleted}`, { skus, deleted });
    if (sendActionSuccess(req, res, {
      message: `Удалено ${deleted} товаров`,
      redirectTo: '/panel/products',
      data: { deleted, skus },
    })) {
      return;
    }
    res.redirect(`/panel/products?message=${encodeURIComponent(`Удалено ${deleted} товаров`)}`);
  } catch (error) {
    if (sendActionError(req, res, error, { redirectTo: '/panel/products' })) {
      return;
    }
    res.redirect(`/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

// ─── Product Detail ─────────────────────────────────────

router.get('/products/:sku', (req, res) => {
  try {
    const product = getProduct(req.params.sku);
    if (!product) throw new Error(`Товар ${req.params.sku} не найден.`);
    const warehouses = getWarehouses(req.params.sku);
    const sellers = getSellers(req.params.sku);
    const history = getProductHistory(req.params.sku, { limit: 80 });
    const buildState = getBuildStatesBySku(getParseSessions({ limit: 50 }))[req.params.sku] || null;
    const sellerContext = getSellerContext(
      req.params.sku,
      getSetting('merchant_id', defaultConfigFromEnv().merchantId),
    );

    res.type('html').send(renderProductDetailPage({
      product,
      warehouses,
      sellers,
      history,
      buildState,
      sellerContext,
      merchantId: getSetting('merchant_id', defaultConfigFromEnv().merchantId),
      ignoredMerchantIds: parseMerchantIds(
        getSetting('ignored_merchant_ids', getSetting('merchant_id', defaultConfigFromEnv().merchantId)),
      ),
      message: req.query.message,
      error: req.query.error,
    }));
  } catch (error) {
    res.redirect(`/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/:sku', async (req, res) => {
  const sku = req.params.sku;
  try {
    if (RESERVED_PRODUCT_ROUTE_SEGMENTS.has(String(sku || '').toLowerCase())) {
      throw new Error(`Служебный путь /products/${sku} нельзя сохранить как SKU.`);
    }
    const formData = productFromForm(req.body);
    upsertProduct({ ...formData, sku });

    // Handle warehouses
    const warehouses = warehousesFromForm(req.body);
    if (warehouses.length) {
      deleteWarehousesForProduct(sku);
      for (const w of warehouses) {
        upsertWarehouse(sku, w.store_id, w);
      }
    }

    recalculateUploadPriceForSku({ sku });

    // Regenerate XML
    await generateAndSaveXml().catch(() => { });
    logRuntime('product_update', 'success', `Товар ${sku} сохранен`);
    if (sendActionSuccess(req, res, {
      message: 'Товар сохранен',
      redirectTo: `/panel/products/${encodeURIComponent(sku)}`,
      data: { sku },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(sku)}?message=${encodeURIComponent('Товар сохранен')}`);
  } catch (error) {
    logRuntime('product_update', 'error', `Ошибка сохранения ${sku}: ${error.message}`);
    if (sendActionError(req, res, error, {
      redirectTo: `/panel/products/${encodeURIComponent(sku)}`,
      data: { sku },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(sku)}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/:sku/parse', async (req, res) => {
  if (wantsJsonResponse(req)) {
    try {
      const product = getProduct(req.params.sku);
      if (!product) {
        throw new Error(`Товар ${req.params.sku} не найден.`);
      }
      const session = startBackgroundParseSession({
        products: [product],
        type: 'single_product',
        logPrefix: `Сформировать карточку: ${req.params.sku}`,
      });
      res.status(202).json({
        ok: true,
        message: `Формирование карточки запущено. Сессия #${session.id}.`,
        redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
        sessionId: session.id,
        sku: req.params.sku,
      });
      return;
    } catch (error) {
      if (sendActionError(req, res, error, {
        redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
        data: { sku: req.params.sku },
      })) {
        return;
      }
    }
  }

  let session = null;
  try {
    if (isFullParseRunning()) {
      throw new Error('Сейчас выполняется формирование карточек. Дождитесь завершения.');
    }
    if (isAutoPricingRunning()) {
      throw new Error('Сейчас выполняется расчет цены. Дождитесь завершения.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Сейчас выполняется загрузка товаров из Kaspi. Дождитесь завершения.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Сейчас выполняется загрузка в Kaspi. Дождитесь завершения.');
    }

    session = startParseSession({
      type: 'single_product',
      triggerSource: 'manual',
      totalCount: 1,
      concurrency: 1,
      message: `Сформировать карточку: ${req.params.sku}`,
      details: {
        triggerSource: 'manual',
        targetSkus: [req.params.sku],
      },
    });
    const result = await parseAndStoreProductData({
      sku: req.params.sku,
      historyContext: {
        eventType: 'full_parse',
        triggerSource: 'manual',
        sessionId: session.id,
      },
    });
    await generateAndSaveXml().catch(() => { });
    finishParseSession(session.id, {
      status: 'success',
      totalCount: 1,
      successCount: 1,
      errorCount: 0,
      positionsFound: Number(result.product?.my_position || 0) > 0 ? 1 : 0,
      concurrency: 1,
      message: `Карточка товара ${req.params.sku} обновлена`,
      details: {
        triggerSource: 'manual',
        targetSkus: [req.params.sku],
        results: [{
          sku: req.params.sku,
          updated: true,
          myPosition: result.product?.my_position || 0,
          sellersCount: result.allSellers.length,
          kaspiPrice: result.product?.last_kaspi_price || result.parsed?.price || 0,
          firstPlacePrice: result.product?.first_place_price || 0,
          oldUploadPrice: result.priceChange?.oldPrice ?? null,
          newUploadPrice: result.priceChange?.newPrice ?? null,
          competitorPrice: result.priceChange?.competitorPrice ?? null,
          reason: result.priceChange?.reason ?? null,
        }],
      },
    });
    if (sendActionSuccess(req, res, {
      message: 'Карточка товара обновлена',
      redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
      data: { sku: req.params.sku, sessionId: session.id },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(req.params.sku)}?message=${encodeURIComponent('Карточка товара обновлена')}`);
  } catch (error) {
    if (session) {
      addProductHistoryEvent({
        sku: req.params.sku,
        sessionId: session.id,
        eventType: 'full_parse',
        triggerSource: 'manual',
        status: 'error',
        parseMode: 'full',
        message: `Сформировать карточку: ${error.message}`,
        details: { error: error.message },
      });
      finishParseSession(session.id, {
        status: 'error',
        totalCount: 1,
        successCount: 0,
        errorCount: 1,
        positionsFound: 0,
        concurrency: 1,
        message: error.message,
        details: {
          error: error.message,
          sku: req.params.sku,
          triggerSource: 'manual',
          targetSkus: [req.params.sku],
        },
      });
    }
    logRuntime('product_parse', 'error', `Ошибка парсинга ${req.params.sku}: ${error.message}`);
    if (sendActionError(req, res, error, {
      redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
      data: { sku: req.params.sku, sessionId: session?.id || null },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(req.params.sku)}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/:sku/delete', async (req, res) => {
  try {
    if (isFullParseRunning()) {
      throw new Error('Нельзя удалять товары во время парсинга.');
    }
    if (isAutoPricingRunning()) {
      throw new Error('Нельзя удалять товары во время расчета цены.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Нельзя удалять товары во время загрузки из Kaspi.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Нельзя удалять товары во время загрузки в Kaspi.');
    }
    const result = deleteProduct(req.params.sku);
    if (!result.changes) {
      throw new Error(`Товар ${req.params.sku} не найден или уже удален.`);
    }
    await generateAndSaveXml().catch(() => { });
    if (sendActionSuccess(req, res, {
      message: `Товар ${req.params.sku} удален`,
      redirectTo: '/panel/products',
      data: { sku: req.params.sku, deleted: 1 },
    })) {
      return;
    }
    res.redirect(`/panel/products?message=${encodeURIComponent(`Товар ${req.params.sku} удален`)}`);
  } catch (error) {
    if (sendActionError(req, res, error, {
      redirectTo: '/panel/products',
      data: { sku: req.params.sku },
    })) {
      return;
    }
    res.redirect(`/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/:sku/auto-price', async (req, res) => {
  try {
    if (isAutoPricingRunning()) {
      throw new Error('Сейчас выполняется расчет цены. Дождитесь завершения.');
    }
    if (isFullParseRunning()) {
      throw new Error('Сейчас выполняется формирование карточек. Дождитесь завершения.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Сейчас выполняется загрузка товаров из Kaspi. Дождитесь завершения.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Сейчас выполняется загрузка в Kaspi. Дождитесь завершения.');
    }
    const result = await runDbAutoPricingForSku({
      sku: req.params.sku,
      historyContext: {
        eventType: 'light_parse',
        triggerSource: 'manual',
      },
    });
    await generateAndSaveXml().catch(() => { });
    const message = result.updated
      ? `SKU ${result.sku}: цена ${result.oldPrice} → ${result.newPrice}`
      : `SKU ${result.sku}: цена уже ${result.newPrice}`;
    if (sendActionSuccess(req, res, {
      message,
      redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
      data: { sku: req.params.sku, result },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(req.params.sku)}?message=${encodeURIComponent(message)}`);
  } catch (error) {
    if (sendActionError(req, res, error, {
      redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
      data: { sku: req.params.sku },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(req.params.sku)}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/products/:sku/toggle-available', async (req, res) => {
  try {
    const product = getProduct(req.params.sku);
    if (!product) throw new Error('Товар не найден');
    upsertProduct({ sku: req.params.sku, available: product.available ? 0 : 1 });
    await generateAndSaveXml().catch(() => { });
    const message = product.available ? 'Снят с продажи' : 'Выставлен в продажу';
    if (sendActionSuccess(req, res, {
      message,
      redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
      data: { sku: req.params.sku, available: product.available ? 0 : 1 },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(req.params.sku)}?message=${encodeURIComponent(product.available ? 'Снят с продажи' : 'Выставлен в продажу')}`);
  } catch (error) {
    if (sendActionError(req, res, error, {
      redirectTo: `/panel/products/${encodeURIComponent(req.params.sku)}`,
      data: { sku: req.params.sku },
    })) {
      return;
    }
    res.redirect(`/panel/products/${encodeURIComponent(req.params.sku)}?error=${encodeURIComponent(error.message)}`);
  }
});

// ─── Bulk actions ───────────────────────────────────────

router.post('/products/bulk/update', async (req, res) => {
  try {
    const skus = req.body.skus ? (Array.isArray(req.body.skus) ? req.body.skus : [req.body.skus]) : [];
    if (!skus.length) throw new Error('Выберите товары');

    const updates = {};
    if (req.body.bulkAvailable !== undefined && req.body.bulkAvailable !== '') {
      updates.available = Number(req.body.bulkAvailable);
    }
    if (req.body.bulkAutopricing !== undefined && req.body.bulkAutopricing !== '') {
      updates.auto_pricing_enabled = Number(req.body.bulkAutopricing);
    }
    if (req.body.bulkMinPrice !== undefined && req.body.bulkMinPrice !== '') {
      updates.min_price = Number(req.body.bulkMinPrice);
    }
    if (req.body.bulkMaxPrice !== undefined && req.body.bulkMaxPrice !== '') {
      updates.max_price = Number(req.body.bulkMaxPrice);
    }
    if (req.body.bulkPreOrder !== undefined && req.body.bulkPreOrder !== '') {
      updates.pre_order = Number(req.body.bulkPreOrder);
    }

    bulkUpdateProducts(skus, updates);
    applyBulkWarehouseUpdates({
      skus,
      warehouseUpdates: bulkWarehouseUpdatesFromBody(req.body),
      bulkPreOrder: updates.pre_order,
    });
    for (const sku of skus) {
      recalculateUploadPriceForSku({ sku });
    }
    await generateAndSaveXml().catch(() => { });
    if (sendActionSuccess(req, res, {
      message: `Обновлено ${skus.length} товаров`,
      redirectTo: '/panel/products',
      data: { skus, updates },
    })) {
      return;
    }
    res.redirect(`/panel/products?message=${encodeURIComponent(`Обновлено ${skus.length} товаров`)}`);
  } catch (error) {
    if (sendActionError(req, res, error, { redirectTo: '/panel/products' })) {
      return;
    }
    res.redirect(`/panel/products?error=${encodeURIComponent(error.message)}`);
  }
});

// ─── Finance ───────────────────────────────────────────

router.get('/finance', async (req, res) => {
  try {
    const dashboard = await getFinanceDashboard(req.query);
    res.type('html').send(renderFinancePage({
      ...dashboard,
      message: req.query.message,
      error: req.query.error,
    }));
  } catch (error) {
    res.redirect(`/panel/?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/finances', (req, res) => {
  const query = new URLSearchParams(req.query || {});
  const suffix = query.toString() ? `?${query.toString()}` : '';
  res.redirect(302, `/panel/finance${suffix}`);
});

router.post('/finance/settings', (req, res) => {
  try {
    saveFinanceSettings(req.body);
    res.redirect(`/panel/finance?message=${encodeURIComponent('Финансовые настройки сохранены')}`);
  } catch (error) {
    res.redirect(`/panel/finance?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/finance/products/save', (req, res) => {
  try {
    const skus = asArray(req.body['sku[]'] ?? req.body.sku);
    const titles = asArray(req.body['title[]'] ?? req.body.title);
    const purchasePrices = asArray(req.body['purchasePrice[]'] ?? req.body.purchasePrice);
    const commissionRates = asArray(req.body['commissionRate[]'] ?? req.body.commissionRate);

    const items = skus.map((sku, index) => ({
      sku,
      title: titles[index] || '',
      purchase_price: purchasePrices[index] || 0,
      commission_rate: commissionRates[index] ?? '',
    }));

    saveFinanceProductInputs(items);

    const returnTo = normalizeFinanceReturnTo(req.body.returnTo);
    res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}message=${encodeURIComponent('Себестоимость и комиссии сохранены')}`);
  } catch (error) {
    const returnTo = normalizeFinanceReturnTo(req.body.returnTo);
    res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.message)}`);
  }
});

// ─── XML upload/download ────────────────────────────────

router.get('/download', (_req, res) => {
  res.download(path.join(config.publicDir, 'index.xml'), 'kaspi_catalog.xml');
});

router.get('/xml', async (req, res, next) => {
  try {
    const status = await getCurrentStatus(config.publicDir);
    res.type('html').send(renderXmlUploadPage({
      status,
      message: req.query.message,
      error: req.query.error,
    }));
  } catch (error) {
    next(error);
  }
});

router.post('/xml/upload', (req, res, next) => getUpload().single('xmlFile')(req, res, next), async (req, res) => {
  const file = req.file;
  try {
    if (!file) throw new Error('Выберите XML файл.');
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.xml') throw new Error('Нужен файл с расширением .xml.');

    const xmlContent = await fs.readFile(file.path, 'utf8');
    const catalog = parseKaspiCatalog(xmlContent);
    const dbResult = importFromCatalog(catalog, { importedAvailable: 0 });
    await generateAndSaveXml();
    const cardBuildInfo = queueNewProductCardBuilds(dbResult.importedSkus, {
      sourceLabel: 'XML',
      logPrefix: 'Автоформирование карточек новых товаров из XML',
    });

    addSyncLog('xml_upload', 'success', `XML загружен: новых ${dbResult.imported}, обновлено ${dbResult.updated}, товары выключены`, {
      importedSkus: dbResult.importedSkus,
      updatedSkus: dbResult.updatedSkus,
      cardBuildInfo,
    });
    res.redirect(303, `/panel/products?message=${encodeURIComponent(`XML загружен: новых ${dbResult.imported}, обновлено ${dbResult.updated}. Товары сразу поставлены "не в продаже". ${formatCardBuildMessage(cardBuildInfo)}`.trim())}`);
  } catch (error) {
    res.redirect(303, `/panel/xml?error=${encodeURIComponent(error.message)}`);
  } finally {
    if (file?.path) await fs.rm(file.path, { force: true }).catch(() => { });
  }
});

router.post('/upload', (req, res, next) => getUpload().single('priceList')(req, res, next), async (req, res) => {
  const file = req.file;
  try {
    if (!file) throw new Error('Выберите файл прайс-листа.');
    const cfg = {
      company: req.body.company || defaultConfigFromEnv().company,
      merchantId: req.body.merchantId || defaultConfigFromEnv().merchantId,
      storeIds: req.body.storeIds || defaultConfigFromEnv().storeIds,
    };
    const result = await processPriceList(file.path, file.originalname, cfg);
    await writeCurrentXml(config.publicDir, result.xml);

    // Import into DB
    const xmlContent = await fs.readFile(path.join(config.publicDir, 'index.xml'), 'utf8');
    const catalog = parseKaspiCatalog(xmlContent);
    const ext = path.extname(file.originalname || '').toLowerCase();
    const dbResult = importFromCatalog(catalog, { importedAvailable: ext === '.xml' ? 0 : 1 });
    if (ext === '.xml') {
      await generateAndSaveXml();
    }
    const cardBuildInfo = queueNewProductCardBuilds(dbResult.importedSkus, {
      sourceLabel: ext === '.xml' ? 'XML' : 'прайса',
      logPrefix: ext === '.xml'
        ? 'Автоформирование карточек новых товаров из XML'
        : 'Автоформирование карточек новых товаров из прайса',
    });

    const inactiveNote = ext === '.xml' ? '. Товары сразу поставлены "не в продаже".' : '';
    res.redirect(`/panel/?message=${encodeURIComponent(`Загружено ${result.offersCount} товаров: новых ${dbResult.imported}, обновлено ${dbResult.updated}${inactiveNote} ${formatCardBuildMessage(cardBuildInfo)}`.trim())}`);
  } catch (error) {
    res.redirect(`/panel/?error=${encodeURIComponent(error.message)}`);
  } finally {
    if (file?.path) await fs.rm(file.path, { force: true }).catch(() => { });
  }
});

// ─── Kaspi cabinet ──────────────────────────────────────

router.post('/kaspi/download', async (req, res) => {
  try {
    const task = startKaspiDownloadNow({
      triggerSource: 'manual',
      onMessage: async (msg) => console.log(`[kaspi-download] ${msg}`),
    });
    task.promise.catch((error) => {
      logRuntime('pull_kaspi', 'error', `Фоновая загрузка товаров из Kaspi завершилась ошибкой: ${error.message}`);
    });
    const redirectTo = returnBackPath(req, '/panel/products');
    const message = `Загрузка товаров из Kaspi запущена. Сессия #${task.session.id}.`;
    if (sendActionSuccess(req, res, {
      message,
      redirectTo,
      status: 202,
      data: { sessionId: task.session.id },
    })) {
      return;
    }
    res.redirect(303, `${redirectTo}?message=${encodeURIComponent(message)}`);
  } catch (error) {
    const redirectTo = returnBackPath(req, '/panel/');
    if (sendActionError(req, res, error, { redirectTo })) {
      return;
    }
    res.redirect(303, `${returnBackPath(req, '/panel/')}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/kaspi/upload', async (req, res) => {
  try {
    const task = startKaspiUploadNow({
      triggerSource: 'manual',
      onMessage: async (msg) => console.log(`[kaspi-upload] ${msg}`),
    });
    task.promise.catch((error) => {
      logRuntime('push_kaspi', 'error', `Фоновая загрузка в Kaspi завершилась ошибкой: ${error.message}`);
    });
    const redirectTo = returnBackPath(req, '/panel/');
    const message = `Загрузка в Kaspi запущена. Сессия #${task.session.id}.`;
    if (sendActionSuccess(req, res, {
      message,
      redirectTo,
      status: 202,
      data: { sessionId: task.session.id },
    })) {
      return;
    }
    res.redirect(303, `${redirectTo}?message=${encodeURIComponent(message)}`);
  } catch (error) {
    if (sendActionError(req, res, error, { redirectTo: '/panel/' })) {
      return;
    }
    res.redirect(303, `/panel/?error=${encodeURIComponent(error.message)}`);
  }
});

// ─── Auto pricing ───────────────────────────────────────

router.post('/auto-pricing/run', (req, res) => {
  try {
    if (isAutoPricingRunning()) {
      throw new Error('Расчет цены уже выполняется.');
    }
    if (isFullParseRunning()) {
      throw new Error('Сейчас выполняется формирование карточек. Дождитесь завершения.');
    }
    if (isKaspiPullRunning()) {
      throw new Error('Сейчас выполняется загрузка товаров из Kaspi. Дождитесь завершения.');
    }
    if (isKaspiPushRunning()) {
      throw new Error('Сейчас выполняется загрузка в Kaspi. Дождитесь завершения.');
    }

    runAutoPricingNow({ triggerSource: 'manual' })
      .then((results) => {
        const updated = results.filter((r) => r.updated).length;
        const failed = results.filter((r) => r.error).length;
        logRuntime('auto_pricing', failed ? 'error' : 'success', `Ручной расчет цены завершен: ${results.length} товаров, изменено ${updated}, ошибок ${failed}`);
      })
      .catch((error) => {
        logRuntime('auto_pricing', 'error', `Ручной расчет цены завершился ошибкой: ${error.message}`);
      });

    const redirectTo = autoPricingReturnPath(req);
    const message = 'Расчет цены запущен. Прогресс смотрите в сессиях.';
    if (sendActionSuccess(req, res, {
      message,
      redirectTo,
      status: 202,
    })) {
      return;
    }
    res.redirect(303, `${redirectTo}?message=${encodeURIComponent(message)}`);
  } catch (error) {
    const redirectTo = autoPricingReturnPath(req);
    if (sendActionError(req, res, error, { redirectTo })) {
      return;
    }
    res.redirect(303, `${autoPricingReturnPath(req)}?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/auto-pricing', (_req, res) => {
  res.redirect(302, '/panel/settings');
});

router.get('/settings', (req, res) => {
  try {
    res.type('html').send(renderSettingsPage({
      automationState: {
        autoPricing: getAutoPricingSchedulerState(),
        fullParse: getFullParseSchedulerState(),
        kaspiPull: getKaspiDownloadSchedulerState(),
        kaspiPush: getKaspiUploadSchedulerState(),
      },
      ignoredMerchantIds: parseMerchantIds(getSetting('ignored_merchant_ids', '')),
      message: req.query.message,
      error: req.query.error,
    }));
  } catch (error) {
    res.redirect(`/panel/?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/auto-pricing/settings', (req, res) => {
  res.redirect(307, '/panel/settings/automation');
});

router.post('/settings/automation', (req, res) => {
  try {
    updateAutomationSetting('auto_pricing_enabled', req.body.autoPricingEnabled);
    updateAutomationSetting('full_parse_enabled', req.body.fullParseEnabled);
    updateAutomationSetting('kaspi_pull_enabled', req.body.kaspiPullEnabled);
    updateAutomationSetting('kaspi_push_enabled', req.body.kaspiPushEnabled);

    updateIntervalSetting('auto_pricing_interval_ms', req.body.autoPricingIntervalMin, 5);
    updateIntervalSetting('full_parse_interval_ms', req.body.fullParseIntervalMin, 15);
    updateIntervalSetting('kaspi_pull_interval_ms', req.body.kaspiPullIntervalMin, 0);
    updateIntervalSetting('kaspi_push_interval_ms', req.body.kaspiPushIntervalMin, 0);

    const ignoredMerchantIds = parseMerchantIds(asArray(req.body['ignoredMerchantIds[]'] ?? req.body.ignoredMerchantIds).join('\n'));
    setSetting('ignored_merchant_ids', ignoredMerchantIds.join('\n'));
    refreshScheduler();
    logRuntime('settings', 'success', 'Настройки автоматизации сохранены', {
      autoPricingEnabled: getSetting('auto_pricing_enabled', '1'),
      fullParseEnabled: getSetting('full_parse_enabled', '1'),
      kaspiPullEnabled: getSetting('kaspi_pull_enabled', '0'),
      kaspiPushEnabled: getSetting('kaspi_push_enabled', '0'),
      ignoredMerchantIds,
    });
    res.redirect(`${normalizeSettingsReturnTo(req.body.returnTo)}?message=${encodeURIComponent('Настройки сохранены')}`);
  } catch (error) {
    res.redirect(`${normalizeSettingsReturnTo(req.body.returnTo)}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/auto-pricing/toggle', (req, res) => {
  try {
    const enabled = getSetting('auto_pricing_enabled', '1') === '1';
    setSetting('auto_pricing_enabled', enabled ? '0' : '1');
    refreshScheduler();
    res.redirect(`/panel/settings?message=${encodeURIComponent(enabled ? 'Авторасчет цены выключен' : 'Авторасчет цены включен')}`);
  } catch (error) {
    res.redirect(`/panel/settings?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/settings/general', (req, res) => {
  try {
    const merchantId = String(req.body.merchantId || '').trim();
    const merchantName = String(req.body.merchantName || '').trim();
    if (!merchantId) {
      throw new Error('Укажите Merchant ID.');
    }

    setSetting('merchant_id', merchantId);
    setSetting('merchant_name', merchantName);

    const ignoredMerchantIds = parseMerchantIds(getSetting('ignored_merchant_ids', merchantId));
    if (!ignoredMerchantIds.includes(merchantId)) {
      ignoredMerchantIds.unshift(merchantId);
      setSetting('ignored_merchant_ids', ignoredMerchantIds.join('\n'));
    }

    logRuntime('settings', 'success', `Обновлен Merchant ID: ${merchantId}`);
    res.redirect(`/panel/?message=${encodeURIComponent('Главные настройки сохранены')}`);
  } catch (error) {
    res.redirect(`/panel/?error=${encodeURIComponent(error.message)}`);
  }
});

// ─── Sync log ───────────────────────────────────────────

router.get('/sync-log', (_req, res) => {
  res.redirect(302, '/panel/history?tab=events');
});

router.get('/history', (req, res) => {
  try {
    const tab = String(req.query.tab || 'events') === 'sessions' ? 'sessions' : 'events';
    const filters = {
      tab,
      eventType: String(req.query.eventType || ''),
      eventStatus: String(req.query.eventStatus || ''),
      eventSearch: String(req.query.eventSearch || ''),
      sessionType: String(req.query.sessionType || ''),
      sessionStatus: String(req.query.sessionStatus || ''),
      sessionSource: String(req.query.sessionSource || ''),
    };
    const events = getAllProductHistory({
      limit: 200,
      eventType: filters.eventType,
      status: filters.eventStatus,
      search: filters.eventSearch,
    });
    const sessions = getParseSessions({
      limit: 200,
      type: filters.sessionType || '',
      status: filters.sessionStatus || '',
      triggerSource: filters.sessionSource || '',
    });
    res.type('html').send(renderHistoryPage({
      events,
      sessions,
      filters,
      message: req.query.message,
      error: req.query.error,
    }));
  } catch (error) {
    res.redirect(`/panel/?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/parse-sessions', (_req, res) => {
  res.redirect(302, '/panel/history?tab=sessions');
});

router.get('/parse-sessions/:id', (req, res) => {
  try {
    const session = getParseSession(req.params.id);
    if (!session) {
      throw new Error(`Сессия #${req.params.id} не найдена.`);
    }

    const relatedLogs = getSyncLogsInRange({
      from: session.started_at,
      to: session.finished_at || new Date().toISOString(),
      limit: 300,
    });

    res.type('html').send(renderParseSessionDetailPage({
      session,
      relatedLogs,
      message: req.query.message,
      error: req.query.error,
    }));
  } catch (error) {
    res.redirect(`/panel/parse-sessions?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/parse-sessions/:id/delete', (req, res) => {
  try {
    const result = deleteParseSession(req.params.id);
    if (!result.deleted) {
      throw new Error('Сессия не найдена или еще выполняется.');
    }

    res.redirect(303, `${returnBackPath(req, '/panel/parse-sessions')}?message=${encodeURIComponent('Сессия очищена')}`);
  } catch (error) {
    res.redirect(303, `${returnBackPath(req, '/panel/parse-sessions')}?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/parse-sessions/clear', (req, res) => {
  try {
    const type = String(req.body.type || '').trim();
    const types = asArray(req.body.types).map((value) => String(value || '').trim()).filter(Boolean);
    const triggerSource = ['manual', 'auto'].includes(String(req.body.triggerSource || ''))
      ? String(req.body.triggerSource)
      : '';
    const result = clearParseSessions({ type, types, triggerSource });
    res.redirect(303, `${returnBackPath(req, '/panel/parse-sessions')}?message=${encodeURIComponent(`Очищено сессий: ${result.deleted}`)}`);
  } catch (error) {
    res.redirect(303, `${returnBackPath(req, '/panel/parse-sessions')}?error=${encodeURIComponent(error.message)}`);
  }
});

function startBackgroundParseSession({
  products,
  type = 'full_parse',
  triggerSource = 'manual',
  logPrefix = 'Сформировать карточку',
} = {}) {
  const task = startFullParseNow({
    products,
    type,
    triggerSource,
    logPrefix,
    onMessage: async (msg) => console.log(`[${type}] ${msg}`),
  });

  task.promise.catch((error) => {
    logRuntime('product_parse', 'error', `${logPrefix} завершился ошибкой: ${error.message}`);
  });

  return task.session;
}

function queueNewProductCardBuilds(importedSkus, {
  sourceLabel = 'файла',
  logPrefix = 'Автоформирование карточек новых товаров',
} = {}) {
  const normalizedSkus = asArray(importedSkus)
    .map((sku) => String(sku || '').trim())
    .filter(Boolean);

  if (!normalizedSkus.length) {
    return {
      importedCount: 0,
      queuedCount: 0,
      started: false,
      scheduled: false,
      disabled: false,
      nextRunAt: null,
      session: null,
      sourceLabel,
    };
  }

  const products = getProductsBySkus(normalizedSkus);
  const queueResult = queueProductCardBuild({
    products,
    triggerSource: 'import',
    logPrefix,
  });

  return {
    importedCount: products.length,
    queuedCount: queueResult.queuedCount || 0,
    started: Boolean(queueResult.started),
    scheduled: Boolean(queueResult.scheduled),
    disabled: Boolean(queueResult.disabled),
    nextRunAt: queueResult.nextRunAt || null,
    session: queueResult.session || null,
    sourceLabel,
  };
}

function formatCardBuildMessage(cardBuildInfo) {
  if (!cardBuildInfo?.importedCount) {
    return '';
  }

  if (cardBuildInfo.started && cardBuildInfo.session) {
    return `Для новых товаров из ${cardBuildInfo.sourceLabel} сразу запущено формирование карточек. Сессия #${cardBuildInfo.session.id}.`;
  }

  if (cardBuildInfo.disabled) {
    return `Автоформирование сейчас выключено, поэтому новые товары из ${cardBuildInfo.sourceLabel} не запускались автоматически.`;
  }

  if (cardBuildInfo.scheduled && cardBuildInfo.queuedCount) {
    return `Новые товары из ${cardBuildInfo.sourceLabel} поставлены в очередь и будут сформированы по расписанию: ${cardBuildInfo.queuedCount}.`;
  }

  if (cardBuildInfo.queuedCount) {
    return `Новые товары из ${cardBuildInfo.sourceLabel} поставлены в очередь на формирование карточек: ${cardBuildInfo.queuedCount}.`;
  }

  return `Для новых товаров из ${cardBuildInfo.sourceLabel} карточки формируются автоматически.`;
}

function bulkWarehouseUpdatesFromBody(body) {
  const storeIds = asArray(firstDefined(body.bulkStoreId, body['bulkStoreId[]']));
  const enabledList = asArray(firstDefined(body.bulkWarehouseEnabled, body['bulkWarehouseEnabled[]']));
  const stockList = asArray(firstDefined(body.bulkStockCount, body['bulkStockCount[]']));
  const actualStockList = asArray(firstDefined(body.bulkActualStock, body['bulkActualStock[]']));
  const preOrderList = asArray(firstDefined(body.bulkWarehousePreOrder, body['bulkWarehousePreOrder[]']));

  return storeIds
    .map((storeId, index) => {
      const normalizedStoreId = String(storeId || '').trim();
      if (!normalizedStoreId) return null;

      const update = {
        store_id: normalizedStoreId,
        enabled: optionalNumber(enabledList[index]),
        stock_count: optionalNumber(stockList[index]),
        actual_stock: optionalNumber(actualStockList[index]),
        pre_order: optionalNumber(preOrderList[index]),
      };

      const hasValue = update.enabled !== null
        || update.stock_count !== null
        || update.actual_stock !== null
        || update.pre_order !== null;

      return hasValue ? update : null;
    })
    .filter(Boolean);
}

function applyBulkWarehouseUpdates({ skus, warehouseUpdates, bulkPreOrder }) {
  const shouldSyncPreOrder = bulkPreOrder !== undefined && bulkPreOrder !== null;
  if (!warehouseUpdates.length && !shouldSyncPreOrder) return;

  for (const sku of skus) {
    const existingWarehouses = getWarehouses(sku);
    const exactMap = new Map(existingWarehouses.map((w) => [String(w.store_id), w]));
    const shortMap = new Map(existingWarehouses.map((w) => [shortStoreId(w.store_id), w]));

    if (shouldSyncPreOrder) {
      for (const warehouse of existingWarehouses) {
        upsertWarehouse(sku, warehouse.store_id, {
          ...warehouse,
          pre_order: bulkPreOrder,
        });
      }
    }

    for (const update of warehouseUpdates) {
      const existing = exactMap.get(update.store_id) || shortMap.get(shortStoreId(update.store_id)) || null;
      const storeId = existing?.store_id || update.store_id;
      const preOrder = update.pre_order ?? bulkPreOrder ?? existing?.pre_order ?? 0;
      const stockCount = update.stock_count ?? existing?.stock_count ?? 0;

      upsertWarehouse(sku, storeId, {
        enabled: update.enabled ?? existing?.enabled ?? 1,
        available: existing?.available || 'yes',
        stock_count: stockCount,
        actual_stock: update.actual_stock ?? existing?.actual_stock ?? stockCount,
        pre_order: preOrder,
      });
    }
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function shortStoreId(id) {
  const value = String(id || '');
  const match = value.match(/_?(PP\d+)$/i);
  return match ? match[1].toUpperCase() : value.toUpperCase();
}

function parseSessionDetails(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getBuildStatesBySku(sessions = []) {
  const states = {};
  const buildTypes = new Set(['full_parse', 'selected_products', 'single_product']);

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session.status !== 'running' || !buildTypes.has(session.type)) {
      continue;
    }

    const details = parseSessionDetails(session.details);
    const targetSkus = asArray(details.targetSkus)
      .map((sku) => String(sku || '').trim())
      .filter(Boolean);
    const finishedSkus = new Set(
      asArray(details.results)
        .map((result) => String(result?.sku || '').trim())
        .filter(Boolean),
    );

    for (const sku of targetSkus) {
      if (finishedSkus.has(sku)) {
        continue;
      }
      states[sku] = {
        state: 'building',
        sessionId: session.id,
        startedAt: session.started_at,
      };
    }
  }

  return states;
}

function updateAutomationSetting(key, value) {
  if (value === undefined) {
    return;
  }
  setSetting(key, String(Number(String(value) === '1' || String(value).toLowerCase() === 'true')));
}

function updateIntervalSetting(key, value, fallbackMinutes = 0) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  const minutes = Math.max(0, Number(value));
  const intervalMs = Number.isFinite(minutes)
    ? Math.round(minutes * 60000)
    : Math.max(0, Number(fallbackMinutes) * 60000);
  setSetting(key, String(intervalMs));
}

function autoPricingReturnPath(req) {
  const referer = String(req.get('referer') || '');
  if (referer.includes('/panel/settings')) return '/panel/settings';
  if (referer.includes('/panel/')) return '/panel/';
  return '/panel/products';
}

function normalizeSettingsReturnTo(value) {
  const target = String(value || '').trim();
  if (target === '/panel/' || target === '/panel/settings') {
    return target;
  }
  return '/panel/settings';
}

function normalizeFinanceReturnTo(value) {
  const target = String(value || '').trim();
  return target.startsWith('/panel/finance') ? target : '/panel/finance';
}

function returnBackPath(req, fallback) {
  const referer = String(req.get('referer') || '');
  if (referer.includes('/panel/products')) return '/panel/products';
  if (referer.includes('/panel/settings')) return '/panel/settings';
  if (referer.includes('/panel/finance')) return '/panel/finance';
  if (referer.includes('/panel/history')) return '/panel/history';
  if (referer.includes('/panel/parse-sessions')) return '/panel/history?tab=sessions';
  if (referer.includes('/panel/')) return '/panel/';
  return fallback;
}

function wantsJsonResponse(req) {
  const accept = String(req.get('accept') || '');
  return req.get('x-kaspi-async') === '1' || accept.includes('application/json');
}

function sendActionSuccess(req, res, {
  message = '',
  redirectTo = '',
  status = 200,
  data = {},
} = {}) {
  if (!wantsJsonResponse(req)) {
    return false;
  }

  res.status(status).json({
    ok: true,
    message,
    redirectTo,
    ...(data && typeof data === 'object' ? data : {}),
  });
  return true;
}

function sendActionError(req, res, error, {
  redirectTo = '',
  status = 400,
  data = {},
} = {}) {
  if (!wantsJsonResponse(req)) {
    return false;
  }

  res.status(status).json({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    redirectTo,
    ...(data && typeof data === 'object' ? data : {}),
  });
  return true;
}

export default router;
