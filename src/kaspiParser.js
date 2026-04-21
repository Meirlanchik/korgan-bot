import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from 'playwright-core';

dotenv.config();

const DEFAULT_CITY_ID = '750000000';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_LIGHT_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_BROWSER_PATHS = [
  process.env.KASPI_BROWSER_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/home/meirlan/.cache/puppeteer/chrome/linux-1069273/chrome-linux/chrome',
].filter(Boolean);

const SELLER_RETRYABLE_STATUSES = new Set([405, 429, 502, 503, 504]);

export async function parseKaspiProductById(kaspiId, options = {}) {
  const target = normalizeParseTarget(kaspiId, options);
  const cityId = options.cityId || process.env.KASPI_CITY_ID || DEFAULT_CITY_ID;
  const url = options.url || buildKaspiProductUrl(target, cityId);
  const executablePath = await resolveBrowserPath(options.executablePath);
  let browser;

  try {
    browser = await chromium.launch({
      executablePath,
      headless: options.headless ?? process.env.KASPI_BROWSER_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-http2',
        '--window-size=1920,1080',
        '--lang=ru-RU,ru',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'ru-RU',
      extraHTTPHeaders: {
        'accept-language': 'ru-RU,ru;q=0.9,kk-KZ;q=0.8,kk;q=0.7,en;q=0.6',
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'ru-RU' });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ru-RU', 'ru', 'kk-KZ', 'en'],
      });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs || Number(process.env.KASPI_PARSER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));

    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await assertKaspiShopAvailable(page, response);
    await ensureProductPage(page, target, cityId);
    await assertKaspiShopAvailable(page);
    await page.waitForLoadState('networkidle').catch(() => null);
    await page
      .waitForSelector('h1, .item__heading, meta[property="og:title"], script[type="application/ld+json"]', { timeout: 15_000 })
      .catch(() => null);

    const parsedData = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((node) => node.textContent || '')
        .map((text) => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        })
        .flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
      const schemaProduct = scripts.find((entry) => {
        const type = entry?.['@type'];
        return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      }) || null;
      const canonicalUrl =
        document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim()
        || location.href;
      const title =
        document.querySelector('.item__heading')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() ||
        schemaProduct?.name?.trim() ||
        document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
      const productCodeText =
        document.querySelector('.item__sku')?.textContent?.trim()
        || schemaProduct?.sku?.trim?.()
        || '';
      const rawPrice =
        document.querySelector('.item__price-once')?.textContent ||
        schemaProduct?.offers?.price ||
        document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
      const price = Number(rawPrice?.match(/\d/g)?.join(''));

      const breadcrumbs = [...document.querySelectorAll('.breadcrumbs__el, [itemtype*="BreadcrumbList"] [itemprop="name"], .breadcrumbs a, nav[aria-label*="Breadcrumb"] a')];
      const category = breadcrumbs.length > 1
        ? breadcrumbs.map((node) => node.textContent?.trim() || '').filter(Boolean).slice(1, -1).pop() || ''
        : '';
      const brand =
        schemaProduct?.brand?.name?.trim()
        || schemaProduct?.brand?.trim?.()
        || document.querySelector('[itemprop="brand"]')?.textContent?.trim()
        || document.querySelector('[data-test-id="merchant-name"]')?.textContent?.trim()
        || '';
      const imageCandidates = [];
      if (Array.isArray(schemaProduct?.image)) {
        imageCandidates.push(...schemaProduct.image);
      } else if (schemaProduct?.image) {
        imageCandidates.push(schemaProduct.image);
      }
      imageCandidates.push(
        ...[...document.querySelectorAll('img[src*="sys_master/images"], img[src*="resources.cdn-kaspi.kz"]')]
          .map((img) => img.getAttribute('src')),
      );
      const images = [...new Set(imageCandidates
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => value.replace(/^https?:\/\/resources\.cdn-kaspi\.kz\/shop\/medias\/sys_master\/images\/images\//, ''))
        .map((value) => value.replace(/^\/+/, '')),
      )];
      const productId =
        (canonicalUrl.match(/-(\d+)\/?(?:\?.*)?$/) || [])[1]
        || String(window.BACKEND?.components?.item?.item?.id || '').trim()
        || '';
      const shopLink = canonicalUrl
        ? canonicalUrl.replace(/^https?:\/\/[^/]+/, '')
        : location.pathname;

      return title ? {
        title,
        price: Number.isFinite(price) ? price : 0,
        category,
        brand,
        images,
        kaspiId: productId,
        productCode: productCodeText,
        shopLink,
      } : null;
    });

    if (!parsedData) {
      throw new Error('PARSING_FROM_KASPI_FAILED');
    }

    if (isKaspiNotFoundTitle(parsedData.title)) {
      if (target.expectedProductCode) {
        throwSkuNotFoundError(target, 'Kaspi карточка с таким кодом не найдена');
      }
      throw new Error('Kaspi карточка товара не найдена.');
    }

    const productId = normalizeKaspiId(parsedData.kaspiId || target.kaspiId);
    assertProductCodeMatchesTarget(target, {
      title: parsedData.title,
      productCode: parsedData.productCode,
      kaspiId: productId,
      shopLink: parsedData.shopLink,
      url: page.url(),
    });

    const sellers = await page.evaluate(
      async ({ productId, cityId, sellerRetryAttempts, sellerRetryDelayMs }) => {
        const product = window.BACKEND?.components?.item?.card?.promoConditions || {};
        const limit = 50;
        const offers = [];
        const wait = (ms) => new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
        const retryableStatuses = new Set([405, 429, 502, 503, 504]);

        for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
          let response;

          for (let attempt = 0; attempt <= sellerRetryAttempts; attempt += 1) {
            response = await fetch(`/yml/offer-view/offers/${productId}`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/json',
                'x-requested-with': 'XMLHttpRequest',
              },
              body: JSON.stringify({
                cityId,
                id: productId,
                merchantUID: [],
                limit,
                page: pageNumber,
                product,
                sortOption: 'PRICE',
              }),
            });

            if (response.ok || !retryableStatuses.has(response.status) || attempt >= sellerRetryAttempts) {
              break;
            }

            await wait(sellerRetryDelayMs * (attempt + 1));
          }

          if (!response?.ok) {
            const message = await response?.text().catch(() => '') || '';
            throw new Error(`SELLERS_REQUEST_FAILED:${response?.status || 'NO_RESPONSE'}:${message.slice(0, 200)}`);
          }

          const data = await response.json();
          offers.push(...(data.offers || []));

          const total =
            data.total || data.offersCount || data.totalElements || data.offers?.length || 0;

          if (offers.length >= total || !data.offers?.length) {
            break;
          }
        }

        return offers.map((offer) => ({
          merchantId:
            offer.merchantId
            ?? offer.merchant_id
            ?? offer.merchantUID
            ?? offer.merchantUid
            ?? offer.merchant?.id
            ?? offer.merchant?.uid
            ?? offer.uid
            ?? offer.id
            ?? '',
          merchantName:
            offer.merchantName
            ?? offer.merchant_name
            ?? offer.merchant?.name
            ?? offer.merchant?.title
            ?? offer.name
            ?? '',
          price: Number(offer.price),
          merchantRating: offer.merchantRating,
          merchantReviewsQuantity: offer.merchantReviewsQuantity,
          deliveryType: offer.deliveryType,
          kaspiDelivery: offer.kaspiDelivery,
        }));
      },
      {
        productId,
        cityId,
        sellerRetryAttempts: Number(options.sellerRetryAttempts ?? process.env.KASPI_SELLER_RETRY_ATTEMPTS ?? 2),
        sellerRetryDelayMs: Number(options.sellerRetryDelayMs ?? process.env.KASPI_SELLER_RETRY_DELAY_MS ?? 1500),
      },
    );

    return {
      kaspiId: productId,
      cityId,
      title: parsedData.title,
      price: parsedData.price,
      category: parsedData.category || '',
      brand: parsedData.brand || '',
      images: parsedData.images || [],
      shopLink: parsedData.shopLink || '',
      url: page.url(),
      sellers: sellers.filter((seller) => Number.isFinite(seller.price) && seller.price > 0),
    };
  } finally {
    await browser?.close();
  }
}

