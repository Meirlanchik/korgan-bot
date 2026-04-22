import Database from 'better-sqlite3';
import { broadcastRealtimeEvent } from './realtime.js';

let db;

function ensureColumn(tableName, columnName, definition) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (columns.some((column) => column.name === columnName)) {
        return;
    }

    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

export function initDatabase(dbPath) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const defaultMerchantId = process.env.KASPI_MERCHANT_ID || '';

    db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      sku TEXT PRIMARY KEY,
      kaspi_id TEXT DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      brand TEXT DEFAULT '',
      category TEXT DEFAULT '',
      vertical_category TEXT DEFAULT '',
      master_category TEXT DEFAULT '',
      price INTEGER DEFAULT 0,
      city_id TEXT DEFAULT '710000000',
      city_price INTEGER DEFAULT 0,
      available INTEGER DEFAULT 1,
      auto_pricing_enabled INTEGER DEFAULT 0,
      min_price INTEGER DEFAULT 0,
      max_price INTEGER DEFAULT 0,
      price_step INTEGER DEFAULT 1,
      own_merchant_id TEXT DEFAULT '',
      upload_price INTEGER DEFAULT 0,
      my_position INTEGER DEFAULT 0,
      seller_count INTEGER DEFAULT 0,
      first_place_price INTEGER DEFAULT 0,
      first_place_seller TEXT DEFAULT '',
      last_parsed_at TEXT,
      last_recommended_price INTEGER,
      last_competitor_price INTEGER,
      last_reason TEXT,
      last_kaspi_price INTEGER,
      images TEXT DEFAULT '[]',
      shop_link TEXT DEFAULT '',
      pre_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_warehouses (
      sku TEXT NOT NULL,
      store_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      available TEXT DEFAULT 'yes',
      stock_count INTEGER DEFAULT 0,
      actual_stock INTEGER DEFAULT 0,
      pre_order INTEGER DEFAULT 0,
      PRIMARY KEY (sku, store_id),
      FOREIGN KEY (sku) REFERENCES products(sku) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      merchant_id TEXT,
      merchant_name TEXT,
      price INTEGER,
      merchant_rating REAL,
      merchant_reviews_quantity INTEGER,
      delivery_type TEXT,
      kaspi_delivery INTEGER DEFAULT 0,
      parsed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sku) REFERENCES products(sku) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sellers_sku ON sellers(sku);

    CREATE TABLE IF NOT EXISTS finance_products (
      sku TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      purchase_price INTEGER DEFAULT 0,
      commission_rate REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS parse_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'all_products',
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER DEFAULT 0,
      total_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      positions_found INTEGER DEFAULT 0,
      concurrency INTEGER DEFAULT 1,
      retry_count INTEGER DEFAULT 0,
      message TEXT DEFAULT '',
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_parse_sessions_started_at ON parse_sessions(started_at DESC);

    CREATE TABLE IF NOT EXISTS product_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      session_id INTEGER,
      event_type TEXT NOT NULL,
      trigger_source TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      parse_mode TEXT DEFAULT '',
      old_upload_price INTEGER,
      new_upload_price INTEGER,
      kaspi_price INTEGER,
      competitor_price INTEGER,
      first_place_price INTEGER,
      my_position INTEGER,
      seller_count INTEGER,
      min_price INTEGER,
      max_price INTEGER,
      reason TEXT DEFAULT '',
      message TEXT DEFAULT '',
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_product_history_sku ON product_history(sku, id DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

    ensureColumn('parse_sessions', 'trigger_source', "TEXT NOT NULL DEFAULT 'manual'");

    const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    ins.run('auto_pricing_interval_ms', String(process.env.KASPI_LIGHT_PARSE_INTERVAL_MS || process.env.KASPI_PRICE_UPDATE_INTERVAL_MS || 300000));
    ins.run('full_parse_interval_ms', String(process.env.KASPI_FULL_PARSE_INTERVAL_MS || 900000));
    ins.run('kaspi_pull_interval_ms', '0');
    ins.run('kaspi_push_interval_ms', '0');
    ins.run('auto_pricing_concurrency', '4');
    ins.run('auto_pricing_enabled', '1');
    ins.run('full_parse_enabled', '1');
    ins.run('kaspi_pull_enabled', '0');
    ins.run('kaspi_push_enabled', '0');
    ins.run('bot_active', '1');
    ins.run('merchant_id', defaultMerchantId);
    ins.run('merchant_name', '');
    ins.run('ignored_merchant_ids', defaultMerchantId);
    ins.run('profile_email', '');
    ins.run('profile_city_id', process.env.KASPI_CITY_ID || '710000000');
    ins.run('city_id', process.env.KASPI_CITY_ID || '710000000');
    ins.run('panel_user', process.env.PANEL_USER || '');
    ins.run('panel_password', process.env.PANEL_PASSWORD || '');
    ins.run('last_kaspi_pull_at', '');
    ins.run('last_kaspi_push_at', '');
    ins.run('kaspi_api_token', process.env.KASPI_API_TOKEN || '');
    ins.run('finance_packaging_percent', '1');
    ins.run('finance_tax_percent', '3');
    ins.run('finance_default_period', '7d');

    return db;
}

export function getDb() {
    if (!db) throw new Error('Database not initialized');
    return db;
}

// ─── Products ───────────────────────────────────────────

export function getAllProducts({ sort = 'sku', order = 'asc', search = '', available = null, category = '' } = {}) {
    const allowedSort = ['sku', 'model', 'brand', 'city_price', 'available', 'auto_pricing_enabled',
        'min_price', 'max_price', 'my_position', 'first_place_price', 'last_parsed_at', 'pre_order',
        'upload_price', 'last_recommended_price', 'seller_count', 'category'];
    const col = allowedSort.includes(sort) ? sort : 'sku';
    const dir = order === 'desc' ? 'DESC' : 'ASC';

    let where = '1=1';
    const params = {};

    if (search) {
        where += ' AND (model LIKE @search OR sku LIKE @search OR brand LIKE @search)';
        params.search = `%${search}%`;
    }
    if (available !== null && available !== '') {
        where += ' AND available = @available';
        params.available = Number(available);
    }
    if (category) {
        where += ' AND category = @category';
        params.category = String(category);
    }

    return getDb().prepare(`SELECT * FROM products WHERE ${where} ORDER BY ${col} ${dir}`).all(params);
}

export function getProduct(sku) {
    return getDb().prepare('SELECT * FROM products WHERE sku = ?').get(sku) || null;
}

export function upsertProduct(data) {
    const d = getDb();
    const existing = d.prepare('SELECT sku FROM products WHERE sku = ?').get(data.sku);
    const payload = {
        sku: data.sku,
        kaspi_id: data.kaspi_id ?? null,
        model: data.model ?? null,
        brand: data.brand ?? null,
        category: data.category ?? null,
        vertical_category: data.vertical_category ?? null,
        master_category: data.master_category ?? null,
        price: data.price ?? null,
        city_id: data.city_id ?? null,
        city_price: data.city_price ?? null,
        available: data.available ?? null,
        auto_pricing_enabled: data.auto_pricing_enabled ?? null,
        min_price: data.min_price ?? null,
        max_price: data.max_price ?? null,
        price_step: data.price_step ?? null,
        own_merchant_id: data.own_merchant_id ?? null,
        upload_price: data.upload_price ?? null,
        my_position: data.my_position ?? null,
        seller_count: data.seller_count ?? null,
        first_place_price: data.first_place_price ?? null,
        first_place_seller: data.first_place_seller ?? null,
        last_parsed_at: data.last_parsed_at ?? null,
        last_recommended_price: data.last_recommended_price ?? null,
        last_competitor_price: data.last_competitor_price ?? null,
        last_reason: data.last_reason ?? null,
        last_kaspi_price: data.last_kaspi_price ?? null,
        images: data.images ?? null,
        shop_link: data.shop_link ?? null,
        pre_order: data.pre_order ?? null,
    };

    if (existing) {
        d.prepare(`
      UPDATE products SET
        kaspi_id = COALESCE(@kaspi_id, kaspi_id),
        model = COALESCE(@model, model),
        brand = COALESCE(@brand, brand),
        category = COALESCE(@category, category),
        vertical_category = COALESCE(@vertical_category, vertical_category),
        master_category = COALESCE(@master_category, master_category),
        price = COALESCE(@price, price),
        city_id = COALESCE(@city_id, city_id),
        city_price = COALESCE(@city_price, city_price),
        available = COALESCE(@available, available),
        auto_pricing_enabled = COALESCE(@auto_pricing_enabled, auto_pricing_enabled),
        min_price = COALESCE(@min_price, min_price),
        max_price = COALESCE(@max_price, max_price),
        price_step = COALESCE(@price_step, price_step),
        own_merchant_id = COALESCE(@own_merchant_id, own_merchant_id),
        upload_price = COALESCE(@upload_price, upload_price),
        my_position = COALESCE(@my_position, my_position),
        seller_count = COALESCE(@seller_count, seller_count),
        first_place_price = COALESCE(@first_place_price, first_place_price),
        first_place_seller = COALESCE(@first_place_seller, first_place_seller),
        last_parsed_at = COALESCE(@last_parsed_at, last_parsed_at),
        last_recommended_price = COALESCE(@last_recommended_price, last_recommended_price),
        last_competitor_price = COALESCE(@last_competitor_price, last_competitor_price),
        last_reason = COALESCE(@last_reason, last_reason),
        last_kaspi_price = COALESCE(@last_kaspi_price, last_kaspi_price),
        images = COALESCE(@images, images),
        shop_link = COALESCE(@shop_link, shop_link),
        pre_order = COALESCE(@pre_order, pre_order),
        updated_at = datetime('now')
      WHERE sku = @sku
        `).run(payload);
    } else {
        d.prepare(`
      INSERT INTO products (sku, kaspi_id, model, brand, category, vertical_category, master_category,
        price, city_id, city_price, available, auto_pricing_enabled, min_price, max_price, price_step,
        own_merchant_id, upload_price, my_position, seller_count, first_place_price, first_place_seller,
        last_parsed_at, last_recommended_price, last_competitor_price, last_reason, last_kaspi_price,
        images, shop_link, pre_order)
      VALUES (@sku, @kaspi_id, @model, @brand, @category, @vertical_category, @master_category,
        @price, @city_id, @city_price, @available, @auto_pricing_enabled, @min_price, @max_price,
        @price_step, @own_merchant_id, @upload_price, @my_position, @seller_count, @first_place_price,
        @first_place_seller, @last_parsed_at, @last_recommended_price, @last_competitor_price,
        @last_reason, @last_kaspi_price, @images, @shop_link, @pre_order)
    `).run({
            sku: payload.sku,
            kaspi_id: payload.kaspi_id || '',
            model: payload.model || '',
            brand: payload.brand || '',
            category: payload.category || '',
            vertical_category: payload.vertical_category || '',
            master_category: payload.master_category || '',
            price: payload.price || 0,
            city_id: payload.city_id || '710000000',
            city_price: payload.city_price || 0,
            available: payload.available ?? 1,
            auto_pricing_enabled: payload.auto_pricing_enabled || 0,
            min_price: payload.min_price || 0,
            max_price: payload.max_price || 0,
            price_step: payload.price_step || 1,
            own_merchant_id: payload.own_merchant_id || '',
            upload_price: payload.upload_price || 0,
            my_position: payload.my_position || 0,
            seller_count: payload.seller_count || 0,
            first_place_price: payload.first_place_price || 0,
            first_place_seller: payload.first_place_seller || '',
            last_parsed_at: payload.last_parsed_at || null,
            last_recommended_price: payload.last_recommended_price ?? null,
            last_competitor_price: payload.last_competitor_price ?? null,
            last_reason: payload.last_reason || null,
            last_kaspi_price: payload.last_kaspi_price ?? null,
            images: payload.images || '[]',
            shop_link: payload.shop_link || '',
            pre_order: payload.pre_order || 0,
        });
    }

    return getProduct(data.sku);
}

export function deleteProduct(sku) {
    const normalizedSku = String(sku || '').trim();
    if (!normalizedSku) {
        return { changes: 0 };
    }

    const d = getDb();
    const tx = d.transaction(() => {
        d.prepare('DELETE FROM sellers WHERE sku = ?').run(normalizedSku);
        d.prepare('DELETE FROM product_warehouses WHERE sku = ?').run(normalizedSku);
        d.prepare('DELETE FROM product_history WHERE sku = ?').run(normalizedSku);
        d.prepare('DELETE FROM finance_products WHERE sku = ?').run(normalizedSku);
        return d.prepare('DELETE FROM products WHERE sku = ?').run(normalizedSku);
    });

    const result = tx();
    if (result.changes) {
        broadcastRealtimeEvent('product_deleted', { sku: normalizedSku });
        broadcastRealtimeEvent('products_changed', { skus: [normalizedSku] });
    }
    return result;
}

export function renameProductSku(oldSku, newSku) {
    const normalizedOldSku = normalizeImportSku(oldSku);
    const normalizedNewSku = normalizeImportSku(newSku);

    if (!normalizedOldSku) {
        throw new Error('Не указан текущий SKU.');
    }
    if (!normalizedNewSku) {
        throw new Error('Не указан новый SKU.');
    }
    if (normalizedOldSku === normalizedNewSku) {
        return getProduct(normalizedOldSku);
    }
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(normalizedNewSku)) {
        throw new Error('SKU должен быть до 20 символов: латиница/цифры/_/-.');
    }

    const d = getDb();
    const tx = d.transaction(() => {
        const oldProduct = d.prepare('SELECT * FROM products WHERE sku = ?').get(normalizedOldSku);
        if (!oldProduct) {
            throw new Error(`Товар ${normalizedOldSku} не найден.`);
        }

        const newProduct = d.prepare('SELECT 1 FROM products WHERE sku = ?').get(normalizedNewSku);
        if (newProduct) {
            throw new Error(`SKU ${normalizedNewSku} уже существует.`);
        }

        d.prepare(`
          INSERT INTO products (
            sku, kaspi_id, model, brand, category, vertical_category, master_category,
            price, city_id, city_price, available, auto_pricing_enabled, min_price, max_price, price_step,
            own_merchant_id, upload_price, my_position, seller_count, first_place_price, first_place_seller,
            last_parsed_at, last_recommended_price, last_competitor_price, last_reason, last_kaspi_price,
            images, shop_link, pre_order, created_at, updated_at
          )
          SELECT
            @new_sku, kaspi_id, model, brand, category, vertical_category, master_category,
            price, city_id, city_price, available, auto_pricing_enabled, min_price, max_price, price_step,
            own_merchant_id, upload_price, my_position, seller_count, first_place_price, first_place_seller,
            last_parsed_at, last_recommended_price, last_competitor_price, last_reason, last_kaspi_price,
            images, shop_link, pre_order, created_at, datetime('now')
          FROM products
          WHERE sku = @old_sku
        `).run({
            old_sku: normalizedOldSku,
            new_sku: normalizedNewSku,
        });

        d.prepare('UPDATE product_warehouses SET sku = ? WHERE sku = ?').run(normalizedNewSku, normalizedOldSku);
        d.prepare('UPDATE sellers SET sku = ? WHERE sku = ?').run(normalizedNewSku, normalizedOldSku);
        d.prepare('UPDATE product_history SET sku = ? WHERE sku = ?').run(normalizedNewSku, normalizedOldSku);
        d.prepare('DELETE FROM products WHERE sku = ?').run(normalizedOldSku);
    });

    tx();
    return getProduct(normalizedNewSku);
}

