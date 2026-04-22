import { config } from '../config.js';
import { defaultConfigFromEnv } from '../kaspiPriceList.js';

export function emptyProduct(storeIds = []) {
  return {
    sku: '',
    model: '',
    brand: '',
    price: '',
    cityPrices: [{ cityId: config.cityId, price: '' }],
    availabilities: storeIds.map((storeId) => ({
      storeId,
      available: 'yes',
      stockCount: '',
      preOrder: '',
    })),
  };
}

export function productFromForm(body) {
  return {
    sku: optionalText(body.sku) || '',
    model: optionalText(body.model),
    brand: optionalText(body.brand),
    category: optionalText(body.category),
    city_id: firstDefined(body.cityId, body.city_id) !== undefined
      ? optionalText(firstDefined(body.cityId, body.city_id)) || config.cityId
      : null,
    city_price: optionalNumber(firstDefined(body.cityPrice, body.city_price, body.price)),
    upload_price: optionalNumber(firstDefined(body.uploadPrice, body.upload_price)),
    available: toBooleanNumber(body.available),
    auto_pricing_enabled: toBooleanNumber(body.autoPricingEnabled ?? body.auto_pricing_enabled),
    min_price: optionalNumber(firstDefined(body.minPrice, body.min_price)),
    max_price: optionalNumber(firstDefined(body.maxPrice, body.max_price)),
    price_step: optionalNumber(firstDefined(body.priceStep, body.price_step)),
    pre_order: optionalNumber(firstDefined(body.preOrder, body.pre_order)),
  };
}

export function warehousesFromForm(body) {
  const warehouses = [];
  const storeIds = asArray(firstDefined(body.storeId, body['storeId[]']));
  const enabledList = asArray(firstDefined(body.warehouseEnabled, body['warehouseEnabled[]']));
  const stockList = asArray(firstDefined(body.stockCount, body['stockCount[]']));
  const actualStockList = asArray(firstDefined(body.actualStock, body['actualStock[]']));
  const preOrderList = asArray(firstDefined(body.warehousePreOrder, body['warehousePreOrder[]']));

  for (let i = 0; i < storeIds.length; i++) {
    const storeId = String(storeIds[i] ?? '').trim();
    if (!storeId) continue;
    warehouses.push({
      store_id: storeId,
      enabled: String(enabledList[i] ?? '0') === '1' ? 1 : 0,
      available: 'yes',
      stock_count: Number(stockList[i] ?? 0),
      actual_stock: Number(actualStockList[i] ?? 0),
      pre_order: Number(preOrderList[i] ?? 0),
    });
  }

  return warehouses;
}

export function autoPricingTrackingFromForm(body) {
  const hasAnyValue = [
    body.kaspiId,
    body.minPrice,
    body.maxPrice,
    body.ownMerchantId,
  ].some((value) => String(value ?? '').trim());

  if (!hasAnyValue && body.autoPricingEnabled !== 'on') {
    return null;
  }

  return {
    kaspiId: body.kaspiId,
    minPrice: body.minPrice,
    maxPrice: body.maxPrice,
    ownMerchantId: body.ownMerchantId,
    autoPricingEnabled: body.autoPricingEnabled === 'on',
  };
}

export function kaspiImageUrl(imagePath) {
  const normalized = normalizeKaspiImagePath(imagePath);
  if (!normalized) return '';
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
  if (normalized.startsWith('//')) return `https:${normalized}`;
  return `https://resources.cdn-kaspi.kz/shop/medias/sys_master/images/images/${normalized.replace(/^\/+/, '')}`;
}

export function normalizeKaspiImagePath(imagePath) {
  if (!imagePath) return '';
  if (typeof imagePath === 'string') return imagePath.trim();
  if (typeof imagePath !== 'object') return '';

  return String(
    imagePath.path
    || imagePath.url
    || imagePath.original
    || imagePath.large
    || imagePath.medium
    || imagePath.small
    || '',
  ).trim();
}

function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBooleanNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return value === 'on' || value === '1' || value === 'yes' ? 1 : 0;
}
