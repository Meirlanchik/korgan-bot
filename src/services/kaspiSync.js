import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import {
  downloadKaspiProductsXmlPair,
  uploadKaspiPriceList,
  getKaspiPriceListUploadStatus,
} from '../kaspiCabinet.js';
import { defaultConfigFromEnv, writeCurrentXml, buildKaspiXml, parseKaspiCatalog } from '../kaspiPriceList.js';
import {
  getProductsForXml,
  importFromCatalog,
  setSetting,
  addSyncLog,
  getSetting,
} from '../db.js';
import { logRuntime } from '../logger.js';

export async function pullKaspiPriceList(onMessage, requestOtp) {
  logRuntime('pull_kaspi', 'info', 'Запущено скачивание прайс-листа из Kaspi');
  const downloaded = await downloadKaspiProductsXmlPair({
    downloadDir: config.kaspiDownloadDir,
    sessionDir: getKaspiPullSessionDir(),
    onMessage,
    requestOtp,
  });
  const activeDownloaded = downloaded.active;
  const archiveDownloaded = downloaded.archive;

  const activeWarnings = [];
  const archiveWarnings = [];
  const activeIssueStats = createKaspiPullIssueStats();
  const archiveIssueStats = createKaspiPullIssueStats();

  let activeCatalog;
  let archiveCatalog;
  try {
    activeCatalog = parseKaspiCatalog(await fs.readFile(activeDownloaded.path, 'utf8'), {
      source: 'kaspi_cabinet_pull',
      tolerant: true,
      warnings: activeWarnings,
      issueStats: activeIssueStats,
    });
    archiveCatalog = parseKaspiCatalog(await fs.readFile(archiveDownloaded.path, 'utf8'), {
      source: 'kaspi_cabinet_pull',
      tolerant: true,
      warnings: archiveWarnings,
      issueStats: archiveIssueStats,
    });
  } catch (error) {
    await fs.rm(activeDownloaded.path, { force: true }).catch(() => { });
    await fs.rm(archiveDownloaded.path, { force: true }).catch(() => { });
    throw new Error(`Не удалось разобрать XML из кабинета Kaspi: ${error.message}`);
  }

  const warningSummary = buildKaspiPullWarningSummary({
    activeWarnings,
    archiveWarnings,
    activeIssueStats,
    archiveIssueStats,
  });
  if (warningSummary) {
    logRuntime('pull_kaspi', 'warning', warningSummary.message, warningSummary.details);
    await onMessage(warningSummary.message);
  }

  const activeImport = importFromCatalog(activeCatalog, { importedAvailable: 1 });
  const archiveImport = importFromCatalog(archiveCatalog, { importedAvailable: 0 });
  const xmlResult = await generateAndSaveXml();

  setSetting('last_kaspi_pull_at', new Date().toISOString());
  addSyncLog('pull_kaspi', 'success',
    `Скачано из Kaspi: в продаже ${activeCatalog.offers?.length || 0}, сняты с продажи ${archiveCatalog.offers?.length || 0}`,
    {
      activeImport,
      archiveImport,
      warningSummary: warningSummary?.details || null,
    });

  await fs.rm(activeDownloaded.path, { force: true }).catch(() => { });
  await fs.rm(archiveDownloaded.path, { force: true }).catch(() => { });

  return {
    offersCount: xmlResult.offersCount,
    imported: Number(activeImport.imported || 0) + Number(archiveImport.imported || 0),
    updated: Number(activeImport.updated || 0) + Number(archiveImport.updated || 0),
    importedSkus: [...new Set([
      ...(Array.isArray(activeImport.importedSkus) ? activeImport.importedSkus : []),
      ...(Array.isArray(archiveImport.importedSkus) ? archiveImport.importedSkus : []),
    ])],
    activeImported: activeImport.imported,
    activeUpdated: activeImport.updated,
    archiveImported: archiveImport.imported,
    archiveUpdated: archiveImport.updated,
    totalProcessed: Number(activeCatalog.offers?.length || 0) + Number(archiveCatalog.offers?.length || 0),
  };
}

