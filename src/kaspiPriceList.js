import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import readXlsxFile from 'read-excel-file/node';

const REQUIRED_COLUMNS = ['sku', 'model', 'brand'];
const PP_COLUMNS = ['pp1', 'pp2', 'pp3', 'pp4', 'pp5'];
const YES_VALUES = new Set(['yes', 'y', 'true', 'да', '1', '+']);
const NO_VALUES = new Set(['no', 'n', 'false', 'нет', '0', '-']);

export function defaultConfigFromEnv() {
  return {
    company: process.env.KASPI_COMPANY_NAME || 'CompanyName',
    merchantId: process.env.KASPI_MERCHANT_ID || 'CompanyID',
    storeIds: splitList(process.env.KASPI_STORE_IDS || 'PP1,PP2,PP3,PP4,PP5'),
  };
}

export async function processPriceList(filePath, originalName, config) {
  const extension = path.extname(originalName || filePath).toLowerCase();

  if (extension === '.xml') {
    const xml = await fs.readFile(filePath, 'utf8');
    const warnings = [];
    const catalog = normalizeCatalog(parseKaspiCatalog(xml), {
      skipDuplicateSkus: true,
      warnings,
    });

    return {
      xml: buildKaspiXml(catalog),
      offersCount: catalog.offers.length,
      sourceType: 'XML',
      warnings,
    };
  }

  let rows;
  if (extension === '.xlsx') {
    rows = await readExcel(filePath);
  } else if (extension === '.csv') {
    rows = await readCsv(filePath);
  } else {
    throw new Error('Поддерживаются только XML, XLSX и CSV файлы.');
  }

  const result = rowsToKaspiXml(rows, config);
  return {
    ...result,
    sourceType: extension.replace('.', '').toUpperCase(),
  };
}

export async function writeCurrentXml(publicDir, xml) {
  await fs.mkdir(publicDir, { recursive: true });
  const target = path.join(publicDir, 'index.xml');
  await fs.writeFile(target, xml, 'utf8');
  return target;
}

export async function readCatalog(publicDir) {
  const target = path.join(publicDir, 'index.xml');
  const xml = await fs.readFile(target, 'utf8');
  return parseKaspiCatalog(xml);
}

export async function saveCatalog(publicDir, catalog) {
  const normalized = normalizeCatalog(catalog);
  const xml = buildKaspiXml(normalized);
  await writeCurrentXml(publicDir, xml);
  return normalized;
}

export async function getCurrentStatus(publicDir) {
  const target = path.join(publicDir, 'index.xml');

  try {
    const stat = await fs.stat(target);
    const xml = await fs.readFile(target, 'utf8');
    const parsed = parseKaspiXml(xml);

    return {
      exists: true,
      path: target,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      offersCount: parsed.offersCount,
      company: parsed.company,
      merchantId: parsed.merchantId,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exists: false,
        path: target,
        size: 0,
        updatedAt: null,
        offersCount: 0,
      };
    }

    throw error;
  }
}

export function parseKaspiXml(xml) {
  const catalog = parseKaspiCatalog(xml);

  return {
    offersCount: catalog.offers.length,
    company: catalog.company,
    merchantId: catalog.merchantId,
  };
}

export function parseKaspiCatalog(xml, options = {}) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });
  const document = parser.parse(xml);

  if (!document.kaspi_catalog) {
    throw new Error('XML должен содержать корневой тег <kaspi_catalog>.');
  }

  const catalog = document.kaspi_catalog;
  const offers = catalog.offers?.offer;
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const parsedOffers = [];

  for (const offer of list) {
    try {
      parsedOffers.push(xmlOfferToProduct(offer, options));
    } catch (error) {
      if (!isKaspiCabinetPullTolerance(options)) {
        throw error;
      }

      const sku = clean(offer?.['@_sku']);
      registerKaspiCatalogIssue(options, {
        type: 'skipped_offer',
        sku,
        message: `SKU ${sku || '-'}: оффер пропущен, причина: ${stripOfferLabelFromError(error?.message)}`,
      });
    }
  }

  return {
    company: textValue(catalog.company),
    merchantId: textValue(catalog.merchantid),
    offers: parsedOffers,
  };
}