export async function parseKaspiProductByIdLight(kaspiId, options = {}) {
  const target = normalizeParseTarget(kaspiId, options);
  const cityId = options.cityId || process.env.KASPI_CITY_ID || DEFAULT_CITY_ID;
  const sellerRetryAttempts = Number(options.sellerRetryAttempts ?? process.env.KASPI_SELLER_RETRY_ATTEMPTS ?? 2);
  const sellerRetryDelayMs = Number(options.sellerRetryDelayMs ?? process.env.KASPI_SELLER_RETRY_DELAY_MS ?? 1500);
  const timeoutMs = Number(options.timeoutMs ?? process.env.KASPI_LIGHT_PARSER_TIMEOUT_MS ?? DEFAULT_LIGHT_FETCH_TIMEOUT_MS);

  const resolvedTarget = await resolveLightweightTarget(target, cityId, timeoutMs);
  const productId = normalizeKaspiId(resolvedTarget.kaspiId || target.kaspiId);
  const offers = await fetchKaspiOffersByProductId({
    productId,
    cityId,
    sellerRetryAttempts,
    sellerRetryDelayMs,
    timeoutMs,
  });

  const firstOffer = offers[0] || null;
  assertProductCodeMatchesTarget(target, {
    title: firstOffer?.title || '',
    productCode: '',
    kaspiId: productId,
    shopLink: resolvedTarget.shopLink || target.shopLink || '',
    url: resolvedTarget.shopLink ? normalizeShopLink(resolvedTarget.shopLink) : buildKaspiProductUrl({ kaspiId: productId }, cityId),
    candidates: resolvedTarget.productCodeCandidates || [],
  });

  return {
    parseMode: 'light',
    kaspiId: productId,
    cityId,
    title: firstOffer?.title || '',
    price: Number(firstOffer?.price || 0),
    category: '',
    brand: '',
    images: [],
    shopLink: resolvedTarget.shopLink || target.shopLink || '',
    url: resolvedTarget.shopLink ? normalizeShopLink(resolvedTarget.shopLink) : buildKaspiProductUrl({ kaspiId: productId }, cityId),
    sellers: offers.map((offer) => ({
      merchantId:
        offer.merchantId
        ?? offer.merchant_id
        ?? offer.merchantUID
        ?? offer.merchantUid
        ?? offer.merchant?.id
        ?? offer.merchant?.uid
        ?? offer.uid
        ?? offer.id
        ?? '',
      merchantName:
        offer.merchantName
        ?? offer.merchant_name
        ?? offer.merchant?.name
        ?? offer.merchant?.title
        ?? offer.name
        ?? '',
      price: Number(offer.price),
      merchantRating: offer.merchantRating,
      merchantReviewsQuantity: offer.merchantReviewsQuantity,
      deliveryType: offer.deliveryType,
      kaspiDelivery: offer.kaspiDelivery,
    })).filter((seller) => Number.isFinite(seller.price) && seller.price > 0),
  };
}