function migrateLegacySku(oldSku, newSku) {
    const normalizedOldSku = String(oldSku || '').trim();
    const normalizedNewSku = String(newSku || '').trim();
    if (!normalizedOldSku || !normalizedNewSku || normalizedOldSku === normalizedNewSku) {
        return false;
    }

    const d = getDb();
    const oldProduct = d.prepare('SELECT 1 FROM products WHERE sku = ?').get(normalizedOldSku);
    const newProduct = d.prepare('SELECT 1 FROM products WHERE sku = ?').get(normalizedNewSku);
    if (!oldProduct || newProduct) {
        return false;
    }

    d.prepare(`
      INSERT INTO products (
        sku, kaspi_id, model, brand, category, vertical_category, master_category,
        price, city_id, city_price, available, auto_pricing_enabled, min_price, max_price, price_step,
        own_merchant_id, upload_price, my_position, seller_count, first_place_price, first_place_seller,
        last_parsed_at, last_recommended_price, last_competitor_price, last_reason, last_kaspi_price,
        images, shop_link, pre_order, created_at, updated_at
      )
      SELECT
        @new_sku, kaspi_id, model, brand, category, vertical_category, master_category,
        price, city_id, city_price, available, auto_pricing_enabled, min_price, max_price, price_step,
        own_merchant_id, upload_price, my_position, seller_count, first_place_price, first_place_seller,
        last_parsed_at, last_recommended_price, last_competitor_price, last_reason, last_kaspi_price,
        images, shop_link, pre_order, created_at, updated_at
      FROM products
      WHERE sku = @old_sku
    `).run({
        old_sku: normalizedOldSku,
        new_sku: normalizedNewSku,
    });

    d.prepare('UPDATE product_warehouses SET sku = ? WHERE sku = ?').run(normalizedNewSku, normalizedOldSku);
    d.prepare('UPDATE sellers SET sku = ? WHERE sku = ?').run(normalizedNewSku, normalizedOldSku);
    d.prepare('UPDATE product_history SET sku = ? WHERE sku = ?').run(normalizedNewSku, normalizedOldSku);
    d.prepare('DELETE FROM products WHERE sku = ?').run(normalizedOldSku);
    return true;
}

