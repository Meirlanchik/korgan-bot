import {
  bulkUpsertFinanceProducts,
  getFinanceProducts,
  getProductsBySkus,
  getSetting,
  setSetting,
} from '../db.js';

const KASPI_API_BASE = 'https://kaspi.kz/shop/api/v2';
const DEFAULT_PAGE_SIZE = 100;
const MAX_CREATION_RANGE_DAYS = 14;
const CACHE_TTL_MS = 60_000;
const DEFAULT_TZ_OFFSET = '+05:00';
const DEFAULT_API_TIMEOUT_MS = Math.max(1_000, Number(process.env.KASPI_FINANCE_API_TIMEOUT_MS || 8_000));
const DEFAULT_REPORT_TIMEOUT_MS = Math.max(DEFAULT_API_TIMEOUT_MS, Number(process.env.KASPI_FINANCE_REPORT_TIMEOUT_MS || 120_000));
const DEFAULT_ENTRY_CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.KASPI_FINANCE_ENTRY_CONCURRENCY || 12)));
const reportCache = new Map();

const COMMISSION_RUBRICS = [
  { label: 'Автотовары', rate: 10.9, keywords: ['авто', 'шины', 'диски', 'масло', 'аккумулятор'] },
  { label: 'Аксессуары', rate: 13.5, keywords: ['аксессуар', 'чехол', 'ремеш', 'кошелек', 'сумка', 'рюкзак', 'зонт'] },
  { label: 'Аптека', rate: 10.9, keywords: ['аптека', 'лекар', 'медицин', 'витамин', 'бад'] },
  { label: 'Бытовая техника', rate: 10.9, keywords: ['бытов', 'пылесос', 'холодиль', 'стираль', 'чайник', 'микроволн'] },
  { label: 'Детские товары', rate: 10.9, keywords: ['детск', 'игруш', 'коляск', 'подгуз', 'малыш'] },
  { label: 'Досуг, книги', rate: 10.9, keywords: ['книг', 'досуг', 'настольн', 'раскраск'] },
  { label: 'Канцелярские товары', rate: 10.9, keywords: ['канцел', 'тетрад', 'ручк', 'карандаш'] },
  { label: 'Компьютеры', rate: 10.9, keywords: ['компьют', 'ноутбук', 'монитор', 'клавиат', 'мыш', 'ssd', 'hdd'] },
  { label: 'Красота и здоровье', rate: 10.9, keywords: ['красот', 'здоров', 'космет', 'парфюм', 'уход'] },
  { label: 'Мебель', rate: 10.9, keywords: ['мебел', 'стол', 'стул', 'диван', 'шкаф', 'комод'] },
  { label: 'Обувь', rate: 10.9, keywords: ['обув', 'кроссов', 'ботин', 'сапог', 'туфл'] },
  { label: 'Одежда', rate: 10.9, keywords: ['одежд', 'куртк', 'футбол', 'брюк', 'кофта', 'плать'] },
  { label: 'Подарки, товары для праздников', rate: 10.9, keywords: ['подар', 'празд', 'сувенир', 'шарик'] },
  { label: 'Продукты питания', rate: 6.4, keywords: ['питани', 'продукт', 'чай', 'кофе', 'сладост', 'бакале', 'еда'] },
  { label: 'Спорт, туризм', rate: 10.9, keywords: ['спорт', 'туризм', 'палат', 'гантел', 'тренаж', 'велосипед'] },
  { label: 'Строительство, ремонт', rate: 10.9, keywords: ['строит', 'ремонт', 'инструм', 'дрель', 'краск', 'сантех'] },
  { label: 'ТВ, Аудио, Видео', rate: 13.5, keywords: ['телевиз', 'аудио', 'видео', 'колонк', 'наушник', 'проектор'] },
  { label: 'Телефоны и гаджеты', rate: 13.5, keywords: ['телефон', 'смартфон', 'iphone', 'android', 'гаджет', 'планшет', 'watch'] },
  { label: 'Товары для дома и дачи', rate: 10.9, keywords: ['дом', 'дач', 'посуда', 'текстиль', 'хранен', 'кухн'] },
  { label: 'Товары для животных', rate: 10.9, keywords: ['животн', 'собак', 'кошк', 'корм', 'ветерин'] },
  { label: 'Украшения', rate: 13.5, keywords: ['украш', 'кольц', 'серьг', 'браслет', 'брошь', 'кулон'] },
];

