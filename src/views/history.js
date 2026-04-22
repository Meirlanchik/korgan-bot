import { escapeAttr, escapeHtml, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderHistoryPage({
  events = [],
  sessions = [],
  filters = {},
  message = '',
  error = '',
} = {}) {
  const activeTab = filters.tab === 'sessions' ? 'sessions' : 'events';
  const eventRows = events.map(renderEventRow).join('');
  const sessionRows = sessions.map(renderSessionRow).join('');

  return renderLayout({
    title: 'История',
    activePage: 'history',
    message,
    error,
    content: `
      <div class="tabs">
        <a class="tab ${activeTab === 'sessions' ? 'active' : ''}" href="/panel/history?tab=sessions">Сессии</a>
        <a class="tab ${activeTab === 'events' ? 'active' : ''}" href="/panel/history?tab=events">События</a>
      </div>

      <div class="tab-content active">
        ${activeTab === 'events' ? renderEventsBlock({ events, filters, rows: eventRows }) : renderSessionsBlock({ sessions, filters, rows: sessionRows })}
      </div>

      ${renderDateTimeScript()}
      <script>
      (() => {
        let refreshTimer = null;
        const activeTab = ${JSON.stringify(activeTab)};
        const scheduleRefresh = () => {
          if (refreshTimer) return;
          refreshTimer = setTimeout(() => {
            location.reload();
          }, 900);
        };

        if (activeTab === 'events') {
          ['kaspi:history_event_added', 'kaspi:sync_log_added']
            .forEach((eventName) => document.addEventListener(eventName, scheduleRefresh));
        } else {
          document.addEventListener('kaspi:parse_session_updated', (event) => {
            if (event.detail && event.detail.status !== 'running') {
              scheduleRefresh();
            }
          });
        }
      })();
      </script>
    `,
  });
}

function renderEventsBlock({ events, filters, rows }) {
  return `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">События по товарам</h3>
          <div class="card__subtitle">Формирование, пересчет цены, импорт и синхронизация по каждому товару.</div>
        </div>
      </div>
      <div class="card__body">
        <form method="get" action="/panel/history" class="compact-filter-form">
          <input type="hidden" name="tab" value="events">
          <div class="compact-filter-grid">
            <div class="form-group">
              <label class="form-label">Тип события</label>
              <select class="form-select" name="eventType">
                ${renderOption(filters.eventType, '', 'Все события')}
                ${renderOption(filters.eventType, 'full_parse', 'Формирование')}
                ${renderOption(filters.eventType, 'light_parse', 'Пересчет цены')}
                ${renderOption(filters.eventType, 'catalog_import', 'Импорт')}
                ${renderOption(filters.eventType, 'catalog_update', 'Обновление каталога')}
                ${renderOption(filters.eventType, 'kaspi_sync', 'Синхронизация Kaspi')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Статус</label>
              <select class="form-select" name="eventStatus">
                ${renderOption(filters.eventStatus, '', 'Любой')}
                ${renderOption(filters.eventStatus, 'success', 'Успех')}
                ${renderOption(filters.eventStatus, 'error', 'Ошибка')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">SKU или текст</label>
              <input class="form-input" type="text" name="eventSearch" value="${escapeAttr(filters.eventSearch || '')}" placeholder="Например, 105988073">
            </div>
          </div>
          <div class="form-actions compact-filter-actions">
            <button class="btn btn--primary" type="submit">Фильтровать</button>
            <a class="btn btn--ghost" href="/panel/history?tab=events">Сбросить</a>
          </div>
        </form>
      </div>
    </div>

    <div class="card card--flush">
      <div class="card__header">
        <h3 class="card__title">Лента событий</h3>
        <span class="text-sm text-muted">Последние ${events.length}</span>
      </div>
      ${events.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>SKU</th>
              <th>Тип</th>
              <th>Статус</th>
              <th>Цены</th>
              <th>Сообщение</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : `
      <div class="session-empty">
        <div class="session-empty__title">Событий пока нет</div>
        <div>Когда начнутся формирования карточек, пересчеты цен и импорты, они появятся здесь.</div>
      </div>`}
    </div>
  `;
}

function renderSessionsBlock({ sessions, filters, rows }) {
  return `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Сессии операций</h3>
          <div class="card__subtitle">Все пакетные загрузки, пересчеты, формирования и выгрузки. Активные сессии тоже видны здесь.</div>
        </div>
      </div>
      <div class="card__body">
        <form method="get" action="/panel/history" class="compact-filter-form">
          <input type="hidden" name="tab" value="sessions">
          <div class="compact-filter-grid">
            <div class="form-group">
              <label class="form-label">Тип сессии</label>
              <select class="form-select" name="sessionType">
                ${renderOption(filters.sessionType, '', 'Все сессии')}
                ${renderOption(filters.sessionType, 'light_parse', 'Пересчет цены')}
                ${renderOption(filters.sessionType, 'auto_pricing', 'Пересчет цены (старый тип)')}
                ${renderOption(filters.sessionType, 'full_parse', 'Формирование')}
                ${renderOption(filters.sessionType, 'selected_products', 'Формирование выбранных')}
                ${renderOption(filters.sessionType, 'single_product', 'Формирование одного товара')}
                ${renderOption(filters.sessionType, 'kaspi_download', 'Загрузка с Kaspi')}
                ${renderOption(filters.sessionType, 'kaspi_upload', 'Выгрузка в Kaspi')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Статус</label>
              <select class="form-select" name="sessionStatus">
                ${renderOption(filters.sessionStatus, '', 'Любой')}
                ${renderOption(filters.sessionStatus, 'running', 'В работе')}
                ${renderOption(filters.sessionStatus, 'success', 'Успех')}
                ${renderOption(filters.sessionStatus, 'partial', 'Частично')}
                ${renderOption(filters.sessionStatus, 'error', 'Ошибка')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Источник</label>
              <select class="form-select" name="sessionSource">
                ${renderOption(filters.sessionSource, '', 'Любой')}
                ${renderOption(filters.sessionSource, 'manual', 'Ручной')}
                ${renderOption(filters.sessionSource, 'auto', 'Авто')}
                ${renderOption(filters.sessionSource, 'import', 'Импорт')}
              </select>
            </div>
          </div>
          <div class="form-actions compact-filter-actions">
            <button class="btn btn--primary" type="submit">Фильтровать</button>
            <a class="btn btn--ghost" href="/panel/history?tab=sessions">Сбросить</a>
          </div>
        </form>
        <form action="/panel/parse-sessions/clear" method="post" style="margin-top:12px" onsubmit="return confirm('Очистить завершенные сессии?')">
          <input type="hidden" name="type" value="${escapeAttr(filters.sessionType || '')}">
          <input type="hidden" name="triggerSource" value="${escapeAttr(filters.sessionSource || '')}">
          <button class="btn btn--ghost" type="submit">Очистить завершенные</button>
        </form>
      </div>
    </div>

    <div class="card card--flush">
      <div class="card__header">
        <h3 class="card__title">Журнал сессий</h3>
        <span class="text-sm text-muted">Последние ${sessions.length}</span>
      </div>
      ${sessions.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Сессия</th>
              <th>Статус</th>
              <th>Прогресс</th>
              <th>Время</th>
              <th>Длительность</th>
              <th>Итог</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : `
      <div class="session-empty">
        <div class="session-empty__title">Сессий пока нет</div>
        <div>После первого запуска пакетной операции история сессий появится здесь.</div>
      </div>`}
    </div>
  `;
}

function renderEventRow(event) {
  const oldPrice = Number(event.old_upload_price || 0);
  const newPrice = Number(event.new_upload_price || 0);

  return `
    <tr>
      <td>${renderDateTime(event.created_at, { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><a class="cell-main" href="/panel/products/${encodeURIComponent(event.sku)}">${escapeHtml(event.sku)}</a></td>
      <td>${escapeHtml(eventTypeLabel(event.event_type))}</td>
      <td>${statusBadge(event.status)}</td>
      <td>${oldPrice || newPrice ? `${formatPrice(oldPrice)} → ${formatPrice(newPrice)}` : '—'}</td>
      <td>
        <div>${escapeHtml(event.message || '—')}</div>
        <div class="cell-sub">${escapeHtml(event.trigger_source || 'manual')}</div>
      </td>
    </tr>
  `;
}

function renderSessionRow(session) {
  const total = Number(session.total_count || 0);
  const processed = Number(session.success_count || 0) + Number(session.error_count || 0);
  const percent = total ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : (session.status === 'running' ? 0 : 100);

  return `
    <tr>
      <td>
        <a class="session-link" href="/panel/parse-sessions/${encodeURIComponent(session.id)}">
          <div class="cell-main">#${escapeHtml(session.id)} ${escapeHtml(sessionTypeLabel(session.type))}</div>
          <div class="cell-sub">${escapeHtml(session.trigger_source || 'manual')}</div>
        </a>
      </td>
      <td>${statusBadge(session.status)}</td>
      <td>
        <div class="session-progress">
          <div class="session-progress__head">
            <span>${processed}/${total || processed}</span>
            <span>${percent}%</span>
          </div>
          <div class="session-progress__bar">
            <div class="session-progress__fill" style="width:${percent}%"></div>
          </div>
        </div>
      </td>
      <td>
        <div>Старт: ${renderDateTime(session.started_at, { dateStyle: 'medium', timeStyle: 'medium' })}</div>
        <div class="cell-sub">${session.finished_at ? `Финиш: ${renderDateTime(session.finished_at, { dateStyle: 'medium', timeStyle: 'medium' })}` : 'В работе'}</div>
      </td>
      <td>${escapeHtml(formatDuration(session))}</td>
      <td style="min-width:280px">${escapeHtml(session.message || '—')}</td>
    </tr>
  `;
}

function renderOption(currentValue, value, label) {
  return `<option value="${escapeAttr(value)}"${String(currentValue || '') === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function eventTypeLabel(value) {
  const map = {
    full_parse: 'Формирование',
    light_parse: 'Пересчет цены',
    catalog_import: 'Импорт',
    catalog_update: 'Обновление каталога',
    kaspi_sync: 'Синхронизация Kaspi',
  };
  return map[value] || value || 'Событие';
}

function sessionTypeLabel(value) {
  const map = {
    light_parse: 'Пересчет цены',
    auto_pricing: 'Пересчет цены',
    full_parse: 'Формирование',
    selected_products: 'Формирование',
    single_product: 'Формирование товара',
    kaspi_download: 'Загрузка с Kaspi',
    kaspi_upload: 'Выгрузка в Kaspi',
  };
  return map[value] || value || 'Сессия';
}

function statusBadge(status) {
  if (status === 'success') return '<span class="badge badge--green">Успех</span>';
  if (status === 'running') return '<span class="badge badge--blue badge--pulse">В работе</span>';
  if (status === 'partial') return '<span class="badge badge--warning">Частично</span>';
  if (status === 'aborted') return '<span class="badge badge--gray">Остановлена</span>';
  return '<span class="badge badge--red">Ошибка</span>';
}

function formatPrice(value) {
  const amount = Number(value || 0);
  if (!amount) return '—';
  return `${amount.toLocaleString('ru-RU')} ₸`;
}

function formatDuration(session = {}) {
  let ms = Number(session.duration_ms || 0);
  if (!ms && session.started_at) {
    const started = new Date(session.started_at).getTime();
    const finished = session.finished_at ? new Date(session.finished_at).getTime() : Date.now();
    if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
      ms = finished - started;
    }
  }
  if (!ms) return '—';
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 1) return `${restSeconds} сек`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return hours ? `${hours} ч ${restMinutes} мин` : `${minutes} мин ${restSeconds} сек`;
}