export function normalizeCatalog(catalog, options = {}) {
  const warnings = options.warnings || [];
  const normalized = {
    company: clean(catalog.company) || 'CompanyName',
    merchantId: clean(catalog.merchantId) || 'CompanyID',
    offers: [],
  };

  const seen = new Set();
  for (const [index, offer] of (catalog.offers || []).entries()) {
    const normalizedOffer = normalizeProduct(offer, `товар ${index + 1}`);
    const offerLabel = normalizedOffer.sku;
    const key = normalizedOffer.sku.toLowerCase();
    if (seen.has(key)) {
      if (options.skipDuplicateSkus) {
        warnings.push(`SKU ${offerLabel} повторяется после обработки, оставлен первый товар.`);
        continue;
      }

      throw new Error(`SKU ${offerLabel} повторяется. SKU должен быть уникальным.`);
    }

    seen.add(key);
    normalized.offers.push(normalizedOffer);
  }

  return normalized;
}

export function normalizeProduct(offer, label = 'товар') {
  const sku = normalizeSku(offer.sku);
  const model = clean(offer.model);
  const brand = clean(offer.brand);
  const price = clean(offer.price);
  const cityPrices = (offer.cityPrices || [])
    .map((cityPrice) => ({
      cityId: clean(cityPrice.cityId),
      price: clean(cityPrice.price),
    }))
    .filter((cityPrice) => cityPrice.cityId || cityPrice.price);
  const availabilities = (offer.availabilities || [])
    .map((availability) => ({
      available: normalizeAvailable(availability.available),
      storeId: clean(availability.storeId),
      preOrder: normalizePreOrder(availability.preOrder ?? availability.preorder),
      stockCount: clean(availability.stockCount),
    }))
    .filter((availability) => availability.storeId || availability.stockCount);

  if (!sku) {
    throw new Error(`${label}: пустой SKU.`);
  }

  if (!/^[A-Za-z0-9_-]{1,20}$/.test(sku)) {
    throw new Error(`${label}: SKU должен быть до 20 символов, латиница/цифры/_/-.`);
  }

  if (!model) {
    throw new Error(`${label}: пустой model.`);
  }

  if (!price && cityPrices.length === 0) {
    throw new Error(`${label}: укажите price или цены по городам.`);
  }

  if (price && !isNumberLike(price)) {
    throw new Error(`${label}: price должен быть целым числом без пробелов.`);
  }

  for (const cityPrice of cityPrices) {
    if (!cityPrice.cityId || !/^\d+$/.test(cityPrice.cityId)) {
      throw new Error(`${label}: cityId должен быть числом.`);
    }

    if (!isNumberLike(cityPrice.price)) {
      throw new Error(`${label}: цена города ${cityPrice.cityId} должна быть целым числом.`);
    }
  }

  for (const availability of availabilities) {
    if (!availability.storeId) {
      throw new Error(`${label}: у склада не указан storeId.`);
    }

    if (availability.stockCount && !isNumberLike(availability.stockCount)) {
      throw new Error(`${label}: stockCount для ${availability.storeId} должен быть числом.`);
    }
  }

  return {
    sku,
    model,
    brand,
    price,
    cityPrices,
    availabilities,
  };
}

function rowsToKaspiXml(inputRows, config) {
  const rows = normalizeRows(inputRows);
  const warnings = [];

  if (rows.length === 0) {
    throw new Error('В файле нет строк с товарами.');
  }

  const headers = Object.keys(rows[0]);
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) {
      throw new Error(`Не найдена обязательная колонка ${column}.`);
    }
  }

  if (!headers.includes('price') && !hasCityPriceHeaders(headers)) {
    throw new Error('Нужна колонка price или cityprice_<cityId>.');
  }

  for (const ppColumn of PP_COLUMNS) {
    if (!headers.includes(ppColumn)) {
      warnings.push(`В файле нет колонки ${ppColumn.toUpperCase()}. Kaspi рекомендует держать PP1-PP5 в Excel.`);
    }
  }

  const storeIds = normalizeStoreIds(config.storeIds);
  const offers = rows
    .map((row, index) => rowToOffer(row, index + 2, storeIds))
    .filter(Boolean);

  if (offers.length === 0) {
    throw new Error('Не найдено ни одного товара для выгрузки.');
  }

  return {
    xml: buildKaspiXml({
      company: config.company,
      merchantId: config.merchantId,
      offers,
    }),
    offersCount: offers.length,
    warnings,
  };
}