export function getFinanceSettings() {
  const token = getKaspiApiToken();
  return {
    tokenConfigured: Boolean(token),
    tokenMasked: maskSecret(token),
    packagingPercent: toPercent(getSetting('finance_packaging_percent', '1'), 1),
    taxPercent: toPercent(getSetting('finance_tax_percent', '3'), 3),
    defaultPeriod: getSetting('finance_default_period', '7d') || '7d',
  };
}

export function saveFinanceSettings(input = {}) {
  const apiToken = normalizeKaspiApiToken(input.apiToken || input.kaspi_api_token);
  const packagingPercent = toPercent(input.packagingPercent ?? input.finance_packaging_percent, 1);
  const taxPercent = toPercent(input.taxPercent ?? input.finance_tax_percent, 3);
  const defaultPeriod = clean(input.defaultPeriod || input.finance_default_period || '7d') || '7d';

  if (apiToken) {
    setSetting('kaspi_api_token', apiToken);
  }
  setSetting('finance_packaging_percent', String(packagingPercent));
  setSetting('finance_tax_percent', String(taxPercent));
  setSetting('finance_default_period', defaultPeriod);

  clearFinanceCache();
  return getFinanceSettings();
}

export function saveFinanceProductInputs(items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      sku: clean(item?.sku),
      title: clean(item?.title),
      purchase_price: Number(item?.purchase_price ?? item?.purchasePrice ?? 0),
      commission_rate: item?.commission_rate ?? item?.commissionRate ?? null,
    }))
    .filter((item) => item.sku);

  const result = bulkUpsertFinanceProducts(normalized);
  clearFinanceCache();
  return result;
}

export function buildFinanceFilters(query = {}, defaults = getFinanceSettings()) {
  const page = Math.max(1, Number(query.page || 1) || 1);
  const pageSize = Math.max(10, Math.min(100, Number(query.pageSize || 25) || 25));
  const status = clean(query.status);
  const state = clean(query.state);
  const refresh = String(query.refresh || '') === '1';
  const period = clean(query.period || defaults.defaultPeriod || '7d') || '7d';

  const range = resolveFinanceDateRange({
    period,
    from: clean(query.from),
    to: clean(query.to),
  });

  return {
    page,
    pageSize,
    status,
    state,
    refresh,
    period: range.period,
    from: range.from,
    to: range.to,
    dateFromMs: range.dateFromMs,
    dateToMs: range.dateToMs,
  };
}

