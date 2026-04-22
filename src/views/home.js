import { escapeAttr, escapeHtml, formatDateTime, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderHome({
  status,
  stats,
  recentLogs = [],
  automationState = {},
  latestSessions = {},
  message,
  error,
  publicFeedUrl,
} = {}) {
  const logItems = recentLogs.slice(0, 8).map((log) => `
    <div class="event-row">
      <div>
        <div class="cell-main">${escapeHtml(log.message || log.type)}</div>
        <div class="cell-sub">${escapeHtml(log.type)} • ${escapeHtml(log.status)}</div>
      </div>
      <div class="cell-sub">${escapeHtml(formatDateTime(log.created_at, { dateStyle: 'short', timeStyle: 'short' }))}</div>
    </div>
  `).join('');

  return renderLayout({
    title: 'Главная',
    activePage: 'home',
    message,
    error,
    content: `
      <section class="home-dashboard">
        <div class="home-dashboard__focus">
          <div class="home-dashboard__kicker">Каталог</div>
          <div class="home-dashboard__number">${escapeHtml(stats.total || 0)}</div>
          <div class="home-dashboard__caption">товаров под управлением korganBot</div>
        </div>
        <div class="stats home-dashboard__stats">
          ${renderStat('В продаже', stats.active, 'Активные товары', 'var(--c-success)')}
          ${renderStat('Не в продаже', stats.inactive, 'Сняты с продажи', 'var(--c-danger)')}
          ${renderStat('Склады', stats.warehouseIds.length || 0, 'Подключенные точки')}
        </div>
      </section>

      <div class="stats operation-stats">
        ${renderOperationStat('Пересчет цены', latestSessions.price)}
        ${renderOperationStat('Формирование', latestSessions.build)}
        ${renderOperationStat('Загрузка с Kaspi', latestSessions.pull)}
        ${renderOperationStat('Выгрузка в Kaspi', latestSessions.push)}
      </div>

      <div class="card card--flush">
        <div class="card__header">
          <h3 class="card__title">Уведомления</h3>
          <a class="btn btn--ghost btn--sm" href="/panel/history?tab=events">Открыть историю</a>
        </div>
        <div class="card__body">
          ${logItems || '<p class="text-muted">Логов пока нет.</p>'}
        </div>
      </div>

      ${renderDateTimeScript()}
      <script>
      (() => {
        let refreshTimer = null;
        const scheduleRefresh = () => {
          if (refreshTimer) return;
          refreshTimer = setTimeout(() => {
            location.reload();
          }, 1200);
        };

        document.addEventListener('kaspi:parse_session_updated', (event) => {
          if (event.detail && event.detail.status !== 'running') {
            scheduleRefresh();
          }
        });
        ['kaspi:sync_log_added', 'kaspi:history_event_added', 'kaspi:setting_updated']
          .forEach((eventName) => document.addEventListener(eventName, scheduleRefresh));
      })();
      </script>
    `,
  });
}

function renderStat(label, value, note = '', color = '') {
  return `
    <div class="stat">
      <div class="stat__label">${escapeHtml(label)}</div>
      <div class="stat__value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      ${note ? `<div class="stat__note">${note}</div>` : ''}
    </div>
  `;
}

function renderAutomationCard(title, enabledName, intervalName, state = {}) {
  const enabled = Boolean(state?.enabled);
  const running = Boolean(state?.running);
  const intervalMin = formatIntervalMinutes(state?.intervalMs);
  return `
    <section class="automation-card">
      <div class="automation-card__head">
        <div>
          <div class="automation-card__title">${escapeHtml(title)}</div>
          <div class="automation-card__meta">${running ? 'Выполняется' : enabled ? 'Включено' : 'Выключено'}</div>
        </div>
        <label class="toggle">
          <input type="hidden" name="${enabledName}" value="0">
          <input name="${enabledName}" type="checkbox" value="1"${enabled ? ' checked' : ''}>
          <span class="toggle__track"></span>
        </label>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Период, минут</label>
        <input class="form-input" name="${intervalName}" type="number" min="0" step="1" value="${escapeAttr(intervalMin)}">
        <div class="form-hint">${running ? 'Цикл сейчас выполняется.' : state?.nextRunAt ? `Следующий запуск: ${renderDateTime(state.nextRunAt, { dateStyle: 'short', timeStyle: 'short' })}` : 'Запусков по расписанию пока нет.'}</div>
      </div>
    </section>
  `;
}

function renderOperationStat(label, session) {
  const status = session?.status === 'running'
    ? 'В работе'
    : session?.status === 'success'
      ? 'Успех'
      : session?.status === 'partial'
        ? 'Частично'
        : session?.status === 'error'
          ? 'Ошибка'
          : 'Пока не было';
  const date = session?.finished_at || session?.started_at || '';
  const note = session
    ? `${date ? `${renderDateTime(date, { dateStyle: 'short', timeStyle: 'medium' })} • ` : ''}${escapeHtml(session.message || '—')}`
    : 'Данных пока нет';

  return renderStat(label, escapeHtml(status), note);
}

function formatIntervalMinutes(value) {
  const minutes = Number(value || 0) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  return String(Math.round(minutes));
}