function normalizeParseTarget(value, options = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      kaspiId: clean(value.kaspiId || value.kaspi_id),
      shopLink: clean(value.shopLink || value.shop_link),
      query: clean(value.query || value.model || value.title || options.query),
      sourceSku: clean(value.sourceSku || value.source_sku || options.sourceSku || options.source_sku),
      expectedProductCode: clean(value.expectedProductCode || value.expected_product_code || options.expectedProductCode || options.expected_product_code),
    };
  }

  return {
    kaspiId: clean(value),
    shopLink: clean(options.shopLink || options.shop_link),
    query: clean(options.query),
    sourceSku: clean(options.sourceSku || options.source_sku),
    expectedProductCode: clean(options.expectedProductCode || options.expected_product_code),
  };
}

function buildKaspiProductUrl(target, cityId) {
  if (target.shopLink) {
    return appendCityId(normalizeShopLink(target.shopLink), cityId);
  }

  if (target.kaspiId) {
    return `https://kaspi.kz/shop/p/-${normalizeKaspiId(target.kaspiId)}/?c=${cityId}`;
  }

  if (target.expectedProductCode) {
    return `https://kaspi.kz/shop/p/-${normalizeKaspiId(target.expectedProductCode)}/?c=${cityId}`;
  }

  if (target.query) {
    return `https://kaspi.kz/shop/search/?text=${encodeURIComponent(target.query)}&c=${cityId}`;
  }

  throw new Error('Не удалось определить ссылку на товар Kaspi.');
}