function normalizeImportSku(value) {
    return String(value || '').trim();
}

function findExistingSkuForImport(rawSku) {
    const sku = normalizeImportSku(rawSku);
    if (!sku) {
        return '';
    }

    const d = getDb();
    const existing = d.prepare('SELECT sku FROM products WHERE sku = ?').get(sku);
    if (existing) {
        return existing.sku;
    }

    const legacySku = sku.includes('_') ? sku.split('_')[0] : '';
    if (!legacySku) {
        return '';
    }

    if (migrateLegacySku(legacySku, sku)) {
        return sku;
    }

    const legacyExisting = d.prepare('SELECT sku FROM products WHERE sku = ?').get(legacySku);
    return legacyExisting?.sku || '';
}

export function bulkUpdateProducts(skus, updates) {
    if (!skus.length) return;
    const d = getDb();
    const sets = [];
    const params = {};

    for (const [key, value] of Object.entries(updates)) {
        const allowed = ['available', 'auto_pricing_enabled', 'min_price', 'max_price', 'pre_order', 'price_step'];
        if (allowed.includes(key)) {
            sets.push(`${key} = @${key}`);
            params[key] = value;
        }
    }

    if (!sets.length) return;
    sets.push("updated_at = datetime('now')");

    const placeholders = skus.map((_, i) => `@sku${i}`).join(',');
    skus.forEach((s, i) => { params[`sku${i}`] = s; });

    const result = d.prepare(`UPDATE products SET ${sets.join(', ')} WHERE sku IN (${placeholders})`).run(params);
    if (result.changes) {
        broadcastRealtimeEvent('products_changed', {
            skus: skus.map((sku) => String(sku || '').trim()).filter(Boolean),
        });
    }
}

export function getProductCount() {
    const d = getDb();
    const active = d.prepare('SELECT COUNT(*) as c FROM products WHERE available = 1').get().c;
    const inactive = d.prepare('SELECT COUNT(*) as c FROM products WHERE available = 0').get().c;
    return { active, inactive, total: active + inactive };
}

export function getProductsBySkus(skus = []) {
    const normalized = Array.isArray(skus)
        ? [...new Set(skus.map((value) => String(value || '').trim()).filter(Boolean))]
        : [];

    if (!normalized.length) {
        return [];
    }

    const placeholders = normalized.map((_, index) => `@sku${index}`).join(', ');
    const params = {};
    normalized.forEach((sku, index) => {
        params[`sku${index}`] = sku;
    });

    return getDb()
        .prepare(`SELECT * FROM products WHERE sku IN (${placeholders})`)
        .all(params);
}

// ─── Finance Products ──────────────────────────────────

export function getFinanceProduct(sku) {
    return getDb().prepare('SELECT * FROM finance_products WHERE sku = ?').get(String(sku || '').trim()) || null;
}

