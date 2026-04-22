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
        <section class="card settings-command-card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Командный Центр</h3>
              <div class="card__subtitle">Ручные действия собраны в одной зоне, а кнопки разложены по приоритету: сначала Kaspi и XML, потом сервисные операции.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="settings-command-grid">
              ${renderManualAction({
                action: '/panel/kaspi/download',
                label: 'Обновить с Kaspi',
                hint: 'Скачать актуальный каталог из кабинета и обновить локальную базу.',
                buttonClass: 'btn btn--accent',
                withReturnTo: true,
              })}
              ${renderManualAction({
                action: '/panel/kaspi/upload',
                label: 'Загрузить в Kaspi',
                hint: 'Отправить текущий XML с ценами, которые уже сохранены на сайте.',
                buttonClass: 'btn btn--success',
                withReturnTo: true,
              })}
              ${renderManualAction({
                action: '/panel/auto-pricing/run',
                label: 'Рассчитать цены',
                hint: 'Запустить авторасчёт вручную без ожидания расписания.',
                buttonClass: 'btn btn--ghost',
              })}
              ${renderManualAction({
                action: '/panel/products/parse-all',
                label: 'Сформировать карточки',
                hint: 'Обновить карточки и данные продавцов по всем товарам.',
                buttonClass: 'btn btn--ghost',
              })}
              <a class="settings-command settings-command--link" href="/panel/download">
                <span class="btn btn--ghost">Скачать XML</span>
                <span class="settings-command__hint">Скачать текущую ленту без изменений в каталоге.</span>
              </a>
            </div>
            <div class="settings-upload-box">
              <form action="/panel/xml/upload" method="post" enctype="multipart/form-data" data-async-form="1">
                ${labelWithHelp('Загрузить XML', 'XML заменит текущую ленту. Новые товары добавятся в каталог и по умолчанию будут сняты с продажи.')}
                <div class="action-row">
                  <input class="form-file" name="xmlFile" type="file" accept=".xml,text/xml,application/xml" required style="max-width:360px">
                  <button class="btn btn--primary" type="submit">Загрузить XML</button>
                </div>
              </form>
            </div>
          </div>
        </section>

        <form method="post" action="/panel/settings/automation" data-async-form="1">
          <input type="hidden" name="returnTo" value="/panel/settings">
          <div class="card settings-automation-card">
            <div class="card__header">
              <div>
                <h3 class="card__title">Автоматизация</h3>
                <div class="card__subtitle">Для каждого процесса видно последнее действие, его результат и время следующего запуска.</div>
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
    `,
  });
}

function renderAutomationCard(title, enabledName, intervalName, state = {}) {
  const enabled = Boolean(state?.enabled);
  const running = Boolean(state?.running);
  const intervalMin = formatIntervalMinutes(state?.intervalMs);
  const tone = running
    ? 'running'
    : state?.lastStatus === 'error'
      ? 'danger'
      : state?.lastStatus === 'partial'
        ? 'warn'
        : state?.lastStatus === 'success'
          ? 'success'
          : 'idle';

  return `
    <section class="automation-card automation-card--${tone}">
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
      <div class="automation-card__facts">
        ${renderAutomationFact('Интервал', enabled ? `${escapeHtml(intervalMin)} мин` : 'Отключен')}
        ${renderAutomationFact('Последнее действие', renderLastActionValue(state))}
        ${renderAutomationFact('Следующий запуск', renderNextRunValue(state))}
      </div>
      <div class="form-group" style="margin-bottom:0">
        ${labelWithHelp('Период, минут', '0 выключает запуск по расписанию. Если переключатель включен, лучше поставить период больше 0.')}
        <input class="form-input" name="${intervalName}" type="number" min="0" step="1" value="${escapeAttr(intervalMin)}" placeholder="0">
        <div class="form-hint">${periodHint(state)}</div>
      </div>
      <div class="automation-card__status automation-card__status--${tone}">${renderStatusSummary(state)}</div>
    </section>
  `;
}

function renderManualAction({
  action,
  label,
  hint,
  buttonClass,
  withReturnTo = false,
} = {}) {
  return `
    <form class="settings-command" action="${escapeAttr(action)}" method="post" data-async-form="1">
      ${withReturnTo ? '<input type="hidden" name="returnTo" value="/panel/settings">' : ''}
      <button class="${escapeAttr(buttonClass)}" type="submit">${escapeHtml(label)}</button>
      <span class="settings-command__hint">${escapeHtml(hint)}</span>
    </form>
  `;
}

function renderAutomationFact(label, value) {
  return `
    <div class="automation-fact">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderLastActionValue(state = {}) {
  if (state?.lastActivityAt) {
    return renderDateTime(state.lastActivityAt, { dateStyle: 'short', timeStyle: 'short' });
  }
  return 'Пока не было';
}

function renderNextRunValue(state = {}) {
  if (state?.running && state?.currentStartedAt) {
    return `идет с ${renderDateTime(state.currentStartedAt, { dateStyle: 'short', timeStyle: 'short' })}`;
  }
  if (!state?.enabled) {
    return 'Отключен';
  }
  if (!state?.nextRunAt) {
    return `через ${escapeHtml(formatIntervalMinutes(state.intervalMs))} мин`;
  }
  return renderDateTime(state.nextRunAt, { dateStyle: 'short', timeStyle: 'short' });
}

function renderStatusSummary(state = {}) {
  if (state?.running) {
    return state?.currentStartedAt
      ? `Сейчас выполняется. Старт: ${renderDateTime(state.currentStartedAt, { dateStyle: 'short', timeStyle: 'short' })}.`
      : 'Сейчас выполняется.';
  }
  if (!state?.lastStatus) {
    return 'Запусков ещё не было.';
  }

  const label = state.lastStatus === 'success'
    ? 'Последний результат: успех'
    : state.lastStatus === 'partial'
      ? 'Последний результат: частично'
      : state.lastStatus === 'error'
        ? 'Последний результат: ошибка'
        : state.lastStatus === 'aborted'
          ? 'Последний результат: прервано'
          : `Последний результат: ${escapeHtml(state.lastStatus)}`;
  const suffix = state?.lastMessage ? ` ${escapeHtml(state.lastMessage)}` : '';
  return `${label}.${suffix}`;
}

function periodHint(state = {}) {
  if (state?.running) {
    return 'Расписание активно, текущий цикл уже выполняется.';
  }
  if (!state?.enabled) {
    return 'Переключатель выключен или период равен 0.';
  }
  if (!state?.lastSuccessAt) {
    return 'После первого успешного запуска здесь появится фактическое время выполнения.';
  }
  return `Последний успешный запуск: ${renderDateTime(state.lastSuccessAt, { dateStyle: 'short', timeStyle: 'short' })}`;
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
