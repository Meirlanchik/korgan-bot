import fs from 'node:fs/promises';
import path from 'node:path';
import { parseKaspiProductById, parseKaspiProductByIdLight } from './kaspiParser.js';
import { resolveKaspiProductCardFromMerchantCabinet } from './kaspiCabinet.js';
import { readCatalog, saveCatalog } from './kaspiPriceList.js';
import { config } from './config.js';
import {
    getAllProducts,
    getProduct,
    getSellers,
    upsertProduct,
    replaceSellers,
    clearKaspiParseData,
    addProductHistoryEvent,
    getSetting,
    setSetting,
    getKnownMerchantNames,
} from './db.js';
import { logRuntime } from './logger.js';

const DEFAULT_PRODUCT_UPDATE_DELAY_MS = 1000;
const DEFAULT_LIGHT_PRODUCT_DELAY_MS = 0;
const DEFAULT_AUTOPRICING_CONCURRENCY = 4;

export async function readAutoPricingState(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return normalizeState(JSON.parse(raw));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return emptyState();
        }

        throw error;
    }
}

export async function saveAutoPricingState(filePath, state) {
    const normalized = normalizeState(state);
    normalized.updatedAt = new Date().toISOString();

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, filePath);
    return normalized;
}

export async function upsertAutoPricingTracking(filePath, sku, tracking) {
    const state = await readAutoPricingState(filePath);
    const key = normalizeSku(sku);

    if (!tracking) {
        delete state.products[key];
        return saveAutoPricingState(filePath, state);
    }

    state.products[key] = {
        ...state.products[key],
        ...normalizeTracking(tracking),
    };

    return saveAutoPricingState(filePath, state);
}

export async function renameAutoPricingTracking(filePath, oldSku, newSku) {
    const oldKey = normalizeSku(oldSku);
    const newKey = normalizeSku(newSku);

    if (oldKey === newKey) {
        return readAutoPricingState(filePath);
    }

    const state = await readAutoPricingState(filePath);
    if (state.products[oldKey] && !state.products[newKey]) {
        state.products[newKey] = state.products[oldKey];
    }
    delete state.products[oldKey];
    return saveAutoPricingState(filePath, state);
}

export async function removeAutoPricingTracking(filePath, sku) {
    const state = await readAutoPricingState(filePath);
    delete state.products[normalizeSku(sku)];
    return saveAutoPricingState(filePath, state);
}

export function getAutoPricingTracking(state, sku) {
    return normalizeState(state).products[normalizeSku(sku)] || null;
}

export async function runAutoPricingForSku({
    publicDir,
    trackingFile,
    sku,
    parser = parseKaspiProductByIdLight,
    parserOptions = {},
} = {}) {
    const state = await readAutoPricingState(trackingFile);
    const catalog = await readCatalog(publicDir);
    const result = await updateCatalogOfferPrice({
        catalog,
        state,
        sku,
        parser,
        parserOptions,
    });

    if (result.changed) {
        await saveCatalog(publicDir, catalog);
    }
    await saveAutoPricingState(trackingFile, state);

    return result;
}

export async function runAutoPricingForAll({
    publicDir,
    trackingFile,
    parser = parseKaspiProductByIdLight,
    parserOptions = {},
    concurrency = DEFAULT_AUTOPRICING_CONCURRENCY,
    delayMs = Number(process.env.KASPI_LIGHT_PARSE_DELAY_MS || DEFAULT_LIGHT_PRODUCT_DELAY_MS),
    onMessage = async () => { },
} = {}) {
    const state = await readAutoPricingState(trackingFile);
    const catalog = await readCatalog(publicDir);
    const entries = Object.entries(state.products)
        .filter(([, tracking]) => tracking.autoPricingEnabled !== false)
        .filter(([, tracking]) => tracking.kaspiId && tracking.minPrice != null && tracking.maxPrice != null);
    let catalogChanged = false;

    const workerCount = normalizeConcurrency(concurrency, entries.length);

    const results = await processWithConcurrency(entries, async ([sku], _index, workerIndex) => {
        try {
            await onMessage(`[W${workerIndex + 1}] Пересчитываю ${sku}.`);
            const result = await updateCatalogOfferPrice({
                catalog,
                state,
                sku,
                parser,
                parserOptions,
            });
            catalogChanged = catalogChanged || result.changed;
            return result;
        } catch (error) {
            const result = {
                sku,
                updated: false,
                error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
            };
            await onMessage(`${sku}: ${result.error}`);
            return result;
        }
    }, { concurrency: workerCount, delayMs });

    state.lastRunAt = new Date().toISOString();

    if (catalogChanged) {
        await saveCatalog(publicDir, catalog);
    }
    await saveAutoPricingState(trackingFile, state);

    return results;
}

export function calculateCompetitivePrice(sellers, minPrice, maxPrice) {
    const competitor = sellers.find((seller) => seller.price >= minPrice);

    if (!competitor) {
        return {
            price: minPrice,
            reason: 'NO_COMPETITOR_ABOVE_MIN_PRICE',
        };
    }

    const candidatePrice = competitor.price - 1;
    const price = Math.max(minPrice, Math.min(candidatePrice, maxPrice));

    if (candidatePrice < minPrice) {
        return {
            price,
            competitorPrice: competitor.price,
            reason: 'MIN_PRICE_FLOOR',
        };
    }

    if (candidatePrice > maxPrice) {
        return {
            price,
            competitorPrice: competitor.price,
            reason: 'MAX_PRICE_CAP',
        };
    }

    return {
        price,
        competitorPrice: competitor.price,
        reason: 'BEAT_COMPETITOR',
    };
}

