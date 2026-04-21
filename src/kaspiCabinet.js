import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_LOGIN_URL = 'https://kaspi.kz/mc/#/';
const DEFAULT_PRODUCTS_URL = 'https://kaspi.kz/mc/#/products';
const DEFAULT_HISTORY_URLS = [
  'https://kaspi.kz/mc/#/history',
  'https://kaspi.kz/mc/#/price-list/history',
];
const DEFAULT_PRICE_LIST_UPLOAD_URLS = [
  'https://kaspi.kz/mc/#/price-list/upload',
  'https://kaspi.kz/mc/#/products/upload',
  'https://kaspi.kz/mc/#/products/import',
];
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_XML_GENERATION_TIMEOUT_MS = 6 * 60_000;
const DIRECT_XML_DOWNLOAD_WAIT_MS = 45_000;
const HISTORY_XML_POLL_MS = 10_000;
const SOFT_NETWORK_IDLE_TIMEOUT_MS = 2_000;
const MERCHANT_EXPORT_STATUS_POLL_MS = 2_000;
const MERCHANT_EXPORT_PROGRESS_LOG_MS = 15_000;
const MERCHANT_EXPORT_API_ORIGIN = 'https://mc.shop.kaspi.kz';
const MERCHANT_EXPORT_FILE_BASE_URL = `${MERCHANT_EXPORT_API_ORIGIN}/image/processor/merchant/img/cnt/m/o`;
const persistentSessionLocks = new Map();

async function acquirePersistentSessionLock(sessionDir, onMessage = async () => {}) {
  const key = path.resolve(sessionDir);
  let state = persistentSessionLocks.get(key);

  if (!state) {
    state = { locked: false, queue: [] };
    persistentSessionLocks.set(key, state);
  }

  if (state.locked) {
    await onMessage('Сессия кабинета Kaspi уже используется, жду освобождения браузерного профиля.');
    await new Promise((resolve) => {
      state.queue.push(resolve);
    });
  }

  state.locked = true;

  return () => {
    const currentState = persistentSessionLocks.get(key);
    if (!currentState) {
      return;
    }

    const next = currentState.queue.shift();
    if (next) {
      next();
      return;
    }

    persistentSessionLocks.delete(key);
  };
}