export function getFinanceProducts(skus = []) {
    const normalized = Array.isArray(skus)
        ? [...new Set(skus.map((value) => String(value || '').trim()).filter(Boolean))]
        : [];

    if (!normalized.length) {
        return getDb().prepare('SELECT * FROM finance_products ORDER BY sku').all();
    }

    const placeholders = normalized.map((_, index) => `@sku${index}`).join(', ');
    const params = {};
    normalized.forEach((sku, index) => {
        params[`sku${index}`] = sku;
    });

    return getDb()
        .prepare(`SELECT * FROM finance_products WHERE sku IN (${placeholders}) ORDER BY sku`)
        .all(params);
}

export function upsertFinanceProduct(data) {
    const sku = String(data?.sku || '').trim();
    if (!sku) {
        throw new Error('Не указан SKU для финансовых настроек.');
    }

    const title = String(data?.title || '').trim();
    const purchasePrice = Number(data?.purchase_price ?? data?.purchasePrice ?? 0);
    const commissionRateRaw = data?.commission_rate ?? data?.commissionRate;
    const commissionRate = commissionRateRaw === '' || commissionRateRaw == null
        ? null
        : Number(commissionRateRaw);

    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        throw new Error(`Некорректная цена закупа для ${sku}.`);
    }

    if (commissionRate !== null && (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100)) {
        throw new Error(`Некорректная комиссия для ${sku}.`);
    }

    getDb().prepare(`
      INSERT INTO finance_products (sku, title, purchase_price, commission_rate, updated_at)
      VALUES (@sku, @title, @purchase_price, @commission_rate, datetime('now'))
      ON CONFLICT(sku) DO UPDATE SET
        title = CASE WHEN excluded.title != '' THEN excluded.title ELSE finance_products.title END,
        purchase_price = excluded.purchase_price,
        commission_rate = excluded.commission_rate,
        updated_at = datetime('now')
    `).run({
        sku,
        title,
        purchase_price: Math.round(purchasePrice),
        commission_rate: commissionRate,
    });

    return getFinanceProduct(sku);
}

export function bulkUpsertFinanceProducts(items = []) {
    const tx = getDb().transaction((rows) => rows.map((row) => upsertFinanceProduct(row)));
    return tx(Array.isArray(items) ? items : []);
}

// ─── Warehouses ─────────────────────────────────────────

export function getWarehouses(sku) {
    return getDb().prepare('SELECT * FROM product_warehouses WHERE sku = ? ORDER BY store_id').all(sku);
}

export function upsertWarehouse(sku, storeId, data) {
    getDb().prepare(`
    INSERT INTO product_warehouses (sku, store_id, enabled, available, stock_count, actual_stock, pre_order)
    VALUES (@sku, @store_id, @enabled, @available, @stock_count, @actual_stock, @pre_order)
    ON CONFLICT(sku, store_id) DO UPDATE SET
      enabled = @enabled,
      available = @available,
      stock_count = @stock_count,
      actual_stock = @actual_stock,
      pre_order = @pre_order
  `).run({
        sku,
        store_id: storeId,
        enabled: data.enabled ?? 1,
        available: data.available || 'yes',
        stock_count: data.stock_count ?? 0,
        actual_stock: data.actual_stock ?? 0,
        pre_order: data.pre_order ?? 0,
    });
}

export function deleteWarehousesForProduct(sku) {
    getDb().prepare('DELETE FROM product_warehouses WHERE sku = ?').run(sku);
}

export function getAllWarehouseIds() {
    return getDb().prepare('SELECT DISTINCT store_id FROM product_warehouses ORDER BY store_id').all()
        .map((r) => r.store_id);
}

export function syncWarehouseAvailabilityForProducts(skus = [], available = 1) {
    const normalizedSkus = [...new Set(
        (Array.isArray(skus) ? skus : [skus])
            .map((sku) => String(sku || '').trim())
            .filter(Boolean),
    )];

    if (!normalizedSkus.length) {
        return { changes: 0, availability: 'no' };
    }

    const availability = Number(available) === 1 ? 'yes' : 'no';
    const placeholders = normalizedSkus.map((_, index) => `@sku${index}`).join(', ');
    const params = { availability };
    normalizedSkus.forEach((sku, index) => {
        params[`sku${index}`] = sku;
    });

    const result = getDb()
        .prepare(`UPDATE product_warehouses SET available = @availability WHERE sku IN (${placeholders})`)
        .run(params);

    return {
        changes: result.changes || 0,
        availability,
    };
}

// ─── Sellers ────────────────────────────────────────────

export function getSellers(sku) {
    return getDb().prepare('SELECT * FROM sellers WHERE sku = ? ORDER BY price ASC').all(sku);
}

export function replaceSellers(sku, sellers) {
    const d = getDb();
    const now = new Date().toISOString();
    const del = d.prepare('DELETE FROM sellers WHERE sku = ?');
    const ins = d.prepare(`
    INSERT INTO sellers (sku, merchant_id, merchant_name, price, merchant_rating,
      merchant_reviews_quantity, delivery_type, kaspi_delivery, parsed_at)
    VALUES (@sku, @merchant_id, @merchant_name, @price, @merchant_rating,
      @merchant_reviews_quantity, @delivery_type, @kaspi_delivery, @parsed_at)
  `);

    const tx = d.transaction(() => {
        del.run(sku);
        for (const s of sellers) {
            ins.run({
                sku,
                merchant_id: toDbText(firstDefinedValue(
                    s.merchantId,
                    s.merchant_id,
                    s.merchantUID,
                    s.merchantUid,
                    s.merchant?.id,
                    s.merchant?.uid,
                    s.uid,
                    s.id,
                )),
                merchant_name: toDbText(firstDefinedValue(
                    s.merchantName,
                    s.merchant_name,
                    s.name,
                    s.title,
                    s.merchant?.name,
                    s.merchant?.title,
                )),
                price: toDbInteger(s.price, 0),
                merchant_rating: toDbNumber(s.merchantRating ?? s.merchant_rating),
                merchant_reviews_quantity: toDbInteger(s.merchantReviewsQuantity ?? s.merchant_reviews_quantity, null),
                delivery_type: toDbText(s.deliveryType ?? s.delivery_type),
                kaspi_delivery: toDbBooleanNumber(s.kaspiDelivery ?? s.kaspi_delivery),
                parsed_at: now,
            });
        }
    });
    tx();
}

