import { config } from '../config.js';
import { parseAndStoreAllProducts, runDbAutoPricingForAll } from '../autoPricing.js';
import {
  getAllProducts,
  getSetting,
  addSyncLog,
  startParseSession,
  finishParseSession,
  updateParseSessionProgress,
} from '../db.js';
import { getAutoPricingConcurrency } from './concurrency.js';
import {
  generateAndSaveXml,
  pullKaspiPriceList,
  pushKaspiPriceList,
  readKaspiUploadStatus,
} from './kaspiSync.js';
import { waitForKaspiOtp } from './otp.js';
import { logRuntime } from '../logger.js';

let autoPricingInProgress = false;
let fullParseInProgress = false;
let kaspiPullInProgress = false;
let kaspiPushInProgress = false;
let autoPricingTimer = null;
let autoPricingNextRunAt = null;
let fullParseTimer = null;
let fullParseNextRunAt = null;
let kaspiPullTimer = null;
let kaspiPullNextRunAt = null;
let kaspiPushTimer = null;
let kaspiPushNextRunAt = null;
let queuedCardBuildTimer = null;
let queuedCardBuildProducts = new Map();
let queuedCardBuildLogPrefix = 'Автоформирование карточек новых товаров';
let queuedCardBuildHistorySource = 'import';
const KASPI_UPLOAD_STATUS_POLL_MS = 60_000;
const KASPI_UPLOAD_STATUS_TIMEOUT_MS = 45 * 60_000;
const KASPI_UPLOAD_STATUS_MAX_ERRORS = 3;
const SCHEDULER_BUSY_RETRY_MS = 10_000;

export function isAutoPricingRunning() {
  return autoPricingInProgress;
}

export function isKaspiPushRunning() {
  return kaspiPushInProgress;
}

export function isKaspiPullRunning() {
  return kaspiPullInProgress;
}

export function isFullParseRunning() {
  return fullParseInProgress;
}

export function getAutoPricingSchedulerState() {
  const intervalMs = Number(getSetting('auto_pricing_interval_ms', String(config.autoPricingIntervalMs)));
  const enabled = getSetting('auto_pricing_enabled', intervalMs > 0 ? '1' : '0') === '1'
    && Number.isFinite(intervalMs)
    && intervalMs > 0;
  return {
    enabled,
    intervalMs,
    nextRunAt: autoPricingNextRunAt,
    running: autoPricingInProgress,
  };
}

export function getFullParseSchedulerState() {
  const intervalMs = Number(getSetting('full_parse_interval_ms', String(config.fullParseIntervalMs)));
  const enabled = getSetting('full_parse_enabled', intervalMs > 0 ? '1' : '0') === '1'
    && Number.isFinite(intervalMs)
    && intervalMs > 0;
  return {
    enabled,
    intervalMs,
    nextRunAt: fullParseNextRunAt,
    running: fullParseInProgress,
  };
}

export function getKaspiDownloadSchedulerState() {
  const intervalMs = Number(getSetting('kaspi_pull_interval_ms', '0'));
  const enabled = getSetting('kaspi_pull_enabled', intervalMs > 0 ? '1' : '0') === '1'
    && Number.isFinite(intervalMs)
    && intervalMs > 0;
  return {
    enabled,
    intervalMs,
    nextRunAt: kaspiPullNextRunAt,
    running: kaspiPullInProgress,
  };
}

export function getKaspiUploadSchedulerState() {
  const intervalMs = Number(getSetting('kaspi_push_interval_ms', '0'));
  const enabled = getSetting('kaspi_push_enabled', intervalMs > 0 ? '1' : '0') === '1'
    && Number.isFinite(intervalMs)
    && intervalMs > 0;
  return {
    enabled,
    intervalMs,
    nextRunAt: kaspiPushNextRunAt,
    running: kaspiPushInProgress,
  };
}

