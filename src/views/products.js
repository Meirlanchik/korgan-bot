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

  const rows = products.map((product) => {
    const image = firstProductImage(product);
    const price = product.upload_price || product.city_price || product.price || 0;
    const available = Number(product.available) === 1;
    const autoPricing = Number(product.auto_pricing_enabled) === 1;
    const warehouses = Array.isArray(product.warehouses) ? product.warehouses : [];
    const buildState = buildStatesBySku[product.sku] || null;

    return `<tr
      data-product-row="1"
      data-sku="${escapeAttr(product.sku)}"
      data-min-price="${escapeAttr(product.min_price || 0)}"
      data-max-price="${escapeAttr(product.max_price || 0)}"
      data-last-parsed-at="${escapeAttr(product.last_parsed_at || '')}"
    >
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
      <td data-role="available-cell">${available ? '<span class="badge badge--green">В продаже</span>' : '<span class="badge badge--gray">Не в продаже</span>'}</td>
      <td data-role="autopricing-cell">${autoPricing ? '<span class="badge badge--blue">Вкл</span>' : '<span class="badge badge--gray">Выкл</span>'}</td>
      <td data-role="build-status-cell">${renderBuildStatus(buildState, product.last_parsed_at)}</td>
      <td data-role="price-cell"><strong>${formatPrice(price)}</strong></td>
      <td data-role="position-cell">${product.my_position ? escapeHtml(product.my_position) : '—'}</td>
      <td data-role="minmax-cell">${formatMinMax(product)}</td>
      <td>${renderWarehouseSummary(warehouses)}</td>
      <td>
        <div class="actions">
          <a class="btn btn--ghost btn--xs" href="/panel/products/${encodeURIComponent(product.sku)}">Открыть</a>
          <form data-products-async="1" action="/panel/products/${encodeURIComponent(product.sku)}/delete" method="post" style="display:inline;margin:0" onsubmit="return confirm('Удалить товар ${escapeAttr(jsString(product.sku))}?')">
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
      <div class="form-row" style="align-items:start">
        <div class="card" style="margin-bottom:16px">
          <div class="card__header">
            <div>
              <h3 class="card__title">Операции по каталогу</h3>
              <div class="card__subtitle">Локальные действия по таблице и карточкам товаров без переходов на другие страницы.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="quick-actions">
              <a class="btn btn--ghost" href="${escapeAttr(refreshUrl)}">Обновить таблицу</a>
              <form data-products-async="1" action="/panel/auto-pricing/run" method="post">
                <button class="btn btn--ghost" type="submit">Рассчитать все</button>
              </form>
              <form data-products-async="1" action="/panel/products/parse-all" method="post">
                <button class="btn btn--ghost" type="submit">Переформировать все</button>
              </form>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card__header">
            <div>
              <h3 class="card__title">Kaspi</h3>
              <div class="card__subtitle">Синхронизация с кабинетом продавца вынесена отдельно, потому что это другой контекст и отдельные фоновые сессии.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="quick-actions">
              <form data-products-async="1" action="/panel/kaspi/download" method="post">
                <button class="btn btn--accent" type="submit">Обновить с Kaspi</button>
              </form>
              <form data-products-async="1" action="/panel/kaspi/upload" method="post">
                <button class="btn btn--success" type="submit">Загрузить в Kaspi</button>
              </form>
            </div>
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
          <span class="text-sm text-muted" id="productsCountsSummary" style="margin-left:auto">Всего: ${escapeHtml(counts.total || 0)} (${escapeHtml(counts.active || 0)} акт. / ${escapeHtml(counts.inactive || 0)} неакт.)</span>
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
            <tbody id="productsTableBody">
              ${rows || emptyRow()}
            </tbody>
          </table>
        </div>
      </div>

      <div class="bulk-bar" id="bulkBar">
        <span class="bulk-bar__count" id="bulkCount">0 выбрано</span>
        <form id="bulkForm" data-products-async="1" action="/panel/products/bulk/update" method="post" class="bulk-bar__form">
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
      const buildSessionTypes = new Set(['full_parse', 'selected_products', 'single_product']);
      const priceSessionTypes = new Set(['light_parse', 'auto_pricing']);

      function selectedChecks() {
        return Array.from(document.querySelectorAll('.product-check:checked'));
      }
      function selectedRows() {
        return selectedChecks()
          .map((checkbox) => checkbox.closest('[data-product-row="1"]'))
          .filter(Boolean);
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
      function formatLocalDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('ru-RU', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Asia/Almaty',
        }).format(date);
      }
      function renderBuildStatusHtml(mode, value) {
        if (mode === 'building') {
          return '<span class="badge badge--blue">Формируется</span><div class="cell-sub">' + formatLocalDateTime(value) + '</div>';
        }
        if (mode === 'parsed' && value) {
          return '<span class="badge badge--green">Сформирована</span><div class="cell-sub">' + formatLocalDateTime(value) + '</div>';
        }
        return '<span class="badge badge--gray">Не сформирована</span>';
      }
      function showPageAlert(type, text) {
        if (window.KaspiPanel && typeof window.KaspiPanel.showAlert === 'function') {
          window.KaspiPanel.showAlert(type, text);
          return;
        }
        if (text) alert(text);
      }
      function setFormBusy(form, busy) {
        form.dataset.busy = busy ? '1' : '0';
        form.querySelectorAll('button[type="submit"]').forEach((button) => {
          button.disabled = busy;
        });
      }
      async function submitAsyncForm(form, submitter) {
        const action = submitter?.formAction || form.action;
        const method = (submitter?.formMethod || form.method || 'post').toUpperCase();
        const formData = new FormData(form);
        if (submitter?.name) {
          formData.append(submitter.name, submitter.value || '');
        }

        const response = await fetch(action, {
          method,
          body: formData,
          headers: {
            Accept: 'application/json',
            'X-Kaspi-Async': '1',
          },
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.ok === false) {
          throw new Error(result?.error || 'Операция завершилась с ошибкой.');
        }
        return result;
      }
      async function refreshProductsSummary() {
        try {
          const response = await fetch('/api/stats', { headers: { Accept: 'application/json' } });
          const stats = await response.json();
          const node = document.getElementById('productsCountsSummary');
          if (node) {
            node.textContent = 'Всего: ' + Number(stats.total || 0) + ' (' + Number(stats.active || 0) + ' акт. / ' + Number(stats.inactive || 0) + ' неакт.)';
          }
        } catch {
          // Ignore soft refresh issues in the counter badge.
        }
      }
      function updateAvailabilityCell(row, available) {
        const cell = row && row.querySelector('[data-role="available-cell"]');
        if (!cell) return;
        cell.innerHTML = Number(available) === 1
          ? '<span class="badge badge--green">В продаже</span>'
          : '<span class="badge badge--gray">Не в продаже</span>';
      }
      function updateAutoPricingCell(row, enabled) {
        const cell = row && row.querySelector('[data-role="autopricing-cell"]');
        if (!cell) return;
        cell.innerHTML = Number(enabled) === 1
          ? '<span class="badge badge--blue">Вкл</span>'
          : '<span class="badge badge--gray">Выкл</span>';
      }
      function updatePriceCell(row, value) {
        const cell = row && row.querySelector('[data-role="price-cell"]');
        if (!cell) return;
        cell.innerHTML = '<strong>' + formatPriceValue(value) + '</strong>';
      }
      function updatePositionCell(row, value) {
        const cell = row && row.querySelector('[data-role="position-cell"]');
        if (!cell) return;
        cell.textContent = value ? String(value) : '—';
      }
      function updateMinMaxCell(row, minPrice, maxPrice) {
        if (!row) return;
        if (minPrice !== undefined && minPrice !== null && minPrice !== '') row.dataset.minPrice = String(minPrice);
        if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') row.dataset.maxPrice = String(maxPrice);
        const cell = row.querySelector('[data-role="minmax-cell"]');
        if (!cell) return;
        const min = Number(row.dataset.minPrice || 0);
        const max = Number(row.dataset.maxPrice || 0);
        cell.textContent = (!min && !max) ? '—' : (formatPriceValue(min) + ' - ' + formatPriceValue(max));
      }
      function updateBuildStatusCell(row, mode, value) {
        const cell = row && row.querySelector('[data-role="build-status-cell"]');
        if (!cell) return;
        cell.innerHTML = renderBuildStatusHtml(mode, value);
      }
      function formatPriceValue(value) {
        const amount = Number(value || 0);
        if (!amount) return '—';
        return amount.toLocaleString('ru-RU') + ' ₸';
      }
      function removeProductRow(sku) {
        const row = document.querySelector('[data-product-row="1"][data-sku="' + cssEscapeValue(sku) + '"]');
        if (row) {
          row.remove();
        }
        ensureEmptyTableState();
        syncBulkBar();
      }
      function ensureEmptyTableState() {
        const body = document.getElementById('productsTableBody');
        if (!body) return;
        const rows = body.querySelectorAll('[data-product-row="1"]');
        if (rows.length) return;
        body.innerHTML = ${JSON.stringify(emptyRow()).replace(/</g, '\\u003c')};
      }
      function cssEscapeValue(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
          return window.CSS.escape(String(value || ''));
        }
        return String(value || '').replace(/"/g, '\\"');
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
      function applyBulkUpdatesFromForm(form) {
        const available = form.querySelector('[name="bulkAvailable"]')?.value;
        const autoPricing = form.querySelector('[name="bulkAutopricing"]')?.value;
        const minPrice = form.querySelector('[name="bulkMinPrice"]')?.value;
        const maxPrice = form.querySelector('[name="bulkMaxPrice"]')?.value;
        selectedRows().forEach((row) => {
          if (available !== '') updateAvailabilityCell(row, available);
          if (autoPricing !== '') updateAutoPricingCell(row, autoPricing);
          if (minPrice !== '') updateMinMaxCell(row, minPrice, undefined);
          if (maxPrice !== '') updateMinMaxCell(row, undefined, maxPrice);
        });
      }
      function updateRowsFromPriceSession(session) {
        const details = parseSessionDetails(session?.details);
        const results = Array.isArray(details.results) ? details.results : [];
        results.forEach((result) => {
          const sku = String(result?.sku || '').trim();
          if (!sku) return;
          const row = document.querySelector('[data-product-row="1"][data-sku="' + cssEscapeValue(sku) + '"]');
          if (!row) return;
          const nextPrice = result?.newPrice ?? result?.newUploadPrice;
          if (nextPrice !== undefined && nextPrice !== null) {
            updatePriceCell(row, nextPrice);
          }
          if (result?.myPosition !== undefined) {
            updatePositionCell(row, result.myPosition);
          }
        });
      }
      function updateRowsFromBuildSession(session) {
        const details = parseSessionDetails(session?.details);
        const targetSkus = Array.isArray(details.targetSkus) ? details.targetSkus.map((sku) => String(sku || '').trim()).filter(Boolean) : [];
        const results = Array.isArray(details.results) ? details.results : [];
        const resultMap = new Map(results
          .map((result) => [String(result?.sku || '').trim(), result])
          .filter((entry) => entry[0]));

        if (session.status === 'running') {
          targetSkus.forEach((sku) => {
            if (resultMap.has(sku)) return;
            const row = document.querySelector('[data-product-row="1"][data-sku="' + cssEscapeValue(sku) + '"]');
            if (row) updateBuildStatusCell(row, 'building', session.started_at);
          });
          return;
        }

        targetSkus.forEach((sku) => {
          const row = document.querySelector('[data-product-row="1"][data-sku="' + cssEscapeValue(sku) + '"]');
          if (!row) return;
          const result = resultMap.get(sku);
          if (result && !result.error) {
            const finishedAt = session.finished_at || session.started_at || new Date().toISOString();
            row.dataset.lastParsedAt = finishedAt;
            updateBuildStatusCell(row, 'parsed', finishedAt);
            return;
          }
          updateBuildStatusCell(row, 'parsed', row.dataset.lastParsedAt || '');
        });
      }
      function handleAsyncSuccess(form, submitter, result) {
        const actionPath = new URL(submitter?.formAction || form.action, location.origin).pathname;
        if (/\/products\/bulk\/delete$/.test(actionPath)) {
          selectedChecks().forEach((checkbox) => removeProductRow(checkbox.value));
          refreshProductsSummary();
          return;
        }
        if (/\/products\/bulk\/update$/.test(actionPath)) {
          applyBulkUpdatesFromForm(form);
          refreshProductsSummary();
          return;
        }
        if (/\/products\/bulk\/(?:light-parse|parse)$/.test(actionPath)) {
          syncBulkBar();
          return;
        }
        if (/\/products\/[^/]+\/delete$/.test(actionPath)) {
          removeProductRow(result.sku || '');
          refreshProductsSummary();
        }
      }

      document.addEventListener('DOMContentLoaded', syncBulkBar);
      document.querySelectorAll('form[data-products-async="1"]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          const submitter = event.submitter || form.querySelector('button[type="submit"]');
          if (form.dataset.busy === '1') return;
          try {
            setFormBusy(form, true);
            const result = await submitAsyncForm(form, submitter);
            handleAsyncSuccess(form, submitter, result);
            showPageAlert('success', result.message || 'Операция выполнена.');
          } catch (error) {
            showPageAlert('error', error?.message || 'Операция завершилась с ошибкой.');
          } finally {
            setFormBusy(form, false);
          }
        });
      });
      document.addEventListener('kaspi:parse_session_updated', (event) => {
        const session = event.detail || {};
        if (priceSessionTypes.has(session.type)) {
          updateRowsFromPriceSession(session);
        }
        if (buildSessionTypes.has(session.type)) {
          updateRowsFromBuildSession(session);
        }
      });
      document.addEventListener('kaspi:product_deleted', (event) => {
        const sku = String(event.detail?.sku || '').trim();
        if (!sku) return;
        removeProductRow(sku);
        refreshProductsSummary();
      });
      document.addEventListener('kaspi:products_changed', () => {
        refreshProductsSummary();
      });
      </script>
    `,
  });
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