export function clearKaspiParseData(sku) {
    const normalizedSku = String(sku || '').trim();
    if (!normalizedSku) return { cleared: 0 };

    const d = getDb();
    const tx = d.transaction(() => {
        d.prepare('DELETE FROM sellers WHERE sku = ?').run(normalizedSku);
        return d.prepare(`
          UPDATE products SET
            kaspi_id = '',
            shop_link = '',
            category = '',
            vertical_category = '',
            master_category = '',
            images = '[]',
            last_parsed_at = NULL,
            last_recommended_price = NULL,
            last_competitor_price = NULL,
            last_reason = NULL,
            last_kaspi_price = NULL,
            upload_price = CASE
              WHEN city_price > 0 THEN city_price
              WHEN price > 0 THEN price
              ELSE upload_price
            END,
            my_position = 0,
            seller_count = 0,
            first_place_price = 0,
            first_place_seller = '',
            updated_at = datetime('now')
          WHERE sku = ?
        `).run(normalizedSku);
    });

    const result = tx();
    return { cleared: result.changes || 0 };
}

export function getSellerContext(sku, ownMerchantId) {
    const all = getSellers(sku);
    if (!all.length) return { before: [], me: null, after: [] };

    const normalizedOwnMerchantId = String(ownMerchantId || '').trim();
    const myIndex = all.findIndex((s) => String(s.merchant_id || '').trim() === normalizedOwnMerchantId);
    if (myIndex === -1) {
        return { before: all.slice(0, 5), me: null, after: [] };
    }

    return {
        before: all.slice(0, myIndex),
        me: all[myIndex],
        after: all.slice(myIndex + 1, myIndex + 4),
    };
}

export function getKnownMerchantNames(merchantId) {
    const normalizedMerchantId = String(merchantId || '').trim();
    if (!normalizedMerchantId) return [];

    return getDb().prepare(`
      SELECT DISTINCT merchant_name
      FROM sellers
      WHERE merchant_id = ?
        AND merchant_name IS NOT NULL
        AND merchant_name != ''
      ORDER BY merchant_name
    `).all(normalizedMerchantId).map((row) => row.merchant_name);
}

// ─── Product History ───────────────────────────────────

export function addProductHistoryEvent({
    sku,
    sessionId = null,
    eventType = '',
    triggerSource = '',
    status = 'success',
    parseMode = '',
    oldUploadPrice = null,
    newUploadPrice = null,
    kaspiPrice = null,
    competitorPrice = null,
    firstPlacePrice = null,
    myPosition = null,
    sellerCount = null,
    minPrice = null,
    maxPrice = null,
    reason = '',
    message = '',
    details = null,
    createdAt = null,
} = {}) {
    const normalizedSku = String(sku || '').trim();
    const normalizedEventType = String(eventType || '').trim();

    if (!normalizedSku || !normalizedEventType) {
        return null;
    }

    const result = getDb().prepare(`
      INSERT INTO product_history (
        sku, session_id, event_type, trigger_source, status, parse_mode,
        old_upload_price, new_upload_price, kaspi_price, competitor_price, first_place_price,
        my_position, seller_count, min_price, max_price, reason, message, details, created_at
      )
      VALUES (
        @sku, @session_id, @event_type, @trigger_source, @status, @parse_mode,
        @old_upload_price, @new_upload_price, @kaspi_price, @competitor_price, @first_place_price,
        @my_position, @seller_count, @min_price, @max_price, @reason, @message, @details,
        COALESCE(@created_at, datetime('now'))
      )
    `).run({
        sku: normalizedSku,
        session_id: sessionId ? Number(sessionId) : null,
        event_type: normalizedEventType,
        trigger_source: String(triggerSource || '').trim(),
        status: String(status || 'success').trim() || 'success',
        parse_mode: String(parseMode || '').trim(),
        old_upload_price: toDbIntegerOrNull(oldUploadPrice),
        new_upload_price: toDbIntegerOrNull(newUploadPrice),
        kaspi_price: toDbIntegerOrNull(kaspiPrice),
        competitor_price: toDbIntegerOrNull(competitorPrice),
        first_place_price: toDbIntegerOrNull(firstPlacePrice),
        my_position: toDbIntegerOrNull(myPosition),
        seller_count: toDbIntegerOrNull(sellerCount),
        min_price: toDbIntegerOrNull(minPrice),
        max_price: toDbIntegerOrNull(maxPrice),
        reason: toDbText(reason, ''),
        message: toDbText(message, ''),
        details: serializeDetails(details),
        created_at: createdAt ? String(createdAt) : null,
    });

    const entry = getDb().prepare('SELECT * FROM product_history WHERE id = ?').get(result.lastInsertRowid) || null;
    if (entry) {
        broadcastRealtimeEvent('history_event_added', entry);
    }
    return entry;
}

export function getProductHistory(sku, { limit = 100 } = {}) {
    const normalizedSku = String(sku || '').trim();
    if (!normalizedSku) return [];

    return getDb().prepare(`
      SELECT *
      FROM product_history
      WHERE sku = @sku
      ORDER BY id DESC
      LIMIT @limit
    `).all({
        sku: normalizedSku,
        limit: Math.max(1, Number(limit) || 100),
    });
}