export async function runAutoPricingNow({
  products: providedProducts = null,
  onMessage = async (msg) => console.log(`[auto-pricing] ${msg}`),
  triggerSource = 'manual',
  type = 'light_parse',
} = {}) {
  if (autoPricingInProgress) {
    throw new Error('Расчет цены уже выполняется.');
  }
  if (fullParseInProgress) {
    throw new Error('Сейчас идет формирование карточек. Дождитесь завершения.');
  }
  if (kaspiPullInProgress) {
    throw new Error('Сейчас идет загрузка товаров из Kaspi. Дождитесь завершения.');
  }
  if (kaspiPushInProgress) {
    throw new Error('Сейчас идет загрузка в Kaspi. Дождитесь завершения.');
  }

  autoPricingInProgress = true;
  const concurrency = getAutoPricingConcurrency();
  const manualProductList = Array.isArray(providedProducts);
  const sourceProducts = manualProductList ? providedProducts : getAllProducts({});
  const products = sourceProducts.filter(
    (p) => (manualProductList || p.auto_pricing_enabled)
      && (p.shop_link || p.kaspi_id || p.sku || p.model)
      && p.min_price != null
      && p.max_price != null,
  );
  const session = startParseSession({
    type,
    triggerSource,
    totalCount: products.length,
    concurrency,
    message: triggerSource === 'auto'
      ? `Расчет цены по расписанию: ${products.length} товаров`
      : `Ручной расчет цены: ${products.length} товаров`,
    details: {
      triggerSource,
      targetSkus: products.map((product) => product.sku),
    },
  });

  try {
    logRuntime('auto_pricing', 'info', triggerSource === 'auto'
      ? 'Запущен расчет цены по расписанию'
      : 'Запущен ручной расчет цены');
    const results = await runDbAutoPricingForAll({
      products,
      onMessage,
      concurrency,
      historyContext: {
        eventType: 'light_parse',
        triggerSource,
        sessionId: session.id,
      },
      onProgress: async (progress) => {
        updateParseSessionProgress(session.id, {
          totalCount: progress.totalCount,
          successCount: progress.successCount,
          errorCount: progress.errorCount,
          positionsFound: progress.positionsFound,
          retryCount: progress.retryCount,
          concurrency,
          message: buildAutoPricingMessage(progress, triggerSource),
          details: {
            triggerSource,
            targetSkus: products.map((product) => product.sku),
            results: progress.results,
          },
        });
      },
    });

    // Regenerate XML from DB after auto-pricing
    try {
      await generateAndSaveXml();
    } catch (e) {
      console.error('Failed to regenerate XML after auto-pricing:', e.message);
    }

    const updated = results.filter((r) => r.updated).length;
    const failed = results.filter((r) => r.error).length;
    finishParseSession(session.id, {
      status: updated === 0 && failed > 0 ? 'error' : failed ? 'partial' : 'success',
      totalCount: results.length,
      successCount: results.length - failed,
      errorCount: failed,
      positionsFound: results.filter((result) => Number(result.myPosition || 0) > 0).length,
      concurrency,
      retryCount: results.filter((result) => Number(result.retryAttempt || 0) > 0).length,
      message: buildAutoPricingSummary(results, triggerSource),
      details: {
        triggerSource,
        targetSkus: products.map((product) => product.sku),
        results,
      },
    });
    addSyncLog('auto_pricing', failed ? 'partial' : 'success',
      `Расчет цены: проверено ${results.length}, изменено ${updated}, ошибок ${failed}, запуск ${triggerSource === 'auto' ? 'авто' : 'ручной'}`,
      { triggerSource, results });

    return results;
  } catch (error) {
    finishParseSession(session.id, {
      status: 'error',
      totalCount: products.length,
      successCount: 0,
      errorCount: products.length,
      positionsFound: 0,
      concurrency,
      message: error.message,
      details: { triggerSource, error: error.message },
    });
    addSyncLog('auto_pricing', 'error', error.message);
    throw error;
  } finally {
    autoPricingInProgress = false;
    tryStartQueuedCardBuild();
  }
}

export function startFullParseNow({
  products = null,
  onMessage = async (msg) => console.log(`[full-parse] ${msg}`),
  triggerSource = 'manual',
  type = 'full_parse',
  logPrefix = 'Сформировать карточку',
  historyTriggerSource = triggerSource,
} = {}) {
  if (fullParseInProgress) {
    throw new Error('Формирование карточек уже выполняется.');
  }
  if (autoPricingInProgress) {
    throw new Error('Сейчас идет расчет цены. Дождитесь завершения.');
  }
  if (kaspiPullInProgress) {
    throw new Error('Сейчас идет загрузка товаров из Kaspi. Дождитесь завершения.');
  }
  if (kaspiPushInProgress) {
    throw new Error('Сейчас идет загрузка в Kaspi. Дождитесь завершения.');
  }

  const parseProducts = Array.isArray(products)
    ? products.filter((product) => product && (product.shop_link || product.kaspi_id || product.sku || product.model))
    : getAllProducts({}).filter((product) => product.shop_link || product.kaspi_id || product.sku || product.model);

  if (!parseProducts.length) {
    throw new Error('Нет товаров для формирования карточек.');
  }

  fullParseInProgress = true;
  fullParseNextRunAt = null;
  const concurrency = getAutoPricingConcurrency();
  const session = startParseSession({
    type,
    triggerSource,
    totalCount: parseProducts.length,
    concurrency,
    message: `${logPrefix}: ${parseProducts.length} товаров`,
    details: {
      triggerSource,
      targetSkus: parseProducts.map((product) => product.sku),
    },
  });

  const promise = executeFullParseTask({
    session,
    products: parseProducts,
    onMessage,
    triggerSource,
    historyTriggerSource,
    logPrefix,
    concurrency,
  });

  return { session, promise };
}

export async function runFullParseNow(options = {}) {
  const task = startFullParseNow(options);
  return task.promise;
}

export function queueProductCardBuild({
  products = [],
  triggerSource = 'import',
  logPrefix = 'Автоформирование карточек новых товаров',
} = {}) {
  const normalizedProducts = normalizeQueuedProducts(products);
  if (!normalizedProducts.length) {
    return { queuedCount: 0, started: false, session: null };
  }

  for (const product of normalizedProducts) {
    queuedCardBuildProducts.set(product.sku, product);
  }

  queuedCardBuildLogPrefix = String(logPrefix || queuedCardBuildLogPrefix).trim() || queuedCardBuildLogPrefix;
  queuedCardBuildHistorySource = String(triggerSource || queuedCardBuildHistorySource).trim() || queuedCardBuildHistorySource;

  const session = tryStartQueuedCardBuild();
  if (session) {
    return { queuedCount: 0, started: true, session };
  }

  scheduleQueuedCardBuildRetry();
  return {
    queuedCount: queuedCardBuildProducts.size,
    started: false,
    session: null,
  };
}