export function normalizeSellers(sellers = [], ownMerchantId = '') {
    const ignoredMerchantIds = new Set(
        (Array.isArray(ownMerchantId)
            ? ownMerchantId
            : ownMerchantId && typeof ownMerchantId === 'object'
                ? ownMerchantId.ignoredMerchantIds || []
                : [ownMerchantId])
            .map((merchantId) => String(merchantId || '').trim())
            .filter(Boolean),
    );

    return sellers
        .filter((seller) => Number.isFinite(Number(seller.price)) && Number(seller.price) > 0)
        .filter((seller) => !sellerMerchantIds(seller).some((merchantId) => ignoredMerchantIds.has(merchantId)))
        .sort((a, b) => Number(a.price) - Number(b.price))
        .map((seller) => ({
            merchantId: primarySellerMerchantId(seller),
            merchantName: sellerMerchantName(seller),
            price: Number(seller.price),
            merchantRating: seller.merchantRating ?? seller.merchant_rating,
            merchantReviewsQuantity: seller.merchantReviewsQuantity ?? seller.merchant_reviews_quantity,
            deliveryType: seller.deliveryType ?? seller.delivery_type,
            kaspiDelivery: seller.kaspiDelivery ?? seller.kaspi_delivery,
        }));
}

export function normalizeTracking(input) {
    const kaspiId = clean(input.kaspiId);
    const minPrice = toPrice(input.minPrice, 'minPrice');
    const maxPrice = toPrice(input.maxPrice, 'maxPrice');

    if (!kaspiId) {
        throw new Error('Укажите Kaspi ID для расчета цены.');
    }

    if (minPrice > maxPrice) {
        throw new Error('minPrice должен быть меньше или равен maxPrice.');
    }

    return {
        kaspiId,
        minPrice,
        maxPrice,
        ownMerchantId: clean(input.ownMerchantId),
        autoPricingEnabled: input.autoPricingEnabled !== false,
        lastParsedAt: input.lastParsedAt || null,
        lastRecommendedPrice: input.lastRecommendedPrice ?? null,
        lastCompetitorPrice: input.lastCompetitorPrice ?? null,
        lastReason: input.lastReason || null,
        lastSellers: Array.isArray(input.lastSellers) ? input.lastSellers : [],
    };
}

async function updateCatalogOfferPrice({
    catalog,
    state,
    sku,
    parser,
    parserOptions,
}) {
    const key = normalizeSku(sku);
    const tracking = state.products[key];

    if (!tracking) {
        throw new Error(`Для SKU ${key} не настроен расчет цены.`);
    }

    const offer = catalog.offers.find((item) => item.sku === key);
    if (!offer) {
        throw new Error(`SKU ${key} не найден в XML.`);
    }

    const skuSearch = buildKaspiSkuSearch(key, { kaspiId: tracking.kaspiId });
    const parsed = await parser({
        kaspiId: tracking.kaspiId || '',
        query: skuSearch.query,
        sourceSku: key,
        expectedProductCode: skuSearch.expectedProductCode,
    }, parserOptions);
    const sellers = normalizeSellers(parsed.sellers, {
        ignoredMerchantIds: buildIgnoredMerchantIds(tracking.ownMerchantId),
    });
    const recommendation = calculateCompetitivePrice(sellers, tracking.minPrice, tracking.maxPrice);
    const cityId = getTargetCityId(offer, parserOptions.cityId);
    const oldPrice = getOfferPrice(offer, cityId);
    setOfferPrice(offer, recommendation.price, cityId);

    tracking.lastParsedAt = new Date().toISOString();
    tracking.kaspiId = parsed.kaspiId || tracking.kaspiId;
    tracking.lastRecommendedPrice = recommendation.price;
    tracking.lastCompetitorPrice = recommendation.competitorPrice ?? null;
    tracking.lastReason = recommendation.reason;
    tracking.lastTitle = parsed.title;
    tracking.lastKaspiPrice = parsed.price;
    tracking.lastSellers = sellers;

    return {
        sku: key,
        kaspiId: tracking.kaspiId,
        title: parsed.title,
        oldPrice,
        newPrice: recommendation.price,
        minPrice: tracking.minPrice,
        maxPrice: tracking.maxPrice,
        competitorPrice: recommendation.competitorPrice,
        reason: recommendation.reason,
        sellersCount: sellers.length,
        cityId,
        updated: oldPrice !== recommendation.price,
        changed: oldPrice !== recommendation.price,
    };
}

function getTargetCityId(offer, fallbackCityId) {
    return clean(fallbackCityId || process.env.KASPI_CITY_ID || offer.cityPrices?.[0]?.cityId);
}

function getOfferPrice(offer, cityId) {
    const cityPrice = findCityPrice(offer, cityId);
    return Number(cityPrice?.price || offer.price || 0);
}

function setOfferPrice(offer, price, cityId) {
    const value = String(price);
    const cityPrice = findCityPrice(offer, cityId);

    if (cityPrice) {
        cityPrice.price = value;
        return;
    }

    offer.price = value;
}

function findCityPrice(offer, cityId) {
    const cityPrices = offer.cityPrices || [];

    if (cityPrices.length === 0) {
        return null;
    }

    return cityPrices.find((cityPrice) => cityPrice.cityId === cityId) || cityPrices[0];
}