async function ensureProductPage(page, target, cityId) {
  if (await isProductPage(page)) {
    return;
  }

  await assertKaspiShopAvailable(page);

  if (target.expectedProductCode) {
    throwSkuNotFoundError(target, 'Kaspi карточка с таким кодом не найдена');
  }

  if (!target.query) {
    throw new Error('Товар Kaspi не найден: нет ссылки и поискового запроса.');
  }

  const searchUrl = `https://kaspi.kz/shop/search/?text=${encodeURIComponent(target.query)}&c=${cityId}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await assertKaspiShopAvailable(page);
  await page.waitForSelector('a[href*="/shop/p/"], a[href*="/p/"]', { timeout: 15_000 });

  const href = await page.evaluate(() => {
    const link = document.querySelector('a[href*="/shop/p/"], a[href*="/p/"]');
    return link?.getAttribute('href') || '';
  });

  if (!href) {
    if (target.expectedProductCode) {
      throwSkuNotFoundError(target, 'Kaspi поиск не вернул ссылку на товар');
    }
    throw new Error('Kaspi поиск не вернул ссылку на товар.');
  }

  await page.goto(appendCityId(normalizeShopLink(href), cityId), { waitUntil: 'domcontentloaded' });
  await assertKaspiShopAvailable(page);

  if (!(await isProductPage(page))) {
    if (target.expectedProductCode) {
      throwSkuNotFoundError(target, 'Kaspi открыл не карточку товара');
    }
    throw new Error('Kaspi открыл не карточку товара.');
  }
}

async function resolveLightweightTarget(target, cityId, timeoutMs) {
  if (target.kaspiId) {
    return {
      kaspiId: target.kaspiId,
      shopLink: target.shopLink || '',
    };
  }

  const kaspiIdFromLink = extractKaspiIdFromShopLink(target.shopLink);
  if (kaspiIdFromLink) {
    return {
      kaspiId: kaspiIdFromLink,
      shopLink: target.shopLink || '',
    };
  }

  if (target.expectedProductCode) {
    const directTarget = await resolveKaspiTargetFromProductCode(target, cityId, timeoutMs);
    if (directTarget.kaspiId) {
      return directTarget;
    }

    throwSkuNotFoundError(target, 'Kaspi карточка с таким кодом не найдена');
  }

  if (!target.query) {
    if (target.expectedProductCode) {
      throwSkuNotFoundError(target, 'нет ссылки и поискового запроса');
    }
    throw new Error('Не удалось определить ссылку на товар Kaspi.');
  }

  const searchResult = await resolveKaspiTargetFromSearch(target.query, cityId, timeoutMs);
  if (!searchResult.kaspiId) {
    if (target.expectedProductCode) {
      throwSkuNotFoundError(target, 'Kaspi поиск не вернул ссылку на товар');
    }
    throw new Error('Kaspi поиск не вернул ссылку на товар.');
  }

  return searchResult;
}

async function resolveKaspiTargetFromProductCode(target, cityId, timeoutMs) {
  const productCode = clean(target.expectedProductCode);
  if (!productCode) return { kaspiId: '', shopLink: '' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const productUrl = `https://kaspi.kz/shop/p/-${encodeURIComponent(productCode)}/?c=${cityId}`;

  try {
    const response = await fetch(productUrl, {
      headers: {
        ...buildKaspiHttpHeaders({ cityId, referer: productUrl }),
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });

    const html = await response.text();
    if (/[CС]коро\s+Магазин\s+будет\s+доступен/i.test(html) || response.status === 503) {
      throw new Error(`KASPI_SHOP_UNAVAILABLE:${response.status || 'PAGE'}:Kaspi Shop сейчас отдает заглушку "Скоро Магазин будет доступен".`);
    }

    if (!response.ok || !isProductHtml(html)) {
      return { kaspiId: '', shopLink: '' };
    }

    const productData = parseProductDataFromHtml(html, productUrl);
    assertProductCodeMatchesTarget(target, productData);

    return {
      kaspiId: productData.kaspiId,
      shopLink: productData.shopLink,
      productCodeCandidates: [productData.productCode, productData.kaspiId].filter(Boolean),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Timeout while resolving Kaspi product by code');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveKaspiTargetFromSearch(query, cityId, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const searchUrl = `https://kaspi.kz/shop/search/?text=${encodeURIComponent(query)}&c=${cityId}`;
    const response = await fetch(searchUrl, {
      headers: buildKaspiHttpHeaders({ cityId, referer: searchUrl }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Kaspi поиск вернул HTTP ${response.status}`);
    }

    const html = await response.text();
    if (/[CС]коро\s+Магазин\s+будет\s+доступен/i.test(html)) {
      throw new Error('KASPI_SHOP_UNAVAILABLE:PAGE:Kaspi Shop сейчас отдает заглушку "Скоро Магазин будет доступен".');
    }

    const hrefMatch = html.match(/href="([^"]*\/shop\/p\/[^"]*-(\d+)\/?[^"]*)"/i);
    if (!hrefMatch) {
      return { kaspiId: '', shopLink: '' };
    }

    const rawLink = hrefMatch[1].replace(/&amp;/g, '&');
    return {
      kaspiId: hrefMatch[2],
      shopLink: rawLink.replace(/^https?:\/\/kaspi\.kz/i, ''),
      productCodeCandidates: [hrefMatch[2]],
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Timeout while resolving Kaspi search results');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKaspiOffersByProductId({
  productId,
  cityId,
  sellerRetryAttempts,
  sellerRetryDelayMs,
  timeoutMs,
}) {
  const offers = [];
  const limit = 50;

  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const response = await fetchKaspiOffersPage({
      productId,
      cityId,
      pageNumber,
      limit,
      sellerRetryAttempts,
      sellerRetryDelayMs,
      timeoutMs,
    });
    const data = await response.json();
    offers.push(...(data.offers || []));

    const total = Number(data.total || data.offersCount || data.totalElements || data.offers?.length || 0);
    if (offers.length >= total || !data.offers?.length) {
      break;
    }
  }

  return offers;
}

async function fetchKaspiOffersPage({
  productId,
  cityId,
  pageNumber,
  limit,
  sellerRetryAttempts,
  sellerRetryDelayMs,
  timeoutMs,
}) {
  let response = null;

  for (let attempt = 0; attempt <= sellerRetryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetch(`https://kaspi.kz/yml/offer-view/offers/${productId}`, {
        method: 'POST',
        headers: buildKaspiHttpHeaders({ cityId, referer: `https://kaspi.kz/shop/p/-${productId}/?c=${cityId}` }),
        body: JSON.stringify({
          cityId,
          id: productId,
          merchantUID: [],
          limit,
          page: pageNumber,
          product: {},
          sortOption: 'PRICE',
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (attempt >= sellerRetryAttempts) {
          throw new Error(`SELLERS_REQUEST_FAILED:TIMEOUT:Kaspi не ответил вовремя по товару ${productId}`);
        }
      } else if (attempt >= sellerRetryAttempts) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (response?.ok || !response || !SELLER_RETRYABLE_STATUSES.has(response.status) || attempt >= sellerRetryAttempts) {
      break;
    }

    await wait(sellerRetryDelayMs * (attempt + 1));
  }

  if (!response?.ok) {
    const message = await response?.text().catch(() => '') || '';
    throw new Error(`SELLERS_REQUEST_FAILED:${response?.status || 'NO_RESPONSE'}:${message.slice(0, 200)}`);
  }

  return response;
}

async function isProductPage(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    if (/[CС]коро\s+Магазин\s+будет\s+доступен/i.test(bodyText)) {
      return false;
    }

    if (/Страница\s+не\s+найдена/i.test(bodyText)) {
      return false;
    }

    return Boolean(
      document.querySelector('.item__heading, h1')
      || document.querySelector('meta[property="product:price:amount"]')
      || document.querySelector('script[type="application/ld+json"]')
      || window.BACKEND?.components?.item?.item?.id
    );
  }).catch(() => false);
}

async function assertKaspiShopAvailable(page, response = null) {
  const status = response?.status?.() || 0;
  const unavailable = await page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    return /[CС]коро\s+Магазин\s+будет\s+доступен/i.test(bodyText);
  }).catch(() => false);

  if (unavailable || status === 503) {
    throw new Error(`KASPI_SHOP_UNAVAILABLE:${status || 'PAGE'}:Kaspi Shop сейчас отдает заглушку "Скоро Магазин будет доступен".`);
  }
}

function buildKaspiHttpHeaders({ cityId, referer }) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ru-RU,ru;q=0.9,kk-KZ;q=0.8,kk;q=0.7,en;q=0.6',
    'content-type': 'application/json',
    origin: 'https://kaspi.kz',
    referer: referer || `https://kaspi.kz/shop/?c=${cityId}`,
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
  };
}