function rowToOffer(row, rowNumber, storeIds) {
  const sku = normalizeSku(row.sku);
  const model = clean(row.model);
  const brand = clean(row.brand);

  if (!sku && !model && !brand) {
    return null;
  }

  if (!sku) {
    throw new Error(`Строка ${rowNumber}: пустой SKU.`);
  }

  if (!/^[A-Za-z0-9_-]{1,20}$/.test(sku)) {
    throw new Error(`Строка ${rowNumber}: SKU должен быть до 20 символов, латиница/цифры/_/-.`);
  }

  if (!model) {
    throw new Error(`Строка ${rowNumber}: пустой model.`);
  }

  const price = clean(row.price);
  const cityPrices = getCityPrices(row);

  if (!price && cityPrices.length === 0) {
    throw new Error(`Строка ${rowNumber}: укажите price или cityprice_<cityId>.`);
  }

  if (price && !isWholeNumber(price)) {
    throw new Error(`Строка ${rowNumber}: price должен быть целым числом без пробелов.`);
  }

  for (const cityPrice of cityPrices) {
    if (!isWholeNumber(cityPrice.price)) {
      throw new Error(`Строка ${rowNumber}: cityprice_${cityPrice.cityId} должен быть целым числом.`);
    }
  }

  return {
    sku,
    model,
    brand,
    price,
    cityPrices,
    availabilities: getAvailabilities(row, storeIds),
  };
}

function getAvailabilities(row, storeIds) {
  const preOrder = normalizePreOrder(row.preorder ?? row.preOrder);

  return PP_COLUMNS.flatMap((column, index) => {
    const raw = clean(row[column]);
    if (!raw) {
      return [];
    }

    const lower = raw.toLowerCase();
    const availability = {
      available: 'yes',
      storeId: storeIds[index] || column.toUpperCase(),
      preOrder,
      stockCount: '',
    };

    if (YES_VALUES.has(lower)) {
      return [availability];
    }

    if (NO_VALUES.has(lower)) {
      return [{ ...availability, available: 'no', stockCount: '' }];
    }

    if (isWholeNumber(raw)) {
      const stockCount = Number(raw);
      return [{
        ...availability,
        available: stockCount > 0 ? 'yes' : 'no',
        stockCount: String(stockCount),
      }];
    }

    return [{
      ...availability,
      available: 'yes',
      stockCount: raw,
    }];
  });
}

function getCityPrices(row) {
  return Object.entries(row)
    .map(([key, value]) => {
      const match = key.match(/^cityprice[_-]?(\d+)$/);
      return match ? { cityId: match[1], price: clean(value) } : null;
    })
    .filter((item) => item && item.price);
}

