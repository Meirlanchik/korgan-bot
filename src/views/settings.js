import { escapeAttr, escapeHtml, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderSettingsPage({
  automationState = {},
  ignoredMerchantIds = [],
  message = '',
  error = '',
} = {}) {
  const cards = [
    renderAutomationCard('Авторасчет цены', 'autoPricingEnabled', 'autoPricingIntervalMin', automationState.autoPricing),
    renderAutomationCard('Автоформирование', 'fullParseEnabled', 'fullParseIntervalMin', automationState.fullParse),
    renderAutomationCard('Автозагрузка с Kaspi', 'kaspiPullEnabled', 'kaspiPullIntervalMin', automationState.kaspiPull),
    renderAutomationCard('Автовыгрузка в Kaspi', 'kaspiPushEnabled', 'kaspiPushIntervalMin', automationState.kaspiPush),
  ].join('');

  const merchantRows = (ignoredMerchantIds.length ? ignoredMerchantIds : ['']).map((merchantId) => renderMerchantRow(merchantId)).join('');

  return renderLayout({
    title: 'Настройки',
    activePage: 'settings',
    message,
    error,
    content: `
      <div class="session-hero">
        ${summaryMetric('Авторасчет', stateLabel(automationState.autoPricing), nextRunLabel(automationState.autoPricing), automationState.autoPricing?.enabled ? 'session-metric--blue' : '')}
        ${summaryMetric('Автоформирование', stateLabel(automationState.fullParse), nextRunLabel(automationState.fullParse), automationState.fullParse?.enabled ? 'session-metric--warn' : '')}
        ${summaryMetric('Автозагрузка', stateLabel(automationState.kaspiPull), nextRunLabel(automationState.kaspiPull), automationState.kaspiPull?.enabled ? 'session-metric--ok' : '')}
        ${summaryMetric('Автовыгрузка', stateLabel(automationState.kaspiPush), nextRunLabel(automationState.kaspiPush), automationState.kaspiPush?.enabled ? 'session-metric--danger' : '')}
      </div>

      <form method="post" action="/panel/settings/automation">
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
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить настройки</button>
            </div>
          </div>
        </div>
      </form>

      <form method="post" action="/panel/settings/automation">
        <input type="hidden" name="returnTo" value="/panel/settings">
        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Merchant ID, с которыми не надо конкурировать</h3>
              <div class="card__subtitle">Добавляй по одному ID. Этот список используется при расчете цены и не смешан с общими настройками.</div>
            </div>
            <button class="btn btn--ghost btn--sm" type="button" onclick="addIgnoredMerchantRow()">Добавить</button>
          </div>
          <div class="card__body">
            <div id="ignoredMerchantList" class="merchant-list">${merchantRows}</div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить список</button>
            </div>
          </div>
        </div>
      </form>

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

      function merchantRowTemplate(value) {
        const safeValue = String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        return '<div class="merchant-row">'
          + '<input class="form-input" type="text" name="ignoredMerchantIds[]" value="' + safeValue + '" placeholder="Например, 30452124">'
          + '<button class="btn btn--ghost btn--sm" type="button" onclick="removeIgnoredMerchantRow(this)">Убрать</button>'
          + '</div>';
      }
      function addIgnoredMerchantRow(value) {
        const container = document.getElementById('ignoredMerchantList');
        if (!container) return;
        container.insertAdjacentHTML('beforeend', merchantRowTemplate(value || ''));
      }
      function removeIgnoredMerchantRow(button) {
        const row = button && button.closest('.merchant-row');
        if (!row) return;
        const container = document.getElementById('ignoredMerchantList');
        row.remove();
        if (container && !container.children.length) {
          addIgnoredMerchantRow('');
        }
      }
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
        <label class="form-label">Период, минут</label>
        <input class="form-input" name="${intervalName}" type="number" min="0" step="1" value="${escapeAttr(intervalMin)}" placeholder="0">
        <div class="form-hint">${nextRunLabel(state)}</div>
      </div>
    </section>
  `;
}

function renderMerchantRow(value = '') {
  return `
    <div class="merchant-row">
      <input class="form-input" type="text" name="ignoredMerchantIds[]" value="${escapeAttr(value)}" placeholder="Например, 30452124">
      <button class="btn btn--ghost btn--sm" type="button" onclick="removeIgnoredMerchantRow(this)">Убрать</button>
    </div>
  `;
}

function summaryMetric(label, value, note, className = '') {
  return `
    <div class="session-metric ${className}">
      <div class="session-metric__label">${escapeHtml(label)}</div>
      <div class="session-metric__value" style="font-size:24px">${escapeHtml(value)}</div>
      <div class="session-metric__note">${note}</div>
    </div>
  `;
}

function stateLabel(state = {}) {
  if (state?.running) return 'В работе';
  return state?.enabled ? 'Включено' : 'Выключено';
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

function formatIntervalMinutes(value) {
  const minutes = Number(value || 0) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  return String(Math.round(minutes));
}
