import { escapeAttr, escapeHtml, formatDateTime } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderFinancePage({
  settings,
  filters,
  summary,
  products,
  warehouses,
  customers,
  orders,
  ordersTotal,
  ordersPage,
  ordersPageCount,
  loadError = '',
  loadNotice = '',
  fetchedAt = '',
  message = '',
  error = '',
} = {}) {
  const effectiveError = error || loadError || '';
  const fetchedLabel = fetchedAt
    ? formatDateTime(fetchedAt, { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const returnTo = buildReturnTo(filters, ordersPage);

  const summaryCards = [
    statCard('Выручка', formatMoney(summary.revenue), `Заказов: ${summary.ordersCount}`),
    statCard('Прибыль', formatMoney(summary.profit), `Маржа: ${formatPercent(summary.marginPercent)}`, profitTone(summary.profit)),
    statCard('Средний чек', formatMoney(summary.averageOrderValue), `Средняя продажа: ${formatMoney(summary.averageItemValue)}`),
    statCard('Комиссия Kaspi', formatMoney(summary.commissionCost), `Налог: ${formatMoney(summary.taxCost)}`),
    statCard('Доставка и упаковка', `${formatMoney(summary.deliveryCost)} / ${formatMoney(summary.packagingCost)}`, `Закуп: ${formatMoney(summary.purchaseCost)}`),
    statCard('Товары без себестоимости', String(summary.unknownCostCount || 0), `Низкая маржа: ${summary.lowMarginCount || 0}`),
  ].join('');

  const warehouseRows = warehouses.map((warehouse) => `
    <tr>
      <td><span class="cell-main">${escapeHtml(warehouse.warehouse || '—')}</span></td>
      <td>${warehouse.ordersCount}</td>
      <td>${warehouse.quantity}</td>
      <td>${formatMoney(warehouse.revenue)}</td>
      <td>${formatMoney(warehouse.profit)}</td>
      <td style="color:${warehouse.marginPercent < 0 ? 'var(--c-danger)' : 'var(--c-success)'}">${formatPercent(warehouse.marginPercent)}</td>
    </tr>
  `).join('');

  const customerRows = customers.map((customer) => `
    <tr>
      <td>
        <div class="cell-main">${escapeHtml(customer.name || 'Покупатель')}</div>
        <div class="cell-sub">${escapeHtml(customer.phone || 'Телефон скрыт')}</div>
      </td>
      <td>${escapeHtml(customer.city || '—')}</td>
      <td>${customer.ordersCount}</td>
      <td>${formatMoney(customer.revenue)}</td>
      <td>${formatMoney(customer.profit)}</td>
    </tr>
  `).join('');

  const productRows = products.map((product) => `
    <tr>
      <td>
        <div class="cell-main">${escapeHtml(product.title || product.sku)}</div>
        <div class="cell-sub">${escapeHtml(product.sku)}</div>
        <input type="hidden" name="sku[]" value="${escapeAttr(product.sku)}">
        <input type="hidden" name="title[]" value="${escapeAttr(product.title || '')}">
      </td>
      <td>
        <div>${escapeHtml(product.rubric || '—')}</div>
        <div class="cell-sub">${escapeHtml(product.categoryTitle || '')}</div>
      </td>
      <td>${product.ordersCount}</td>
      <td>${product.quantity}</td>
      <td>${formatMoney(product.averageSalePrice)}</td>
      <td style="min-width:140px">
        <input class="form-input form-input--sm" type="number" min="0" step="1" name="purchasePrice[]" value="${escapeAttr(product.purchasePrice || 0)}">
      </td>
      <td style="min-width:120px">
        <input class="form-input form-input--sm" type="number" min="0" max="100" step="0.1" name="commissionRate[]" value="${product.commissionSource === 'manual' ? escapeAttr(product.commissionRate) : ''}" placeholder="${escapeAttr(String(product.commissionRate || ''))}">
        <div class="cell-sub">${escapeHtml(product.commissionSource === 'manual' ? 'ручная' : 'по рубрике')}</div>
      </td>
      <td>${formatMoney(product.revenue)}</td>
      <td>${formatMoney(product.purchaseCost)}</td>
      <td>${formatMoney(product.deliveryCost + product.packagingCost + product.commissionCost + product.taxCost)}</td>
      <td style="color:${product.profit < 0 ? 'var(--c-danger)' : 'var(--c-success)'}">${formatMoney(product.profit)}</td>
      <td>${escapeHtml(product.warehousesLabel || '—')}</td>
    </tr>
  `).join('');

  const orderRows = orders.map((order) => `
    <tr>
      <td>
        <div class="cell-main">${escapeHtml(order.code || order.id)}</div>
        <div class="cell-sub">${escapeHtml(formatDateTimeValue(order.creationDate))}</div>
      </td>
      <td>
        <div>${escapeHtml(order.status || '—')}</div>
        <div class="cell-sub">${escapeHtml(order.state || '—')}</div>
      </td>
      <td>
        <div>${escapeHtml(order.customerName || 'Покупатель')}</div>
        <div class="cell-sub">${escapeHtml(order.customerPhone || '')}</div>
      </td>
      <td>${escapeHtml(order.deliveryTown || '—')}</td>
      <td>${escapeHtml(order.warehouse || '—')}</td>
      <td>${order.itemsCount}</td>
      <td>${formatMoney(order.totalPrice)}</td>
      <td>${formatMoney(order.deliveryCostForSeller)}</td>
      <td style="color:${order.profit < 0 ? 'var(--c-danger)' : 'var(--c-success)'}">${formatMoney(order.profit)}</td>
    </tr>
  `).join('');

  return renderLayout({
    title: 'Финансы',
    activePage: 'finance',
    message,
    error: effectiveError,
    content: `
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Kaspi Orders API</h3>
            <div class="card__subtitle">Живой расчет прибыли по заказам, складам и товарам. Последнее обновление: ${escapeHtml(fetchedLabel)}</div>
          </div>
          <div class="session-toolbar">
            <a class="btn btn--ghost btn--sm" href="/panel/finance?${buildQueryString({ ...filters, refresh: 1, page: 1 })}">Обновить из API</a>
          </div>
        </div>
        <div class="card__body">
          ${loadNotice ? `<div class="alert alert--success" style="margin-bottom:16px">${escapeHtml(loadNotice)}</div>` : ''}
          <div class="stats finance-summary">${summaryCards}</div>
          <div class="form-hint">Формула прибыли: продажа − закуп − упаковка (${escapeHtml(String(settings.packagingPercent))}%) − доставка клиенту − комиссия Kaspi − налог (${escapeHtml(String(settings.taxPercent))}%).</div>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Фильтры заказов</h3>
            <div class="card__subtitle">Можно смотреть день, неделю, месяц или свой интервал. Для длинных периодов запросы режутся на окна по 14 дней автоматически.</div>
          </div>
        </div>
        <div class="card__body">
          <form method="get" action="/panel/finance" class="compact-filter-form">
            <div class="compact-filter-grid">
              <div class="form-group">
                <label class="form-label">Период</label>
                <select class="form-select" name="period">
                  ${renderOption(filters.period, 'today', 'Сегодня')}
                  ${renderOption(filters.period, '7d', '7 дней')}
                  ${renderOption(filters.period, '14d', '14 дней')}
                  ${renderOption(filters.period, '30d', '30 дней')}
                  ${renderOption(filters.period, '90d', '90 дней')}
                  ${renderOption(filters.period, 'custom', 'Свой период')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Дата от</label>
                <input class="form-input" type="date" name="from" value="${escapeAttr(filters.from || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Дата до</label>
                <input class="form-input" type="date" name="to" value="${escapeAttr(filters.to || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Статус</label>
                <input class="form-input" list="kaspi-status-list" name="status" value="${escapeAttr(filters.status || '')}" placeholder="Например, COMPLETED">
              </div>
              <div class="form-group">
                <label class="form-label">Состояние</label>
                <input class="form-input" list="kaspi-state-list" name="state" value="${escapeAttr(filters.state || '')}" placeholder="Например, ARCHIVE">
              </div>
              <div class="form-group">
                <label class="form-label">Заказов на странице</label>
                <select class="form-select" name="pageSize">
                  ${renderOption(String(filters.pageSize), '25', '25')}
                  ${renderOption(String(filters.pageSize), '50', '50')}
                  ${renderOption(String(filters.pageSize), '100', '100')}
                </select>
              </div>
            </div>
            <div class="form-actions compact-filter-actions">
              <button class="btn btn--primary" type="submit">Показать отчет</button>
              <a class="btn btn--ghost" href="/panel/finance">Сбросить</a>
            </div>
            <datalist id="kaspi-status-list">
              <option value="COMPLETED"></option>
              <option value="APPROVED_BY_BANK"></option>
              <option value="ACCEPTED_BY_MERCHANT"></option>
              <option value="ASSEMBLED"></option>
              <option value="KASPI_DELIVERY"></option>
              <option value="CANCELLED"></option>
            </datalist>
            <datalist id="kaspi-state-list">
              <option value="NEW"></option>
              <option value="ARCHIVE"></option>
            </datalist>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Настройки финансов</h3>
            <div class="card__subtitle">Токен можно обновить здесь же. Если поле токена пустое, текущий сохраненный токен не трогаем.</div>
          </div>
        </div>
        <div class="card__body">
          <form method="post" action="/panel/finance/settings">
            <div class="compact-filter-grid">
              <div class="form-group">
                <label class="form-label">Kaspi API токен</label>
                <input class="form-input" type="password" name="apiToken" value="" placeholder="${escapeAttr(settings.tokenMasked || 'Не задан')}">
                <div class="form-hint">${settings.tokenConfigured ? 'Токен сохранен и скрыт.' : 'Сейчас токен не настроен.'}</div>
              </div>
              <div class="form-group">
                <label class="form-label">Упаковка, %</label>
                <input class="form-input" type="number" min="0" max="100" step="0.1" name="packagingPercent" value="${escapeAttr(settings.packagingPercent)}">
              </div>
              <div class="form-group">
                <label class="form-label">Налог, %</label>
                <input class="form-input" type="number" min="0" max="100" step="0.1" name="taxPercent" value="${escapeAttr(settings.taxPercent)}">
              </div>
              <div class="form-group">
                <label class="form-label">Период по умолчанию</label>
                <select class="form-select" name="defaultPeriod">
                  ${renderOption(settings.defaultPeriod, 'today', 'Сегодня')}
                  ${renderOption(settings.defaultPeriod, '7d', '7 дней')}
                  ${renderOption(settings.defaultPeriod, '14d', '14 дней')}
                  ${renderOption(settings.defaultPeriod, '30d', '30 дней')}
                  ${renderOption(settings.defaultPeriod, '90d', '90 дней')}
                </select>
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить настройки</button>
            </div>
          </form>
        </div>
      </div>

      <div class="finance-side-grid">
        <div class="card" style="margin-bottom:0">
          <div class="card__header">
            <h3 class="card__title">Распределение по складам</h3>
          </div>
          <div class="card__body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Склад</th>
                    <th>Заказы</th>
                    <th>Штук</th>
                    <th>Выручка</th>
                    <th>Прибыль</th>
                    <th>Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  ${warehouseRows || '<tr><td colspan="6"><div class="empty"><div class="empty__text">Нет данных за выбранный период</div></div></td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:0">
          <div class="card__header">
            <h3 class="card__title">Клиенты</h3>
          </div>
          <div class="card__body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Покупатель</th>
                    <th>Город</th>
                    <th>Заказы</th>
                    <th>Выручка</th>
                    <th>Прибыль</th>
                  </tr>
                </thead>
                <tbody>
                  ${customerRows || '<tr><td colspan="5"><div class="empty"><div class="empty__text">Нет данных по клиентам</div></div></td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Прибыль по товарам</h3>
            <div class="card__subtitle">Цена закупа уже должна быть с учетом твоей входящей доставки. Если комиссия не указана вручную, берем ее по рубрике автоматически.</div>
          </div>
        </div>
        <div class="card__body">
          <form method="post" action="/panel/finance/products/save">
            <input type="hidden" name="returnTo" value="${escapeAttr(returnTo)}">
            <div class="form-actions form-actions--flush" style="margin-bottom:14px">
              <button class="btn btn--primary" type="submit">Сохранить себестоимость и комиссии</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Рубрика</th>
                    <th>Заказы</th>
                    <th>Штук</th>
                    <th>Средняя цена</th>
                    <th>Закуп за 1 шт</th>
                    <th>Комиссия, %</th>
                    <th>Выручка</th>
                    <th>Закуп</th>
                    <th>Прочие траты</th>
                    <th>Прибыль</th>
                    <th>Склады</th>
                  </tr>
                </thead>
                <tbody>
                  ${productRows || '<tr><td colspan="12"><div class="empty"><div class="empty__text">Нет продаж по выбранным фильтрам</div></div></td></tr>'}
                </tbody>
              </table>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Заказы Kaspi (${ordersTotal})</h3>
            <div class="card__subtitle">Статус, состояние, клиент, склад, сумма и рассчитанная прибыль по каждому заказу.</div>
          </div>
          <div class="session-toolbar">
            ${renderPagination(filters, ordersPage, ordersPageCount)}
          </div>
        </div>
        <div class="card__body">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Статус</th>
                  <th>Клиент</th>
                  <th>Город</th>
                  <th>Склад</th>
                  <th>Штук</th>
                  <th>Сумма</th>
                  <th>Доставка продавца</th>
                  <th>Прибыль</th>
                </tr>
              </thead>
              <tbody>
                ${orderRows || '<tr><td colspan="9"><div class="empty"><div class="empty__text">Нет заказов за этот период</div></div></td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `,
  });
}

function statCard(label, value, note, tone = '') {
  return `
    <div class="stat ${tone}">
      <div class="stat__label">${escapeHtml(label)}</div>
      <div class="stat__value">${escapeHtml(value)}</div>
      <div class="stat__note">${escapeHtml(note)}</div>
    </div>
  `;
}

function renderOption(current, value, label) {
  return `<option value="${escapeAttr(value)}"${String(current || '') === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₸`;
}

function formatPercent(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatDateTimeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toLocaleString('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Almaty',
    });
  }

  return formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' });
}

function profitTone(value) {
  return Number(value || 0) < 0 ? 'stat--danger' : '';
}

function buildReturnTo(filters, page) {
  return `/panel/finance?${buildQueryString({
    ...filters,
    page,
  })}`;
}

function buildQueryString(input = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === '' || value === false) continue;
    if (key === 'dateFromMs' || key === 'dateToMs') continue;
    if (key === 'refresh' && value !== 1 && value !== '1') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function renderPagination(filters, page, pageCount) {
  if (pageCount <= 1) return '';

  const links = [];
  if (page > 1) {
    links.push(`<a class="btn btn--ghost btn--sm" href="/panel/finance?${buildQueryString({ ...filters, page: page - 1 })}">Назад</a>`);
  }
  links.push(`<span class="form-hint">Страница ${page} / ${pageCount}</span>`);
  if (page < pageCount) {
    links.push(`<a class="btn btn--ghost btn--sm" href="/panel/finance?${buildQueryString({ ...filters, page: page + 1 })}">Вперед</a>`);
  }
  return links.join('');
}
