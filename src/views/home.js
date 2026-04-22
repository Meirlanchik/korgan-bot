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
          ${renderStat('В продаже', stats.active, 'Активные товары', 'var(--c-success)', '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>')}
          ${renderStat('Не в продаже', stats.inactive, 'Сняты с продажи', 'var(--c-danger)', '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>')}
          ${renderStat('Склады', stats.warehouseIds.length || 0, 'Подключенные точки', 'var(--c-accent)', '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>')}
        </div>
      </section>

      <div class="stats operation-stats">
        ${renderOperationStat('Пересчет цены', latestSessions.price, '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>')}
        ${renderOperationStat('Формирование', latestSessions.build, '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>')}
        ${renderOperationStat('Загрузка с Kaspi', latestSessions.pull, '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>')}
        ${renderOperationStat('Выгрузка в Kaspi', latestSessions.push, '<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>')}
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

function renderStat(label, value, note = '', color = '', icon = '') {
  return `
    <div class="stat">
      ${icon ? `<div class="stat__icon" style="color:${color || 'var(--c-accent)'};margin-bottom:8px">${icon}</div>` : ''}
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

function renderOperationStat(label, session, icon = '') {
  const status = session?.status === 'running'
    ? 'В работе'
    : session?.status === 'success'
      ? 'Успех'
      : session?.status === 'partial'
        ? 'Частично'
        : session?.status === 'error'
          ? 'Ошибка'
          : 'Пока не было';
  const statusColor = session?.status === 'success'
    ? 'var(--c-success)'
    : session?.status === 'running'
      ? 'var(--c-accent)'
      : session?.status === 'partial'
        ? 'var(--c-warning)'
        : session?.status === 'error'
          ? 'var(--c-danger)'
          : 'var(--c-text-muted)';
  const date = session?.finished_at || session?.started_at || '';
  const note = session
    ? `${date ? `${renderDateTime(date, { dateStyle: 'short', timeStyle: 'medium' })} • ` : ''}${escapeHtml(session.message || '—')}`
    : 'Данных пока нет';

  return renderStat(label, escapeHtml(status), note, statusColor, icon);
}

function formatIntervalMinutes(value) {
  const minutes = Number(value || 0) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  return String(Math.round(minutes));
}