export function getAllProductHistory({
    limit = 200,
    eventType = '',
    status = '',
    search = '',
} = {}) {
    const whereParts = [];
    const params = {
        limit: Math.max(1, Number(limit) || 200),
    };

    if (eventType) {
        whereParts.push('event_type = @event_type');
        params.event_type = String(eventType);
    }

    if (status) {
        whereParts.push('status = @status');
        params.status = String(status);
    }

    if (search) {
        whereParts.push('(sku LIKE @search OR message LIKE @search OR reason LIKE @search)');
        params.search = `%${String(search).trim()}%`;
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    return getDb().prepare(`
      SELECT *
      FROM product_history
      ${whereClause}
      ORDER BY id DESC
      LIMIT @limit
    `).all(params);
}

// ─── Sync Log ───────────────────────────────────────────

export function addSyncLog(type, status, message, details = null) {
    const result = getDb().prepare(
        'INSERT INTO sync_log (type, status, message, details) VALUES (?, ?, ?, ?)',
    ).run(type, status, message, details ? JSON.stringify(details) : null);
    const entry = getDb().prepare('SELECT * FROM sync_log WHERE id = ?').get(result.lastInsertRowid) || null;
    if (entry) {
        broadcastRealtimeEvent('sync_log_added', entry);
    }
    return entry;
}

export function getSyncLogs(limit = 50, type = null) {
    if (type) {
        return getDb().prepare('SELECT * FROM sync_log WHERE type = ? ORDER BY id DESC LIMIT ?').all(type, limit);
    }
    return getDb().prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?').all(limit);
}

export function getSyncLogsInRange({
    from = '',
    to = '',
    limit = 200,
    type = '',
    types = [],
} = {}) {
    const whereParts = [];
    const params = { limit: Number(limit) || 200 };
    const normalizedTypes = Array.isArray(types)
        ? types.map((value) => String(value || '').trim()).filter(Boolean)
        : [];

    if (from) {
        whereParts.push('created_at >= datetime(@from)');
        params.from = String(from);
    }

    if (to) {
        whereParts.push('created_at <= datetime(@to)');
        params.to = String(to);
    }

    if (type) {
        whereParts.push('type = @type');
        params.type = String(type);
    } else if (normalizedTypes.length) {
        const placeholders = normalizedTypes.map((_, index) => `@type${index}`).join(',');
        whereParts.push(`type IN (${placeholders})`);
        normalizedTypes.forEach((value, index) => {
            params[`type${index}`] = value;
        });
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    return getDb()
        .prepare(`SELECT * FROM sync_log ${whereClause} ORDER BY id ASC LIMIT @limit`)
        .all(params);
}

// ─── Parse Sessions ─────────────────────────────────────

export function startParseSession({
    type = 'all_products',
    triggerSource = 'manual',
    totalCount = 0,
    concurrency = 1,
    message = '',
    details = null,
} = {}) {
    const startedAt = new Date().toISOString();
    const result = getDb().prepare(`
      INSERT INTO parse_sessions (
        type, trigger_source, status, started_at, total_count, concurrency, message, details
      )
      VALUES (@type, @trigger_source, 'running', @started_at, @total_count, @concurrency, @message, @details)
    `).run({
        type,
        trigger_source: triggerSource,
        started_at: startedAt,
        total_count: Number(totalCount) || 0,
        concurrency: Number(concurrency) || 1,
        message: String(message || ''),
        details: serializeDetails(details),
    });

    const session = getParseSession(result.lastInsertRowid);
    if (session) {
        broadcastRealtimeEvent('parse_session_updated', session);
    }
    return session;
}

export function updateParseSessionProgress(id, {
    totalCount = null,
    successCount = null,
    errorCount = null,
    positionsFound = null,
    concurrency = null,
    retryCount = null,
    message = '',
    details = null,
} = {}) {
    const session = getParseSession(id);
    if (!session) return null;

    getDb().prepare(`
      UPDATE parse_sessions SET
        total_count = COALESCE(@total_count, total_count),
        success_count = COALESCE(@success_count, success_count),
        error_count = COALESCE(@error_count, error_count),
        positions_found = COALESCE(@positions_found, positions_found),
        concurrency = COALESCE(@concurrency, concurrency),
        retry_count = COALESCE(@retry_count, retry_count),
        message = COALESCE(NULLIF(@message, ''), message),
        details = COALESCE(@details, details)
      WHERE id = @id
    `).run({
        id,
        total_count: totalCount,
        success_count: successCount,
        error_count: errorCount,
        positions_found: positionsFound,
        concurrency,
        retry_count: retryCount,
        message: String(message || ''),
        details: serializeDetails(details),
    });

    const updated = getParseSession(id);
    if (updated) {
        broadcastRealtimeEvent('parse_session_updated', updated);
    }
    return updated;
}

export function finishParseSession(id, {
    status = 'success',
    totalCount = null,
    successCount = null,
    errorCount = null,
    positionsFound = null,
    concurrency = null,
    retryCount = null,
    message = '',
    details = null,
} = {}) {
    const session = getParseSession(id);
    if (!session) return null;

    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(session.started_at));

    getDb().prepare(`
      UPDATE parse_sessions SET
        status = @status,
        finished_at = @finished_at,
        duration_ms = @duration_ms,
        total_count = COALESCE(@total_count, total_count),
        success_count = COALESCE(@success_count, success_count),
        error_count = COALESCE(@error_count, error_count),
        positions_found = COALESCE(@positions_found, positions_found),
        concurrency = COALESCE(@concurrency, concurrency),
        retry_count = COALESCE(@retry_count, retry_count),
        message = COALESCE(NULLIF(@message, ''), message),
        details = COALESCE(@details, details)
      WHERE id = @id
    `).run({
        id,
        status,
        finished_at: finishedAt,
        duration_ms: durationMs,
        total_count: totalCount,
        success_count: successCount,
        error_count: errorCount,
        positions_found: positionsFound,
        concurrency,
        retry_count: retryCount,
        message: String(message || ''),
        details: serializeDetails(details),
    });

    const finished = getParseSession(id);
    if (finished) {
        broadcastRealtimeEvent('parse_session_updated', finished);
    }
    return finished;
}

export function getParseSession(id) {
    return getDb().prepare('SELECT * FROM parse_sessions WHERE id = ?').get(id) || null;
}

export function getParseSessions(options = {}) {
    const normalizedOptions = typeof options === 'number'
        ? { limit: options }
        : options;
    const limit = Number(normalizedOptions.limit || 100);
    const type = normalizedOptions.type ? String(normalizedOptions.type) : '';
    const triggerSource = normalizedOptions.triggerSource ? String(normalizedOptions.triggerSource) : '';
    const status = normalizedOptions.status ? String(normalizedOptions.status) : '';

    const whereParts = [];
    const params = { limit: limit || 100 };

    if (type) {
        whereParts.push('type = @type');
        params.type = type;
    }
    if (triggerSource) {
        whereParts.push('trigger_source = @trigger_source');
        params.trigger_source = triggerSource;
    }
    if (status) {
        whereParts.push('status = @status');
        params.status = status;
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    return getDb()
        .prepare(`SELECT * FROM parse_sessions ${whereClause} ORDER BY id DESC LIMIT @limit`)
        .all(params);
}

export function deleteParseSession(id, { includeRunning = false } = {}) {
    const sessionId = Number(id);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
        return { deleted: 0 };
    }

    const where = includeRunning
        ? 'id = @id'
        : "id = @id AND status != 'running'";
    const result = getDb()
        .prepare(`DELETE FROM parse_sessions WHERE ${where}`)
        .run({ id: sessionId });

    return { deleted: result.changes || 0 };
}

export function clearParseSessions({
    type = '',
    types = [],
    triggerSource = '',
    status = '',
    includeRunning = false,
} = {}) {
    const whereParts = [];
    const params = {};
    const normalizedTypes = Array.isArray(types)
        ? types.map((value) => String(value || '').trim()).filter(Boolean)
        : [];

    if (type) {
        whereParts.push('type = @type');
        params.type = String(type);
    } else if (normalizedTypes.length) {
        const placeholders = normalizedTypes.map((_, index) => `@type${index}`).join(',');
        whereParts.push(`type IN (${placeholders})`);
        normalizedTypes.forEach((value, index) => {
            params[`type${index}`] = value;
        });
    }

    if (triggerSource) {
        whereParts.push('trigger_source = @trigger_source');
        params.trigger_source = String(triggerSource);
    }

    if (status) {
        whereParts.push('status = @status');
        params.status = String(status);
    }

    if (!includeRunning) {
        whereParts.push("status != 'running'");
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const result = getDb()
        .prepare(`DELETE FROM parse_sessions ${whereClause}`)
        .run(params);

    return { deleted: result.changes || 0 };
}

export function abortRunningParseSessions(message = 'Сервер был остановлен до завершения парсинга.') {
    const running = getDb()
        .prepare("SELECT id FROM parse_sessions WHERE status = 'running'")
        .all();

    for (const session of running) {
        finishParseSession(session.id, {
            status: 'aborted',
            message,
        });
    }

    return running.length;
}

// ─── Settings ───────────────────────────────────────────

export function getSetting(key, defaultValue = '') {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

export function setSetting(key, value) {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    broadcastRealtimeEvent('setting_updated', {
        key: String(key),
        value: String(value),
    });
}

// ─── Dashboard Stats ────────────────────────────────────

export function getDashboardStats() {
    const counts = getProductCount();
    return {
        ...counts,
        botActive: getSetting('bot_active', '1') === '1',
        merchantId: getSetting('merchant_id', ''),
        lastKaspiPullAt: getSetting('last_kaspi_pull_at', ''),
        lastKaspiPushAt: getSetting('last_kaspi_push_at', ''),
        autoPricingEnabled: getSetting('auto_pricing_enabled', '1') === '1',
        fullParseEnabled: getSetting('full_parse_enabled', '1') === '1',
        kaspiPullEnabled: getSetting('kaspi_pull_enabled', '0') === '1',
        kaspiPushEnabled: getSetting('kaspi_push_enabled', '0') === '1',
        autoPricingIntervalMs: Number(getSetting('auto_pricing_interval_ms', '300000')),
        fullParseIntervalMs: Number(getSetting('full_parse_interval_ms', '900000')),
        kaspiPullIntervalMs: Number(getSetting('kaspi_pull_interval_ms', '0')),
        kaspiPushIntervalMs: Number(getSetting('kaspi_push_interval_ms', '0')),
        autoPricingConcurrency: Number(getSetting('auto_pricing_concurrency', '4')),
        merchantName: getSetting('merchant_name', '') || getKnownMerchantNames(getSetting('merchant_id', ''))[0] || '',
        warehouseIds: getAllWarehouseIds(),
    };
}

function toDbText(value, fallback = '') {
    if (value == null) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    return JSON.stringify(value) ?? fallback;
}

function firstDefinedValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

function toDbNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toDbInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
}

function toDbIntegerOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
}

function toDbBooleanNumber(value) {
    if (value === true) return 1;
    if (value === false || value == null) return 0;
    if (typeof value === 'string') {
        return ['true', 'yes', '1', 'да'].includes(value.trim().toLowerCase()) ? 1 : 0;
    }
    return Number(value) ? 1 : 0;
}

function serializeDetails(details) {
    if (details === undefined || details === null) return null;
    if (typeof details === 'string') return details;

    try {
        return JSON.stringify(details);
    } catch {
        return JSON.stringify({ error: 'DETAILS_SERIALIZE_FAILED' });
    }
}

// ─── XML Generation from DB ─────────────────────────────

export function getProductsForXml() {
    const d = getDb();
    const products = d.prepare('SELECT * FROM products ORDER BY sku').all();
    const result = [];

    for (const p of products) {
        const warehouses = d.prepare(
            'SELECT * FROM product_warehouses WHERE sku = ? AND enabled = 1 ORDER BY store_id',
        ).all(p.sku);
        const productAvailable = Number(p.available) === 1;

        if (!productAvailable && warehouses.length === 0) {
            continue;
        }

        result.push({
            sku: p.sku,
            model: p.model,
            brand: p.brand,
            price: String(p.upload_price || p.city_price || p.price || 0),
            cityPrices: (p.upload_price || p.city_price)
                ? [{ cityId: p.city_id || '710000000', price: String(p.upload_price || p.city_price) }]
                : [],
            availabilities: warehouses.map((w) => ({
                available: productAvailable ? normalizeWarehouseAvailability(w.available) : 'no',
                storeId: w.store_id,
                preOrder: w.pre_order ? String(w.pre_order) : '',
                stockCount: w.stock_count ? String(w.stock_count) : '',
            })),
        });
    }

    return result;
}

function normalizeWarehouseAvailability(value) {
    return String(value || '').trim().toLowerCase() === 'no' ? 'no' : 'yes';
}

// ─── Import from XML catalog ────────────────────────────

export function importFromCatalog(catalog, { importedAvailable = 1 } = {}) {
    const d = getDb();
    let imported = 0;
    let updated = 0;
    const importedSkus = [];
    const updatedSkus = [];
    const available = importedAvailable ? 1 : 0;

    const tx = d.transaction(() => {
        for (const offer of catalog.offers || []) {
            const sku = normalizeImportSku(offer.sku);
            if (!sku) continue;

            const existingSku = findExistingSkuForImport(sku);
            const targetSku = existingSku || sku;
            const existingProduct = existingSku
                ? d.prepare('SELECT * FROM products WHERE sku = ?').get(existingSku)
                : null;
            const cityPrice = offer.cityPrices?.[0];
            const price = Number(cityPrice?.price || offer.price || 0);

            if (existingSku) {
                d.prepare(`
          UPDATE products SET
            model = @model, brand = @brand,
            city_id = @city_id, city_price = @city_price, upload_price = @upload_price,
            available = @available,
            updated_at = datetime('now')
          WHERE sku = @sku
        `).run({
                    sku: targetSku,
                    model: offer.model,
                    brand: offer.brand || '',
                    city_id: cityPrice?.cityId || '710000000',
                    city_price: price,
                    upload_price: price,
                    available,
                });
                updated++;
                updatedSkus.push(targetSku);
                addProductHistoryEvent({
                    sku: targetSku,
                    eventType: 'catalog_update',
                    triggerSource: 'import',
                    status: 'success',
                    oldUploadPrice: existingProduct?.upload_price ?? existingProduct?.city_price ?? existingProduct?.price ?? null,
                    newUploadPrice: price,
                    minPrice: existingProduct?.min_price ?? null,
                    maxPrice: existingProduct?.max_price ?? null,
                    message: `Товар обновлен из файла: ${sku}`,
                    details: {
                        importedAvailable: available,
                        offerSku: sku,
                        model: offer.model || '',
                        brand: offer.brand || '',
                    },
                });
            } else {
                upsertProduct({
                    sku: targetSku,
                    model: offer.model,
                    brand: offer.brand || '',
                    city_id: cityPrice?.cityId || '710000000',
                    city_price: price,
                    upload_price: price,
                    available,
                });
                imported++;
                importedSkus.push(targetSku);
                addProductHistoryEvent({
                    sku: targetSku,
                    eventType: 'catalog_import',
                    triggerSource: 'import',
                    status: 'success',
                    newUploadPrice: price,
                    message: `Новый товар добавлен из файла: ${sku}`,
                    details: {
                        importedAvailable: available,
                        offerSku: sku,
                        model: offer.model || '',
                        brand: offer.brand || '',
                    },
                });
            }

            // Import warehouses
            for (const av of offer.availabilities || []) {
                upsertWarehouse(targetSku, av.storeId, {
                    enabled: 1,
                    available: av.available || 'yes',
                    stock_count: Number(av.stockCount) || 0,
                    pre_order: Number(av.preOrder) || 0,
                });
            }
        }
    });

    tx();
    if (importedSkus.length || updatedSkus.length) {
        broadcastRealtimeEvent('products_changed', {
            skus: [...new Set([...importedSkus, ...updatedSkus])],
        });
    }
    return { imported, updated, importedSkus, updatedSkus };
}

export function importFromMerchantCabinetProducts(items = [], {
    available = 1,
    triggerSource = 'kaspi_cabinet',
} = {}) {
    const d = getDb();
    let imported = 0;
    let updated = 0;
    const importedSkus = [];
    const updatedSkus = [];
    const normalizedItems = Array.isArray(items) ? items : [];
    const availableFlag = Number(available) === 1 ? 1 : 0;

    const tx = d.transaction(() => {
        for (const item of normalizedItems) {
            const sku = normalizeImportSku(item?.sku);
            if (!sku) continue;

            const existingSku = findExistingSkuForImport(sku);
            const targetSku = existingSku || sku;
            const existingProduct = existingSku
                ? d.prepare('SELECT * FROM products WHERE sku = ?').get(existingSku)
                : null;
            const price = toDbIntegerOrNull(item?.price);
            const image = String(item?.image || '').trim();
            const warehouses = Array.isArray(item?.warehouses) ? item.warehouses : [];
            const title = String(item?.title || item?.model || '').trim();

            upsertProduct({
                sku: targetSku,
                kaspi_id: String(item?.kaspiId || targetSku.split('_')[0] || existingProduct?.kaspi_id || '').trim() || null,
                model: title || null,
                city_price: price,
                upload_price: price,
                available: availableFlag,
                images: image ? JSON.stringify([image]) : null,
            });

            if (existingSku) {
                updated += 1;
                updatedSkus.push(targetSku);
            } else {
                imported += 1;
                importedSkus.push(targetSku);
            }

            if (warehouses.length) {
                for (const warehouse of warehouses) {
                    const storeId = String(warehouse?.storeId || warehouse?.store_id || '').trim();
                    if (!storeId) continue;
                    upsertWarehouse(targetSku, storeId, {
                        enabled: 1,
                        available: availableFlag ? 'yes' : 'no',
                        stock_count: toDbInteger(warehouse?.stockCount ?? warehouse?.stock_count, 0),
                        actual_stock: toDbInteger(warehouse?.stockCount ?? warehouse?.stock_count, 0),
                        pre_order: toDbInteger(warehouse?.preOrder ?? warehouse?.pre_order, 0),
                    });
                }
            }

            addProductHistoryEvent({
                sku: targetSku,
                eventType: 'kaspi_sync',
                triggerSource,
                status: 'success',
                newUploadPrice: price,
                message: availableFlag
                    ? 'Товар обновлен из кабинета Kaspi как активный'
                    : 'Товар обновлен из кабинета Kaspi как архивный',
                details: {
                    available: availableFlag,
                    imported: !existingSku,
                    price,
                },
            });
        }
    });

    tx();
    if (importedSkus.length || updatedSkus.length) {
        broadcastRealtimeEvent('products_changed', {
            skus: [...new Set([...importedSkus, ...updatedSkus])],
        });
    }
    return { imported, updated, importedSkus, updatedSkus };
}

// ─── Import from Kaspi merchant JSON ────────────────────

export function importFromKaspiJson(jsonData) {
    const d = getDb();
    let imported = 0;
    let updated = 0;
    const merchantId = jsonData.merchant || '';

    const tx = d.transaction(() => {
        for (const item of jsonData.data || []) {
            const sku = normalizeImportSku(item.sku || item.masterSku);
            if (!sku) continue;

            const existingSku = findExistingSkuForImport(sku);
            const cityPrice = item.cityPrices?.[0]?.value || item.minPrice || 0;
            const images = JSON.stringify(item.images || []);

            const productData = {
                sku,
                kaspi_id: item.masterSku || null,
                model: item.model || item.title || '',
                brand: item.brandName || item.brand || null,
                category: item.categoryCode || item.masterCategory || null,
                vertical_category: item.verticalCategory || null,
                master_category: item.masterCategory || null,
                city_price: cityPrice,
                city_id: item.cityPrices?.[0]?.cityId || '710000000',
                available: item.available ? 1 : 0,
                images,
                shop_link: item.shopLink || null,
                upload_price: cityPrice,
                min_price: item.minPrice || 0,
                max_price: item.maxPrice || 0,
            };

            if (existingSku) {
                upsertProduct(productData);
                updated++;
            } else {
                upsertProduct(productData);
                imported++;
            }

            // Import warehouses
            for (const av of item.availabilities || []) {
                upsertWarehouse(sku, av.storeId, {
                    enabled: 1,
                    available: av.available || 'yes',
                    stock_count: av.stockCount || 0,
                    actual_stock: av.stockCount || 0,
                    pre_order: av.preOrder || 0,
                });
            }
        }
    });

    tx();

    if (merchantId) {
        setSetting('merchant_id', merchantId);
    }

    return { imported, updated, merchant: merchantId };
}

// ─── Import auto-pricing state from JSON ────────────────

export function importAutoPricingState(state) {
    const d = getDb();
    let count = 0;
    let importedMerchantId = '';

    const tx = d.transaction(() => {
        for (const [sku, tracking] of Object.entries(state.products || {})) {
            const existing = d.prepare('SELECT sku FROM products WHERE sku = ?').get(sku);
            if (!existing) continue;

            d.prepare(`
        UPDATE products SET
          kaspi_id = COALESCE(NULLIF(@kaspi_id, ''), kaspi_id),
          auto_pricing_enabled = @auto_pricing_enabled,
          min_price = @min_price,
          max_price = @max_price,
          last_parsed_at = @last_parsed_at,
          last_recommended_price = @last_recommended_price,
          last_competitor_price = @last_competitor_price,
          last_reason = @last_reason,
          updated_at = datetime('now')
        WHERE sku = @sku
      `).run({
                sku,
                kaspi_id: tracking.kaspiId || '',
                auto_pricing_enabled: tracking.autoPricingEnabled !== false ? 1 : 0,
                min_price: tracking.minPrice || 0,
                max_price: tracking.maxPrice || 0,
                last_parsed_at: tracking.lastParsedAt || null,
                last_recommended_price: tracking.lastRecommendedPrice ?? null,
                last_competitor_price: tracking.lastCompetitorPrice ?? null,
                last_reason: tracking.lastReason || null,
            });

            // Import sellers
            if (Array.isArray(tracking.lastSellers) && tracking.lastSellers.length) {
                replaceSellers(sku, tracking.lastSellers);
            }

            if (!importedMerchantId && tracking.ownMerchantId) {
                importedMerchantId = String(tracking.ownMerchantId).trim();
            }

            count++;
        }
    });

    tx();
    if (importedMerchantId && !getSetting('merchant_id', '')) {
        setSetting('merchant_id', importedMerchantId);
        setSetting('ignored_merchant_ids', importedMerchantId);
    }
    return { count };
}
