import { escapeAttr, escapeHtml, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderProductsPage({
  products = [],
  counts = { total: 0, active: 0, inactive: 0 },
  message,
  error,
  sort = 'sku',
  order = 'asc',
  search = '',
  availableFilter = '',
  merchantId = '',
  priceCalculationState = { enabled: false, running: false, nextRunAt: null, intervalMs: 0 },
  latestPriceCalculationSession = null,
  currentPriceCalculationSession = null,
  priceCalculationProductsCount = 0,
  buildStatesBySku = {},
}) {
  const filterParams = new URLSearchParams();
  if (sort) filterParams.set('sort', sort);
  if (order) filterParams.set('order', order);
  if (search) filterParams.set('search', search);
  if (availableFilter !== '') filterParams.set('available', availableFilter);
  const refreshUrl = `/panel/products${filterParams.toString() ? `?${filterParams}` : ''}`;
  const bulkWarehouseControls = renderBulkWarehouseControls(products, merchantId);
  const session = currentPriceCalculationSession || latestPriceCalculationSession;
  const sessionDetails = parseSessionDetails(session?.details);
  const progress = buildSessionProgress(session, sessionDetails);

  const rows = products.map((product) => {
    const image = firstProductImage(product);
    const price = product.upload_price || product.city_price || product.price || 0;
    const available = Number(product.available) === 1;
    const autoPricing = Number(product.auto_pricing_enabled) === 1;
    const warehouses = Array.isArray(product.warehouses) ? product.warehouses : [];
    const buildState = buildStatesBySku[product.sku] || null;

    return `<tr>
      <td>
        <input class="product-check" form="bulkForm" type="checkbox" name="skus" value="${escapeAttr(product.sku)}" onchange="syncBulkBar()">
      </td>
      <td>
        ${image
          ? `<img src="${escapeAttr(image)}" alt="" loading="lazy" style="width:42px;height:42px;object-fit:cover;border-radius:10px;border:1px solid var(--c-border)">`
          : '<div style="width:42px;height:42px;border-radius:10px;border:1px solid var(--c-border);background:#f5f7fb"></div>'}
      </td>
      <td>
        <a href="/panel/products/${encodeURIComponent(product.sku)}" class="cell-main" style="color:var(--c-accent)">${escapeHtml(product.model || product.sku)}</a>
        <div class="cell-sub">SKU: ${escapeHtml(product.sku)}</div>
        ${product.brand ? `<div class="cell-sub">${escapeHtml(product.brand)}</div>` : ''}
      </td>
      <td>${available ? '<span class="badge badge--green">В продаже</span>' : '<span class="badge badge--gray">Не в продаже</span>'}</td>
      <td>${autoPricing ? '<span class="badge badge--blue">Вкл</span>' : '<span class="badge badge--gray">Выкл</span>'}</td>
      <td>${renderBuildStatus(buildState, product.last_parsed_at)}</td>
      <td><strong>${formatPrice(price)}</strong></td>
      <td>${product.my_position ? escapeHtml(product.my_position) : '—'}</td>
      <td>${formatMinMax(product)}</td>
      <td>${renderWarehouseSummary(warehouses)}</td>
      <td>
        <div class="actions">
          <a class="btn btn--ghost btn--xs" href="/panel/products/${encodeURIComponent(product.sku)}">Открыть</a>
          <form action="/panel/products/${encodeURIComponent(product.sku)}/delete" method="post" style="display:inline;margin:0" onsubmit="return confirm('Удалить товар ${escapeAttr(jsString(product.sku))}?')">
            <button class="btn btn--danger btn--xs" type="submit">Удалить</button>
          </form>
        </div>
      </td>
    </tr>`;
  }).join('');

  return renderLayout({
    title: 'Товары',
    activePage: 'products',
    message,
    error,
    content: `
      ${renderLivePricePanel({
        state: priceCalculationState,
        latestSession: latestPriceCalculationSession,
        session,
        progress,
        productsCount: priceCalculationProductsCount,
      })}

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Быстрые действия</h3>
            <div class="card__subtitle">Кнопки загрузки из Kaspi и массовых действий вынесены наверх, чтобы были всегда под рукой.</div>
          </div>
        </div>
        <div class="card__body">
          <div class="quick-actions">
            <a class="btn btn--ghost" href="${escapeAttr(refreshUrl)}">Обновить таблицу</a>
            <form action="/panel/kaspi/download" method="post">
              <button class="btn btn--accent" type="submit">Обновить с Kaspi</button>
            </form>
            <form action="/panel/kaspi/upload" method="post">
              <button class="btn btn--success" type="submit">Загрузить в Kaspi</button>
            </form>
            <form action="/panel/auto-pricing/run" method="post">
              <button class="btn btn--ghost" type="submit">Рассчитать все</button>
            </form>
            <form action="/panel/products/parse-all" method="post">
              <button class="btn btn--ghost" type="submit">Переформировать все</button>
            </form>
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px 24px;margin-bottom:16px">
        <form method="get" action="/panel/products" class="flex items-center gap-md flex-wrap">
          <input type="hidden" name="sort" value="${escapeAttr(sort)}">
          <input type="hidden" name="order" value="${escapeAttr(order)}">
          <input class="form-input" name="search" type="text" placeholder="Поиск по названию, SKU..." value="${escapeAttr(search)}" style="max-width:300px">
          <select class="form-select" name="available" style="max-width:180px">
            <option value="">Все товары</option>
            <option value="1"${availableFilter === '1' ? ' selected' : ''}>В продаже</option>
            <option value="0"${availableFilter === '0' ? ' selected' : ''}>Не в продаже</option>
          </select>
          <button class="btn btn--ghost btn--sm" type="submit">Найти</button>
          <span class="text-sm text-muted" style="margin-left:auto">Всего: ${escapeHtml(counts.total || 0)} (${escapeHtml(counts.active || 0)} акт. / ${escapeHtml(counts.inactive || 0)} неакт.)</span>
        </form>
      </div>

      <div class="card card--flush">
        <div class="card__header">
          <div class="flex items-center gap-sm">
            <label style="cursor:pointer;display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="selectAll" onchange="toggleAll(this)">
              <span class="text-sm">Выбрать все</span>
            </label>
          </div>
          <div class="text-sm text-muted">В карточках видно: сформирована, не сформирована или формируется.</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:40px"></th>
                <th style="width:54px">Фото</th>
                ${sortLink('model', 'Название / SKU', sort, order, search, availableFilter)}
                ${sortLink('available', 'Продажа', sort, order, search, availableFilter)}
                ${sortLink('auto_pricing_enabled', 'Авторасчет', sort, order, search, availableFilter)}
                <th>Формирование</th>
                ${sortLink('upload_price', 'Цена выгрузки', sort, order, search, availableFilter)}
                ${sortLink('my_position', 'Позиция', sort, order, search, availableFilter)}
                <th>Мин/Макс</th>
                <th>Склады</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              ${rows || emptyRow()}
            </tbody>
          </table>
        </div>
      </div>

      <div class="bulk-bar" id="bulkBar">
        <span class="bulk-bar__count" id="bulkCount">0 выбрано</span>
        <form id="bulkForm" action="/panel/products/bulk/update" method="post" class="bulk-bar__form">
          <select name="bulkAvailable" class="form-select" style="width:auto;min-width:140px">
            <option value="">Продажа...</option>
            <option value="1">В продажу</option>
            <option value="0">Снять</option>
          </select>
          <select name="bulkAutopricing" class="form-select" style="width:auto;min-width:160px">
            <option value="">Авторасчет...</option>
            <option value="1">Включить</option>
            <option value="0">Выключить</option>
          </select>
          <input class="form-input" name="bulkMinPrice" type="number" placeholder="Мин цена" style="width:110px">
          <input class="form-input" name="bulkMaxPrice" type="number" placeholder="Макс цена" style="width:110px">
          <input class="form-input" name="bulkPreOrder" type="number" placeholder="Предзаказ" min="0" max="30" style="width:110px">
          <details class="bulk-warehouse-details">
            <summary class="btn btn--ghost btn--sm bulk-warehouse-summary">Остатки по складам</summary>
            <div class="bulk-warehouse-panel">
              <div class="form-hint" style="margin:0 0 12px">Изменения применятся ко всем выбранным товарам. Пустые поля останутся без изменений.</div>
              <div class="warehouse-grid bulk-warehouse-grid">
                ${bulkWarehouseControls || '<p class="text-muted" style="margin:0">Складов пока нет.</p>'}
              </div>
            </div>
          </details>
          <button class="btn btn--primary btn--sm" type="submit">Сохранить</button>
          <button class="btn btn--accent btn--sm" type="submit" formaction="/panel/products/bulk/light-parse" formmethod="post">Рассчитать выбранные</button>
          <button class="btn btn--ghost btn--sm" type="submit" formaction="/panel/products/bulk/parse" formmethod="post">Переформировать выбранные</button>
          <button class="btn btn--danger btn--sm" type="submit" formaction="/panel/products/bulk/delete" formmethod="post" onclick="return confirmBulkDelete()">Удалить</button>
        </form>
      </div>

      ${renderDateTimeScript()}
      <script>
      const priceSessionState = ${JSON.stringify({
        sessionId: session?.id || null,
        sessionType: session?.type || '',
      }).replace(/</g, '\\u003c')};

      function selectedChecks() {
        return Array.from(document.querySelectorAll('.product-check:checked'));
      }
      function syncBulkBar() {
        const checks = selectedChecks();
        const bulkBar = document.getElementById('bulkBar');
        const bulkCount = document.getElementById('bulkCount');
        const selectAll = document.getElementById('selectAll');
        if (bulkBar) bulkBar.classList.toggle('active', checks.length > 0);
        if (bulkCount) bulkCount.textContent = checks.length + ' выбрано';
        if (selectAll) {
          const all = Array.from(document.querySelectorAll('.product-check'));
          selectAll.checked = all.length > 0 && checks.length === all.length;
          selectAll.indeterminate = checks.length > 0 && checks.length < all.length;
        }
      }
      function toggleAll(source) {
        document.querySelectorAll('.product-check').forEach((checkbox) => {
          checkbox.checked = source.checked;
        });
        syncBulkBar();
      }
      function confirmBulkDelete() {
        const count = selectedChecks().length;
        if (!count) {
          alert('Выберите товары для удаления.');
          return false;
        }
        return confirm('Удалить выбранные товары: ' + count + '?');
      }
      function parseSessionDetails(details) {
        if (!details) return {};
        if (typeof details === 'object') return details;
        try {
          return JSON.parse(details);
        } catch {
          return {};
        }
      }
      function buildProgress(session) {
        const details = parseSessionDetails(session && session.details);
        const results = Array.isArray(details.results) ? details.results : [];
        const total = Number(session && session.total_count || 0);
        const success = Number(session && session.success_count || 0);
        const errors = Number(session && session.error_count || 0);
        const processed = success + errors;
        const percent = total ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : (session && session.status === 'running' ? 0 : 100);
        const updated = results.filter((item) => item && item.updated).length;
        return { total, success, errors, processed, percent, updated };
      }
      function updateLivePricePanel(session) {
        if (!session || !['light_parse', 'auto_pricing'].includes(session.type)) return;
        const progress = buildProgress(session);
        const title = document.getElementById('priceLiveTitle');
        const meta = document.getElementById('priceLiveMeta');
        const messageNode = document.getElementById('priceLiveMessage');
        const progressCount = document.getElementById('priceLiveProgress');
        const updatedNode = document.getElementById('priceLiveUpdated');
        const errorsNode = document.getElementById('priceLiveErrors');
        const bar = document.getElementById('priceLiveBar');
        const percentNode = document.getElementById('priceLivePercent');
        if (title) title.textContent = session.status === 'running' ? 'Расчет цены выполняется в реальном времени' : 'Последний пересчет цены';
        if (meta) meta.textContent = (session.trigger_source === 'auto' ? 'Авто' : 'Ручной') + ' • Сессия #' + session.id;
        if (messageNode) messageNode.textContent = session.message || '—';
        if (progressCount) progressCount.textContent = progress.processed + ' / ' + (progress.total || progress.processed);
        if (updatedNode) updatedNode.textContent = String(progress.updated);
        if (errorsNode) errorsNode.textContent = String(progress.errors);
        if (bar) bar.style.width = progress.percent + '%';
        if (percentNode) percentNode.textContent = progress.percent + '%';
      }

      document.addEventListener('DOMContentLoaded', syncBulkBar);
      document.addEventListener('kaspi:parse_session_updated', (event) => {
        const session = event.detail || {};
        if (['light_parse', 'auto_pricing'].includes(session.type)) {
          updateLivePricePanel(session);
        }
      });
      </script>
    `,
  });
}

function renderLivePricePanel({ state, latestSession, session, progress, productsCount }) {
  const running = Boolean(session && session.status === 'running');
  const nextRun = !running && state?.enabled && state?.nextRunAt
    ? renderDateTime(state.nextRunAt, { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const latestLabel = latestSession
    ? `#${escapeHtml(latestSession.id)} • ${escapeHtml(latestSession.status || '—')}`
    : 'Сессий пока нет';

  return `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title" id="priceLiveTitle">${running ? 'Расчет цены выполняется в реальном времени' : 'Статус расчета цены'}</h3>
          <div class="card__subtitle" id="priceLiveMeta">${session ? `${session.trigger_source === 'auto' ? 'Авто' : 'Ручной'} • Сессия #${escapeHtml(session.id)}` : `Последняя сессия: ${latestLabel}`}</div>
        </div>
        <div class="session-toolbar">
          <a class="btn btn--ghost btn--sm" href="/panel/history?tab=sessions">Открыть историю</a>
          <span class="badge ${running ? 'badge--blue' : state?.enabled ? 'badge--green' : 'badge--gray'}">${running ? 'В работе' : state?.enabled ? 'Авто включен' : 'Авто выключен'}</span>
        </div>
      </div>
      <div class="card__body">
        <div class="stats" style="margin-bottom:16px">
          <div class="stat">
            <div class="stat__label">Товаров в авторасчете</div>
            <div class="stat__value">${escapeHtml(productsCount || 0)}</div>
          </div>
          <div class="stat">
            <div class="stat__label">Прогресс</div>
            <div class="stat__value" id="priceLiveProgress">${escapeHtml(progress.processed)} / ${escapeHtml(progress.total || progress.processed)}</div>
          </div>
          <div class="stat">
            <div class="stat__label">Изменено цен</div>
            <div class="stat__value" id="priceLiveUpdated">${escapeHtml(progress.updated)}</div>
          </div>
          <div class="stat">
            <div class="stat__label">Ошибки</div>
            <div class="stat__value" id="priceLiveErrors">${escapeHtml(progress.errors)}</div>
            <div class="stat__note">Следующий запуск: ${nextRun}</div>
          </div>
        </div>
        <div class="session-progress" style="max-width:none">
          <div class="session-progress__head">
            <span id="priceLiveMessage">${escapeHtml(session?.message || latestSession?.message || 'Ожидание следующего запуска')}</span>
            <strong id="priceLivePercent">${escapeHtml(progress.percent)}%</strong>
          </div>
          <div class="session-progress__bar" style="height:12px">
            <div class="session-progress__fill" id="priceLiveBar" style="width:${escapeHtml(progress.percent)}%"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderBuildStatus(buildState, lastParsedAt) {
  if (buildState?.state === 'building') {
    return `
      <span class="badge badge--blue">Формируется</span>
      <div class="cell-sub">${renderDateTime(buildState.startedAt, { dateStyle: 'short', timeStyle: 'short' })}</div>
    `;
  }

  if (lastParsedAt) {
    return `
      <span class="badge badge--green">Сформирована</span>
      <div class="cell-sub">${renderDateTime(lastParsedAt, { dateStyle: 'short', timeStyle: 'short' })}</div>
    `;
  }

  return '<span class="badge badge--gray">Не сформирована</span>';
}

function renderBulkWarehouseControls(products, merchantId) {
  const warehouses = new Map();

  for (const product of products) {
    for (const warehouse of Array.isArray(product.warehouses) ? product.warehouses : []) {
      const key = shortStoreId(warehouse.store_id);
      if (!warehouses.has(key)) {
        warehouses.set(key, warehouse.store_id);
      }
    }
  }

  return Array.from(warehouses.entries()).map(([shortId, fullId]) => `
      <div class="warehouse-card bulk-warehouse-card">
        <div class="warehouse-card__head" style="margin-bottom:10px">
          <div>
            <h4 class="warehouse-card__title">${escapeHtml(shortId)}</h4>
            <div class="warehouse-card__meta">${escapeHtml(fullId)}</div>
          </div>
        </div>
        <div class="warehouse-card__fields">
          <div class="form-group form-group--full">
            <label class="form-label">ID склада</label>
            <input class="form-input form-input--sm" name="bulkStoreId[]" type="text" value="${escapeAttr(defaultStoreId(shortId, merchantId) || fullId)}">
          </div>
          <div class="form-group">
            <label class="form-label">Статус</label>
            <select class="form-select form-select--sm" name="bulkWarehouseEnabled[]">
              <option value="">Без изменений</option>
              <option value="1">Вкл</option>
              <option value="0">Выкл</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Kaspi остаток</label>
            <input class="form-input form-input--sm" name="bulkStockCount[]" type="number" min="0" placeholder="Напр. 5">
          </div>
          <div class="form-group">
            <label class="form-label">Факт. остаток</label>
            <input class="form-input form-input--sm" name="bulkActualStock[]" type="number" min="0" placeholder="Напр. 5">
          </div>
          <div class="form-group form-group--full">
            <label class="form-label">Предзаказ</label>
            <input class="form-input form-input--sm" name="bulkWarehousePreOrder[]" type="number" min="0" max="30" placeholder="0-30 дней">
          </div>
        </div>
      </div>`).join('');
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

function buildSessionProgress(session, details) {
  const results = Array.isArray(details?.results) ? details.results : [];
  const total = Number(session?.total_count || 0);
  const success = Number(session?.success_count || 0);
  const errors = Number(session?.error_count || 0);
  const processed = success + errors;
  const percent = total ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : (session?.status === 'running' ? 0 : 100);
  return {
    total,
    success,
    errors,
    processed,
    percent,
    updated: results.filter((result) => result && result.updated).length,
  };
}

function sortLink(column, label, currentSort, currentOrder, search, availableFilter) {
  const order = currentSort === column && currentOrder === 'asc' ? 'desc' : 'asc';
  const params = new URLSearchParams();
  params.set('sort', column);
  params.set('order', order);
  if (search) params.set('search', search);
  if (availableFilter !== '') params.set('available', availableFilter);
  const classes = ['sortable'];
  if (currentSort === column) classes.push(currentOrder);
  return `<th class="${classes.join(' ')}"><a href="/panel/products?${params.toString()}">${escapeHtml(label)}</a></th>`;
}

function renderWarehouseSummary(warehouses) {
  if (!warehouses.length) return '—';
  return warehouses.slice(0, 3).map((warehouse) => {
    const enabled = Number(warehouse.enabled) === 1;
    const stock = Number(warehouse.stock_count || 0);
    return `<div class="cell-sub">${escapeHtml(shortStoreId(warehouse.store_id))}: ${enabled ? stock : 'выкл'}</div>`;
  }).join('') + (warehouses.length > 3 ? `<div class="cell-sub">+${warehouses.length - 3}</div>` : '');
}

function emptyRow() {
  return `
    <tr>
      <td colspan="11">
        <div class="empty">
          <div class="empty__text">Товаров пока нет</div>
        </div>
      </td>
    </tr>`;
}

function firstProductImage(product) {
  const images = parseImages(product.images);
  const image = images[0];
  if (!image) return '';
  if (/^https?:\/\//i.test(image)) return image;
  return `https://resources.cdn-kaspi.kz/shop/medias/sys_master/images/images/${image}`;
}

function parseImages(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatMinMax(product) {
  const min = Number(product.min_price || 0);
  const max = Number(product.max_price || 0);
  if (!min && !max) return '—';
  return `${formatPrice(min)} - ${formatPrice(max)}`;
}

function formatPrice(value) {
  const amount = Number(value || 0);
  if (!amount) return '—';
  return `${amount.toLocaleString('ru-RU')} ₸`;
}

function shortStoreId(id) {
  const value = String(id || '');
  const match = value.match(/_?(PP\d+)$/i);
  return match ? match[1].toUpperCase() : value.toUpperCase();
}

function defaultStoreId(shortId, merchantId) {
  const value = String(shortId || '').trim();
  if (!value || value.includes('_') || !merchantId) return value;
  return `${merchantId}_${value}`;
}

function jsString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