export async function pushKaspiPriceList(onMessage, requestOtp, { triggerSource = 'manual' } = {}) {
  // Generate fresh XML from DB before pushing
  logRuntime('push_kaspi', 'info', triggerSource === 'auto'
    ? 'Запущена автоматическая загрузка XML в Kaspi'
    : 'Запущена ручная загрузка XML в Kaspi');
  const xmlResult = await generateAndSaveXml();
  if (
    triggerSource === 'auto'
    && Number(xmlResult.offersCount || 0) === 0
    && process.env.KASPI_ALLOW_EMPTY_AUTO_UPLOAD !== 'true'
  ) {
    throw new Error('XML пустой: автозагрузка в Kaspi остановлена, чтобы случайно не выгрузить пустой каталог.');
  }

  const sourceFilePath = path.join(config.publicDir, 'index.xml');
  await fs.access(sourceFilePath);
  await fs.mkdir(config.kaspiDownloadDir, { recursive: true });

  // Freeze the uploaded file for this run so concurrent pull/regeneration
  // does not replace the XML that is already being sent to Kaspi.
  const uploadFilePath = path.join(config.kaspiDownloadDir, `kaspi-upload-${Date.now()}.xml`);
  await fs.copyFile(sourceFilePath, uploadFilePath);

  let result;
  try {
    result = await uploadKaspiPriceList({
      filePath: uploadFilePath,
      downloadDir: config.kaspiDownloadDir,
      sessionDir: getKaspiPushSessionDir(),
      onMessage,
      requestOtp,
    });
  } finally {
    await fs.rm(uploadFilePath, { force: true }).catch(() => {});
  }

  setSetting('last_kaspi_push_at', new Date().toISOString());
  addSyncLog(
    'push_kaspi',
    'success',
    `XML загружен в Kaspi: ${path.basename(sourceFilePath)} (${triggerSource === 'auto' ? 'авто' : 'ручной'})`,
    {
      triggerSource,
      filePath: sourceFilePath,
      uploadedFilePath: result.filePath,
      statusInfo: result.statusInfo || null,
    },
  );

  return {
    ...result,
    filePath: sourceFilePath,
    uploadedFilePath: result.filePath,
  };
}

export async function readKaspiUploadStatus(onMessage, requestOtp) {
  return getKaspiPriceListUploadStatus({
    downloadDir: config.kaspiDownloadDir,
    sessionDir: getKaspiPushSessionDir(),
    onMessage,
    requestOtp,
  });
}

export async function generateAndSaveXml() {
  const products = getProductsForXml();
  const merchantId = getSetting('merchant_id', defaultConfigFromEnv().merchantId);
  const company = getSetting('merchant_name', '') || merchantId;

  const xml = buildKaspiXml({
    company,
    merchantId,
    offers: products,
  });

  await writeCurrentXml(config.publicDir, xml);
  logRuntime('xml_generate', 'success', `XML обновлен, товаров: ${products.length}`, { count: products.length });
  return { offersCount: products.length, xml };
}

function createKaspiPullIssueStats() {
  return {
    modelFallbackSkus: [],
    skippedSkus: [],
  };
}

function buildKaspiPullWarningSummary({
  activeWarnings = [],
  archiveWarnings = [],
  activeIssueStats = createKaspiPullIssueStats(),
  archiveIssueStats = createKaspiPullIssueStats(),
} = {}) {
  const activeModelFallback = uniqueValues(activeIssueStats.modelFallbackSkus);
  const archiveModelFallback = uniqueValues(archiveIssueStats.modelFallbackSkus);
  const activeSkipped = uniqueValues(activeIssueStats.skippedSkus);
  const archiveSkipped = uniqueValues(archiveIssueStats.skippedSkus);

  const modelFallbackCount = activeModelFallback.length + archiveModelFallback.length;
  const skippedCount = activeSkipped.length + archiveSkipped.length;

  if (!modelFallbackCount && !skippedCount) {
    return null;
  }

  const parts = [];
  if (modelFallbackCount) {
    parts.push(`model заменен из SKU для ${modelFallbackCount} SKU${formatKaspiPullSectionDetails(activeModelFallback, archiveModelFallback)}`);
  }
  if (skippedCount) {
    parts.push(`пропущено ${skippedCount} офферов${formatKaspiPullSectionDetails(activeSkipped, archiveSkipped)}`);
  }

  return {
    message: `Kaspi pull завершен с предупреждениями: ${parts.join(', ')}.`,
    details: {
      counts: {
        modelFallback: modelFallbackCount,
        skipped: skippedCount,
      },
      modelFallbackSkus: {
        active: activeModelFallback,
        archive: archiveModelFallback,
      },
      skippedSkus: {
        active: activeSkipped,
        archive: archiveSkipped,
      },
      warnings: {
        active: uniqueValues(activeWarnings),
        archive: uniqueValues(archiveWarnings),
      },
    },
  };
}

function formatKaspiPullSectionDetails(activeValues = [], archiveValues = []) {
  const parts = [];
  if (activeValues.length) {
    parts.push(`в продаже: ${activeValues.join(', ')}`);
  }
  if (archiveValues.length) {
    parts.push(`сняты с продажи: ${archiveValues.join(', ')}`);
  }
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function uniqueValues(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function getKaspiPullSessionDir() {
  return process.env.KASPI_PULL_SESSION_DIR || path.join(config.kaspiSessionDir, 'pull');
}

function getKaspiPushSessionDir() {
  return process.env.KASPI_PUSH_SESSION_DIR || path.join(config.kaspiSessionDir, 'push');
}