export function startScheduler() {
  const autoPricingState = scheduleAutoPricingNextRun({ logChanges: true });
  const fullParseState = scheduleFullParseNextRun({ logChanges: true });
  const kaspiPullState = scheduleKaspiPullNextRun({ logChanges: true });
  const kaspiPushState = scheduleKaspiPushNextRun({ logChanges: true });

  if (autoPricingState.enabled) {
    console.log(`Price calculation scheduler interval: ${autoPricingState.intervalMs} ms (${Math.round(autoPricingState.intervalMs / 60000)} min)`);
  } else {
    console.log('Price calculation scheduler is disabled');
  }

  if (fullParseState.enabled) {
    console.log(`Card build scheduler interval: ${fullParseState.intervalMs} ms (${Math.round(fullParseState.intervalMs / 60000)} min)`);
  } else {
    console.log('Card build scheduler is disabled');
  }

  if (kaspiPullState.enabled) {
    console.log(`Kaspi pull scheduler interval: ${kaspiPullState.intervalMs} ms (${Math.round(kaspiPullState.intervalMs / 60000)} min)`);
  } else {
    console.log('Kaspi pull scheduler is disabled');
  }

  if (kaspiPushState.enabled) {
    console.log(`Kaspi push scheduler interval: ${kaspiPushState.intervalMs} ms (${Math.round(kaspiPushState.intervalMs / 60000)} min)`);
  } else {
    console.log('Kaspi push scheduler is disabled');
  }
}

export function refreshScheduler() {
  return {
    autoPricing: scheduleAutoPricingNextRun({ logChanges: true }),
    fullParse: scheduleFullParseNextRun({ logChanges: true }),
    kaspiPull: scheduleKaspiPullNextRun({ logChanges: true }),
    kaspiPush: scheduleKaspiPushNextRun({ logChanges: true }),
  };
}

export function startKaspiDownloadNow({
  onMessage = async (msg) => console.log(`[kaspi-pull] ${msg}`),
  triggerSource = 'manual',
} = {}) {
  if (kaspiPullInProgress) {
    throw new Error('Загрузка товаров из Kaspi уже выполняется.');
  }
  if (fullParseInProgress) {
    throw new Error('Сейчас идет формирование карточек. Дождитесь завершения перед скачиванием из Kaspi.');
  }
  if (autoPricingInProgress) {
    throw new Error('Сейчас идет расчет цены. Дождитесь завершения перед скачиванием из Kaspi.');
  }

  const session = startParseSession({
    type: 'kaspi_download',
    triggerSource,
    totalCount: 0,
    concurrency: 1,
    message: triggerSource === 'auto'
      ? 'Автозагрузка товаров из Kaspi запущена'
      : 'Ручная загрузка товаров из Kaspi запущена',
    details: {
      triggerSource,
      download: {
        checkedAt: new Date().toISOString(),
        phase: 'starting',
        statusText: 'Подготовка загрузки из Kaspi',
      },
    },
  });
  kaspiPullInProgress = true;
  kaspiPullNextRunAt = null;

  const promise = executeKaspiDownloadTask({
    session,
    onMessage,
    triggerSource,
  });

  return { session, promise };
}

export function startKaspiUploadNow({
  onMessage = async (msg) => console.log(`[kaspi-push] ${msg}`),
  triggerSource = 'manual',
} = {}) {
  if (kaspiPushInProgress) {
    throw new Error('Загрузка в Kaspi уже выполняется.');
  }
  if (kaspiPullInProgress) {
    throw new Error('Сейчас идет загрузка товаров из Kaspi. Дождитесь завершения перед отправкой в Kaspi.');
  }
  if (fullParseInProgress) {
    throw new Error('Сейчас идет формирование карточек. Дождитесь завершения перед загрузкой в Kaspi.');
  }
  if (autoPricingInProgress) {
    throw new Error('Сейчас идет расчет цены. Дождитесь завершения перед загрузкой в Kaspi.');
  }

  const session = startParseSession({
    type: 'kaspi_upload',
    triggerSource,
    totalCount: 0,
    concurrency: 1,
    message: triggerSource === 'auto'
      ? 'Автозагрузка XML в Kaspi запущена'
      : 'Ручная загрузка XML в Kaspi запущена',
    details: {
      triggerSource,
      upload: {
        checkedAt: new Date().toISOString(),
        phase: 'starting',
        statusText: 'Подготовка XML и отправка файла в Kaspi',
        checks: [],
      },
    },
  });
  kaspiPushInProgress = true;
  kaspiPushNextRunAt = null;

  const promise = executeKaspiUploadTask({
    session,
    onMessage,
    triggerSource,
  });

  return { session, promise };
}

export async function runKaspiUploadNow(options = {}) {
  const task = startKaspiUploadNow(options);
  return task.promise;
}

