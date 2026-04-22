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
  categoryFilter = '',
  categories = [],
  merchantId = '',
  ignoredMerchantIds = [],
  priceCalculationState = { enabled: false, running: false, nextRunAt: null, intervalMs: 0 },
  latestPriceCalculationSession = null,
  currentPriceCalculationSession = null,
  priceCalculationProductsCount = 0,
}) {
  const filterParams = new URLSearchParams();
  if (sort) filterParams.set('sort', sort);
  if (order) filterParams.set('order', order);
  if (search) filterParams.set('search', search);
  if (availableFilter !== '') filterParams.set('available', availableFilter);
  if (categoryFilter) filterParams.set('category', categoryFilter);
  const refreshUrl = `/panel/products${filterParams.toString() ? `?${filterParams}` : ''}`;
  const bulkWarehouseControls = renderBulkWarehouseControls(products, merchantId);
  const session = currentPriceCalculationSession || latestPriceCalculationSession;
  const sessionDetails = parseSessionDetails(session?.details);
  const progress = buildSessionProgress(session, sessionDetails);

  const rows = products.map((product, index) => {
    const image = firstProductImage(product);
    const price = product.upload_price || product.city_price || product.price || 0;
    const available = Number(product.available) === 1;
    const autoPricing = Number(product.auto_pricing_enabled) === 1;
    const warehouses = Array.isArray(product.warehouses) ? product.warehouses : [];
    const lastPriceUpdatedAt = product.last_price_updated_at || product.last_auto_price_updated_at || '';
    const lastPriceUpdatedMs = lastPriceUpdatedAt ? Date.parse(lastPriceUpdatedAt) || 0 : 0;

    return `<tr class="product-row"
      data-search="${escapeAttr(`${product.model || ''} ${product.sku || ''} ${product.brand || ''}`.toLowerCase())}"
      data-available="${available ? '1' : '0'}"
      data-auto-pricing="${autoPricing ? '1' : '0'}"
      data-category="${escapeAttr(product.category || '')}"
      data-sort-sku="${escapeAttr(String(product.sku || '').toLowerCase())}"
      data-sort-model="${escapeAttr(String(product.model || product.sku || '').toLowerCase())}"
      data-sort-category="${escapeAttr(String(product.category || '').toLowerCase())}"
      data-sort-available="${available ? '1' : '0'}"
      data-sort-auto_pricing_enabled="${autoPricing ? '1' : '0'}"
      data-sort-upload_price="${escapeAttr(Number(price || 0))}"
      data-sort-first_place_price="${escapeAttr(Number(product.first_place_price || 0))}"
      data-sort-my_position="${escapeAttr(Number(product.my_position || 0))}"
      data-sort-price_updated_at="${escapeAttr(lastPriceUpdatedMs)}">
      <td class="product-select-cell">
        <input class="product-check" form="bulkForm" type="checkbox" name="skus" value="${escapeAttr(product.sku)}" tabindex="-1" onchange="syncBulkBar()">
      </td>
      <td class="text-muted row-number">${escapeHtml(index + 1)}</td>
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
      <td>${escapeHtml(product.category || '—')}</td>
      <td>${available ? '<span class="badge badge--green product-status-badge">В продаже</span>' : '<span class="badge badge--gray product-status-badge">Не в продаже</span>'}</td>
      <td>${autoPricing ? '<span class="badge badge--blue">Вкл</span>' : '<span class="badge badge--gray">Выкл</span>'}</td>
      <td><strong>${formatPrice(price)}</strong></td>
      <td>${renderFirstPlacePriceCell(product)}</td>
      <td>${product.my_position ? escapeHtml(product.my_position) : '—'}</td>
      <td>${formatMinMax(product)}</td>
      <td>${renderWarehouseSummary(warehouses)}</td>
      <td>${lastPriceUpdatedAt ? renderDateTime(lastPriceUpdatedAt, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
    </tr>`;
  }).join('');

  return renderLayout({
    title: 'Товары',
    activePage: 'products',
    message,
    error,
    content: `
      <div class="card product-filter-bar" style="padding:14px 18px;margin-bottom:16px">
        <form method="get" action="/panel/products" class="flex items-center gap-md flex-wrap" id="productFilterForm" onsubmit="return false">
          <input type="hidden" name="sort" value="${escapeAttr(sort)}">
          <input type="hidden" name="order" value="${escapeAttr(order)}">
          <input class="form-input" id="productSearch" name="search" type="search" placeholder="Поиск по названию, SKU..." value="${escapeAttr(search)}" style="max-width:320px">
          <div class="filter-chips" id="availableChips" data-value="${escapeAttr(availableFilter)}">
            <button class="filter-chip${availableFilter === '' ? ' active' : ''}" type="button" data-value="">Все</button>
            <button class="filter-chip${availableFilter === '1' ? ' active' : ''}" type="button" data-value="1">В продаже</button>
            <button class="filter-chip${availableFilter === '0' ? ' active' : ''}" type="button" data-value="0">Не в продаже</button>
          </div>
          <select class="form-select" id="categoryFilter" name="category" style="max-width:230px">
            <option value="">Все категории</option>
            ${categories.map((category) => `<option value="${escapeAttr(category)}"${categoryFilter === category ? ' selected' : ''}>${escapeHtml(category)}</option>`).join('')}
          </select>
          <button class="btn btn--ghost btn--sm" id="clearProductFilters" type="button">Сбросить фильтр</button>
          <a class="icon-btn" href="${escapeAttr(refreshUrl)}" title="Обновить таблицу" aria-label="Обновить таблицу">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 11a8.1 8.1 0 00-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0015.5 2M20 19v-4h-4"/></svg>
          </a>
          <span class="text-sm text-muted" style="margin-left:auto" id="productsVisibleCount">Всего: ${escapeHtml(counts.total || 0)} (${escapeHtml(counts.active || 0)} в продаже / ${escapeHtml(counts.inactive || 0)} не в продаже)</span>
        </form>
      </div>

      <div class="card card--flush">
        <div class="card__header">
          <div class="flex items-center gap-sm">
            <label class="product-select-all" style="cursor:pointer;display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="selectAll" onchange="toggleAll(this)">
              <span class="text-sm">Выбрать все</span>
            </label>
          </div>
          <div class="text-sm text-muted">Открой товар по названию, массовое редактирование появится после выбора строк.</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th style="width:40px"></th>
                <th style="width:52px">№</th>
                <th style="width:54px">Фото</th>
                ${sortLink('model', 'Название / SKU', sort, order, search, availableFilter, categoryFilter)}
                ${sortLink('category', 'Категория', sort, order, search, availableFilter, categoryFilter)}
                ${sortLink('available', 'Продажа', sort, order, search, availableFilter, categoryFilter)}
                ${sortLink('auto_pricing_enabled', 'Авторасчет', sort, order, search, availableFilter, categoryFilter)}
                ${sortLink('upload_price', 'Цена выгрузки', sort, order, search, availableFilter, categoryFilter)}
                ${sortLink('first_place_price', 'Цена первого места', sort, order, search, availableFilter, categoryFilter)}
                ${sortLink('my_position', 'Позиция', sort, order, search, availableFilter, categoryFilter)}
                <th>Мин/Макс</th>
                <th>Склады</th>
                ${sortLink('price_updated_at', 'Обновление цены', sort, order, search, availableFilter, categoryFilter)}
              </tr>
            </thead>
            <tbody>
              ${rows || emptyRow()}
            </tbody>
          </table>
        </div>
      </div>

      <div class="modal-overlay" id="sellerContextModal" aria-hidden="true">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sellerContextTitle">
          <div class="modal__header">
            <h3 id="sellerContextTitle">Продавцы</h3>
            <button class="modal__close" type="button" data-close-seller-context aria-label="Закрыть">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="modal__body">
            <div id="sellerContextMeta" class="text-sm text-muted" style="margin-bottom:12px"></div>
            <div id="sellerContextBody"></div>
          </div>
        </div>
      </div>

      <div class="bulk-bar" id="bulkBar">
        <span class="bulk-bar__count" id="bulkCount">0 выбрано</span>
        <form id="bulkForm" action="/panel/products/bulk/update" method="post" class="bulk-bar__form" data-async-form="1" data-redirect-on-success="1">
          <select name="bulkAvailable" id="bulkAvailableSelect" class="form-select" style="width:auto;min-width:160px">
            <option value="" id="bulkAvailableNeutral">Выставить/снять</option>
            <option value="1">В продаже</option>
            <option value="0">Не в продаже</option>
          </select>
          <select name="bulkAutopricing" id="bulkAutopricingSelect" class="form-select" style="width:auto;min-width:170px">
            <option value="" id="bulkAutopricingNeutral">Авторасчет</option>
            <option value="1">Вкл авторасчет</option>
            <option value="0">Выкл авторасчет</option>
          </select>
          <input class="form-input" id="bulkMinPrice" name="bulkMinPrice" type="number" min="0" placeholder="Минимальная цена" aria-label="Минимальная цена" style="width:150px">
          <input class="form-input" id="bulkMaxPrice" name="bulkMaxPrice" type="number" min="0" placeholder="Максимальная цена" aria-label="Максимальная цена" style="width:160px">
          <label class="number-with-suffix bulk-number-field" aria-label="Предзаказ">
            <input class="form-input" id="bulkPreOrder" name="bulkPreOrder" type="number" placeholder="Предзаказ" min="0" max="30">
            <span>дней</span>
          </label>
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
          <button class="btn btn--danger btn--sm" type="submit" formaction="/panel/products/bulk/delete" formmethod="post" formnovalidate onclick="return confirmBulkDelete()">Удалить</button>
        </form>
      </div>

      ${renderDateTimeScript()}
      <script>
      const priceSessionState = ${JSON.stringify({
        sessionId: session?.id || null,
        sessionType: session?.type || '',
      }).replace(/</g, '\\u003c')};
      const sellerContextConfig = ${JSON.stringify({
        merchantId,
        ownMerchantIds: uniqueIds([merchantId, ...(Array.isArray(ignoredMerchantIds) ? ignoredMerchantIds : [])]),
      }).replace(/</g, '\\u003c')};
      const sellerContextCache = new Map();
      let currentProductSort = ${JSON.stringify(sort || 'sku')};
      let currentProductOrder = ${JSON.stringify(order === 'desc' ? 'desc' : 'asc')};

      function selectedChecks() {
        return Array.from(document.querySelectorAll('.product-check:checked'));
      }
      function visibleProductChecks() {
        return Array.from(document.querySelectorAll('.product-check')).filter((checkbox) => {
          const row = checkbox.closest('.product-row');
          return row && !row.hidden;
        });
      }
      function updateRowSelection() {
        document.querySelectorAll('.product-row').forEach((row) => {
          const checkbox = row.querySelector('.product-check');
          row.classList.toggle('is-selected', Boolean(checkbox && checkbox.checked));
        });
      }
      function selectedStateLabel(checks, dataAttr, labels, fallback) {
        if (!checks.length) return fallback;
        const values = new Set(checks.map((checkbox) => {
          const row = checkbox.closest('.product-row');
          return row ? row.getAttribute(dataAttr) || '' : '';
        }));
        if (values.size !== 1) return fallback;
        return labels[values.values().next().value] || fallback;
      }
      function syncBulkLabels(checks) {
        const availableNeutral = document.getElementById('bulkAvailableNeutral');
        const autopricingNeutral = document.getElementById('bulkAutopricingNeutral');
        const availableSelect = document.getElementById('bulkAvailableSelect');
        const autopricingSelect = document.getElementById('bulkAutopricingSelect');
        if (availableNeutral) {
          availableNeutral.textContent = selectedStateLabel(checks, 'data-available', {
            1: 'В продаже',
            0: 'Не в продаже',
          }, 'Выставить/снять');
        }
        if (autopricingNeutral) {
          autopricingNeutral.textContent = selectedStateLabel(checks, 'data-auto-pricing', {
            1: 'Вкл авторасчет',
            0: 'Выкл авторасчет',
          }, 'Авторасчет');
        }
        if (availableSelect && !availableSelect.value) availableSelect.selectedIndex = 0;
        if (autopricingSelect && !autopricingSelect.value) autopricingSelect.selectedIndex = 0;
      }
      function syncBulkBar() {
        const checks = selectedChecks();
        const bulkBar = document.getElementById('bulkBar');
        const bulkCount = document.getElementById('bulkCount');
        const selectAll = document.getElementById('selectAll');
        if (bulkBar) bulkBar.classList.toggle('active', checks.length > 0);
        if (bulkCount) bulkCount.textContent = checks.length + ' выбрано';
        if (selectAll) {
          const all = visibleProductChecks();
          selectAll.checked = all.length > 0 && checks.length === all.length;
          selectAll.indeterminate = checks.length > 0 && checks.length < all.length;
        }
        updateRowSelection();
        syncBulkLabels(checks);
      }
      function toggleAll(source) {
        visibleProductChecks().forEach((checkbox) => {
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
      function applyProductFilters() {
        const query = String(document.getElementById('productSearch')?.value || '').trim().toLowerCase();
        const category = String(document.getElementById('categoryFilter')?.value || '');
        const available = String(document.getElementById('availableChips')?.dataset.value || '');
        let visible = 0;
        let active = 0;
        let inactive = 0;

        document.querySelectorAll('.product-row').forEach((row) => {
          const matchesSearch = !query || String(row.dataset.search || '').includes(query);
          const matchesCategory = !category || row.dataset.category === category;
          const matchesAvailable = available === '' || row.dataset.available === available;
          const show = matchesSearch && matchesCategory && matchesAvailable;
          row.hidden = !show;
          if (!show) {
            const checkbox = row.querySelector('.product-check');
            if (checkbox) checkbox.checked = false;
          }
          if (show) {
            visible += 1;
            if (row.dataset.available === '1') active += 1;
            else inactive += 1;
          }
        });

        const count = document.getElementById('productsVisibleCount');
        if (count) count.textContent = 'Показано: ' + visible + ' (' + active + ' в продаже / ' + inactive + ' не в продаже)';
        updateVisibleRowNumbers();
        syncBulkBar();
      }
      function updateVisibleRowNumbers() {
        let index = 1;
        document.querySelectorAll('.product-row').forEach((row) => {
          const numberCell = row.querySelector('.row-number');
          if (!numberCell) return;
          if (row.hidden) {
            numberCell.textContent = '';
            return;
          }
          numberCell.textContent = String(index);
          index += 1;
        });
      }
      function updateFilterUrl() {
        const params = new URLSearchParams();
        const sortInput = document.querySelector('input[name="sort"]');
        const orderInput = document.querySelector('input[name="order"]');
        if (sortInput) sortInput.value = currentProductSort || '';
        if (orderInput) orderInput.value = currentProductOrder || 'asc';
        const sort = sortInput?.value || '';
        const order = orderInput?.value || '';
        const search = document.getElementById('productSearch')?.value || '';
        const category = document.getElementById('categoryFilter')?.value || '';
        const available = document.getElementById('availableChips')?.dataset.value || '';
        if (sort) params.set('sort', sort);
        if (order) params.set('order', order);
        if (search) params.set('search', search);
        if (category) params.set('category', category);
        if (available) params.set('available', available);
        history.replaceState(null, '', '/panel/products' + (params.toString() ? '?' + params.toString() : ''));
      }
      function bindProductFilters() {
        const search = document.getElementById('productSearch');
        const category = document.getElementById('categoryFilter');
        const chips = document.getElementById('availableChips');
        const clearButton = document.getElementById('clearProductFilters');
        const run = () => {
          applyProductFilters();
          updateFilterUrl();
        };
        if (search) search.addEventListener('input', run);
        if (category) category.addEventListener('change', run);
        if (clearButton) {
          clearButton.addEventListener('click', () => {
            if (search) search.value = '';
            if (category) category.value = '';
            if (chips) {
              chips.dataset.value = '';
              chips.querySelectorAll('.filter-chip').forEach((chip) => {
                chip.classList.toggle('active', (chip.dataset.value || '') === '');
              });
            }
            run();
          });
        }
        if (chips) {
          chips.addEventListener('click', (event) => {
            const button = event.target.closest('[data-value]');
            if (!button) return;
            const current = chips.dataset.value || '';
            const next = button.dataset.value || '';
            chips.dataset.value = current === next && next !== '' ? '' : next;
            chips.querySelectorAll('.filter-chip').forEach((chip) => {
              chip.classList.toggle('active', (chip.dataset.value || '') === (chips.dataset.value || ''));
            });
            run();
          });
        }
        applyProductFilters();
      }
      function bindProductRowSelection() {
        document.querySelectorAll('.product-check').forEach((checkbox) => {
          checkbox.addEventListener('change', syncBulkBar);
        });
        document.querySelector('.table-wrap')?.addEventListener('click', (event) => {
          const row = event.target.closest('.product-row');
          if (!row || row.hidden) return;
          if (event.target.closest('a,button,input,select,textarea,label,details,summary')) return;
          const checkbox = row.querySelector('.product-check');
          if (!checkbox) return;
          checkbox.checked = !checkbox.checked;
          syncBulkBar();
        });
      }
      function bindProductSorting() {
        document.querySelectorAll('[data-product-sort]').forEach((button) => {
          button.addEventListener('click', () => sortProductRows(button.dataset.productSort || 'sku'));
        });
        updateSortHeaders();
      }
      function applyCurrentProductSort() {
        const tbody = document.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('.product-row'));
        rows.sort((a, b) => compareProductRows(a, b, currentProductSort, currentProductOrder));
        rows.forEach((row) => tbody.appendChild(row));
        updateSortHeaders();
      }
      function sortProductRows(column) {
        currentProductOrder = currentProductSort === column && currentProductOrder === 'asc' ? 'desc' : 'asc';
        currentProductSort = column;
        const tbody = document.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('.product-row'));
        rows.sort((a, b) => compareProductRows(a, b, column, currentProductOrder));
        rows.forEach((row) => tbody.appendChild(row));
        updateSortHeaders();
        updateFilterUrl();
        applyProductFilters();
      }
      function compareProductRows(a, b, column, order) {
        const left = productSortValue(a, column);
        const right = productSortValue(b, column);
        let result = 0;
        if (typeof left === 'number' && typeof right === 'number') {
          result = left - right;
        } else {
          result = String(left).localeCompare(String(right), 'ru', { numeric: true, sensitivity: 'base' });
        }
        return order === 'desc' ? -result : result;
      }
      function productSortValue(row, column) {
        const raw = row.getAttribute('data-sort-' + column) || '';
        if (['available', 'auto_pricing_enabled', 'upload_price', 'first_place_price', 'my_position', 'price_updated_at'].includes(column)) {
          const number = Number(raw);
          return Number.isFinite(number) ? number : 0;
        }
        return raw;
      }
      function updateSortHeaders() {
        document.querySelectorAll('[data-product-sort]').forEach((button) => {
          const column = button.dataset.productSort || '';
          const th = button.closest('th');
          const isActive = column === currentProductSort;
          if (th) {
            th.classList.toggle('asc', isActive && currentProductOrder === 'asc');
            th.classList.toggle('desc', isActive && currentProductOrder === 'desc');
          }
          button.setAttribute('aria-sort', isActive ? (currentProductOrder === 'asc' ? 'ascending' : 'descending') : 'none');
        });
      }
      function bindBulkValidation() {
        const form = document.getElementById('bulkForm');
        const minInput = document.getElementById('bulkMinPrice');
        const maxInput = document.getElementById('bulkMaxPrice');
        const validate = () => {
          const minRaw = minInput?.value ?? '';
          const maxRaw = maxInput?.value ?? '';
          const min = minRaw === '' ? null : Number(minRaw);
          const max = maxRaw === '' ? null : Number(maxRaw);
          let minMessage = '';
          let maxMessage = '';
          if (min !== null && min < 0) minMessage = 'Минимальная цена не может быть отрицательной.';
          if (max !== null && max < 0) maxMessage = 'Максимальная цена не может быть отрицательной.';
          if (!minMessage && !maxMessage && min !== null && max !== null && min > max) {
            minMessage = 'Минимальная цена не должна быть больше максимальной.';
            maxMessage = 'Максимальная цена не должна быть меньше минимальной.';
          }
          if (minInput) minInput.setCustomValidity(minMessage);
          if (maxInput) maxInput.setCustomValidity(maxMessage);
          return !minMessage && !maxMessage;
        };
        [minInput, maxInput].forEach((input) => input?.addEventListener('input', validate));
        form?.addEventListener('submit', (event) => {
          if (event.submitter?.hasAttribute?.('formnovalidate')) return;
          if (!validate()) {
            event.preventDefault();
            (minInput?.validationMessage ? minInput : maxInput)?.reportValidity();
          }
        }, { capture: true });
      }
      function bindBulkPreOrderSync() {
        const input = document.getElementById('bulkPreOrder');
        input?.addEventListener('input', () => {
          document.querySelectorAll('.bulk-warehouse-pre-order').forEach((warehouseInput) => {
            warehouseInput.value = input.value;
          });
        });
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

      function normalizeSellerContextId(value) {
        return String(value || '').trim();
      }

      function sellerContextOwnIds() {
        return new Set((Array.isArray(sellerContextConfig.ownMerchantIds) ? sellerContextConfig.ownMerchantIds : [])
          .map(normalizeSellerContextId)
          .filter(Boolean));
      }

      function formatSellerContextPrice(value) {
        const amount = Number(value || 0);
        return amount ? amount.toLocaleString('ru-RU') + ' ₸' : '—';
      }

      function escapeClientHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function findSellerContextIndex(rows) {
        const primaryId = normalizeSellerContextId(sellerContextConfig.merchantId);
        if (primaryId) {
          const primaryIndex = rows.findIndex((row) => normalizeSellerContextId(row.seller.merchant_id) === primaryId);
          if (primaryIndex >= 0) return primaryIndex;
        }
        const ownIds = sellerContextOwnIds();
        if (!ownIds.size) return -1;
        return rows.findIndex((row) => ownIds.has(normalizeSellerContextId(row.seller.merchant_id)));
      }

      function renderSellerContextRow(row) {
        const seller = row.seller || {};
        const sellerId = normalizeSellerContextId(seller.merchant_id);
        const primaryId = normalizeSellerContextId(sellerContextConfig.merchantId);
        const ownIds = sellerContextOwnIds();
        const isOwn = sellerId && ownIds.has(sellerId);
        const meta = ['#' + row.position];
        if (sellerId) meta.push('ID: ' + sellerId);
        if (seller.merchant_rating) meta.push('Рейтинг: ' + seller.merchant_rating);
        if (seller.merchant_reviews_quantity) meta.push(seller.merchant_reviews_quantity + ' отз.');
        if (seller.delivery_type) meta.push(String(seller.delivery_type));
        return '<div class="seller-row' + (isOwn ? ' is-me' : '') + '">'
          + '<div>'
          + '<div class="seller-name">' + escapeClientHtml(seller.merchant_name || seller.merchant_id || '—')
          + (isOwn ? ' <span class="badge badge--green">' + escapeClientHtml(sellerId === primaryId ? 'Вы' : 'свой ID') + '</span>' : '')
          + '</div>'
          + '<div class="seller-meta">' + escapeClientHtml(meta.join(' • ')) + '</div>'
          + '</div>'
          + '<div class="seller-price">' + escapeClientHtml(formatSellerContextPrice(seller.price)) + '</div>'
          + '</div>';
      }

      function renderSellerContextBody(sellers) {
        const body = document.getElementById('sellerContextBody');
        const meta = document.getElementById('sellerContextMeta');
        if (!body || !meta) return;
        const rows = (Array.isArray(sellers) ? sellers : []).map((seller, index) => ({
          seller,
          position: index + 1,
        }));
        if (!rows.length) {
          meta.textContent = '';
          body.innerHTML = '<p class="text-muted" style="margin:0">Данных по продавцам пока нет. Они появятся после формирования карточки.</p>';
          return;
        }
        const myIndex = findSellerContextIndex(rows);
        const visibleRows = myIndex >= 0 ? rows.slice(0, myIndex + 4) : rows.slice(0, 5);
        if (myIndex >= 0) {
          meta.textContent = 'Ваша позиция: ' + (myIndex + 1) + ' из ' + rows.length + '. Показаны продавцы до вас и 3 после.';
        } else {
          const merchantId = normalizeSellerContextId(sellerContextConfig.merchantId);
          meta.textContent = merchantId
            ? 'Merchant ID ' + merchantId + ' не найден среди продавцов. Показаны первые 5.'
            : 'Merchant ID не задан. Показаны первые 5.';
        }
        body.innerHTML = visibleRows.map(renderSellerContextRow).join('');
      }

      function closeSellerContextModal() {
        const modal = document.getElementById('sellerContextModal');
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
      }

      async function openSellerContextModal(trigger) {
        const modal = document.getElementById('sellerContextModal');
        const title = document.getElementById('sellerContextTitle');
        const meta = document.getElementById('sellerContextMeta');
        const body = document.getElementById('sellerContextBody');
        const sku = trigger && trigger.dataset ? trigger.dataset.sku : '';
        if (!modal || !title || !meta || !body || !sku) return;
        title.textContent = trigger.dataset.title || sku;
        meta.textContent = 'SKU: ' + sku;
        body.innerHTML = '<p class="text-muted" style="margin:0">Загрузка продавцов...</p>';
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        try {
          if (!sellerContextCache.has(sku)) {
            const response = await fetch('/api/products/' + encodeURIComponent(sku) + '/sellers', {
              credentials: 'same-origin',
              headers: { Accept: 'application/json', 'X-Kaspi-Async': '1' },
            });
            if (!response.ok) {
              let message = 'Не удалось загрузить продавцов.';
              try {
                const errorPayload = await response.json();
                message = errorPayload.error || message;
              } catch {}
              throw new Error(message);
            }
            sellerContextCache.set(sku, await response.json());
          }
          renderSellerContextBody(sellerContextCache.get(sku));
        } catch (error) {
          meta.textContent = '';
          body.innerHTML = '<p class="text-muted" style="margin:0">' + escapeClientHtml(error.message || 'Не удалось загрузить продавцов.') + '</p>';
        }
      }

      document.addEventListener('DOMContentLoaded', () => {
        syncBulkBar();
        bindProductFilters();
        bindProductRowSelection();
        bindProductSorting();
        applyCurrentProductSort();
        applyProductFilters();
        bindBulkValidation();
        bindBulkPreOrderSync();
      });
      document.addEventListener('click', (event) => {
        const sellerTrigger = event.target.closest('[data-seller-context-trigger]');
        if (sellerTrigger) {
          event.preventDefault();
          openSellerContextModal(sellerTrigger);
          return;
        }
        if (event.target.closest('[data-close-seller-context]') || event.target.id === 'sellerContextModal') {
          closeSellerContextModal();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeSellerContextModal();
      });
      document.addEventListener('click', (event) => {
        if (!selectedChecks().length) return;
        if (event.target.closest('#bulkBar, .product-check, .product-select-all, .table-wrap, .product-filter-bar')) return;
        document.querySelectorAll('.product-check').forEach((checkbox) => {
          checkbox.checked = false;
        });
        syncBulkBar();
      });
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
          <span class="badge ${running ? 'badge--blue badge--pulse' : state?.enabled ? 'badge--green' : 'badge--gray'}">${running ? 'В работе' : state?.enabled ? 'Авто включен' : 'Авто выключен'}</span>
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
      <div class="warehouse-line bulk-warehouse-line is-open">
        <input name="bulkStoreId[]" type="hidden" value="${escapeAttr(defaultStoreId(shortId, merchantId) || fullId)}">
        <div class="warehouse-line__head">
          <div>
            <h4 class="warehouse-card__title">${escapeHtml(shortId)}</h4>
            <div class="cell-sub">Склад Kaspi</div>
          </div>
        </div>
        <div class="warehouse-line__fields">
          <div class="form-group">
            <label class="form-label">Состояние</label>
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
            <label class="number-with-suffix">
              <input class="form-input form-input--sm bulk-warehouse-pre-order" name="bulkWarehousePreOrder[]" type="number" min="0" max="30" placeholder="0-30">
              <span>дней</span>
            </label>
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

function sortLink(column, label, currentSort, currentOrder, search, availableFilter, categoryFilter) {
  const classes = ['sortable'];
  if (currentSort === column) {
    classes.push(currentOrder);
  }
  return `<th class="${classes.join(' ')}"><button class="sort-button" type="button" data-product-sort="${escapeAttr(column)}">${escapeHtml(label)}</button></th>`;
}

function renderWarehouseSummary(warehouses) {
  if (!warehouses.length) return '—';
  return warehouses.slice(0, 3).map((warehouse) => {
    const enabled = Number(warehouse.enabled) === 1;
    const stock = Number(warehouse.stock_count || 0);
    return `<div class="cell-sub">${escapeHtml(shortStoreId(warehouse.store_id))}: ${enabled ? stock : 'выкл'}</div>`;
  }).join('') + (warehouses.length > 3 ? `<div class="cell-sub">+${warehouses.length - 3}</div>` : '');
}

function renderFirstPlacePriceCell(product) {
  const price = Number(product.first_place_price || 0);
  if (!price) return '—';
  return `
    <button
      class="price-click"
      type="button"
      data-seller-context-trigger
      data-sku="${escapeAttr(product.sku)}"
      data-title="${escapeAttr(product.model || product.sku)}"
      title="Показать продавцов"
      style="border:0;background:none;padding:0;font:inherit"
    >${formatPrice(price)}</button>
    ${product.first_place_seller ? `<div class="cell-sub">${escapeHtml(product.first_place_seller)}</div>` : ''}
  `;
}

function emptyRow() {
  return `
    <tr>
      <td colspan="13">
        <div class="empty">
          <div class="empty__icon">
            <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
          </div>
          <div class="empty__text">Товаров пока нет</div>
          <div class="empty__action">
            <a href="/panel/xml/upload" class="btn btn--primary btn--sm">Загрузить XML</a>
          </div>
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

function uniqueIds(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function jsString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
