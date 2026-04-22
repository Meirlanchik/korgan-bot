import { escapeAttr, escapeHtml, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderSettingsPage({
  automationState = {},
  concurrency = '4',
  message = '',
  error = '',
} = {}) {
  const cards = [
    renderAutomationCard('Авторасчет цены', 'autoPricingEnabled', 'autoPricingIntervalMin', automationState.autoPricing),
    renderAutomationCard('Автоформирование', 'fullParseEnabled', 'fullParseIntervalMin', automationState.fullParse),
    renderAutomationCard('Автозагрузка с Kaspi', 'kaspiPullEnabled', 'kaspiPullIntervalMin', automationState.kaspiPull),
    renderAutomationCard('Автовыгрузка в Kaspi', 'kaspiPushEnabled', 'kaspiPushIntervalMin', automationState.kaspiPush),
  ].join('');

  return renderLayout({
    title: 'Настройки',
    activePage: 'settings',
    message,
    error,
    content: `
      <div class="settings-grid">
        <section class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Kaspi и XML</h3>
              <div class="card__subtitle">Ручные действия собраны здесь, чтобы вкладка товаров оставалась чистой.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="quick-actions" style="margin-top:0">
              <form action="/panel/kaspi/download" method="post" data-async-form="1">
                <input type="hidden" name="returnTo" value="/panel/settings">
                <button class="btn btn--accent" type="submit">Обновить с Kaspi</button>
              </form>
              <form action="/panel/kaspi/upload" method="post" data-async-form="1">
                <input type="hidden" name="returnTo" value="/panel/settings">
                <button class="btn btn--success" type="submit">Загрузить в Kaspi</button>
              </form>
              <form action="/panel/auto-pricing/run" method="post" data-async-form="1">
                <button class="btn btn--ghost" type="submit">Рассчитать цены</button>
              </form>
              <form action="/panel/products/parse-all" method="post" data-async-form="1">
                <button class="btn btn--ghost" type="submit">Сформировать карточки</button>
              </form>
              <a class="btn btn--ghost" href="/panel/download">Скачать XML</a>
            </div>
            <form action="/panel/xml/upload" method="post" enctype="multipart/form-data" data-async-form="1" style="margin-top:18px">
              ${labelWithHelp('Загрузить XML', 'XML заменит текущую ленту. Новые товары добавятся в каталог и по умолчанию будут сняты с продажи.')}
              <div class="flex gap-sm flex-wrap">
                <input class="form-file" name="xmlFile" type="file" accept=".xml,text/xml,application/xml" required style="max-width:360px">
                <button class="btn btn--primary" type="submit">Загрузить XML</button>
              </div>
            </form>
          </div>
        </section>

        <form method="post" action="/panel/settings/automation" data-async-form="1">
          <input type="hidden" name="returnTo" value="/panel/settings">
          <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Автоматизация</h3>
              <div class="card__subtitle">Все переключатели и периодичности видны сразу. Выключатель отключает цикл полностью, период задается в минутах.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="automation-grid">${cards}</div>
            <div class="form-section">
              <div class="form-group" style="max-width:280px">
                ${labelWithHelp('Потоки авторасчета', 'Сколько товаров korganBot может рассчитывать параллельно. Больше потоков быстрее, но сильнее нагружает Kaspi и сервер.')}
                <input class="form-input" name="concurrency" type="number" min="1" max="100" step="1" value="${escapeAttr(concurrency || '4')}">
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить настройки</button>
            </div>
          </div>
          </div>
        </form>
      </div>

      ${renderDateTimeScript()}
      <script>
      (() => {
        let refreshTimer = null;
        const scheduleRefresh = () => {
          if (refreshTimer) return;
          refreshTimer = setTimeout(() => {
            location.reload();
          }, 900);
        };

        document.addEventListener('kaspi:setting_updated', scheduleRefresh);
        document.addEventListener('kaspi:parse_session_updated', (event) => {
          if (event.detail && event.detail.status !== 'running') {
            scheduleRefresh();
          }
        });
      })();

      </script>
    `,
  });
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
          <div class="automation-card__meta">${running ? 'Выполняется сейчас' : enabled ? 'Включено' : 'Выключено'}</div>
        </div>
        <label class="toggle">
          <input type="hidden" name="${enabledName}" value="0">
          <input name="${enabledName}" type="checkbox" value="1"${enabled ? ' checked' : ''}>
          <span class="toggle__track"></span>
        </label>
      </div>
      <div class="form-group" style="margin-bottom:0">
        ${labelWithHelp('Период, минут', '0 выключает запуск по расписанию. Если переключатель включен, лучше поставить период больше 0.')}
        <input class="form-input" name="${intervalName}" type="number" min="0" step="1" value="${escapeAttr(intervalMin)}" placeholder="0">
        <div class="form-hint">${nextRunLabel(state)}</div>
      </div>
    </section>
  `;
}

function nextRunLabel(state = {}) {
  if (state?.running) {
    return 'Цикл выполняется прямо сейчас';
  }
  if (!state?.enabled) {
    return 'Следующий запуск отключен';
  }
  if (!state?.nextRunAt) {
    return `Интервал: ${formatIntervalMinutes(state.intervalMs)} мин`;
  }
  return `Следующий запуск: ${renderDateTime(state.nextRunAt, { dateStyle: 'short', timeStyle: 'short' })}`;
}

function labelWithHelp(label, help) {
  return `
    <div class="label-row">
      <label class="form-label">${escapeHtml(label)}</label>
      <button class="help-dot" type="button" data-help="${escapeAttr(help)}">?</button>
    </div>
  `;
}

function formatIntervalMinutes(value) {
  const minutes = Number(value || 0) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  return String(Math.round(minutes));
}