function scheduleAutoPricingNextRun({ logChanges = false, delayMs = null } = {}) {
  if (autoPricingTimer) {
    clearTimeout(autoPricingTimer);
    autoPricingTimer = null;
  }

  const state = getAutoPricingSchedulerState();
  if (!state.enabled || !Number.isFinite(state.intervalMs) || state.intervalMs <= 0) {
    autoPricingNextRunAt = null;
    if (logChanges) {
      logRuntime('scheduler', 'info', 'Планировщик расчета цены выключен');
    }
    return state;
  }

  const nextDelayMs = Number.isFinite(Number(delayMs)) && Number(delayMs) > 0
    ? Number(delayMs)
    : state.intervalMs;
  autoPricingNextRunAt = new Date(Date.now() + nextDelayMs).toISOString();
  autoPricingTimer = setTimeout(async () => {
    if (autoPricingInProgress || fullParseInProgress || kaspiPullInProgress || kaspiPushInProgress) {
      scheduleAutoPricingNextRun({ delayMs: SCHEDULER_BUSY_RETRY_MS });
      return;
    }

    try {
      await runAutoPricingNow({ triggerSource: 'auto' });
    } catch (error) {
      console.error('Auto pricing scheduler failed:', error.message);
      logRuntime('auto_pricing', 'error', `Ошибка планировщика: ${error.message}`);
    } finally {
      scheduleAutoPricingNextRun();
    }
  }, nextDelayMs);

  if (logChanges) {
    logRuntime('scheduler', 'info', `Планировщик расчета цены запущен: ${Math.round(state.intervalMs / 60000)} мин`);
  }
  return state;
}

function scheduleFullParseNextRun({ logChanges = false, delayMs = null } = {}) {
  if (fullParseTimer) {
    clearTimeout(fullParseTimer);
    fullParseTimer = null;
  }

  const state = getFullParseSchedulerState();
  if (!state.enabled || !Number.isFinite(state.intervalMs) || state.intervalMs <= 0) {
    fullParseNextRunAt = null;
    if (logChanges) {
      logRuntime('scheduler', 'info', 'Планировщик формирования карточек выключен');
    }
    return state;
  }

  const nextDelayMs = Number.isFinite(Number(delayMs)) && Number(delayMs) > 0
    ? Number(delayMs)
    : state.intervalMs;
  fullParseNextRunAt = new Date(Date.now() + nextDelayMs).toISOString();
  fullParseTimer = setTimeout(async () => {
    if (fullParseInProgress || autoPricingInProgress || kaspiPullInProgress || kaspiPushInProgress) {
      scheduleFullParseNextRun({ delayMs: SCHEDULER_BUSY_RETRY_MS });
      return;
    }

    try {
      const task = startFullParseNow({
        triggerSource: 'auto',
        type: 'full_parse',
        logPrefix: 'Формирование карточек по расписанию',
      });
      await task.promise;
    } catch (error) {
      console.error('Full parse scheduler failed:', error.message);
      logRuntime('product_parse', 'error', `Ошибка планировщика формирования карточек: ${error.message}`);
    } finally {
      scheduleFullParseNextRun();
    }
  }, nextDelayMs);

  if (logChanges) {
    logRuntime('scheduler', 'info', `Планировщик формирования карточек запущен: ${Math.round(state.intervalMs / 60000)} мин`);
  }
  return state;
}

function scheduleKaspiPullNextRun({ logChanges = false, delayMs = null } = {}) {
  if (kaspiPullTimer) {
    clearTimeout(kaspiPullTimer);
    kaspiPullTimer = null;
  }

  const state = getKaspiDownloadSchedulerState();
  if (!state.enabled || !Number.isFinite(state.intervalMs) || state.intervalMs <= 0) {
    kaspiPullNextRunAt = null;
    if (logChanges) {
      logRuntime('scheduler', 'info', 'Планировщик загрузки товаров из Kaspi выключен');
    }
    return state;
  }

  if (kaspiPullInProgress) {
    kaspiPullNextRunAt = null;
    return {
      ...state,
      nextRunAt: null,
      running: true,
    };
  }

  const nextDelayMs = Number.isFinite(Number(delayMs)) && Number(delayMs) > 0
    ? Number(delayMs)
    : state.intervalMs;
  kaspiPullNextRunAt = new Date(Date.now() + nextDelayMs).toISOString();
  kaspiPullTimer = setTimeout(async () => {
    if (kaspiPullInProgress || autoPricingInProgress || fullParseInProgress) {
      scheduleKaspiPullNextRun({ delayMs: SCHEDULER_BUSY_RETRY_MS });
      return;
    }

    try {
      const task = startKaspiDownloadNow({ triggerSource: 'auto' });
      await task.promise;
    } catch (error) {
      console.error('Kaspi pull scheduler failed:', error.message);
      logRuntime('pull_kaspi', 'error', `Ошибка планировщика загрузки товаров из Kaspi: ${error.message}`);
    } finally {
      scheduleKaspiPullNextRun();
    }
  }, nextDelayMs);

  if (logChanges) {
    logRuntime('scheduler', 'info', `Планировщик загрузки товаров из Kaspi запущен: ${Math.round(state.intervalMs / 60000)} мин`);
  }
  return state;
}

