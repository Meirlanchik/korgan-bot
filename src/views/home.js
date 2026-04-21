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
      <div class="stats">
        ${renderStat('В продаже', stats.active, `Не в продаже: ${stats.inactive}`, 'var(--c-success)')}
        ${renderStat('Всего товаров', stats.total, `Складов: ${stats.warehouseIds.length || 0}`)}
        ${renderStat('XML обновлен', status.updatedAt ? renderDateTime(status.updatedAt, { dateStyle: 'short', timeStyle: 'short' }) : '—', `Компания: ${escapeHtml(status.company || '—')}`)}
        ${renderStat('Публичная ссылка', `<a href="${escapeAttr(publicFeedUrl)}" target="_blank" rel="noreferrer">${escapeHtml(publicFeedUrl)}</a>`, 'Лента доступна для Kaspi')}
      </div>

      <form method="post" action="/panel/settings/automation">
        <input type="hidden" name="returnTo" value="/panel/">
        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Быстрое управление автоматизацией</h3>
              <div class="card__subtitle">Здесь можно сразу включать и выключать автозагрузку, автовыгрузку, автоформирование и авторасчет цены.</div>
            </div>
            <a class="btn btn--ghost btn--sm" href="/panel/settings">Подробные настройки</a>
          </div>
          <div class="card__body">
            <div class="automation-grid">
              ${renderAutomationCard('Авторасчет цены', 'autoPricingEnabled', 'autoPricingIntervalMin', automationState.autoPricing)}
              ${renderAutomationCard('Автоформирование', 'fullParseEnabled', 'fullParseIntervalMin', automationState.fullParse)}
              ${renderAutomationCard('Автозагрузка с Kaspi', 'kaspiPullEnabled', 'kaspiPullIntervalMin', automationState.kaspiPull)}
              ${renderAutomationCard('Автовыгрузка в Kaspi', 'kaspiPushEnabled', 'kaspiPushIntervalMin', automationState.kaspiPush)}
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить</button>
            </div>
          </div>
        </div>
      </form>

      <div class="stats">
        ${renderOperationStat('Пересчет цены', latestSessions.price)}
        ${renderOperationStat('Формирование', latestSessions.build)}
        ${renderOperationStat('Загрузка с Kaspi', latestSessions.pull)}
        ${renderOperationStat('Выгрузка в Kaspi', latestSessions.push)}
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Ручные действия</h3>
            <div class="card__subtitle">Быстрые кнопки для импорта, выгрузки и пакетных операций по товарам.</div>
          </div>
        </div>
        <div class="card__body">
          <div class="quick-actions">
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

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Магазин</h3>
            <div class="card__subtitle">Merchant ID не дублируется в настройках, но здесь его можно проверить и поправить при необходимости.</div>
          </div>
        </div>
        <div class="card__body">
          <form action="/panel/settings/general" method="post">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Merchant ID</label>
                <input class="form-input" name="merchantId" type="text" value="${escapeAttr(stats.merchantId || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Название магазина</label>
                <input class="form-input" name="merchantName" type="text" value="${escapeAttr(stats.merchantName || '')}" placeholder="Например, BOT">
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить данные магазина</button>
            </div>
          </form>
        </div>
      </div>

      <div class="card card--flush">
        <div class="card__header">
          <h3 class="card__title">Последние события</h3>
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
  const note = session
    ? `${escapeHtml(session.message || '') || '—'}`
    : 'Сессии появятся после первого запуска';

  return renderStat(label, escapeHtml(status), note);
}

function formatIntervalMinutes(value) {
  const minutes = Number(value || 0) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  return String(Math.round(minutes));
}