export async function getFinanceDashboard(query = {}) {
  const settings = getFinanceSettings();
  const filters = buildFinanceFilters(query, settings);

  if (!settings.tokenConfigured) {
    return buildEmptyFinanceDashboard({
      settings,
      filters,
      error: 'Добавь API токен Kaspi в настройках раздела «Финансы».',
    });
  }

  if (!shouldFetchFinanceReport(query)) {
    return buildEmptyFinanceDashboard({
      settings,
      filters,
      notice: 'Первое открытие быстрое: нажмите «Обновить из API», когда нужен свежий отчет Kaspi.',
    });
  }

  try {
    const orders = await withTimeout(
      fetchKaspiOrdersWithEntries({
        token: getKaspiApiToken(),
        dateFromMs: filters.dateFromMs,
        dateToMs: filters.dateToMs,
        status: filters.status,
        state: filters.state,
        refresh: filters.refresh,
      }),
      DEFAULT_REPORT_TIMEOUT_MS,
      `Kaspi Orders API отвечает слишком долго. Попробуй обновить позже или сузить период отчета. Таймаут: ${formatTimeoutMs(DEFAULT_REPORT_TIMEOUT_MS)}.`,
    );

    return buildFinanceDashboardFromOrders({
      orders,
      settings,
      filters,
    });
  } catch (error) {
    return buildEmptyFinanceDashboard({
      settings,
      filters,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function fetchKaspiOrdersWithEntries({
  token,
  dateFromMs,
  dateToMs,
  status = '',
  state = '',
  refresh = false,
} = {}) {
  const cacheKey = JSON.stringify({
    dateFrom: formatDateInput(dateFromMs),
    dateTo: formatDateInput(dateToMs),
    status: clean(status),
    state: clean(state),
  });
  const cached = reportCache.get(cacheKey);
  if (!refresh && cached && (Date.now() - cached.createdAt) < CACHE_TTL_MS) {
    return cached.orders;
  }

  const windows = splitIntoKaspiWindows(dateFromMs, dateToMs);
  const ordersMap = new Map();

  for (const window of windows) {
    let pageNumber = 0;
    let pageCount = 1;

    while (pageNumber < pageCount) {
      const response = await fetchKaspiJson(buildOrdersUrl({
        dateFromMs: window.from,
        dateToMs: window.to,
        pageNumber,
        pageSize: DEFAULT_PAGE_SIZE,
        status,
        state,
      }), token);

      for (const rawOrder of response.data || []) {
        const order = normalizeKaspiOrder(rawOrder);
        ordersMap.set(order.id, order);
      }

      pageCount = Math.max(1, Number(response.meta?.pageCount || 1));
      pageNumber += 1;
    }
  }

  const orders = await mapWithConcurrency(
    [...ordersMap.values()].sort((a, b) => Number(b.creationDate || 0) - Number(a.creationDate || 0)),
    DEFAULT_ENTRY_CONCURRENCY,
    async (order) => ({
      ...order,
      entries: await fetchKaspiOrderEntries(order.id, token),
    }),
  );

  reportCache.set(cacheKey, {
    createdAt: Date.now(),
    orders,
  });

  return orders;
}

function buildOrdersUrl({ dateFromMs, dateToMs, pageNumber = 0, pageSize = DEFAULT_PAGE_SIZE, status = '', state = '' }) {
  const params = new URLSearchParams();
  params.set('page[number]', String(pageNumber));
  params.set('page[size]', String(pageSize));
  params.set('filter[orders][creationDate][$ge]', String(dateFromMs));
  params.set('filter[orders][creationDate][$le]', String(dateToMs));
  if (status) params.set('filter[orders][status]', status);
  if (state) params.set('filter[orders][state]', state);
  // Kaspi's Orders API does not recognize date operator names when "$" is
  // percent-encoded by URLSearchParams as "%24".
  return `${KASPI_API_BASE}/orders?${params.toString().replace(/%24/g, '$')}`;
}

async function fetchKaspiOrderEntries(orderId, token) {
  const response = await fetchKaspiJson(`${KASPI_API_BASE}/orders/${encodeURIComponent(orderId)}/entries`, token);
  return (response.data || []).map(normalizeKaspiOrderEntry);
}

async function fetchKaspiJson(url, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'X-Auth-Token': token,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const apiMessage = Array.isArray(data?.errors)
        ? data.errors.map((item) => clean(item?.title || item?.detail)).filter(Boolean).join('; ')
        : clean(data?.message || '');
      throw new Error(apiMessage || `Kaspi API вернул HTTP ${response.status}`);
    }

    return data || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Kaspi Orders API не ответил за ${formatTimeoutMs(DEFAULT_API_TIMEOUT_MS)}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeKaspiOrder(item = {}) {
  const attributes = item.attributes || {};
  return {
    id: clean(item.id),
    code: clean(attributes.code || item.id),
    creationDate: Number(attributes.creationDate || 0),
    completionDate: Number(attributes.completionDate || 0),
    totalPrice: Number(attributes.totalPrice || 0),
    deliveryCostForSeller: Number(attributes.deliveryCostForSeller || 0),
    deliveryCost: Number(attributes.deliveryCost || 0),
    status: clean(attributes.status),
    state: clean(attributes.state),
    customerName: clean(attributes.customer?.name || attributes.recipient?.name),
    customerPhone: clean(attributes.customer?.cellPhone || attributes.recipient?.cellPhone),
    deliveryTown: clean(attributes.deliveryAddress?.town),
    deliveryAddress: clean(attributes.deliveryAddress?.formattedAddress),
    warehouse: clean(attributes.originAddress?.displayName || attributes.pickupPointId),
    warehouseAddress: clean(attributes.originAddress?.address?.formattedAddress),
    paymentMode: clean(attributes.paymentMode),
    deliveryMode: clean(attributes.deliveryMode),
    isKaspiDelivery: Boolean(attributes.isKaspiDelivery),
    raw: item,
  };
}

function normalizeKaspiOrderEntry(item = {}) {
  const attributes = item.attributes || {};
  return {
    id: clean(item.id),
    quantity: Math.max(0, Number(attributes.quantity || 0)),
    basePrice: Number(attributes.basePrice || 0),
    totalPrice: Number(attributes.totalPrice || 0),
    deliveryCost: Number(attributes.deliveryCost || 0),
    unitType: clean(attributes.unitType),
    categoryCode: clean(attributes.category?.code),
    categoryTitle: clean(attributes.category?.title),
    offerCode: clean(attributes.offer?.code),
    offerName: clean(attributes.offer?.name),
    productId: clean(item.relationships?.product?.data?.id),
    warehouseId: clean(item.relationships?.deliveryPointOfService?.data?.id),
    raw: item,
  };
}

function buildFinanceDashboardFromOrders({ orders, settings, filters }) {
  const entrySkus = [...new Set(orders.flatMap((order) => order.entries.map((entry) => clean(entry.offerCode))).filter(Boolean))];
  const productMap = new Map(getProductsBySkus(entrySkus).map((product) => [product.sku, product]));
  const financeMap = new Map(getFinanceProducts(entrySkus).map((product) => [product.sku, product]));

  const packagingPercent = Number(settings.packagingPercent || 0);
  const taxPercent = Number(settings.taxPercent || 0);
  const productStats = new Map();
  const warehouseStats = new Map();
  const customerStats = new Map();
  const orderRows = [];

  const summary = {
    ordersCount: orders.length,
    itemsCount: 0,
    productsCount: 0,
    revenue: 0,
    purchaseCost: 0,
    packagingCost: 0,
    deliveryCost: 0,
    commissionCost: 0,
    taxCost: 0,
    profit: 0,
    averageOrderValue: 0,
    averageItemValue: 0,
    unknownCostCount: 0,
    lowMarginCount: 0,
    marginPercent: 0,
  };

  for (const order of orders) {
    const entries = Array.isArray(order.entries) ? order.entries : [];
    const entriesRevenue = entries.reduce((sum, entry) => sum + Number(entry.totalPrice || 0), 0) || Number(order.totalPrice || 0);
    let orderProfit = 0;
    let orderQuantity = 0;

    for (const entry of entries) {
      const sku = clean(entry.offerCode) || clean(entry.productId) || '-';
      const localProduct = productMap.get(sku) || null;
      const financeProduct = financeMap.get(sku) || null;
      const purchasePrice = Math.max(0, Number(financeProduct?.purchase_price || 0));
      const quantity = Math.max(0, Number(entry.quantity || 0));
      const revenue = Number(entry.totalPrice || 0);
      const deliveryShare = entriesRevenue > 0
        ? Number(order.deliveryCostForSeller || 0) * (revenue / entriesRevenue)
        : 0;
      const commissionInfo = resolveCommissionInfo({
        overrideRate: financeProduct?.commission_rate,
        categoryTitle: entry.categoryTitle,
        categoryCode: entry.categoryCode,
        localCategory: localProduct?.category,
        localVerticalCategory: localProduct?.vertical_category,
        localMasterCategory: localProduct?.master_category,
        productTitle: localProduct?.model || entry.offerName,
      });

      const purchaseCost = purchasePrice * quantity;
      const packagingCost = revenue * (packagingPercent / 100);
      const commissionCost = revenue * (commissionInfo.rate / 100);
      const taxCost = revenue * (taxPercent / 100);
      const profit = revenue - purchaseCost - packagingCost - deliveryShare - commissionCost - taxCost;
      const warehouseName = clean(order.warehouse || order.warehouseAddress || '—');

      summary.itemsCount += quantity;
      summary.revenue += revenue;
      summary.purchaseCost += purchaseCost;
      summary.packagingCost += packagingCost;
      summary.deliveryCost += deliveryShare;
      summary.commissionCost += commissionCost;
      summary.taxCost += taxCost;
      summary.profit += profit;
      orderProfit += profit;
      orderQuantity += quantity;

      const existingProduct = productStats.get(sku) || {
        sku,
        title: clean(localProduct?.model || financeProduct?.title || entry.offerName || sku),
        localTitle: clean(localProduct?.model),
        categoryTitle: clean(entry.categoryTitle || localProduct?.category),
        categoryCode: clean(entry.categoryCode),
        rubric: commissionInfo.label,
        commissionRate: commissionInfo.rate,
        commissionSource: commissionInfo.source,
        purchasePrice,
        quantity: 0,
        ordersCount: 0,
        revenue: 0,
        purchaseCost: 0,
        packagingCost: 0,
        deliveryCost: 0,
        commissionCost: 0,
        taxCost: 0,
        profit: 0,
        warehouses: new Map(),
        orderIds: new Set(),
      };

      existingProduct.title = existingProduct.title || clean(localProduct?.model || financeProduct?.title || entry.offerName || sku);
      existingProduct.purchasePrice = purchasePrice;
      existingProduct.rubric = commissionInfo.label;
      existingProduct.commissionRate = commissionInfo.rate;
      existingProduct.commissionSource = commissionInfo.source;
      existingProduct.quantity += quantity;
      existingProduct.revenue += revenue;
      existingProduct.purchaseCost += purchaseCost;
      existingProduct.packagingCost += packagingCost;
      existingProduct.deliveryCost += deliveryShare;
      existingProduct.commissionCost += commissionCost;
      existingProduct.taxCost += taxCost;
      existingProduct.profit += profit;
      existingProduct.orderIds.add(order.id);
      existingProduct.warehouses.set(
        warehouseName,
        (existingProduct.warehouses.get(warehouseName) || 0) + quantity,
      );
      productStats.set(sku, existingProduct);

      const warehouseStat = warehouseStats.get(warehouseName) || {
        warehouse: warehouseName,
        ordersCount: 0,
        quantity: 0,
        revenue: 0,
        purchaseCost: 0,
        deliveryCost: 0,
        commissionCost: 0,
        taxCost: 0,
        packagingCost: 0,
        profit: 0,
        orderIds: new Set(),
      };
      warehouseStat.quantity += quantity;
      warehouseStat.revenue += revenue;
      warehouseStat.purchaseCost += purchaseCost;
      warehouseStat.deliveryCost += deliveryShare;
      warehouseStat.commissionCost += commissionCost;
      warehouseStat.taxCost += taxCost;
      warehouseStat.packagingCost += packagingCost;
      warehouseStat.profit += profit;
      warehouseStat.orderIds.add(order.id);
      warehouseStats.set(warehouseName, warehouseStat);

      const customerKey = clean([order.customerName, order.customerPhone].filter(Boolean).join(' | ') || order.code);
      const customer = customerStats.get(customerKey) || {
        key: customerKey,
        name: clean(order.customerName || 'Покупатель'),
        phone: clean(order.customerPhone),
        city: clean(order.deliveryTown),
        ordersCount: 0,
        revenue: 0,
        profit: 0,
        lastOrderAt: 0,
        orderIds: new Set(),
      };
      customer.orderIds.add(order.id);
      customer.revenue += revenue;
      customer.profit += profit;
      customer.lastOrderAt = Math.max(customer.lastOrderAt, Number(order.creationDate || 0));
      customerStats.set(customerKey, customer);
    }

    const warehouseName = clean(order.warehouse || order.warehouseAddress || '—');
    const warehouseStat = warehouseStats.get(warehouseName);
    if (warehouseStat) {
      warehouseStat.ordersCount = warehouseStat.orderIds.size;
    }

    const customerKey = clean([order.customerName, order.customerPhone].filter(Boolean).join(' | ') || order.code);
    const customer = customerStats.get(customerKey);
    if (customer) {
      customer.ordersCount = customer.orderIds.size;
      customer.city = customer.city || clean(order.deliveryTown);
    }

    orderRows.push({
      ...order,
      itemsCount: orderQuantity,
      entriesCount: entries.length,
      profit: orderProfit,
      marginPercent: order.totalPrice > 0 ? (orderProfit / Number(order.totalPrice || 0)) * 100 : 0,
    });
  }

  const productRows = [...productStats.values()]
    .map((item) => ({
      ...item,
      ordersCount: item.orderIds.size,
      averageSalePrice: item.quantity > 0 ? item.revenue / item.quantity : 0,
      marginPercent: item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0,
      warehousesLabel: [...item.warehouses.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([warehouse, quantity]) => `${warehouse}: ${quantity}`)
        .join(', '),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const warehouseRows = [...warehouseStats.values()]
    .map((item) => ({
      ...item,
      ordersCount: item.orderIds.size,
      marginPercent: item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const customerRows = [...customerStats.values()]
    .map((item) => ({
      ...item,
      ordersCount: item.orderIds.size,
      marginPercent: item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 25);

  summary.productsCount = productRows.length;
  summary.averageOrderValue = summary.ordersCount > 0
    ? orders.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0) / summary.ordersCount
    : 0;
  summary.averageItemValue = summary.itemsCount > 0 ? summary.revenue / summary.itemsCount : 0;
  summary.unknownCostCount = productRows.filter((item) => Number(item.purchasePrice || 0) <= 0).length;
  summary.lowMarginCount = productRows.filter((item) => item.marginPercent < 10).length;
  summary.marginPercent = summary.revenue > 0 ? (summary.profit / summary.revenue) * 100 : 0;

  const pagedOrders = paginate(orderRows, filters.page, filters.pageSize);

  return {
    settings,
    filters,
    fetchedAt: new Date().toISOString(),
    summary,
    products: productRows,
    warehouses: warehouseRows,
    customers: customerRows,
    orders: pagedOrders.items,
    ordersTotal: orderRows.length,
    ordersPage: pagedOrders.page,
    ordersPageSize: pagedOrders.pageSize,
    ordersPageCount: pagedOrders.pageCount,
    loadError: '',
  };
}

function buildEmptyFinanceDashboard({ settings, filters, error = '', notice = '' }) {
  return {
    settings,
    filters,
    fetchedAt: new Date().toISOString(),
    summary: {
      ordersCount: 0,
      itemsCount: 0,
      productsCount: 0,
      revenue: 0,
      purchaseCost: 0,
      packagingCost: 0,
      deliveryCost: 0,
      commissionCost: 0,
      taxCost: 0,
      profit: 0,
      averageOrderValue: 0,
      averageItemValue: 0,
      unknownCostCount: 0,
      lowMarginCount: 0,
      marginPercent: 0,
    },
    products: [],
    warehouses: [],
    customers: [],
    orders: [],
    ordersTotal: 0,
    ordersPage: filters.page,
    ordersPageSize: filters.pageSize,
    ordersPageCount: 1,
    loadError: error,
    loadNotice: notice,
  };
}

function shouldFetchFinanceReport(query = {}) {
  if (String(query.refresh || '') === '1' || String(query.load || '') === '1') {
    return true;
  }

  return ['period', 'from', 'to', 'status', 'state', 'page', 'pageSize']
    .some((key) => Object.prototype.hasOwnProperty.call(query, key));
}

function resolveCommissionInfo({
  overrideRate,
  categoryTitle = '',
  categoryCode = '',
  localCategory = '',
  localVerticalCategory = '',
  localMasterCategory = '',
  productTitle = '',
} = {}) {
  const override = overrideRate === '' || overrideRate == null ? null : Number(overrideRate);
  if (override != null && Number.isFinite(override) && override >= 0) {
    return {
      label: 'Ручная комиссия',
      rate: override,
      source: 'manual',
    };
  }

  const haystack = normalizeText([
    categoryTitle,
    categoryCode,
    localCategory,
    localVerticalCategory,
    localMasterCategory,
    productTitle,
  ].join(' '));

  for (const rubric of COMMISSION_RUBRICS) {
    if (rubric.keywords.some((keyword) => haystack.includes(normalizeText(keyword)))) {
      return {
        label: rubric.label,
        rate: rubric.rate,
        source: 'rubric',
      };
    }
  }

  return {
    label: 'Общая ставка',
    rate: 10.9,
    source: 'default',
  };
}

function resolveFinanceDateRange({ period = '7d', from = '', to = '' } = {}) {
  const manualFrom = clean(from);
  const manualTo = clean(to);
  if (manualFrom && manualTo) {
    const fromMs = parseDateInputToMs(manualFrom, false);
    const toMs = parseDateInputToMs(manualTo, true);
    if (fromMs <= toMs) {
      return {
        period: 'custom',
        from: manualFrom,
        to: manualTo,
        dateFromMs: fromMs,
        dateToMs: toMs,
      };
    }
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const periodToDays = {
    today: 1,
    '7d': 7,
    '14d': 14,
    '30d': 30,
    '90d': 90,
  };
  const days = periodToDays[period] || 7;
  const dateToMs = now;
  const dateFromMs = now - (days * dayMs) + 1;

  return {
    period: periodToDays[period] ? period : '7d',
    from: formatDateInput(dateFromMs),
    to: formatDateInput(dateToMs),
    dateFromMs,
    dateToMs,
  };
}

function splitIntoKaspiWindows(dateFromMs, dateToMs) {
  const start = Number(dateFromMs || 0);
  const end = Number(dateToMs || 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || start > end) {
    throw new Error('Некорректный период для Kaspi Orders API.');
  }

  const windowMs = MAX_CREATION_RANGE_DAYS * 24 * 60 * 60 * 1000;
  const windows = [];
  let cursor = start;

  while (cursor <= end) {
    const windowEnd = Math.min(end, cursor + windowMs - 1);
    windows.push({ from: cursor, to: windowEnd });
    cursor = windowEnd + 1;
  }

  return windows;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const normalizedConcurrency = Math.max(1, Math.min(Number(concurrency || 1), items.length || 1));
  const results = new Array(items.length);
  let index = 0;

  await Promise.all(Array.from({ length: normalizedConcurrency }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }));

  return results;
}

function paginate(items, page, pageSize) {
  const total = items.length;
  const normalizedPageSize = Math.max(1, Number(pageSize || 25));
  const pageCount = Math.max(1, Math.ceil(total / normalizedPageSize));
  const normalizedPage = Math.max(1, Math.min(Number(page || 1), pageCount));
  const start = (normalizedPage - 1) * normalizedPageSize;

  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    pageCount,
    items: items.slice(start, start + normalizedPageSize),
  };
}

function parseDateInputToMs(value, endOfDay = false) {
  const raw = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return 0;
  }
  const iso = `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${DEFAULT_TZ_OFFSET}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function formatDateInput(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toPercent(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : fallback;
}

function getKaspiApiToken() {
  return normalizeKaspiApiToken(getSetting('kaspi_api_token', process.env.KASPI_API_TOKEN || ''));
}

function normalizeKaspiApiToken(value) {
  const token = clean(value);
  if (!token || token.includes('=')) return token;
  if (!/^[A-Za-z0-9+/]+$/.test(token)) return token;
  const remainder = token.length % 4;
  if (remainder === 2) return `${token}==`;
  if (remainder === 3) return `${token}=`;
  return token;
}

function maskSecret(value) {
  const secret = clean(value);
  if (!secret) return '';
  if (secret.length <= 8) return '********';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function clean(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ');
}

function clearFinanceCache() {
  reportCache.clear();
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function formatTimeoutMs(value) {
  const milliseconds = Math.max(0, Number(value || 0));
  if (milliseconds % 1000 === 0) {
    return `${milliseconds / 1000} сек`;
  }
  return `${(milliseconds / 1000).toFixed(1)} сек`;
}