function scheduleKaspiPushNextRun({ logChanges = false, delayMs = null } = {}) {
  if (kaspiPushTimer) {
    clearTimeout(kaspiPushTimer);
    kaspiPushTimer = null;
  }

  const state = getKaspiUploadSchedulerState();
  if (!state.enabled || !Number.isFinite(state.intervalMs) || state.intervalMs <= 0) {
    kaspiPushNextRunAt = null;
    if (logChanges) {
      logRuntime('scheduler', 'info', 'Планировщик загрузки в Kaspi выключен');
    }
    return state;
  }

  if (kaspiPushInProgress) {
    kaspiPushNextRunAt = null;
    return {
      ...state,
      nextRunAt: null,
      running: true,
    };
  }

  const nextDelayMs = Number.isFinite(Number(delayMs)) && Number(delayMs) > 0
    ? Number(delayMs)
    : state.intervalMs;
  kaspiPushNextRunAt = new Date(Date.now() + nextDelayMs).toISOString();
  kaspiPushTimer = setTimeout(async () => {
    if (kaspiPushInProgress || kaspiPullInProgress || autoPricingInProgress || fullParseInProgress) {
      scheduleKaspiPushNextRun({ delayMs: SCHEDULER_BUSY_RETRY_MS });
      return;
    }

    try {
      const task = startKaspiUploadNow({ triggerSource: 'auto' });
      await task.promise;
    } catch (error) {
      console.error('Kaspi push scheduler failed:', error.message);
      logRuntime('push_kaspi', 'error', `Ошибка планировщика загрузки в Kaspi: ${error.message}`);
    } finally {
      scheduleKaspiPushNextRun();
    }
  }, nextDelayMs);

  if (logChanges) {
    logRuntime('scheduler', 'info', `Планировщик загрузки в Kaspi запущен: ${Math.round(state.intervalMs / 60000)} мин`);
  }
  return state;
}

async function executeFullParseTask({
  session,
  products,
  onMessage,
  triggerSource,
  historyTriggerSource,
  logPrefix,
  concurrency,
}) {
  try {
    logRuntime('product_parse', 'info', triggerSource === 'auto'
      ? 'Запущено формирование карточек по расписанию'
      : 'Запущено ручное формирование карточек');

    const results = await parseAndStoreAllProducts({
      products,
      concurrency,
      onMessage,
      historyContext: {
        eventType: 'full_parse',
        triggerSource: historyTriggerSource,
        sessionId: session.id,
      },
      onProgress: async (progress) => {
        updateParseSessionProgress(session.id, {
          totalCount: progress.totalCount,
          successCount: progress.successCount,
          errorCount: progress.errorCount,
          positionsFound: progress.positionsFound,
          concurrency,
          retryCount: progress.retryCount,
          message: buildFullParseMessage(progress, triggerSource, logPrefix),
          details: {
            triggerSource,
            targetSkus: products.map((product) => product.sku),
            results: progress.results,
          },
        });
      },
    });

    await generateAndSaveXml().catch(() => {});

    const failed = results.filter((result) => result.error).length;
    const success = results.length - failed;
    const positionsFound = results.filter((result) => Number(result.myPosition || 0) > 0).length;
    finishParseSession(session.id, {
      status: success === 0 && failed > 0 ? 'error' : failed ? 'partial' : 'success',
      totalCount: results.length,
      successCount: success,
      errorCount: failed,
      positionsFound,
      concurrency,
      retryCount: results.filter((result) => Number(result.retryAttempt || 0) > 0).length,
      message: buildFullParseSummary(results, triggerSource, logPrefix),
      details: {
        triggerSource,
        targetSkus: products.map((product) => product.sku),
        results,
      },
    });
    logRuntime(
      'product_parse',
      success === 0 && failed > 0 ? 'error' : failed ? 'partial' : 'success',
      buildFullParseSummary(results, triggerSource, logPrefix),
      { triggerSource, results },
    );
    addSyncLog(
      'full_parse',
      success === 0 && failed > 0 ? 'error' : failed ? 'partial' : 'success',
      `${logPrefix}: товаров ${results.length}, ошибок ${failed}, запуск ${triggerSource === 'auto' ? 'авто' : 'ручной'}`,
      { triggerSource, results },
    );

    return results;
  } catch (error) {
    finishParseSession(session.id, {
      status: 'error',
      totalCount: products.length,
      successCount: 0,
      errorCount: products.length,
      positionsFound: 0,
      concurrency,
      message: error.message,
      details: { triggerSource, error: error.message },
    });
    addSyncLog('full_parse', 'error', error.message, { triggerSource });
    throw error;
  } finally {
    fullParseInProgress = false;
    tryStartQueuedCardBuild();
  }
}