function normalizeShopLink(shopLink) {
  if (!shopLink) return '';
  const value = String(shopLink).trim();
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `https://kaspi.kz${value.startsWith('/') ? '' : '/'}${value}`;
}

function extractKaspiIdFromShopLink(shopLink) {
  const match = String(shopLink || '').match(/-(\d+)\/?(?:\?|$)/);
  return match?.[1] || '';
}

function appendCityId(url, cityId) {
  const target = new URL(url);
  if (!target.searchParams.get('c')) {
    target.searchParams.set('c', cityId);
  }
  return target.toString();
}

function isProductHtml(html) {
  return Boolean(
    html.match(/class=["'][^"']*item__heading/i)
    || html.match(/class=["'][^"']*item__sku/i)
    || html.match(/"@type"\s*:\s*"Product"/i)
  );
}

function parseProductDataFromHtml(html, fallbackUrl = '') {
  const canonicalUrl =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
    || fallbackUrl;
  const productCode =
    html.match(/class=["'][^"']*item__sku[^"']*["'][^>]*>\s*Код товара:\s*([^<]+)/i)?.[1]
    || html.match(/"sku"\s*:\s*"([^"]+)"/i)?.[1]
    || '';
  const title =
    html.match(/class=["'][^"']*item__heading[^"']*["'][^>]*>([^<]+)/i)?.[1]
    || html.match(/<title>([^<]+)/i)?.[1]
    || '';
  const kaspiId = extractKaspiIdFromShopLink(canonicalUrl) || extractKaspiIdFromShopLink(fallbackUrl) || productCode;

  return {
    title: decodeHtmlText(title),
    productCode: decodeHtmlText(productCode),
    kaspiId,
    shopLink: canonicalUrl ? canonicalUrl.replace(/^https?:\/\/[^/]+/, '') : '',
    url: fallbackUrl,
  };
}

function assertProductCodeMatchesTarget(target, parsedProduct) {
  const expectedCode = clean(target.expectedProductCode);
  if (!expectedCode) return;

  const candidates = extractActualProductCodeCandidates(parsedProduct);
  const expected = normalizeProductCode(expectedCode);

  if (candidates.normalized.has(expected)) {
    return;
  }

  const sourceSku = clean(target.sourceSku) || clean(target.query) || expectedCode;
  const found = candidates.display.slice(0, 8).join(', ') || 'код не найден';
  throwSkuNotFoundError(target, 'код товара на Kaspi не совпадает', found);
}

function extractActualProductCodeCandidates(parsedProduct = {}) {
  const normalized = new Set();
  const display = [];

  const add = (value) => {
    const raw = clean(extractProductCodeValue(value));
    const code = normalizeProductCode(raw);
    if (!code || normalized.has(code)) return;
    normalized.add(code);
    display.push(raw.length > 60 ? `${raw.slice(0, 57)}...` : raw);
  };

  add(parsedProduct.productCode);
  add(parsedProduct.kaspiId);
  add(extractKaspiIdFromShopLink(parsedProduct.shopLink));
  add(extractKaspiIdFromShopLink(parsedProduct.url));

  for (const value of Array.isArray(parsedProduct.candidates) ? parsedProduct.candidates : []) {
    add(value);
  }

  return { normalized, display };
}

function extractProductCodeValue(value) {
  const text = clean(value);
  if (!text) return '';

  const labelMatch = text.match(/код\s+товара\s*:?\s*([A-Za-zА-Яа-я0-9_-]+)/i);
  if (labelMatch) return labelMatch[1];

  return text;
}

function throwSkuNotFoundError(target, reason = '', found = '') {
  const sourceSku = clean(target.sourceSku) || clean(target.query) || clean(target.expectedProductCode) || '-';
  const expectedCode = clean(target.expectedProductCode);
  const reasonText = reason ? ` ${capitalizeFirst(reason)}.` : '';
  const expectedText = expectedCode ? ` Ожидал код: ${expectedCode}.` : '';
  const foundText = found ? ` Найдено: ${found}.` : '';

  throw new Error(`Не получилось по SKU ${sourceSku} найти товар на Kaspi.${reasonText}${expectedText}${foundText} Товар не существует.`);
}

function normalizeProductCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-zа-я0-9]/gi, '');
}

function capitalizeFirst(value) {
  const text = clean(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function decodeHtmlText(value) {
  return clean(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isKaspiNotFoundTitle(value) {
  return /Страница\s+не\s+найдена/i.test(clean(value));
}

export function normalizeKaspiId(value) {
  const kaspiId = String(value || '').trim();

  if (!kaspiId) {
    throw new Error('Укажите Kaspi ID товара.');
  }

  return kaspiId;
}

function clean(value) {
  return String(value || '').trim();
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveBrowserPath(preferredPath) {
  for (const browserPath of [preferredPath, ...DEFAULT_BROWSER_PATHS].filter(Boolean)) {
    if (await exists(browserPath)) {
      return browserPath;
    }
  }

  return undefined;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isCliEntryPoint() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isCliEntryPoint()) {
  const kaspiId = process.argv[2];

  if (!kaspiId) {
    console.error('Использование: npm run parser:test -- <kaspiId>');
    process.exitCode = 1;
  } else {
    parseKaspiProductById(kaspiId)
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