async function withPersistentKaspiContext(config, onMessage, task) {
  const release = await acquirePersistentSessionLock(config.sessionDir, onMessage);
  let context;

  try {
    context = await chromium.launchPersistentContext(config.sessionDir, {
      headless: config.headless,
      executablePath: config.browserPath,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    return await task(context);
  } finally {
    await context?.close().catch(() => {});
    release();
  }
}

export async function downloadKaspiPriceList({
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    await onMessage('Открываю кабинет продавца Kaspi.');

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    try {
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, onMessage, requestOtp);
      await onMessage('Открываю управление товарами и скачиваю XML.');

      const download = await triggerPriceListDownload(page, config, onMessage);
      const suggestedName = normalizeDownloadName(download.suggestedFilename(), config.format);
      const targetPath = path.join(config.downloadDir, `${Date.now()}-${suggestedName}`);
      await download.saveAs(targetPath);

      await onMessage(`Прайс-лист скачан: ${suggestedName}.`);
      return {
        path: targetPath,
        filename: suggestedName,
      };
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

export async function uploadKaspiPriceList({
  filePath,
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!filePath) {
    throw new Error('Не указан XML для загрузки в Kaspi.');
  }

  await fs.access(filePath);

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    await onMessage('Открываю кабинет продавца Kaspi.');

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    try {
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, onMessage, requestOtp);
      await onMessage('Открываю загрузку прайс-листа.');

      const result = await triggerPriceListUpload(page, config, filePath, onMessage);

      await onMessage('Прайс-лист отправлен в Kaspi.');
      return result;
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

export async function getKaspiPriceListUploadStatus({
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

      try {
        await onMessage('Проверяю статус последней загрузки в Kaspi.');
        await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
        await maybeLogin(page, config, onMessage, requestOtp);
        try {
          await openPriceListHistoryPage(page, config);
        } catch {
          await openUploadPage(page, config);
        }
        await waitForOptionalNetworkIdle(page);
        await waitForAnyVisible(page, [
          '.progress-status-text',
          ...config.historySelectors,
          ...config.uploadResultSelectors,
          'text=Сейчас активен прайс лист',
        'text=Сейчас активен прайс-лист',
      ], 30_000).catch(() => {});
      return await readUploadSummary(page);
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

export async function downloadKaspiProductsXml({
  status = 'active',
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const normalizedStatus = String(status || '').trim() === 'archive' ? 'archive' : 'active';
  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    try {
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, onMessage, requestOtp);
      return await downloadKaspiProductsXmlWithinContext(
        context,
        page,
        config,
        normalizedStatus,
        onMessage,
      );
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

export async function downloadKaspiProductsXmlPair({
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    try {
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, onMessage, requestOtp);

      await onMessage('Скачиваю XML из раздела "В продаже".');
      const active = await downloadKaspiProductsXmlWithinContext(
        context,
        page,
        config,
        'active',
        onMessage,
      );

      await onMessage('Скачиваю XML из раздела "Сняты с продажи".');
      const archive = await downloadKaspiProductsXmlWithinContext(
        context,
        page,
        config,
        'archive',
        onMessage,
      );

      return { active, archive };
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

export async function downloadKaspiMerchantProducts({
  status = 'active',
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const normalizedStatus = String(status || '').trim() === 'archive' ? 'archive' : 'active';
  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    try {
      await onMessage(`Открываю список товаров Kaspi: ${normalizedStatus === 'active' ? 'в продаже' : 'архив'}.`);
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, onMessage, requestOtp);
      await openMerchantProductsPage(page, config, normalizedStatus);

      const items = [];
      const seenSkus = new Set();
      let pageNumber = 1;

      while (true) {
        await waitForAnyVisible(page, [
          '#products-table tbody tr',
          '.table-wrapper tbody tr',
          'tbody tr',
        ], 30_000);
        await waitForOptionalNetworkIdle(page);

        const pageItems = await readMerchantProductsTable(page, normalizedStatus);
        for (const item of pageItems) {
          if (!item?.sku || seenSkus.has(item.sku)) {
            continue;
          }
          seenSkus.add(item.sku);
          items.push(item);
        }

        await onMessage(`Kaspi ${normalizedStatus === 'active' ? 'в продаже' : 'в архиве'}: страница ${pageNumber}, найдено ${items.length} товаров.`);

        const moved = await goToNextMerchantProductsPage(page);
        if (!moved) {
          break;
        }

        pageNumber += 1;
      }

      return {
        status: normalizedStatus,
        items,
      };
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

export async function resolveKaspiProductCardFromMerchantCabinet({
  article,
  downloadDir,
  sessionDir,
  onMessage = async () => {},
  requestOtp = async () => null,
} = {}) {
  const normalizedArticle = normalizeText(article);
  if (!normalizedArticle) {
    throw new Error('Не указан артикул для поиска товара в кабинете Kaspi.');
  }

  const config = readConfig(downloadDir, sessionDir);
  await fs.mkdir(config.downloadDir, { recursive: true });
  await fs.mkdir(config.sessionDir, { recursive: true });

  if (!config.login || !config.password) {
    throw new Error('Заполни KASPI_CABINET_EMAIL или KASPI_CABINET_LOGIN, а также KASPI_CABINET_PASSWORD в .env.');
  }

  return withPersistentKaspiContext(config, onMessage, async (context) => {
    await onMessage(`Открываю товар ${normalizedArticle} в кабинете продавца Kaspi.`);

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);

    try {
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, onMessage, requestOtp);

      const merchantUrl = `https://kaspi.kz/mc/#/products/${encodeURIComponent(normalizedArticle)}`;
      await page.goto(merchantUrl, { waitUntil: 'domcontentloaded' });
      await waitForOptionalNetworkIdle(page);

      const productLink = await resolveMerchantProductLink(page, config);
      if (!productLink) {
        throw new Error(`В кабинете Kaspi не нашел ссылку «Посмотреть на Kaspi.kz» для артикула ${normalizedArticle}.`);
      }

      const normalizedShopLink = normalizeKaspiShopLink(productLink);
      const kaspiId = extractKaspiIdFromHref(normalizedShopLink);
      if (!kaspiId) {
        throw new Error(`Ссылка товара из кабинета Kaspi не содержит код товара для артикула ${normalizedArticle}.`);
      }

      await onMessage(`В кабинете найден товар Kaspi ${kaspiId} для артикула ${normalizedArticle}.`);

      return {
        article: normalizedArticle,
        kaspiId,
        shopLink: normalizedShopLink.replace(/^https?:\/\/kaspi\.kz/i, ''),
        merchantUrl,
      };
    } catch (error) {
      await saveDebugSnapshot(page, config).catch(() => {});
      throw error;
    }
  });
}

async function maybeLogin(page, config, onMessage, requestOtp) {
  await page.waitForLoadState('domcontentloaded');
  await waitForAnyVisible(page, [
    ...config.loginSelectors,
    'input[type="password"]',
    ...config.priceListSelectors,
  ], 15_000).catch(() => {});

  await maybeHandleOtp(page, onMessage, requestOtp);

  const passwordInput = await firstVisibleLocator(page, ['input[type="password"]']);
  const loginInput = await firstVisibleLocator(page, config.loginSelectors);

  if (passwordInput && loginInput) {
    await onMessage('Ввожу логин и пароль.');
    await loginInput.fill(config.login);
    await passwordInput.fill(config.password);
    await clickFirstVisible(page, config.submitSelectors);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await waitForLoginResult(page, config, onMessage, requestOtp);
    return;
  }

  if (loginInput) {
    await onMessage('Ввожу почту для входа в кабинет Kaspi.');
    await loginInput.fill(config.login);
    await clickFirstVisible(page, config.continueSelectors);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await waitForAnyVisible(page, [
      'input[type="password"]',
      ...config.loginSelectors,
    ], 15_000).catch(() => {});
  }

  const nextPasswordInput = passwordInput || await firstVisibleLocator(page, ['input[type="password"]']);
  if (nextPasswordInput) {
    await onMessage('Ввожу пароль.');
    await nextPasswordInput.fill(config.password);
    await clickFirstVisible(page, config.submitSelectors);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await waitForLoginResult(page, config, onMessage, requestOtp);
  } else if (!loginInput) {
    await onMessage('Похоже, сессия Kaspi уже активна.');
  } else {
    throw new Error('После ввода почты Kaspi не показал поле пароля.');
  }

  await maybeHandleOtp(page, onMessage, requestOtp);
  await waitForOptionalNetworkIdle(page);
}

async function waitForLoginResult(page, config, onMessage, requestOtp) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const loginError = await firstVisibleLocator(page, config.loginErrorSelectors);
    if (loginError) {
      const message = await loginError.textContent().catch(() => '');
      throw new Error(`Kaspi не принял почту или пароль${message ? `: ${message.trim()}` : ''}. Проверь KASPI_CABINET_EMAIL/KASPI_CABINET_PASSWORD в .env.`);
    }

    const otpInput = await firstVisibleLocator(page, config.otpSelectors);
    if (otpInput) {
      await maybeHandleOtp(page, onMessage, requestOtp);
      return;
    }

    const priceList = await firstVisibleLocator(page, config.priceListSelectors);
    const goodsLink = await firstVisibleLocator(page, config.goodsSelectors);
    if (priceList || goodsLink || !isLoginUrl(page.url())) {
      return;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Kaspi не завершил вход за 60 секунд. Текущая страница: ${page.url()}`);
}

async function maybeHandleOtp(page, onMessage, requestOtp) {
  const otpInput = await firstVisibleLocator(page, readOtpSelectors());

  if (!otpInput) {
    return;
  }

  await onMessage('Kaspi запросил код подтверждения. Пришли его командой /kaspi_code 123456.');
  const code = await requestOtp();

  if (!code) {
    throw new Error('Код подтверждения не получен.');
  }

  await otpInput.fill(code);
  await clickFirstVisible(page, [
    'button:has-text("Подтвердить")',
    'button:has-text("Продолжить")',
    'button:has-text("Войти")',
    'button[type="submit"]',
  ]);
  await waitForOptionalNetworkIdle(page);
}

async function triggerPriceListDownload(page, config, onMessage) {
  if (config.goodsUrl) {
    await page.goto(config.goodsUrl, { waitUntil: 'domcontentloaded' });
  } else {
    const priceListVisible = await waitForAnyVisible(page, config.priceListSelectors, 5000).catch(() => null);

    if (!priceListVisible) {
      await page.goto(config.productsUrl, { waitUntil: 'domcontentloaded' });
      await waitForAnyVisible(page, config.priceListSelectors, 30_000).catch(() => {});
    }

    const priceListVisibleAfterGoto = await firstVisibleLocator(page, config.priceListSelectors);
    if (!priceListVisibleAfterGoto) {
      throw new Error(`Не нашел кнопку «Прайс-лист» на странице ${page.url()}. Debug-файлы сохранены в ${config.debugDir}.`);
    }
  }

  await waitForOptionalNetworkIdle(page);

  const downloadPromise = page.waitForEvent('download', { timeout: config.timeoutMs });
  await clickFirstVisible(page, config.priceListSelectors);
  await page.waitForTimeout(1200);

  if (config.formatText) {
    await clickFirstVisible(page, [
      `text=Скачать в ${config.formatText}`,
      `text=Скачать ${config.formatText}`,
      `text=${config.formatText}`,
      `button:has-text("Скачать в ${config.formatText}")`,
      `a:has-text("Скачать в ${config.formatText}")`,
      `button:has-text("${config.formatText}")`,
      `a:has-text("${config.formatText}")`,
      `label:has-text("${config.formatText}")`,
    ]).catch(() => {});
  }

  await clickFirstVisible(page, config.downloadSelectors).catch(async () => {
    await onMessage('Отдельной кнопки «Скачать» не нашел, жду скачивание после клика по «Прайс-лист».');
  });

  return downloadPromise;
}

async function triggerPriceListUpload(page, config, filePath, onMessage) {
  await openUploadPage(page, config);

  await waitForAnyVisible(page, [
    ...config.uploadPageSelectors,
    ...config.uploadDropzoneSelectors,
    ...config.uploadSubmitSelectors,
  ], 30_000);

  const input = await firstExistingLocator(page, config.fileInputSelectors);
  if (input) {
    await input.setInputFiles(filePath);
  } else {
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: config.timeoutMs });
    await clickFirstVisible(page, config.uploadDropzoneSelectors);
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
  }

  await onMessage(`Выбран файл ${path.basename(filePath)}.`);
  await page.waitForTimeout(700);

  const uploadResponsePromise = page.waitForResponse((response) => {
    const method = response.request().method();
    return method !== 'GET' && /upload|price|file|product|import|merchant/i.test(response.url());
  }, { timeout: config.timeoutMs }).catch(() => null);

  const submitButton = await firstVisibleLocator(page, config.uploadSubmitSelectors);
  if (submitButton) {
    await submitButton.click();
  } else {
    await onMessage('Кнопку «Загрузить» не нашел, похоже файл отправляется автоматически.');
  }

  const response = await uploadResponsePromise;
  await waitForOptionalNetworkIdle(page);
  await waitForAnyVisible(page, config.uploadResultSelectors, 60_000).catch(() => {});

  const statusText = await readPageStatusText(page);
  const failed = await firstVisibleLocator(page, config.uploadErrorSelectors);
  if (failed) {
    const message = await failed.textContent().catch(() => '');
    throw new Error(`Kaspi не принял прайс-лист${message ? `: ${message.trim()}` : ''}`);
  }

  if (response && !response.ok()) {
    throw new Error(`Kaspi вернул ошибку при загрузке: HTTP ${response.status()}`);
  }

  const statusInfo = await readUploadSummary(page);

  return {
    filePath,
    url: page.url(),
    status: statusInfo.statusText || statusText,
    statusInfo,
  };
}

async function triggerMerchantProductsXmlDownload(
  page,
  config,
  status,
  onMessage,
  previousHistoryEntry = null,
) {
  const statusLabel = status === 'archive' ? 'снятых с продажи' : 'в продаже';
  const directDownloadPromise = waitForPageDownload(page, DIRECT_XML_DOWNLOAD_WAIT_MS);

  await clickFirstVisible(page, config.priceListSelectors);
  await page.waitForTimeout(900);
  await clickFirstVisible(page, config.downloadXmlSelectors);

  const directDownload = await waitForDirectXmlDownload(page, directDownloadPromise, {
    onMessage,
    statusLabel,
  });

  if (directDownload) {
    return directDownload;
  }

  await onMessage(`Kaspi не отдал XML для раздела ${statusLabel} сразу. Проверяю историю загрузок и продолжаю ждать.`);
  return waitForHistoryXmlDownload(page, config, {
    statusLabel,
    onMessage,
    previousHistoryEntry,
  });
}

async function openUploadPage(page, config) {
  const uploadPageVisible = await waitForAnyVisible(page, [
    ...config.fileInputSelectors,
    ...config.uploadPageSelectors,
    ...config.uploadMenuSelectors,
  ], 5000).catch(() => null);

  if (uploadPageVisible && await firstExistingLocator(page, config.fileInputSelectors)) {
    return;
  }

  const uploadMenu = await firstVisibleLocator(page, config.uploadMenuSelectors);
  if (uploadMenu) {
    await uploadMenu.click();
    await waitForAnyVisible(page, [
      ...config.fileInputSelectors,
      ...config.uploadPageSelectors,
      ...config.uploadDropzoneSelectors,
    ], 30_000);
    return;
  }

  for (const uploadUrl of config.uploadUrls) {
    await page.goto(uploadUrl, { waitUntil: 'domcontentloaded' });
    const visible = await waitForAnyVisible(page, [
      ...config.fileInputSelectors,
      ...config.uploadPageSelectors,
      ...config.uploadDropzoneSelectors,
      ...config.uploadMenuSelectors,
    ], 12_000).catch(() => null);

    if (visible) {
      return;
    }
  }

  throw new Error(`Не нашел страницу загрузки прайс-листа. Debug-файлы сохранены в ${config.debugDir}.`);
}

async function openPriceListHistoryPage(page, config) {
  const alreadyVisible = await waitForAnyVisible(page, [
    ...config.historySelectors,
    'a[href*="/pricefeed/upload/merchant/files/"]',
  ], 5_000).catch(() => null);

  if (alreadyVisible) {
    return;
  }

  const historyLink = await firstVisibleLocator(page, config.historyMenuSelectors);
  if (historyLink) {
    await historyLink.click();
    await waitForOptionalNetworkIdle(page);
    await waitForAnyVisible(page, [
      ...config.historySelectors,
      'a[href*="/pricefeed/upload/merchant/files/"]',
    ], 30_000);
    return;
  }

  for (const historyUrl of config.historyUrls) {
    await page.goto(historyUrl, { waitUntil: 'domcontentloaded' });
    const visible = await waitForAnyVisible(page, [
      ...config.historySelectors,
      'a[href*="/pricefeed/upload/merchant/files/"]',
    ], 12_000).catch(() => null);

    if (visible) {
      return;
    }
  }

  throw new Error(`Не нашел страницу истории загрузок прайс-листа. Debug-файлы сохранены в ${config.debugDir}.`);
}

async function openMerchantProductsPage(page, config, status) {
  const targetUrl = `${config.productsUrl}?status=${encodeURIComponent(status)}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await waitForOptionalNetworkIdle(page);
  await waitForAnyVisible(page, [
    '#products-table tbody tr',
    '.table-wrapper tbody tr',
    '#offers-filter select',
    'text=Управление товарами',
  ], 30_000).catch(() => {});

  const filter = await firstExistingLocator(page, [
    '#offers-filter select',
    'select',
  ]);

  if (filter) {
    const currentValue = await filter.inputValue().catch(() => '');
    if (currentValue && currentValue !== status) {
      await filter.selectOption(status).catch(() => {});
      await waitForOptionalNetworkIdle(page);
      await page.waitForTimeout(1200);
    }
  }
}

async function resolveMerchantProductLink(page, config) {
  await waitForAnyVisible(page, [
    ...config.merchantViewSelectors,
    ...config.merchantProductSelectors,
  ], 30_000).catch(() => {});

  const directHref = await page.evaluate(() => {
    const normalizedHref = (value) => {
      const href = String(value || '').trim();
      if (!href) return '';
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
      }
      if (href.startsWith('/')) {
        return `https://kaspi.kz${href}`;
      }
      return href;
    };

    const links = Array.from(document.querySelectorAll('a[href], [href]'));
    const byText = links.find((node) => /Посмотреть\s+на\s+Kaspi\.kz/i.test(node.textContent || ''));
    if (byText?.getAttribute('href')) {
      return normalizedHref(byText.getAttribute('href'));
    }

    const byHref = links.find((node) => /kaspi\.kz\/shop\/p\/|\/shop\/p\//i.test(node.getAttribute('href') || ''));
    if (byHref?.getAttribute('href')) {
      return normalizedHref(byHref.getAttribute('href'));
    }

    return '';
  }).catch(() => '');

  if (directHref) {
    return directHref;
  }

  const trigger = await firstVisibleLocator(page, config.merchantViewSelectors);
  if (!trigger) {
    return '';
  }

  const triggerHref = await trigger.getAttribute('href').catch(() => '');
  if (triggerHref) {
    return normalizeKaspiShopLink(triggerHref);
  }

  const popupPromise = page.context().waitForEvent('page', { timeout: 12_000 }).catch(() => null);
  await trigger.click().catch(() => {});
  const popup = await popupPromise;

  if (!popup) {
    return '';
  }

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  const popupUrl = popup.url();
  await popup.close().catch(() => {});
  return popupUrl;
}

async function readMerchantProductsTable(page, status) {
  return page.evaluate((currentStatus) => {
    const parseMoney = (value) => {
      const digits = String(value || '').replace(/[^\d]/g, '');
      return digits ? Number(digits) : null;
    };

    const normalizeTextValue = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const normalizeSku = (value) => {
      const text = normalizeTextValue(value);
      const match = text.match(/[A-Za-z0-9_-]+_[A-Za-z0-9_-]+/);
      return match ? match[0] : '';
    };

    const rows = Array.from(document.querySelectorAll('#products-table tbody tr, .table-wrapper tbody tr'));

    return rows.map((row) => {
      const productCell = row.querySelector('td[data-label="Товар"]');
      const priceCell = row.querySelector('td[data-label*="Цена"]');
      const warehousesCell = row.querySelector('td[data-label*="Наличие"]');
      const title = normalizeTextValue(productCell?.querySelector('p.is-5, .is-5')?.textContent);
      const descriptionBlock = productCell?.querySelector('p.subtitle.is-6, .subtitle.is-6');
      const descriptionLines = String(descriptionBlock?.innerText || '')
        .split('\n')
        .map((line) => normalizeTextValue(line))
        .filter(Boolean);
      const sku = descriptionLines.map(normalizeSku).find(Boolean);
      const stockLine = descriptionLines.find((line) => /Остатки:/i.test(line)) || '';
      const stockMatch = stockLine.match(/(\d+)/);
      const stockCount = stockMatch ? Number(stockMatch[1]) : 0;
      const warehouseText = normalizeTextValue(warehousesCell?.textContent);
      const warehouses = warehouseText
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter((value) => /^PP/i.test(value));
      const image = productCell?.querySelector('img.thumbnail')?.getAttribute('src') || '';

      if (!sku) {
        return null;
      }

      return {
        sku,
        kaspiId: sku.split('_')[0] || '',
        title,
        description: descriptionLines[0] || title,
        price: parseMoney(priceCell?.textContent),
        image,
        status: currentStatus,
        stockCount,
        warehouses: warehouses.map((storeId) => ({
          storeId,
          stockCount,
        })),
      };
    }).filter(Boolean);
  }, status);
}

async function goToNextMerchantProductsPage(page) {
  const nextButton = await firstVisibleLocator(page, [
    'a.pagination-next',
    '.pagination-next',
  ]);

  if (!nextButton) {
    return false;
  }

  const disabled = await nextButton.evaluate((node) => {
    const disabledAttr = node.getAttribute('disabled');
    const className = String(node.getAttribute('class') || '');
    return disabledAttr === 'true'
      || disabledAttr === ''
      || className.includes('is-disabled')
      || className.includes('disabled');
  }).catch(() => true);

  if (disabled) {
    return false;
  }

  const beforeSignature = await merchantProductsTableSignature(page);
  await nextButton.click().catch(() => {});
  await waitForOptionalNetworkIdle(page);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300);
    const nextSignature = await merchantProductsTableSignature(page);
    if (nextSignature && nextSignature !== beforeSignature) {
      return true;
    }
  }

  return false;
}

async function merchantProductsTableSignature(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('#products-table tfoot th, .table-wrapper tfoot th')?.textContent || '';
    const firstRow = document.querySelector('#products-table tbody tr td[data-label="Товар"], .table-wrapper tbody tr td[data-label="Товар"]');
    return `${String(footer).trim()}::${String(firstRow?.textContent || '').trim()}`;
  }).catch(() => '');
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = await firstVisibleLocator(page, [selector]);
    if (locator) {
      await locator.click();
      return;
    }
  }

  throw new Error(`Не нашел кнопку/ссылку: ${selectors.join(', ')}`);
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().then(Boolean).catch(() => false) && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function firstExistingLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().then(Boolean).catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function waitForAnyVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const locator = await firstVisibleLocator(page, selectors);
    if (locator) {
      return locator;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Не дождался элемента: ${selectors.join(', ')}`);
}

function readConfig(downloadDir, sessionDir) {
  const format = process.env.KASPI_PRICE_LIST_FORMAT || 'XML';

  return {
    loginUrl: process.env.KASPI_CABINET_URL || DEFAULT_LOGIN_URL,
    productsUrl: process.env.KASPI_PRODUCTS_URL || DEFAULT_PRODUCTS_URL,
    historyUrls: splitList(process.env.KASPI_PRICE_LIST_HISTORY_URLS || process.env.KASPI_PRICE_LIST_HISTORY_URL)
      || DEFAULT_HISTORY_URLS,
    uploadUrls: splitList(process.env.KASPI_PRICE_LIST_UPLOAD_URLS || process.env.KASPI_PRICE_LIST_UPLOAD_URL)
      || DEFAULT_PRICE_LIST_UPLOAD_URLS,
    goodsUrl: process.env.KASPI_GOODS_URL || '',
    login: process.env.KASPI_CABINET_EMAIL || process.env.KASPI_CABINET_LOGIN || '',
    password: process.env.KASPI_CABINET_PASSWORD || '',
    merchantId: process.env.KASPI_MERCHANT_ID || '',
    format,
    formatText: process.env.KASPI_PRICE_LIST_FORMAT_TEXT || format,
    browserPath: resolveBrowserPath(),
    headless: process.env.KASPI_BROWSER_HEADLESS !== 'false',
    timeoutMs: Number(process.env.KASPI_DOWNLOAD_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    xmlGenerationTimeoutMs: Number(process.env.KASPI_XML_GENERATION_TIMEOUT_MS || DEFAULT_XML_GENERATION_TIMEOUT_MS),
    downloadDir: downloadDir || process.env.KASPI_DOWNLOAD_DIR || '/app/kaspi-downloads',
    debugDir: process.env.KASPI_DEBUG_DIR || downloadDir || process.env.KASPI_DOWNLOAD_DIR || '/app/kaspi-downloads',
    sessionDir: sessionDir || process.env.KASPI_SESSION_DIR || '/app/kaspi-session',
    otpSelectors: readOtpSelectors(),
    loginErrorSelectors: splitSelectors(process.env.KASPI_LOGIN_ERROR_SELECTORS, [
      '.help.is-danger',
      '.is-danger',
      'text=Неверные почта или пароль',
      'text=Неверный пароль',
      'text=Неверная почта',
      'text=Ошибка',
    ]),
    loginSelectors: splitSelectors(process.env.KASPI_LOGIN_SELECTORS, [
      'input[name="email"]',
      'input[name*="email" i]',
      'input[name="username"]',
      'input[name="login"]',
      'input[name*="login" i]',
      'input[id*="email" i]',
      'input[id*="login" i]',
      'input[autocomplete="username"]',
      'input[autocomplete="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="почт" i]',
      'input[placeholder*="логин" i]',
      'input[placeholder*="телефон" i]',
      'input[type="tel"]',
      'input[type="email"]',
    ]),
    continueSelectors: splitSelectors(process.env.KASPI_CONTINUE_SELECTORS, [
      'button[type="submit"]',
      'button.button',
      'button:has-text("Продолжить")',
      'button:has-text("Далее")',
      'button:has-text("Войти")',
    ]),
    submitSelectors: splitSelectors(process.env.KASPI_SUBMIT_SELECTORS, [
      'button[type="submit"]',
      'button.button',
      'button:has-text("Войти")',
      'button:has-text("Продолжить")',
    ]),
    goodsSelectors: splitSelectors(process.env.KASPI_GOODS_SELECTORS, [
      'a[href*="#/products"]',
      'a[href*="/products"]',
      '[href*="#/products"]',
      'a:has-text("Управление товарами")',
      'button:has-text("Управление товарами")',
      'text=Управление товарами',
      'a:has-text("Товары")',
      'button:has-text("Товары")',
    ]),
    priceListSelectors: splitSelectors(process.env.KASPI_PRICE_LIST_SELECTORS, [
      'button:has-text("Прайс-лист")',
      'a:has-text("Прайс-лист")',
      'text=Прайс-лист',
    ]),
    downloadSelectors: splitSelectors(process.env.KASPI_DOWNLOAD_SELECTORS, [
      `text=Скачать в ${format}`,
      `text=Скачать ${format}`,
      `li:has-text("Скачать в ${format}")`,
      `div[role="menuitem"]:has-text("Скачать в ${format}")`,
      `button:has-text("Скачать в ${format}")`,
      `a:has-text("Скачать в ${format}")`,
      'button:has-text("Скачать")',
      'a:has-text("Скачать")',
      'button:has-text("Download")',
      'a:has-text("Download")',
      `button:has-text("${format}")`,
      `a:has-text("${format}")`,
    ]),
    downloadXmlSelectors: splitSelectors(process.env.KASPI_DOWNLOAD_XML_SELECTORS, [
      'a:has-text("Скачать в XML")',
      'button:has-text("Скачать в XML")',
      'text=Скачать в XML',
      'a:has-text("Скачать XML")',
      'button:has-text("Скачать XML")',
      'text=Скачать XML',
      'div[role="menuitem"]:has-text("Скачать в XML")',
      'li:has-text("Скачать в XML")',
      ...splitSelectors(process.env.KASPI_DOWNLOAD_SELECTORS, [
        'a:has-text("XML")',
        'button:has-text("XML")',
        'text=XML',
      ]),
    ]),
    uploadMenuSelectors: splitSelectors(process.env.KASPI_UPLOAD_MENU_SELECTORS, [
      'a:has-text("Загрузить прайс-лист")',
      'button:has-text("Загрузить прайс-лист")',
      'text=Загрузить прайс-лист',
      'a:has-text("Загрузить прайс")',
      'button:has-text("Загрузить прайс")',
    ]),
    fileInputSelectors: splitSelectors(process.env.KASPI_FILE_INPUT_SELECTORS, [
      'input[type="file"]',
      'input[accept*="xml" i]',
      'input[accept*="excel" i]',
      'input[accept*="xls" i]',
    ]),
    uploadPageSelectors: splitSelectors(process.env.KASPI_UPLOAD_PAGE_SELECTORS, [
      'text=Загрузить файл вручную',
      'text=Допустимый формат файла',
      'text=Перенесите файлы',
      'text=чтобы загрузить',
      'text=Автоматическая загрузка',
    ]),
    uploadDropzoneSelectors: splitSelectors(process.env.KASPI_UPLOAD_DROPZONE_SELECTORS, [
      'text=Перенесите файлы',
      'text=чтобы загрузить',
      '.dropzone',
      '[class*="drop" i]',
      '[class*="upload" i]',
    ]),
    uploadSubmitSelectors: splitSelectors(process.env.KASPI_UPLOAD_SUBMIT_SELECTORS, [
      'button:has-text("Загрузить")',
      'button:has-text("Отправить")',
      'button[type="submit"]',
    ]),
    uploadResultSelectors: splitSelectors(process.env.KASPI_UPLOAD_RESULT_SELECTORS, [
      'text=Обработано',
      'text=Дата загрузки',
      'text=Сейчас активен прайс',
      'text=История загрузок',
      'text=Товары с ошибками',
      'text=Товары с предупреждениями',
      'text=Файл загружен',
      'text=обработка может занять',
      'text=в течение 5 минут',
      'text=принят в обработку',
      'text=обрабатывается',
    ]),
    uploadErrorSelectors: splitSelectors(process.env.KASPI_UPLOAD_ERROR_SELECTORS, [
      '.help.is-danger',
      '.is-danger',
      'text=Ошибка',
      'text=Неверный формат',
      'text=Не удалось',
      'text=Файл не загружен',
    ]),
    merchantProductSelectors: splitSelectors(process.env.KASPI_MERCHANT_PRODUCT_SELECTORS, [
      'text=Посмотреть на Kaspi.kz',
      'text=Код товара',
      'text=Артикул',
      'a[href*="kaspi.kz/shop/p/"]',
      '[href*="/shop/p/"]',
    ]),
    merchantViewSelectors: splitSelectors(process.env.KASPI_MERCHANT_VIEW_SELECTORS, [
      'a:has-text("Посмотреть на Kaspi.kz")',
      'button:has-text("Посмотреть на Kaspi.kz")',
      'text=Посмотреть на Kaspi.kz',
      'a[href*="kaspi.kz/shop/p/"]',
      '[href*="/shop/p/"]',
    ]),
    historyMenuSelectors: splitSelectors(process.env.KASPI_HISTORY_MENU_SELECTORS, [
      '[data-testid="priceListHistory"]',
      'a:has-text("История загрузок")',
      'button:has-text("История загрузок")',
      'text=История загрузок',
    ]),
    historySelectors: splitSelectors(process.env.KASPI_HISTORY_SELECTORS, [
      'text=История загрузок',
      'text=Дата загрузки',
      'text=Сейчас активен прайс лист',
      'text=Сейчас активен прайс-лист',
      'a[href*="/pricefeed/upload/merchant/files/"]',
      '.progress-status-text',
    ]),
  };
}

function readOtpSelectors() {
  return splitSelectors(process.env.KASPI_OTP_SELECTORS, [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[name*="code" i]',
    'input[id*="otp" i]',
    'input[id*="code" i]',
    'input[maxlength="6"]',
    'input[maxlength="4"]',
  ]);
}

function isLoginUrl(url) {
  return /\/login(?:$|[?#/])/.test(url);
}

function splitList(value) {
  const items = String(value || '')
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : null;
}

async function readPageStatusText(page) {
  return page.locator('body').innerText({ timeout: 3000 })
    .then((text) => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 20).join('\n'))
    .catch(() => '');
}

async function readUploadSummary(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const progressStatus = normalizeText(
    await page.locator('.progress-status-text').first().textContent().catch(() => ''),
  );
  const modalMessage = normalizeText(
    await page.locator('.modal-card-body').first().innerText().catch(() => ''),
  );
  const fileLink = await page.locator('a[href*="/pricefeed/upload/merchant/files/"]').first()
    .getAttribute('href')
    .catch(() => '');
  const fileName = normalizeText(
    await page.locator('a[href*="/pricefeed/upload/merchant/files/"]').first().textContent().catch(() => ''),
  );
  const fileId = extractFileId(fileLink) || matchText(bodyText, /Сейчас активен прайс[- ]лист №\s*([A-Za-z0-9]+)/i);
  const uploadedAt = matchText(bodyText, /Дата загрузки:\s*([^\n]+)/i);
  const totalCount = parseLooseCount(matchText(bodyText, /Всего товаров:\s*([^\n]+)/i));
  const processedCount = parseBracketCount(bodyText, 'Обработано');
  const unrecognizedCount = parseBracketCount(bodyText, 'Нераспознанные товары');
  const restrictedCount = parseBracketCount(bodyText, 'Ограниченные товары');
  const errorCount = parseBracketCount(bodyText, 'Товары с ошибками');
  const warningCount = parseBracketCount(bodyText, 'Товары с предупреждениями');
  const unchangedCount = parseBracketCount(bodyText, 'Товары без изменений');
  const acceptedMessage = extractMatchedText(`${modalMessage}\n${bodyText}`, [
    /[^.\n]{0,120}файл[^.\n]{0,120}загружен[^.\n]{0,120}/i,
    /[^.\n]{0,120}принят[^.\n]{0,120}в обработк[^.\n]{0,120}/i,
    /[^.\n]{0,120}обработка[^.\n]{0,120}(?:5 минут|несколько минут)[^.\n]{0,120}/i,
    /[^.\n]{0,120}в течени[ея][^.\n]{0,40}5 минут[^.\n]{0,120}/i,
    /[^.\n]{0,120}в течение[^.\n]{0,40}5 минут[^.\n]{0,120}/i,
  ]);
  const processingMessage = extractMatchedText(`${progressStatus}\n${bodyText}`, [
    /[^.\n]{0,120}обрабатыва[^.\n]{0,120}/i,
    /[^.\n]{0,120}формир[^.\n]{0,120}/i,
  ]);

  let phase = 'unknown';
  if (fileId || totalCount !== null || processedCount !== null) {
    phase = 'completed';
  } else if (processingMessage || progressStatus) {
    phase = 'processing';
  } else if (acceptedMessage || modalMessage) {
    phase = 'accepted';
  }

  return {
    checkedAt: new Date().toISOString(),
    fileId,
    fileName,
    fileLink,
    uploadedAt,
    totalCount,
    processedCount,
    unrecognizedCount,
    restrictedCount,
    errorCount,
    warningCount,
    unchangedCount,
    progressStatus,
    phase,
    statusText: progressStatus || processingMessage || acceptedMessage || modalMessage || (phase === 'completed' ? 'Обработка завершена' : ''),
    url: page.url(),
  };
}

async function readLatestPriceListHistoryEntry(page, config) {
  await openPriceListHistoryPage(page, config);
  await waitForOptionalNetworkIdle(page);
  await waitForAnyVisible(page, [
    ...config.historySelectors,
    'a[href*="/pricefeed/upload/merchant/files/"]',
  ], 20_000).catch(() => {});

  const summary = await readUploadSummary(page);
  return {
    ...summary,
    fileLink: toAbsoluteKaspiUrl(summary.fileLink),
  };
}

async function waitForDirectXmlDownload(page, directDownloadPromise, {
  onMessage,
  statusLabel,
} = {}) {
  const startedAt = Date.now();
  let generationDetected = false;
  let lastNoticeAt = 0;

  while (Date.now() - startedAt < DIRECT_XML_DOWNLOAD_WAIT_MS) {
    const result = await Promise.race([
      directDownloadPromise,
      page.waitForTimeout(5_000).then(() => ({ type: 'tick' })),
    ]);

    if (result.type === 'download') {
      return result.download;
    }

    if (result.type === 'timeout') {
      return null;
    }

    const generationMessage = await detectPriceListGenerationMessage(page);
    if (generationMessage) {
      if (!generationDetected) {
        await onMessage(`Kaspi формирует XML для раздела ${statusLabel}. ${generationMessage}`);
        generationDetected = true;
        lastNoticeAt = Date.now();
      } else if (Date.now() - lastNoticeAt >= 30_000) {
        await onMessage(`Kaspi все еще формирует XML для раздела ${statusLabel}. Продолжаю ждать.`);
        lastNoticeAt = Date.now();
      }
      continue;
    }

    if (Date.now() - lastNoticeAt >= 30_000) {
      await onMessage(`Жду скачивание XML для раздела ${statusLabel}.`);
      lastNoticeAt = Date.now();
    }
  }

  return null;
}

async function waitForHistoryXmlDownload(page, config, {
  statusLabel,
  onMessage,
  previousHistoryEntry = null,
} = {}) {
  const startedAt = Date.now();
  let lastNoticeAt = 0;

  while (Date.now() - startedAt < config.xmlGenerationTimeoutMs) {
    const latestEntry = await readLatestPriceListHistoryEntry(page, config).catch(() => null);
    if (isNewPriceListHistoryEntry(latestEntry, previousHistoryEntry)) {
      await onMessage(`XML для раздела ${statusLabel} появился в истории загрузок. Скачиваю файл.`);
      return downloadPriceListHistoryEntry(page, latestEntry, config);
    }

    if (Date.now() - lastNoticeAt >= 30_000) {
      await onMessage(`Kaspi еще не подготовил XML для раздела ${statusLabel}. Проверяю историю повторно.`);
      lastNoticeAt = Date.now();
    }

    await page.waitForTimeout(HISTORY_XML_POLL_MS);
  }

  throw new Error(`Kaspi не подготовил XML для раздела ${statusLabel} за ${Math.round(config.xmlGenerationTimeoutMs / 60000)} минут.`);
}

async function downloadPriceListHistoryEntry(page, entry, config) {
  const downloadPromise = waitForPageDownload(page, Math.min(config.xmlGenerationTimeoutMs, 60_000));
  const fileId = extractFileId(entry?.fileLink);
  const historyLink = fileId
    ? await firstVisibleLocator(page, [`a[href*="${fileId}"]`])
    : await firstVisibleLocator(page, ['a[href*="/pricefeed/upload/merchant/files/"]']);

  if (!historyLink) {
    throw new Error('Не нашел ссылку на готовый XML в истории загрузок Kaspi.');
  }

  await historyLink.click();

  const result = await downloadPromise;
  if (result.type === 'download') {
    return result.download;
  }

  throw new Error('Kaspi показал готовый XML в истории, но браузер не начал скачивание файла.');
}

async function downloadKaspiProductsXmlWithinContext(context, page, config, status, onMessage) {
  const normalizedStatus = String(status || '').trim() === 'archive' ? 'archive' : 'active';
  await onMessage(`Открываю товары Kaspi: ${normalizedStatus === 'active' ? 'в продаже' : 'снятые с продажи'}.`);

  const apiResult = await tryDownloadMerchantProductsXmlViaApi(
    context,
    page,
    config,
    normalizedStatus,
    onMessage,
  );
  if (apiResult) {
    return apiResult;
  }

  await onMessage('Прямое API-скачивание Kaspi недоступно, переключаюсь на UI-режим.');
  const previousHistoryEntry = await readLatestPriceListHistoryEntry(page, config).catch(() => null);

  await openMerchantProductsPage(page, config, normalizedStatus);
  const download = await triggerMerchantProductsXmlDownload(
    page,
    config,
    normalizedStatus,
    onMessage,
    previousHistoryEntry,
  );

  const suggestedName = normalizeDownloadName(download.suggestedFilename(), 'xml');
  const targetFileName = `${Date.now()}-${normalizedStatus}-${suggestedName}`;
  const targetPath = path.join(config.downloadDir, targetFileName);
  await download.saveAs(targetPath);

  await onMessage(`XML ${normalizedStatus === 'active' ? 'товаров в продаже' : 'снятых с продажи'} скачан: ${targetFileName}.`);
  return {
    path: targetPath,
    filename: targetFileName,
    status: normalizedStatus,
  };
}

async function tryDownloadMerchantProductsXmlViaApi(context, page, config, status, onMessage) {
  const merchantId = await resolveKaspiMerchantId(page, config);
  if (!merchantId) {
    return null;
  }

  const normalizedStatus = status === 'archive' ? 'archive' : 'active';
  const availability = normalizedStatus === 'archive' ? 'ARCHIVE' : 'ACTIVE';
  const statusLabel = normalizedStatus === 'archive' ? 'снятых с продажи' : 'в продаже';
  let exportStatus = await readKaspiMerchantExportStatus(context, merchantId, availability);

  if (!exportStatus.ok) {
    return null;
  }

  if (exportStatus.status === 'FINISHED' && exportStatus.fileName) {
    await onMessage(`Kaspi API уже подготовил XML для раздела ${statusLabel}. Скачиваю файл напрямую.`);
    return downloadKaspiMerchantExportFile(context, config, normalizedStatus, exportStatus.fileName, statusLabel);
  }

  if (exportStatus.status === 'PROCESSING') {
    await onMessage(`Kaspi уже формирует XML для раздела ${statusLabel}. Жду готовый файл через API.`);
  } else {
    await onMessage(`Запускаю формирование XML для раздела ${statusLabel} через API Kaspi.`);
    const triggerResult = await triggerKaspiMerchantExport(context, merchantId, availability);

    if (triggerResult.httpStatus === 429) {
      await onMessage(`Kaspi ограничил повторный запуск экспорта для раздела ${statusLabel}. Жду уже подготовленный файл.`);
    } else if (!triggerResult.ok) {
      return null;
    }
  }

  const startedAt = Date.now();
  let lastNoticeAt = 0;

  while (Date.now() - startedAt < config.xmlGenerationTimeoutMs) {
    exportStatus = await readKaspiMerchantExportStatus(context, merchantId, availability);

    if (exportStatus.ok && exportStatus.status === 'FINISHED' && exportStatus.fileName) {
      await onMessage(`Kaspi API подготовил XML для раздела ${statusLabel}. Скачиваю файл напрямую.`);
      return downloadKaspiMerchantExportFile(context, config, normalizedStatus, exportStatus.fileName, statusLabel);
    }

    if (exportStatus.ok && /FAILED|ERROR|CANCELLED/i.test(exportStatus.status)) {
      const details = exportStatus.errorMessage ? `: ${exportStatus.errorMessage}` : '';
      throw new Error(`Kaspi API не смог подготовить XML для раздела ${statusLabel}${details}`);
    }

    if (Date.now() - lastNoticeAt >= MERCHANT_EXPORT_PROGRESS_LOG_MS) {
      const suffix = exportStatus.status
        ? ` Текущий статус API: ${exportStatus.status}.`
        : '';
      await onMessage(`Kaspi API все еще формирует XML для раздела ${statusLabel}.${suffix}`);
      lastNoticeAt = Date.now();
    }

    await waitForTimeoutOrPageClose(context.pages()[0] || null, MERCHANT_EXPORT_STATUS_POLL_MS);
  }

  throw new Error(`Kaspi API не подготовил XML для раздела ${statusLabel} за ${Math.round(config.xmlGenerationTimeoutMs / 60000)} минут.`);
}

async function readKaspiMerchantExportStatus(context, merchantId, availability) {
  const response = await context.request.get(
    `${MERCHANT_EXPORT_API_ORIGIN}/offers/api/v1/offer/export/status?m=${encodeURIComponent(merchantId)}&available=${encodeURIComponent(availability)}`,
    { failOnStatusCode: false },
  );
  const text = await readApiResponseText(response);
  const payload = parseJsonSafe(text);

  return {
    ok: response.ok(),
    httpStatus: response.status(),
    status: normalizeText(payload?.status).toUpperCase(),
    fileName: normalizeText(payload?.fileName),
    errorMessage: normalizeText(payload?.errorMessage),
    rawText: text,
  };
}

async function triggerKaspiMerchantExport(context, merchantId, availability) {
  const response = await context.request.get(
    `${MERCHANT_EXPORT_API_ORIGIN}/offers/api/v1/offer/export/trigger?m=${encodeURIComponent(merchantId)}&available=${encodeURIComponent(availability)}&fileType=XML`,
    { failOnStatusCode: false },
  );
  const text = await readApiResponseText(response);

  return {
    ok: response.ok(),
    httpStatus: response.status(),
    rawText: text,
  };
}

async function downloadKaspiMerchantExportFile(context, config, status, fileName, statusLabel) {
  const normalizedFileName = normalizeDownloadName(path.basename(fileName), 'xml');
  const targetFileName = `${Date.now()}-${status}-${normalizedFileName}`;
  const targetPath = path.join(config.downloadDir, targetFileName);
  const response = await context.request.get(buildKaspiMerchantExportFileUrl(fileName), {
    failOnStatusCode: false,
  });

  if (!response.ok()) {
    throw new Error(`Kaspi API подготовил XML для раздела ${statusLabel}, но прямое скачивание вернуло HTTP ${response.status()}.`);
  }

  await fs.writeFile(targetPath, await response.body());
  return {
    path: targetPath,
    filename: targetFileName,
    status,
  };
}

async function saveDebugSnapshot(page, config) {
  await fs.mkdir(config.debugDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotPath = path.join(config.debugDir, `${stamp}-kaspi-debug.png`);
  const htmlPath = path.join(config.debugDir, `${stamp}-kaspi-debug.html`);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  await fs.writeFile(htmlPath, await page.content(), 'utf8').catch(() => {});
}

function splitSelectors(raw, fallback) {
  return raw
    ? raw.split('||').map((selector) => selector.trim()).filter(Boolean)
    : fallback;
}

function resolveBrowserPath() {
  if (process.env.KASPI_BROWSER_PATH) {
    return process.env.KASPI_BROWSER_PATH;
  }

  return firstExistingPath([
    chromium.executablePath(),
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ]) || '/usr/bin/chromium-browser';
}

function firstExistingPath(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate));
}

async function waitForOptionalNetworkIdle(page, timeoutMs = SOFT_NETWORK_IDLE_TIMEOUT_MS) {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
}

function sanitizeDownloadName(value) {
  return value.replace(/[^A-Za-zА-Яа-я0-9._-]/g, '_');
}

function normalizeDownloadName(value, format) {
  const fallbackExtension = format.toLowerCase() === 'excel' ? 'xlsx' : format.toLowerCase();
  const name = sanitizeDownloadName(value || `kaspi-price-list.${fallbackExtension}`);

  if (path.extname(name)) {
    return name;
  }

  return `${name}.${fallbackExtension}`;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function readApiResponseText(response) {
  const body = await response.body().catch(() => Buffer.from(''));
  return body.toString('utf8');
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

async function resolveKaspiMerchantId(page, config) {
  const configuredMerchantId = normalizeText(config.merchantId);
  if (/^\d+$/.test(configuredMerchantId)) {
    return configuredMerchantId;
  }

  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const merchantIdMatch = String(bodyText || '').match(/\bID\s*[-:]\s*(\d+)\b/i);
  return merchantIdMatch?.[1] || '';
}

async function detectPriceListGenerationMessage(page) {
  const bodyText = normalizeText(
    await page.locator('body').innerText({ timeout: 2_000 }).catch(() => ''),
  );

  return extractMatchedText(bodyText, [
    /[^.]{0,120}формир[^.]{0,160}xml[^.]{0,120}/i,
    /[^.]{0,120}xml[^.]{0,160}формир[^.]{0,120}/i,
    /[^.]{0,120}в течени[ея][^.]{0,40}5 минут[^.]{0,120}/i,
    /[^.]{0,120}в течение[^.]{0,40}5 минут[^.]{0,120}/i,
    /[^.]{0,120}будет готов[^.]{0,120}/i,
    /[^.]{0,120}подготов[^.]{0,120}файл[^.]{0,120}/i,
  ]);
}

function waitForPageDownload(page, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      page.off('download', onDownload);
    };

    const onDownload = (download) => {
      if (settled) return;
      cleanup();
      resolve({ type: 'download', download });
    };

    timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      resolve({ type: 'timeout' });
    }, timeoutMs);

    page.on('download', onDownload);
  });
}

async function waitForTimeoutOrPageClose(page, timeoutMs) {
  if (page) {
    await page.waitForTimeout(timeoutMs).catch(() => {});
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function extractMatchedText(text, patterns) {
  const source = String(text || '');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[0]) {
      return normalizeText(match[0]);
    }
  }

  return '';
}

function matchText(text, pattern) {
  const match = String(text || '').match(pattern);
  return match?.[1] ? normalizeText(match[1]) : '';
}

function parseBracketCount(text, label) {
  const safeLabel = escapeRegExp(label);
  const match = String(text || '').match(new RegExp(`${safeLabel}:\\s*\\((\\d+)\\)`, 'i'));
  return match ? Number(match[1]) : null;
}

function parseLooseCount(value) {
  const normalized = normalizeText(value);
  if (!normalized || /^[.]+$/.test(normalized)) {
    return null;
  }
  const digits = normalized.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function extractFileId(link) {
  const match = String(link || '').match(/\/files\/([^/?#]+)/i);
  return match?.[1] || '';
}

function buildKaspiMerchantExportFileUrl(fileName) {
  const normalizedPath = String(fileName || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${MERCHANT_EXPORT_FILE_BASE_URL}/${normalizedPath}`;
}

function isNewPriceListHistoryEntry(latestEntry, previousEntry) {
  if (!latestEntry?.fileLink) {
    return false;
  }

  if (!previousEntry?.fileLink) {
    return true;
  }

  return latestEntry.fileLink !== previousEntry.fileLink
    || extractFileId(latestEntry.fileLink) !== extractFileId(previousEntry.fileLink);
}

function toAbsoluteKaspiUrl(link) {
  const value = String(link || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `https://kaspi.kz${value}`;
  return value;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKaspiShopLink(value) {
  const href = normalizeText(value);
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  return `https://kaspi.kz${href.startsWith('/') ? '' : '/'}${href}`;
}

function extractKaspiIdFromHref(value) {
  const match = String(value || '').match(/-(\d+)\/?(?:[?#]|$)/);
  return match?.[1] || '';
}