async function executeKaspiDownloadTask({
  session,
  onMessage,
  triggerSource,
}) {
  const pushMessage = async (message) => {
    const text = String(message || '').trim();
    if (text) {
      updateParseSessionProgress(session.id, {
        message: text,
      });
      await onMessage(text);
    }
  };

  try {
    await pushMessage('Открываю кабинет продавца и загружаю товары из Kaspi.');
    const result = await pullKaspiPriceList(pushMessage, waitForKaspiOtp);
    finishParseSession(session.id, {
      status: 'success',
      totalCount: Number(result.totalProcessed || 0),
      successCount: Number(result.totalProcessed || 0),
      errorCount: 0,
      positionsFound: Number(result.archiveImported || 0),
      concurrency: 1,
      retryCount: 0,
      message: buildKaspiDownloadSummary(result, triggerSource),
      details: {
        triggerSource,
        download: {
          checkedAt: new Date().toISOString(),
          phase: 'completed',
          statusText: buildKaspiDownloadSummary(result, triggerSource),
        },
        result,
      },
    });
    logRuntime('pull_kaspi', 'success', buildKaspiDownloadSummary(result, triggerSource), {
      triggerSource,
      result,
    });
    return result;
  } catch (error) {
    finishParseSession(session.id, {
      status: 'error',
      totalCount: 0,
      successCount: 0,
      errorCount: 1,
      positionsFound: 0,
      concurrency: 1,
      retryCount: 0,
      message: error.message,
      details: {
        triggerSource,
        download: {
          checkedAt: new Date().toISOString(),
          phase: 'error',
          statusText: error.message,
        },
        error: error.message,
      },
    });
    logRuntime('pull_kaspi', 'error', `${triggerSource === 'auto' ? 'Автоматическая' : 'Ручная'} загрузка товаров из Kaspi завершилась ошибкой: ${error.message}`);
    throw error;
  } finally {
    kaspiPullInProgress = false;
    tryStartQueuedCardBuild();
  }
}

async function executeKaspiUploadTask({
  session,
  onMessage,
  triggerSource,
}) {
  const statusChecks = [];

  const pushMessage = async (message) => {
    const text = String(message || '').trim();
    if (text) {
      updateParseSessionProgress(session.id, {
        message: text,
      });
      await onMessage(text);
    }
  };

  try {
    await pushMessage('Формирую XML и отправляю файл в Kaspi.');
    const result = await pushKaspiPriceList(pushMessage, waitForKaspiOtp, { triggerSource });
    let upload = mergeUploadStatus(result.statusInfo, {
      filePath: result.filePath,
      url: result.url,
    }, statusChecks);

    updateKaspiUploadProgress(session.id, upload, triggerSource);

    if (upload.phase !== 'completed') {
      upload = await waitForKaspiUploadCompletion({
        upload,
        statusChecks,
        triggerSource,
        onMessage: pushMessage,
        sessionId: session.id,
      });
    }

    const finalStatus = mapKaspiUploadSessionStatus(upload);
    const totals = uploadCounters(upload);
    finishParseSession(session.id, {
      status: finalStatus,
      totalCount: totals.totalCount,
      successCount: totals.successCount,
      errorCount: totals.errorCount,
      positionsFound: upload.warningCount ?? 0,
      concurrency: 1,
      retryCount: 0,
      message: buildKaspiUploadSummary(upload, triggerSource),
      details: {
        triggerSource,
        upload,
      },
    });
    logRuntime(
      'push_kaspi',
      finalStatus === 'success' ? 'success' : finalStatus === 'partial' ? 'partial' : 'error',
      buildKaspiUploadSummary(upload, triggerSource),
      { triggerSource, upload },
    );

    return {
      ...result,
      uploadStatus: upload,
      sessionId: session.id,
    };
  } catch (error) {
    finishParseSession(session.id, {
      status: 'error',
      totalCount: 0,
      successCount: 0,
      errorCount: 1,
      positionsFound: 0,
      concurrency: 1,
      retryCount: 0,
      message: error.message,
      details: {
        triggerSource,
        upload: {
          checkedAt: new Date().toISOString(),
          phase: 'error',
          statusText: error.message,
          checks: statusChecks,
        },
        error: error.message,
      },
    });
    logRuntime('push_kaspi', 'error', `${triggerSource === 'auto' ? 'Автоматическая' : 'Ручная'} загрузка в Kaspi завершилась ошибкой: ${error.message}`);
    throw error;
  } finally {
    kaspiPushInProgress = false;
    tryStartQueuedCardBuild();
  }
}