function normalizeState(state) {
    const normalized = {
        version: 1,
        updatedAt: state?.updatedAt || null,
        lastRunAt: state?.lastRunAt || null,
        products: {},
    };

    for (const [sku, tracking] of Object.entries(state?.products || {})) {
        try {
            normalized.products[normalizeSku(sku)] = normalizeTracking(tracking);
        } catch {
            normalized.products[normalizeSku(sku)] = tracking;
        }
    }

    return normalized;
}

function emptyState() {
    return {
        version: 1,
        updatedAt: null,
        lastRunAt: null,
        products: {},
    };
}

function normalizeSku(value) {
    const sku = clean(value);

    if (!sku) {
        throw new Error('Пустой SKU.');
    }

    return sku;
}

export function buildKaspiSkuSearch(sku, { kaspiId = '' } = {}) {
    const sourceSku = normalizeSku(sku);
    const skuWithoutSuffix = sourceSku.split(/[-–—]/)[0].trim();
    const articleCode = skuWithoutSuffix.split('_')[0].trim();
    const savedKaspiId = clean(kaspiId);
    const expectedProductCode = savedKaspiId || articleCode;
    const query = expectedProductCode;

    if (!skuWithoutSuffix) {
        throw new Error(`Не получилось по SKU ${sourceSku} найти товар: пустой поисковый код.`);
    }

    if (!articleCode) {
        throw new Error(`Не получилось по SKU ${sourceSku} найти товар: пустой код товара.`);
    }

    return {
        query,
        expectedProductCode,
        articleCode,
        savedKaspiId,
    };
}

function toPrice(value, label) {
    const price = Number(value);

    if (!Number.isFinite(price) || price < 0) {
        throw new Error(`${label} должен быть положительным числом.`);
    }

    return Math.round(price);
}

function clean(value) {
    return String(value ?? '').trim();
}

function getEffectiveUploadPrice(product) {
    return Number(product?.upload_price || product?.city_price || product?.price || 0);
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function normalizeConcurrency(value, totalItems) {
    if (!totalItems || totalItems <= 0) {
        return 1;
    }

    const concurrency = Number(value);
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
        return Math.min(DEFAULT_AUTOPRICING_CONCURRENCY, totalItems);
    }

    return Math.max(1, Math.min(Math.floor(concurrency), totalItems));
}

async function processWithConcurrency(items, worker, { concurrency = 1, delayMs = 0 } = {}) {
    if (!items.length) {
        return [];
    }

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array(items.length);
    let nextIndex = 0;

    await Promise.all(Array.from({ length: workerCount }, async (_unused, workerIndex) => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= items.length) {
                return;
            }

            results[currentIndex] = await worker(items[currentIndex], currentIndex, workerIndex);

            if (delayMs > 0 && currentIndex < items.length - 1) {
                await delay(delayMs);
            }
        }
    }));

    return results;
}

// ─── DB-based auto-pricing ──────────────────────────────

export async function runDbAutoPricingForAll({
    products: providedProducts = null,
    parser = parseKaspiProductByIdLight,
    parserOptions = {},
    concurrency = DEFAULT_AUTOPRICING_CONCURRENCY,
    delayMs = Number(process.env.KASPI_LIGHT_PARSE_DELAY_MS || DEFAULT_LIGHT_PRODUCT_DELAY_MS),
    onMessage = async () => { },
    onProgress = async () => { },
    historyContext = null,
} = {}) {
    const manualProductList = Array.isArray(providedProducts);
    const sourceProducts = manualProductList ? providedProducts : getAllProducts({});
    const products = sourceProducts.filter(
        (p) => p
            && (manualProductList || p.auto_pricing_enabled)
            && (p.shop_link || p.kaspi_id || p.sku || p.model)
            && p.min_price != null
            && p.max_price != null,
    );

    const workerCount = normalizeConcurrency(concurrency, products.length);
    logRuntime('auto_pricing', 'info', `Старт расчета цены: ${products.length} товаров, параллельность ${workerCount}`);
    const resultsBySku = new Map();

    const results = await processWithConcurrency(products, async (product, _index, workerIndex) => {
        try {
            await onMessage(`[W${workerIndex + 1}] Пересчитываю ${product.sku}.`);
            const result = await runDbAutoPricingForSku({
                sku: product.sku,
                parser,
                parserOptions,
                historyContext,
            });
            resultsBySku.set(product.sku, result);
            await onProgress(buildSessionProgress(products, resultsBySku));
            return result;
        } catch (error) {
            const result = {
                sku: product.sku,
                updated: false,
                error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
            };
            await onMessage(`${product.sku}: ${result.error}`);
            resultsBySku.set(product.sku, result);
            await onProgress(buildSessionProgress(products, resultsBySku));
            return result;
        }
    }, { concurrency: workerCount, delayMs });

    return results;
}