export function buildKaspiXml({ company, merchantId, offers }) {
  const date = new Date().toISOString();
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<kaspi_catalog date="${escapeAttr(date)}"`,
    '               xmlns="kaspiShopping"',
    '               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '               xsi:schemaLocation="kaspiShopping http://kaspi.kz/kaspishopping.xsd">',
    `    <company>${escapeText(company)}</company>`,
    `    <merchantid>${escapeText(merchantId)}</merchantid>`,
    '    <offers>',
  ];

  for (const offer of offers) {
    const cityPrices = offer.cityPrices || [];
    const availabilities = offer.availabilities || [];

    lines.push(`        <offer sku="${escapeAttr(offer.sku)}">`);
    lines.push(`            <model>${escapeText(offer.model)}</model>`);
    lines.push(`            <brand>${escapeText(offer.brand)}</brand>`);

    if (availabilities.length > 0) {
      lines.push('            <availabilities>');
      for (const availability of availabilities) {
        const attrs = [
          `available="${escapeAttr(availability.available)}"`,
          `storeId="${escapeAttr(availability.storeId)}"`,
        ];

        if (availability.preOrder) {
          attrs.push(`preOrder="${escapeAttr(availability.preOrder)}"`);
        }

        if (availability.stockCount) {
          attrs.push(`stockCount="${escapeAttr(availability.stockCount)}"`);
        }

        lines.push(`                <availability ${attrs.join(' ')}/>`);
      }
      lines.push('            </availabilities>');
    }

    if (cityPrices.length > 0) {
      lines.push('            <cityprices>');
      for (const cityPrice of cityPrices) {
        lines.push(`                <cityprice cityId="${escapeAttr(cityPrice.cityId)}">${escapeText(cityPrice.price)}</cityprice>`);
      }
      lines.push('            </cityprices>');
    } else {
      lines.push(`            <price>${escapeText(offer.price)}</price>`);
    }

    lines.push('        </offer>');
  }

  lines.push('    </offers>');
  lines.push('</kaspi_catalog>');
  lines.push('');

  return lines.join('\n');
}

async function readExcel(filePath) {
  const rows = await readXlsxFile(filePath);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => clean(header));

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => clean(cell)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

async function readCsv(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeHeader(key);
      if (normalizedKey) {
        normalized[normalizedKey] = value;
      }
    }
    return normalized;
  });
}

function normalizeHeader(header) {
  return clean(header).toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');
}

function normalizeStoreIds(storeIds) {
  const values = Array.isArray(storeIds) ? storeIds : splitList(storeIds);
  return PP_COLUMNS.map((column, index) => clean(values[index]) || column.toUpperCase());
}

function normalizePreOrder(value) {
  const preOrder = clean(value);

  if (!preOrder) {
    return '';
  }

  if (!isWholeNumber(preOrder)) {
    throw new Error('preorder должен быть целым числом от 0 до 30.');
  }

  const days = Number(preOrder);
  if (days < 0 || days > 30) {
    throw new Error('preorder должен быть от 0 до 30 дней.');
  }

  return String(days);
}

function xmlOfferToProduct(offer, options = {}) {
  const availabilities = asArray(offer.availabilities?.availability).map((availability) => ({
    available: clean(availability['@_available']) || 'yes',
    storeId: clean(availability['@_storeId']),
    preOrder: clean(availability['@_preOrder']),
    stockCount: clean(availability['@_stockCount']),
  }));
  const cityPrices = asArray(offer.cityprices?.cityprice).map((cityPrice) => ({
    cityId: clean(cityPrice['@_cityId']),
    price: textValue(cityPrice),
  }));
  const sku = clean(offer['@_sku']);
  let model = textValue(offer.model);

  if (isKaspiCabinetPullTolerance(options) && !model && /^[A-Za-z0-9_-]{1,20}$/.test(sku)) {
    model = sku;
    registerKaspiCatalogIssue(options, {
      type: 'model_fallback',
      sku,
      message: `SKU ${sku}: пустой model, подставлен SKU.`,
    });
  }

  return normalizeProduct({
    sku,
    model,
    brand: textValue(offer.brand),
    price: textValue(offer.price),
    cityPrices,
    availabilities,
  }, `SKU ${sku || '-'}`);
}

function normalizeAvailable(value) {
  const normalized = clean(value).toLowerCase();
  return normalized === 'no' || normalized === 'нет' || normalized === 'false' || normalized === '0' ? 'no' : 'yes';
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function hasCityPriceHeaders(headers) {
  return headers.some((header) => /^cityprice[_-]?\d+$/.test(header));
}

function isWholeNumber(value) {
  return /^\d+$/.test(clean(value));
}

function isNumberLike(value) {
  return /^\d+(?:\.\d+)?$/.test(clean(value));
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSku(value) {
  return clean(value);
}

function isKaspiCabinetPullTolerance(options) {
  return options?.tolerant === true && options?.source === 'kaspi_cabinet_pull';
}

function registerKaspiCatalogIssue(options, issue) {
  if (Array.isArray(options?.warnings) && issue?.message) {
    options.warnings.push(issue.message);
  }

  const stats = options?.issueStats;
  if (!stats || !issue?.type) {
    return;
  }

  if (!Array.isArray(stats.modelFallbackSkus)) {
    stats.modelFallbackSkus = [];
  }
  if (!Array.isArray(stats.skippedSkus)) {
    stats.skippedSkus = [];
  }

  if (issue.type === 'model_fallback' && issue.sku) {
    pushUnique(stats.modelFallbackSkus, issue.sku);
  }
  if (issue.type === 'skipped_offer') {
    pushUnique(stats.skippedSkus, issue.sku || '-');
  }
}

function pushUnique(list, value) {
  if (!Array.isArray(list) || !value || list.includes(value)) {
    return;
  }
  list.push(value);
}

function stripOfferLabelFromError(message) {
  return clean(message).replace(/^(?:SKU\s+[^:]+|товар\s+\d+):\s*/i, '') || 'неизвестная ошибка';
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function textValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'object' && '#text' in value) {
    return clean(value['#text']);
  }

  return clean(value);
}

function escapeText(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}