async function waitForKaspiUploadCompletion({
  upload,
  statusChecks,
  triggerSource,
  onMessage,
  sessionId,
}) {
  const startedAt = Date.now();
  let failedChecks = 0;
  let current = upload;
  let lastCheckError = '';

  while (Date.now() - startedAt < KASPI_UPLOAD_STATUS_TIMEOUT_MS) {
    await delay(KASPI_UPLOAD_STATUS_POLL_MS);

    let latestStatus;
    try {
      latestStatus = await readKaspiUploadStatus(async () => {}, waitForKaspiOtp);
      failedChecks = 0;
    } catch (error) {
      failedChecks += 1;
      lastCheckError = error.message;
      const message = `Не удалось проверить статус загрузки в Kaspi: ${error.message}`;
      updateParseSessionProgress(sessionId, {
        message: `${message}. Продолжаю ждать, Kaspi может обновлять историю с задержкой.`,
        details: {
          triggerSource,
          upload: {
            ...current,
            lastCheckError: error.message,
            checks: statusChecks,
          },
        },
      });
      if (failedChecks === KASPI_UPLOAD_STATUS_MAX_ERRORS || failedChecks % KASPI_UPLOAD_STATUS_MAX_ERRORS === 0) {
        await onMessage('Kaspi пока не отдает свежий статус загрузки. Это не считаю ошибкой, продолжаю ждать историю обработки.');
      }
      continue;
    }

    current = mergeUploadStatus(latestStatus, current, statusChecks);
    lastCheckError = '';
    updateKaspiUploadProgress(sessionId, current, triggerSource);

    if (current.phase === 'completed') {
      return current;
    }

    await onMessage(`Kaspi еще обрабатывает файл: ${current.statusText || 'статус обновляется'}.`);
  }

  const timeoutMinutes = Math.round(KASPI_UPLOAD_STATUS_TIMEOUT_MS / 60000);
  const suffix = lastCheckError
    ? ` Последняя ошибка проверки статуса: ${lastCheckError}`
    : current.statusText
      ? ` Последний статус: ${current.statusText}`
      : '';
  throw new Error(`Не дождались финального статуса загрузки в Kaspi за ${timeoutMinutes} минут.${suffix}`);
}

function updateKaspiUploadProgress(sessionId, upload, triggerSource) {
  const totals = uploadCounters(upload);
  updateParseSessionProgress(sessionId, {
    totalCount: totals.totalCount,
    successCount: totals.successCount,
    errorCount: totals.errorCount,
    positionsFound: upload.warningCount ?? 0,
    concurrency: 1,
    retryCount: 0,
    message: buildKaspiUploadProgressMessage(upload, triggerSource),
    details: {
      triggerSource,
      upload,
    },
  });
}

function mergeUploadStatus(latestStatus = {}, previousStatus = {}, statusChecks = []) {
  const next = {
    ...previousStatus,
    ...latestStatus,
    checkedAt: latestStatus.checkedAt || new Date().toISOString(),
    phase: latestStatus.phase || previousStatus.phase || 'unknown',
    statusText: latestStatus.statusText || previousStatus.statusText || '',
    progressStatus: latestStatus.progressStatus || previousStatus.progressStatus || '',
    fileId: latestStatus.fileId || previousStatus.fileId || '',
    fileName: latestStatus.fileName || previousStatus.fileName || '',
    filePath: latestStatus.filePath || previousStatus.filePath || '',
    fileLink: latestStatus.fileLink || previousStatus.fileLink || '',
    url: latestStatus.url || previousStatus.url || '',
    uploadedAt: latestStatus.uploadedAt || previousStatus.uploadedAt || '',
    totalCount: pickUploadCount(latestStatus.totalCount, previousStatus.totalCount),
    processedCount: pickUploadCount(latestStatus.processedCount, previousStatus.processedCount),
    unrecognizedCount: pickUploadCount(latestStatus.unrecognizedCount, previousStatus.unrecognizedCount),
    restrictedCount: pickUploadCount(latestStatus.restrictedCount, previousStatus.restrictedCount),
    errorCount: pickUploadCount(latestStatus.errorCount, previousStatus.errorCount),
    warningCount: pickUploadCount(latestStatus.warningCount, previousStatus.warningCount),
    unchangedCount: pickUploadCount(latestStatus.unchangedCount, previousStatus.unchangedCount),
  };

  statusChecks.push({
    checkedAt: next.checkedAt,
    phase: next.phase,
    statusText: next.statusText,
    progressStatus: next.progressStatus,
    totalCount: next.totalCount,
    processedCount: next.processedCount,
    unrecognizedCount: next.unrecognizedCount,
    restrictedCount: next.restrictedCount,
    errorCount: next.errorCount,
    warningCount: next.warningCount,
    unchangedCount: next.unchangedCount,
  });

  next.checks = statusChecks.slice(-20);
  return next;
}

function pickUploadCount(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : (Number.isFinite(Number(fallback)) ? Number(fallback) : null);
}

function uploadCounters(upload = {}) {
  const totalCount = Number(upload.totalCount || 0);
  const processedCount = Number(upload.processedCount || 0);
  const errorCount = Number(upload.errorCount || 0);
  return {
    totalCount,
    successCount: Math.max(0, processedCount - errorCount),
    errorCount,
    processedCount,
  };
}

function mapKaspiUploadSessionStatus(upload = {}) {
  if (upload.phase !== 'completed') {
    return 'running';
  }

  const errorCount = Number(upload.errorCount || 0);
  const warningCount = Number(upload.warningCount || 0);
  const unrecognizedCount = Number(upload.unrecognizedCount || 0);
  const restrictedCount = Number(upload.restrictedCount || 0);

  if (errorCount > 0 || warningCount > 0 || unrecognizedCount > 0 || restrictedCount > 0) {
    return 'partial';
  }

  return 'success';
}

function buildKaspiDownloadSummary(result = {}, triggerSource = 'manual') {
  const sourceLabel = triggerSource === 'auto' ? 'авто' : 'ручной';
  const activeImported = Number(result.activeImported || 0);
  const activeUpdated = Number(result.activeUpdated || 0);
  const archiveImported = Number(result.archiveImported || 0);
  const archiveUpdated = Number(result.archiveUpdated || 0);
  const totalProcessed = Number(result.totalProcessed || 0);
  return `Загрузка из Kaspi (${sourceLabel}): обработано ${totalProcessed}, активные ${activeImported + activeUpdated}, архивные ${archiveImported + archiveUpdated}`;
}