export async function parseAndStoreAllProducts({
    products: providedProducts = null,
    parser = parseKaspiProductById,
    parserOptions = {},
    concurrency = DEFAULT_AUTOPRICING_CONCURRENCY,
    delayMs = Number(process.env.KASPI_PRICE_UPDATE_PRODUCT_DELAY_MS || DEFAULT_PRODUCT_UPDATE_DELAY_MS),
    retryAttempts = Number(process.env.KASPI_PARSE_RETRY_ATTEMPTS || 1),
    retryDelayMs = Number(process.env.KASPI_PARSE_RETRY_DELAY_MS || 5000),
    retryConcurrency = Number(process.env.KASPI_PARSE_RETRY_CONCURRENCY || 2),
    preflight = process.env.KASPI_PARSE_PREFLIGHT !== 'false',
    stopOnBlock = process.env.KASPI_PARSE_STOP_ON_BLOCK !== 'false',
    onMessage = async () => { },
    onProgress = async () => { },
    historyContext = null,
} = {}) {
    const products = Array.isArray(providedProducts)
        ? providedProducts.filter((p) => p && (p.shop_link || p.kaspi_id || p.sku || p.model))
        : getAllProducts({}).filter((p) => p.shop_link || p.kaspi_id || p.sku || p.model);
    const workerCount = normalizeConcurrency(concurrency, products.length);
    const ownMerchantId = getSetting('merchant_id', process.env.KASPI_MERCHANT_ID || '').trim();

    logRuntime('product_parse', 'info', `Старт парсинга всех товаров: ${products.length} товаров, параллельность ${workerCount}`);

    const resultsBySku = new Map();
    let blockingError = null;
    const emitProgress = async () => onProgress(buildSessionProgress(products, resultsBySku));

    const parseProduct = async (product, workerIndex, label = '') => {
        if (blockingError && stopOnBlock) {
            return skippedParseResult(product.sku, blockingError);
        }

        try {
            await onMessage(`[W${workerIndex + 1}] ${label}Парсю ${product.sku}.`);
            const result = await parseAndStoreProductData({
                sku: product.sku,
                parser,
                parserOptions,
                ownMerchantId,
                historyContext,
            });
            return {
                sku: product.sku,
                updated: true,
                myPosition: result.product?.my_position || 0,
                sellersCount: result.allSellers.length,
                kaspiPrice: result.product?.last_kaspi_price || result.parsed?.price || 0,
                firstPlacePrice: result.product?.first_place_price || 0,
                oldUploadPrice: result.priceChange?.oldPrice ?? null,
                newUploadPrice: result.priceChange?.newPrice ?? null,
                competitorPrice: result.priceChange?.competitorPrice ?? null,
                reason: result.priceChange?.reason ?? null,
                retryAttempt: 0,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            if (stopOnBlock && isBlockingParseError(message)) {
                blockingError = message;
            }

            recordProductHistoryError({
                sku: product.sku,
                historyContext,
                error: message,
                parseMode: 'full',
            });

            const result = {
                sku: product.sku,
                updated: false,
                error: message,
                retryAttempt: 0,
            };
            await onMessage(`${product.sku}: ${result.error}`);
            return result;
        }
    };

    const parseBatch = (batch, batchConcurrency, label = '') => processWithConcurrency(batch, async (product, _index, workerIndex) => {
        const result = await parseProduct(product, workerIndex, label);
        resultsBySku.set(product.sku, result);
        await emitProgress();
        return result;
    }, { concurrency: batchConcurrency, delayMs });

    let queue = products;
    if (preflight && products.length) {
        await onMessage('Проверяю доступность Kaspi Shop на одном товаре.');
        const firstProduct = products[0];
        const preflightResult = await parseProduct(firstProduct, 0, 'Проверка: ');
        resultsBySku.set(firstProduct.sku, preflightResult);
        await emitProgress();
        queue = products.slice(1);

        if (blockingError && stopOnBlock) {
            await onMessage(`Парсинг остановлен: ${shortError(blockingError)}`);
            for (const product of queue) {
                resultsBySku.set(product.sku, skippedParseResult(product.sku, blockingError));
            }
            await emitProgress();
            return products.map((product) => resultsBySku.get(product.sku));
        }
    }

    await parseBatch(queue, workerCount);

    if (blockingError && stopOnBlock) {
        await onMessage(`Парсинг остановлен: ${shortError(blockingError)}`);
        for (const product of products) {
            if (!resultsBySku.has(product.sku)) {
                resultsBySku.set(product.sku, skippedParseResult(product.sku, blockingError));
            }
        }
        await emitProgress();
        return products.map((product) => resultsBySku.get(product.sku));
    }

    let retryProducts = products.filter((product) => isRetryableParseError(resultsBySku.get(product.sku)?.error));

    for (let attempt = 1; attempt <= retryAttempts && retryProducts.length; attempt += 1) {
        const currentRetryConcurrency = normalizeConcurrency(retryConcurrency, retryProducts.length);
        await onMessage(`Повтор ${attempt}/${retryAttempts}: ${retryProducts.length} товаров, параллельность ${currentRetryConcurrency}.`);
        await delay(retryDelayMs * attempt);

        const retryResults = await parseBatch(retryProducts, currentRetryConcurrency, `Повтор ${attempt}: `);
        for (const result of retryResults) {
            resultsBySku.set(result.sku, { ...result, retryAttempt: attempt });
        }
        await emitProgress();

        retryProducts = retryProducts.filter((product) => isRetryableParseError(resultsBySku.get(product.sku)?.error));
    }

    return products.map((product) => resultsBySku.get(product.sku));
}

function buildSessionProgress(products, resultsBySku) {
    const results = products
        .map((product) => resultsBySku.get(product.sku))
        .filter(Boolean);

    return {
        results,
        totalCount: products.length,
        successCount: results.filter((result) => !result.error).length,
        errorCount: results.filter((result) => Boolean(result.error)).length,
        positionsFound: results.filter((result) => Number(result.myPosition || 0) > 0).length,
        retryCount: results.filter((result) => Number(result.retryAttempt || 0) > 0).length,
    };
}

export async function runDbAutoPricingForSku({
    sku,
    parser = parseKaspiProductByIdLight,
    parserOptions = {},
    historyContext = null,
} = {}) {
    const product = getProduct(sku);
    if (!product) throw new Error(`Товар ${sku} не найден.`);

    const ownMerchantId = getSetting('merchant_id', process.env.KASPI_MERCHANT_ID || '').trim();
    if (!ownMerchantId) {
        throw new Error('На главной странице не задан Merchant ID.');
    }

    if ((product.min_price ?? 0) <= 0 || (product.max_price ?? 0) <= 0) {
        throw new Error(`Для товара ${sku} не заданы корректные мин/макс цены.`);
    }

    logRuntime('product_parse', 'info', `Запуск парсинга для ${sku}`);
    let parsedResult;
    try {
        parsedResult = await parseAndStoreProductData({
            sku,
            parser,
            parserOptions,
            ownMerchantId,
            historyContext,
        });
    } catch (error) {
        recordProductHistoryError({
            sku,
            historyContext,
            error,
            parseMode: 'light',
        });
        throw error;
    }
    const freshProduct = parsedResult.product;
    const ignoredMerchantIds = buildIgnoredMerchantIds(ownMerchantId);
    const priceChange = parsedResult.priceChange || {};
    const oldPrice = Number(priceChange.oldPrice ?? getEffectiveUploadPrice(product));
    const newPrice = Number(priceChange.newPrice ?? getEffectiveUploadPrice(freshProduct));
    const competitorPrice = priceChange.competitorPrice ?? freshProduct.last_competitor_price ?? null;
    const reason = priceChange.reason ?? freshProduct.last_reason ?? null;

    logRuntime(
        'auto_pricing',
        'success',
        `Расчет цены ${sku}: ${oldPrice} -> ${newPrice}`,
        {
            sku,
            oldPrice,
            newPrice,
            competitorPrice,
            ignoredMerchantIds,
            reason,
            sellersCount: parsedResult.allSellers.length,
        },
    );

    return {
        sku,
        kaspiId: parsedResult.parsed.kaspiId,
        title: parsedResult.parsed.title,
        oldPrice,
        newPrice,
        minPrice: freshProduct.min_price,
        maxPrice: freshProduct.max_price,
        competitorPrice,
        reason,
        myPosition: freshProduct.my_position || 0,
        kaspiPrice: freshProduct.last_kaspi_price || parsedResult.parsed.price || 0,
        firstPlacePrice: freshProduct.first_place_price || 0,
        sellersCount: parsedResult.allSellers.length,
        updated: oldPrice !== newPrice,
        changed: oldPrice !== newPrice,
    };
}

export async function parseAndStoreProductData({
    sku,
    parser = parseKaspiProductById,
    parserOptions = {},
    ownMerchantId = getSetting('merchant_id', process.env.KASPI_MERCHANT_ID || '').trim(),
    historyContext = null,
} = {}) {
    const product = getProduct(sku);
    if (!product) throw new Error(`Товар ${sku} не найден.`);
    const previousUploadPrice = getEffectiveUploadPrice(product);
    const skuSearch = buildKaspiSkuSearch(product.sku, { kaspiId: product.kaspi_id });

    let parsed;
    let activeSkuSearch = skuSearch;
    try {
        parsed = await parser({
            kaspiId: activeSkuSearch.savedKaspiId || '',
            query: activeSkuSearch.query,
            sourceSku: product.sku,
            expectedProductCode: activeSkuSearch.expectedProductCode,
        }, parserOptions);
    } catch (error) {
        if (shouldTryMerchantCabinetFallback(error)) {
            const cabinetFallback = await tryResolveKaspiFromMerchantCabinet({
                product,
                skuSearch: activeSkuSearch,
            });

            if (cabinetFallback?.kaspiId) {
                activeSkuSearch = buildKaspiSkuSearch(product.sku, { kaspiId: cabinetFallback.kaspiId });
                try {
                    parsed = await parser({
                        kaspiId: cabinetFallback.kaspiId,
                        shopLink: cabinetFallback.shopLink,
                        query: activeSkuSearch.query,
                        sourceSku: product.sku,
                        expectedProductCode: activeSkuSearch.expectedProductCode,
                    }, parserOptions);
                } catch (fallbackError) {
                    clearKaspiParseData(sku);
                    throw fallbackError;
                }
            } else {
                clearKaspiParseData(sku);
                logRuntime('product_parse', 'error', `Парсинг ${sku} отклонен: найден не тот код товара Kaspi`, {
                    sku,
                    searchQuery: activeSkuSearch.query,
                    expectedProductCode: activeSkuSearch.expectedProductCode,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (!parsed) {
            throw error;
        }
    }

    if ((!parsed?.kaspiId || !parsed?.shopLink) && activeSkuSearch.articleCode) {
        const cabinetFallback = await tryResolveKaspiFromMerchantCabinet({
            product,
            skuSearch: activeSkuSearch,
        });
        if (cabinetFallback?.kaspiId) {
            activeSkuSearch = buildKaspiSkuSearch(product.sku, { kaspiId: cabinetFallback.kaspiId });
            parsed = await parser({
                kaspiId: cabinetFallback.kaspiId,
                shopLink: cabinetFallback.shopLink,
                query: activeSkuSearch.query,
                sourceSku: product.sku,
                expectedProductCode: activeSkuSearch.expectedProductCode,
            }, parserOptions);
        }
    }

    const isLightParse = parsed?.parseMode === 'light';

    const allSellers = (parsed.sellers || [])
        .filter((seller) => Number.isFinite(Number(seller.price)) && Number(seller.price) > 0)
        .sort((a, b) => Number(a.price) - Number(b.price));
    const normalizedOwnMerchantId = clean(ownMerchantId);
    const ownMerchantNames = ownMerchantNamesForMatching(normalizedOwnMerchantId);
    const myIndex = allSellers.findIndex(
        (seller) => sellerBelongsToMerchant(seller, normalizedOwnMerchantId, ownMerchantNames),
    );
    const mySeller = myIndex >= 0 ? allSellers[myIndex] : null;
    const firstSeller = allSellers[0] || null;

    replaceSellers(sku, parsed.sellers || []);
    rememberMerchantName(mySeller);
    upsertProduct({
        sku,
        model: !isLightParse ? parsed.title || null : null,
        brand: !isLightParse ? parsed.brand || null : null,
        category: !isLightParse ? parsed.category || null : null,
        images: !isLightParse && parsed.images?.length ? JSON.stringify(parsed.images) : null,
        shop_link: parsed.shopLink || null,
        kaspi_id: parsed.kaspiId || null,
        last_parsed_at: new Date().toISOString(),
        last_kaspi_price: parsed.price || null,
        my_position: myIndex >= 0 ? myIndex + 1 : 0,
        seller_count: allSellers.length,
        first_place_price: firstSeller?.price || 0,
        first_place_seller: firstSeller ? (sellerMerchantName(firstSeller) || primarySellerMerchantId(firstSeller)) : '',
    });

    const uploadPriceResult = recalculateUploadPriceForProduct({
        product: getProduct(sku),
        sellers: parsed.sellers || [],
        ownMerchantId,
    });
    const updatedProduct = uploadPriceResult.product || getProduct(sku);
    const nextUploadPrice = getEffectiveUploadPrice(updatedProduct);

    recordProductHistorySuccess({
        historyContext,
        sku,
        product: updatedProduct,
        parsed,
        allSellers,
        priceChange: {
            applied: Boolean(uploadPriceResult.applied),
            oldPrice: previousUploadPrice,
            newPrice: nextUploadPrice,
            updated: previousUploadPrice !== nextUploadPrice,
            competitorPrice: uploadPriceResult.competitorPrice ?? updatedProduct.last_competitor_price ?? null,
            reason: uploadPriceResult.reason ?? updatedProduct.last_reason ?? null,
        },
    });

    logRuntime('product_parse', 'success', `Парсинг обновил ${sku}`, {
        sku,
        searchQuery: activeSkuSearch.query,
        expectedProductCode: activeSkuSearch.expectedProductCode,
        brand: parsed.brand || null,
        category: parsed.category || null,
        sellersCount: allSellers.length,
        shopLink: parsed.shopLink || null,
        oldUploadPrice: previousUploadPrice,
        newUploadPrice: nextUploadPrice,
    });

    return {
        product: updatedProduct,
        parsed,
        allSellers,
        priceChange: {
            applied: Boolean(uploadPriceResult.applied),
            oldPrice: previousUploadPrice,
            newPrice: nextUploadPrice,
            updated: previousUploadPrice !== nextUploadPrice,
            competitorPrice: uploadPriceResult.competitorPrice ?? updatedProduct.last_competitor_price ?? null,
            reason: uploadPriceResult.reason ?? updatedProduct.last_reason ?? null,
        },
    };
}

async function tryResolveKaspiFromMerchantCabinet({ product, skuSearch }) {
    const article = clean(skuSearch?.articleCode);
    if (!article) {
        return null;
    }

    try {
        logRuntime('product_parse', 'info', `Пробую найти ${product.sku} через кабинет Kaspi по артикулу ${article}`, {
            sku: product.sku,
            article,
        });

        const resolved = await resolveKaspiProductCardFromMerchantCabinet({
            article,
            downloadDir: config.kaspiDownloadDir,
            sessionDir: config.kaspiSessionDir,
            onMessage: async (message) => {
                logRuntime('product_parse', 'info', message, { sku: product.sku, article });
            },
        });

        logRuntime('product_parse', 'success', `Через кабинет Kaspi найден код товара ${resolved.kaspiId} для ${product.sku}`, {
            sku: product.sku,
            article,
            resolvedKaspiId: resolved.kaspiId,
            shopLink: resolved.shopLink,
        });

        return resolved;
    } catch (error) {
        logRuntime('product_parse', 'error', `Через кабинет Kaspi не удалось найти карточку для ${product.sku}: ${error.message}`, {
            sku: product.sku,
            article,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export function calculateUploadPriceFromSellers({
    product,
    sellers = [],
    ownMerchantId = getSetting('merchant_id', process.env.KASPI_MERCHANT_ID || '').trim(),
} = {}) {
    if (!product) {
        throw new Error('Товар не найден.');
    }

    const currentPrice = getEffectiveUploadPrice(product);
    const minPrice = Number(product.min_price ?? 0);
    const maxPrice = Number(product.max_price ?? 0);
    const normalizedOwnMerchantId = clean(product.own_merchant_id || ownMerchantId);
    const ignoredMerchantIds = buildIgnoredMerchantIds(normalizedOwnMerchantId);

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice <= 0 || minPrice > maxPrice) {
        return {
            applied: false,
            updated: false,
            oldPrice: currentPrice,
            newPrice: currentPrice,
            price: currentPrice,
            competitorPrice: null,
            reason: null,
            sellersCount: Array.isArray(sellers) ? sellers.length : 0,
            ignoredMerchantIds,
        };
    }

    const competitorSellers = normalizeSellers(sellers, { ignoredMerchantIds });
    const recommendation = calculateCompetitivePriceWithStep(
        competitorSellers,
        minPrice,
        maxPrice,
        product.price_step || 1,
        currentPrice || minPrice,
    );

    return {
        ...recommendation,
        applied: true,
        updated: currentPrice !== recommendation.price,
        oldPrice: currentPrice,
        newPrice: recommendation.price,
        sellersCount: competitorSellers.length,
        ignoredMerchantIds,
    };
}

export function recalculateUploadPriceForProduct({
    product,
    sellers = [],
    ownMerchantId = getSetting('merchant_id', process.env.KASPI_MERCHANT_ID || '').trim(),
} = {}) {
    const recommendation = calculateUploadPriceFromSellers({ product, sellers, ownMerchantId });
    if (!recommendation.applied) {
        return { ...recommendation, product };
    }

    upsertProduct({
        sku: product.sku,
        upload_price: recommendation.price,
        last_recommended_price: recommendation.price,
        last_competitor_price: recommendation.competitorPrice ?? null,
        last_reason: recommendation.reason,
    });

    return {
        ...recommendation,
        product: getProduct(product.sku),
    };
}

export function recalculateUploadPriceForSku({
    sku,
    ownMerchantId = getSetting('merchant_id', process.env.KASPI_MERCHANT_ID || '').trim(),
} = {}) {
    const product = getProduct(sku);
    if (!product) {
        throw new Error(`Товар ${sku} не найден.`);
    }

    return recalculateUploadPriceForProduct({
        product,
        sellers: getSellers(sku),
        ownMerchantId,
    });
}

export function calculateCompetitivePriceWithStep(sellers, minPrice, maxPrice, priceStep = 1, currentPrice = minPrice) {
    const step = Math.max(1, priceStep);
    const competitor = sellers.find((seller) => seller.price >= minPrice);

    if (!competitor) {
        const fallbackPrice = Math.max(minPrice, Math.min(Number(currentPrice) || minPrice, maxPrice));
        return {
            price: fallbackPrice,
            reason: 'NO_COMPETITOR_TO_BEAT',
        };
    }

    const candidatePrice = competitor.price - step;
    const price = Math.max(minPrice, Math.min(candidatePrice, maxPrice));

    if (candidatePrice < minPrice) {
        return {
            price,
            competitorPrice: competitor.price,
            reason: 'MIN_PRICE_FLOOR',
        };
    }

    if (candidatePrice > maxPrice) {
        return {
            price,
            competitorPrice: competitor.price,
            reason: 'MAX_PRICE_CAP',
        };
    }

    return {
        price,
        competitorPrice: competitor.price,
        reason: 'BEAT_COMPETITOR',
    };
}

export function parseMerchantIds(value) {
    return [...new Set(
        String(value || '')
            .split(/[\s,;]+/)
            .map((merchantId) => merchantId.trim())
            .filter(Boolean),
    )];
}

function buildIgnoredMerchantIds(ownMerchantId) {
    const configured = parseMerchantIds(getSetting('ignored_merchant_ids', ownMerchantId || ''));
    return [...new Set([ownMerchantId, ...configured].filter(Boolean))];
}

function isRetryableParseError(error) {
    const message = String(error || '');
    if (isBlockingParseError(message)) {
        return false;
    }

    return [
        'SELLERS_REQUEST_FAILED:429',
        'SELLERS_REQUEST_FAILED:502',
        'SELLERS_REQUEST_FAILED:503',
        'SELLERS_REQUEST_FAILED:504',
        'Timeout',
        'Target page, context or browser has been closed',
    ].some((pattern) => message.includes(pattern));
}

function isBlockingParseError(error) {
    const message = String(error || '');
    return [
        'KASPI_SHOP_UNAVAILABLE',
        'SELLERS_REQUEST_FAILED:405',
    ].some((pattern) => message.includes(pattern));
}

function isSkuLookupError(error) {
    return String(error?.message || error || '').includes('Не получилось по SKU');
}

function shouldTryMerchantCabinetFallback(error) {
    const message = String(error?.message || error || '');
    return [
        'Не получилось по SKU',
        'Kaspi карточка с таким кодом не найдена',
        'Kaspi поиск не вернул ссылку на товар',
        'Kaspi открыл не карточку товара',
        'Товар Kaspi не найден',
        'Товар не существует',
    ].some((pattern) => message.includes(pattern));
}

function skippedParseResult(sku, reason) {
    return {
        sku,
        updated: false,
        skipped: true,
        retryAttempt: 0,
        error: `KASPI_PARSE_STOPPED:${shortError(reason)}`,
    };
}

function shortError(error) {
    return String(error || '').replace(/\s+/g, ' ').slice(0, 220);
}

function sellerBelongsToMerchant(seller, ownMerchantId, ownMerchantNames = []) {
    if (ownMerchantId && sellerMerchantIds(seller).includes(ownMerchantId)) {
        return true;
    }

    const sellerName = normalizeMerchantName(sellerMerchantName(seller));
    return Boolean(sellerName && ownMerchantNames.includes(sellerName));
}

function ownMerchantNamesForMatching(ownMerchantId) {
    const configured = [
        getSetting('merchant_name', ''),
        getSetting('own_merchant_name', ''),
        ...getKnownMerchantNames(ownMerchantId),
    ];

    return [...new Set(configured.map(normalizeMerchantName).filter(Boolean))];
}

function rememberMerchantName(seller) {
    if (!seller) return;
    const current = clean(getSetting('merchant_name', ''));
    if (current) return;

    const merchantName = sellerMerchantName(seller);
    if (merchantName) {
        setSetting('merchant_name', merchantName);
    }
}

function normalizeMerchantName(value) {
    return clean(value)
        .toLowerCase()
        .replace(/["'`«»“”]/g, '')
        .replace(/\s+/g, ' ');
}

function sellerMerchantIds(seller = {}) {
    return [
        seller.merchantId,
        seller.merchant_id,
        seller.merchantUID,
        seller.merchantUid,
        seller.merchant?.id,
        seller.merchant?.uid,
        seller.merchant?.merchantId,
        seller.uid,
        seller.id,
    ]
        .map(clean)
        .filter(Boolean);
}

function primarySellerMerchantId(seller = {}) {
    return sellerMerchantIds(seller)[0] || '';
}

function sellerMerchantName(seller = {}) {
    return clean(
        seller.merchantName
        ?? seller.merchant_name
        ?? seller.name
        ?? seller.title
        ?? seller.merchant?.name
        ?? seller.merchant?.title
        ?? '',
    );
}

function recordProductHistorySuccess({
    historyContext,
    sku,
    product,
    parsed,
    allSellers = [],
    priceChange = {},
}) {
    const normalized = normalizeHistoryContext(historyContext);
    if (!normalized) return;

    addProductHistoryEvent({
        sku,
        sessionId: normalized.sessionId,
        eventType: normalized.eventType,
        triggerSource: normalized.triggerSource,
        status: 'success',
        parseMode: clean(parsed?.parseMode || normalized.parseMode || inferParseMode(normalized.eventType)),
        oldUploadPrice: priceChange.oldPrice ?? null,
        newUploadPrice: priceChange.newPrice ?? getEffectiveUploadPrice(product),
        kaspiPrice: product?.last_kaspi_price ?? parsed?.price ?? null,
        competitorPrice: priceChange.competitorPrice ?? product?.last_competitor_price ?? null,
        firstPlacePrice: product?.first_place_price ?? null,
        myPosition: product?.my_position ?? null,
        sellerCount: product?.seller_count ?? allSellers.length,
        minPrice: product?.min_price ?? null,
        maxPrice: product?.max_price ?? null,
        reason: priceChange.reason ?? product?.last_reason ?? '',
        message: buildHistoryMessage({
            eventType: normalized.eventType,
            status: 'success',
            oldUploadPrice: priceChange.oldPrice,
            newUploadPrice: priceChange.newPrice ?? getEffectiveUploadPrice(product),
        }),
        details: {
            ...(normalized.details || {}),
            title: parsed?.title || product?.model || '',
            brand: parsed?.brand || product?.brand || '',
            category: parsed?.category || product?.category || '',
            kaspiId: parsed?.kaspiId || product?.kaspi_id || '',
            shopLink: parsed?.shopLink || product?.shop_link || '',
            updated: Boolean(priceChange.updated),
            applied: Boolean(priceChange.applied),
        },
    });
}

function recordProductHistoryError({
    sku,
    historyContext,
    error,
    parseMode = '',
}) {
    const normalized = normalizeHistoryContext(historyContext);
    if (!normalized) return;

    const message = error instanceof Error ? error.message : String(error || '').trim();
    addProductHistoryEvent({
        sku,
        sessionId: normalized.sessionId,
        eventType: normalized.eventType,
        triggerSource: normalized.triggerSource,
        status: 'error',
        parseMode: clean(parseMode || normalized.parseMode || inferParseMode(normalized.eventType)),
        message: buildHistoryMessage({
            eventType: normalized.eventType,
            status: 'error',
            error: message,
        }),
        details: {
            ...(normalized.details || {}),
            error: message,
        },
    });
}

function normalizeHistoryContext(historyContext) {
    if (!historyContext || typeof historyContext !== 'object') {
        return null;
    }

    const eventType = clean(historyContext.eventType);
    if (!eventType) {
        return null;
    }

    return {
        eventType,
        triggerSource: clean(historyContext.triggerSource),
        sessionId: historyContext.sessionId ? Number(historyContext.sessionId) : null,
        parseMode: clean(historyContext.parseMode),
        details: historyContext.details && typeof historyContext.details === 'object'
            ? historyContext.details
            : null,
    };
}

function inferParseMode(eventType) {
    return eventType === 'light_parse' ? 'light' : 'full';
}

function buildHistoryMessage({
    eventType,
    status,
    oldUploadPrice = null,
    newUploadPrice = null,
    error = '',
}) {
    const action = eventType === 'light_parse'
        ? 'Расчет цены'
        : eventType === 'full_parse'
            ? 'Сформировать карточку'
            : eventType;

    if (status === 'error') {
        return `${action}: ${String(error || 'ошибка').trim()}`;
    }

    const oldValue = Number(oldUploadPrice);
    const newValue = Number(newUploadPrice);
    if (Number.isFinite(oldValue) && Number.isFinite(newValue) && oldValue > 0 && newValue > 0) {
        if (oldValue !== newValue) {
            return `${action}: ${oldValue} → ${newValue}`;
        }
        return `${action}: цена без изменений (${newValue})`;
    }

    return action;
}