function buildKaspiUploadProgressMessage(upload = {}, triggerSource = 'manual') {
  const sourceLabel = triggerSource === 'auto' ? 'Авто' : 'Ручной';
  const processedCount = Number(upload.processedCount || 0);
  const totalCount = Number(upload.totalCount || 0);
  const errorCount = Number(upload.errorCount || 0);
  const warningCount = Number(upload.warningCount || 0);
  const statusText = upload.statusText || upload.progressStatus || 'Ожидание статуса';

  if (upload.phase === 'completed') {
    return `${sourceLabel} загрузка: завершено, обработано ${processedCount}/${totalCount || processedCount}, ошибок ${errorCount}, предупреждений ${warningCount}`;
  }

  return `${sourceLabel} загрузка: ${statusText}${totalCount ? `, обработано ${processedCount}/${totalCount}` : ''}`;
}

function buildKaspiUploadSummary(upload = {}, triggerSource = 'manual') {
  const sourceLabel = triggerSource === 'auto' ? 'авто' : 'ручной';
  const processedCount = Number(upload.processedCount || 0);
  const totalCount = Number(upload.totalCount || 0);
  const errorCount = Number(upload.errorCount || 0);
  const warningCount = Number(upload.warningCount || 0);
  const statusText = upload.statusText || upload.progressStatus || 'статус не определен';
  return `Загрузка в Kaspi (${sourceLabel}): ${statusText}, обработано ${processedCount}/${totalCount || processedCount || 0}, ошибок ${errorCount}, предупреждений ${warningCount}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAutoPricingMessage(progress, triggerSource) {
  const updatedCount = (progress.results || []).filter((result) => result.updated).length;
  return `${triggerSource === 'auto' ? 'Авто' : 'Ручной'} расчет цены: обработано ${progress.successCount + progress.errorCount}/${progress.totalCount}, изменено ${updatedCount}, ошибок ${progress.errorCount}`;
}

function buildFullParseMessage(progress, triggerSource, logPrefix) {
  return `${triggerSource === 'auto' ? 'Авто' : 'Ручной'} ${logPrefix.toLowerCase()}: обработано ${progress.successCount + progress.errorCount}/${progress.totalCount}, ошибок ${progress.errorCount}, позиций ${progress.positionsFound}`;
}

function buildAutoPricingSummary(results, triggerSource) {
  const updatedCount = results.filter((result) => result.updated).length;
  const failedCount = results.filter((result) => result.error).length;
  return `${triggerSource === 'auto' ? 'Авто' : 'Ручной'} расчет цены: товаров ${results.length}, изменено ${updatedCount}, ошибок ${failedCount}`;
}

function buildFullParseSummary(results, triggerSource, logPrefix) {
  const failedCount = results.filter((result) => result.error).length;
  const positionsFound = results.filter((result) => Number(result.myPosition || 0) > 0).length;
  return `${triggerSource === 'auto' ? 'Авто' : 'Ручной'} ${logPrefix.toLowerCase()}: товаров ${results.length}, ошибок ${failedCount}, позиций ${positionsFound}`;
}

function scheduleQueuedCardBuildRetry(delayMs = SCHEDULER_BUSY_RETRY_MS) {
  if (queuedCardBuildTimer) {
    clearTimeout(queuedCardBuildTimer);
  }

  if (!queuedCardBuildProducts.size) {
    queuedCardBuildTimer = null;
    return;
  }

  queuedCardBuildTimer = setTimeout(() => {
    queuedCardBuildTimer = null;
    const session = tryStartQueuedCardBuild();
    if (!session && queuedCardBuildProducts.size) {
      scheduleQueuedCardBuildRetry();
    }
  }, Math.max(0, Number(delayMs) || 0));
}

function tryStartQueuedCardBuild() {
  if (!queuedCardBuildProducts.size) {
    return null;
  }

  if (autoPricingInProgress || fullParseInProgress || kaspiPushInProgress) {
    return null;
  }

  const products = [...queuedCardBuildProducts.values()];
  queuedCardBuildProducts = new Map();
  if (queuedCardBuildTimer) {
    clearTimeout(queuedCardBuildTimer);
    queuedCardBuildTimer = null;
  }

  const task = startFullParseNow({
    products,
    triggerSource: 'auto',
    historyTriggerSource: queuedCardBuildHistorySource,
    logPrefix: queuedCardBuildLogPrefix,
    type: 'full_parse',
    onMessage: async (msg) => console.log(`[queued-card-build] ${msg}`),
  });

  task.promise.catch((error) => {
    logRuntime('product_parse', 'error', `${queuedCardBuildLogPrefix} завершилось ошибкой: ${error.message}`);
  });

  return task.session;
}

function normalizeQueuedProducts(products) {
  return Array.isArray(products)
    ? products
      .filter((product) => product && String(product.sku || '').trim())
      .map((product) => ({ ...product, sku: String(product.sku || '').trim() }))
    : [];
}
