import { escapeHtml, escapeAttr, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderAutoPricingSettingsPage({
  intervalMs,
  fullIntervalMs,
  pushIntervalMs,
  concurrency,
  merchantId,
  ignoredMerchantIds,
  products,
  sessions,
  uploadSessions = [],
  sourceFilter,
  schedulerState,
  fullSchedulerState,
  uploadSchedulerState,
  message,
  error,
}) {
  const intervalMin = formatIntervalMinutes(intervalMs);
  const fullIntervalMin = formatIntervalMinutes(fullIntervalMs);
  const pushIntervalMin = formatIntervalMinutes(pushIntervalMs);
  const safeConcurrency = Number.isFinite(Number(concurrency)) && Number(concurrency) > 0 ? Number(concurrency) : 4;
  const parseEnabled = Boolean(schedulerState?.enabled);
  const fullParseEnabled = Boolean(fullSchedulerState?.enabled);
  const uploadEnabled = Boolean(uploadSchedulerState?.enabled);
  const parseRunning = Boolean(schedulerState?.running);
  const fullParseRunning = Boolean(fullSchedulerState?.running);
  const uploadRunning = Boolean(uploadSchedulerState?.running);
  const parseNextRunAt = renderLocalDateTime(schedulerState?.nextRunAt);
  const fullParseNextRunAt = renderLocalDateTime(fullSchedulerState?.nextRunAt);
  const uploadNextRunAt = renderLocalDateTime(uploadSchedulerState?.nextRunAt);
  const latestUploadSession = uploadSessions[0] || null;
  const latestUpload = latestUploadSession ? getUploadDetails(latestUploadSession.details) : null;
  const parseSessionsSummary = summarizeSessions(sessions);
  const uploadSessionsSummary = summarizeSessions(uploadSessions);

  const productRows = products.map((product) => {
    const price = product.upload_price || product.city_price || product.price || 0;
    return `<tr>
      <td><a href="/panel/products/${encodeURIComponent(product.sku)}" style="color:var(--c-accent)">${escapeHtml(product.model || product.sku)}</a></td>
      <td>${escapeHtml(product.sku)}</td>
      <td>${formatPrice(price)}</td>
      <td>${product.min_price || 0} - ${product.max_price || 0} ₸</td>
      <td>${product.price_step || 1} ₸</td>
      <td>${product.my_position || '—'}</td>
      <td>${product.first_place_price ? formatPrice(product.first_place_price) : '—'}</td>
    </tr>`;
  }).join('');

  const filterTabs = [
    { key: '', label: 'Все', href: '/panel/auto-pricing' },
    { key: 'manual', label: 'Ручной', href: '/panel/auto-pricing?source=manual' },
    { key: 'auto', label: 'Авто', href: '/panel/auto-pricing?source=auto' },
  ].map((tab) => (
    `<a class="btn ${sourceFilter === tab.key ? 'btn--accent' : 'btn--ghost'} btn--sm" href="${tab.href}">${tab.label}</a>`
  )).join('');

  const autoPricingRows = sessions.map((session) => {
    const results = getSessionResults(session.details);
    const changedCount = results.filter((result) => result.updated).length;
    const processedCount = Number(session.success_count || 0) + Number(session.error_count || 0);
    const progress = getProgress(processedCount, Number(session.total_count || 0), session.status);
    const href = `/panel/parse-sessions/${encodeURIComponent(session.id)}`;
    return `<tr>
      <td>
        <a class="session-link" href="${href}">
          <strong>${renderLocalDateTime(session.started_at)}</strong>
          <div class="cell-sub">#${escapeHtml(session.id)}</div>
          <div class="cell-sub">${escapeHtml(parseTypeLabel(session.type))}</div>
        </a>
      </td>
      <td>${sourceBadge(session.trigger_source)}</td>
      <td>${statusBadge(session.status)}</td>
      <td>
        ${renderMiniProgress(progress)}
        <div class="cell-sub">Изменено цен: ${escapeHtml(changedCount)}</div>
      </td>
      <td>
        ${escapeHtml(session.message || '—')}
        ${renderSessionDetails(results)}
      </td>
      <td><div class="cell-actions">${renderDeleteSessionForm(session)}</div></td>
    </tr>`;
  }).join('');

  const kaspiUploadRows = uploadSessions.map((session) => {
    const upload = getUploadDetails(session.details);
    const progress = renderUploadProgress(upload);
    const details = renderUploadDetails(upload);
    const href = `/panel/parse-sessions/${encodeURIComponent(session.id)}`;
    return `<tr>
      <td>
        <a class="session-link" href="${href}">
          <strong>${renderLocalDateTime(session.started_at)}</strong>
          <div class="cell-sub">#${escapeHtml(session.id)}</div>
        </a>
      </td>
      <td>${sourceBadge(session.trigger_source)}</td>
      <td>${statusBadge(session.status)}</td>
      <td>${progress}</td>
      <td>
        ${escapeHtml(session.message || '—')}
        ${details}
      </td>
      <td><div class="cell-actions">${renderDeleteSessionForm(session)}</div></td>
    </tr>`;
  }).join('');

  const uploadStateLabel = uploadRunning
    ? 'Идет загрузка'
    : uploadEnabled
      ? 'Включена'
      : 'Выключена';

  const uploadNextRunLabel = uploadRunning
    ? 'После завершения текущей загрузки'
    : uploadEnabled
      ? uploadNextRunAt
      : '—';

  const parseNextRunLabel = parseRunning
    ? 'После завершения текущего запуска'
    : parseEnabled
      ? parseNextRunAt
      : '—';

  const fullParseNextRunLabel = fullParseRunning
    ? 'После завершения текущего запуска'
    : fullParseEnabled
      ? fullParseNextRunAt
      : '—';

  return renderLayout({
    title: 'Настройки',
    activePage: 'settings',
    message,
    error,
    content: `
      ${renderAutoPricingOverview({
        parseEnabled,
        fullParseEnabled,
        uploadEnabled,
        parseRunning,
        fullParseRunning,
        uploadRunning,
        parseNextRunLabel,
        fullParseNextRunLabel,
        uploadNextRunLabel,
        productsCount: products.length,
        parseSessionsSummary,
        uploadSessionsSummary,
        latestUpload,
      })}

      ${renderPriceSettingsCard({
        intervalMin,
        fullIntervalMin,
        safeConcurrency,
        merchantId,
        ignoredMerchantIds,
        parseEnabled,
        fullParseEnabled,
        parseRunning,
        fullParseRunning,
        parseNextRunLabel,
        fullParseNextRunLabel,
      })}

      ${renderKaspiUploadSettingsCard({
        pushIntervalMin,
        uploadStateLabel,
        uploadNextRunLabel,
        uploadEnabled,
        latestUpload,
        latestUploadSession,
      })}

      <div class="card card--flush">
        <div class="card__header">
          <h3 class="card__title">Товары с расчетом цены (${products.length})</h3>
        </div>
        ${products.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Название</th><th>SKU</th><th>Цена выгрузки</th><th>Мин-Макс</th><th>Шаг</th><th>Позиция</th><th>1-е место</th>
            </tr></thead>
            <tbody>${productRows}</tbody>
          </table>
        </div>` : `
        <div class="card__body">
          <p class="text-muted">Нет товаров с включенным расчетом цены. Включите его на странице товара.</p>
        </div>`}
      </div>

      <div class="card card--flush">
        <div class="card__header">
          <div>
            <h3 class="card__title">Сессии расчета цены</h3>
            <div class="card__subtitle">Видно ручные и автоматические циклы пересчета цены и обновления позиций.</div>
          </div>
          <div class="session-toolbar">
            ${filterTabs}
            ${renderClearSessionsForm({
              label: 'Очистить',
              confirm: 'Очистить завершенные сессии расчета цены?',
              types: ['light_parse', 'auto_pricing'],
              triggerSource: sourceFilter,
            })}
          </div>
        </div>
        ${sessions.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Время</th><th>Источник</th><th>Статус</th><th>Товары</th><th>Итог</th><th style="text-align:right">Действие</th></tr></thead>
            <tbody>${autoPricingRows}</tbody>
          </table>
        </div>` : `
        <div class="session-empty">
          <div class="session-empty__title">Сессий расчета цены пока нет</div>
          <div>Ручной или автоматический запуск появится здесь с прогрессом и списком товаров.</div>
        </div>`}
      </div>

      <div class="card card--flush">
        <div class="card__header">
          <div>
            <h3 class="card__title">Сессии загрузки в Kaspi</h3>
            <div class="card__subtitle">После отправки файла статус обновляется автоматически и подтягивается с кабинета Kaspi.</div>
          </div>
          <div class="session-toolbar">
            ${filterTabs}
            ${renderClearSessionsForm({
              label: 'Очистить',
              confirm: 'Очистить завершенные сессии загрузки в Kaspi?',
              type: 'kaspi_upload',
              triggerSource: sourceFilter,
            })}
          </div>
        </div>
        ${uploadSessions.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Время</th><th>Источник</th><th>Статус</th><th>Прогресс</th><th>Итог</th><th style="text-align:right">Действие</th></tr></thead>
            <tbody>${kaspiUploadRows}</tbody>
          </table>
        </div>` : `
        <div class="session-empty">
          <div class="session-empty__title">Сессий загрузки в Kaspi пока нет</div>
          <div>Когда загрузка стартует, здесь будет видно отправку, проверки статуса и итог Kaspi.</div>
        </div>`}
      </div>
      ${renderDateTimeScript()}
    `,
  });
}

function renderAutoPricingOverview({
  parseEnabled,
  fullParseEnabled,
  uploadEnabled,
  parseRunning,
  fullParseRunning,
  uploadRunning,
  parseNextRunLabel,
  fullParseNextRunLabel,
  uploadNextRunLabel,
  productsCount,
  parseSessionsSummary,
  uploadSessionsSummary,
  latestUpload,
}) {
  const runningNow = [
    parseRunning ? 'расчет цены' : '',
    fullParseRunning ? 'формирование карточек' : '',
    uploadRunning ? 'загрузка в Kaspi' : '',
  ].filter(Boolean);
  const focusTitle = runningNow.length
    ? `Сейчас идет: ${runningNow.join(', ')}`
    : 'Автоциклы под контролем';
  const focusMeta = [
    `Расчет цены: ${parseEnabled ? 'вкл' : 'выкл'}`,
    `Карточка: ${fullParseEnabled ? 'вкл' : 'выкл'}`,
    `Kaspi: ${uploadEnabled ? 'вкл' : 'выкл'}`,
  ].join(' • ');
  const latestUploadNote = latestUpload
    ? `Последняя загрузка: ${latestUpload.statusText || latestUpload.progressStatus || 'статус обновляется'}`
    : 'Загрузок в Kaspi еще не было.';

  return `
    <div class="session-hero">
      <div class="session-focus">
        <div>
          <div class="session-focus__label">Что важно сейчас</div>
          <div class="session-focus__title">${escapeHtml(focusTitle)}</div>
          <div class="session-focus__meta">${escapeHtml(focusMeta)}</div>
        </div>
        <div class="session-focus__meta">${escapeHtml(latestUploadNote)}</div>
      </div>
      ${metricCard('Товары в боте', productsCount, `Следующий расчет: ${stripTags(parseNextRunLabel)}`, 'session-metric--blue')}
      ${metricCard('Расчет цены', parseSessionsSummary.running, `Ошибок: ${parseSessionsSummary.errors} • Следующая карточка: ${stripTags(fullParseNextRunLabel)}`, parseSessionsSummary.errors ? 'session-metric--danger' : 'session-metric--ok')}
      ${metricCard('Загрузка Kaspi', uploadSessionsSummary.running, `Ошибок: ${uploadSessionsSummary.errors} • Следующая: ${stripTags(uploadNextRunLabel)}`, uploadSessionsSummary.errors ? 'session-metric--danger' : 'session-metric--warn')}
      ${metricCard('История', parseSessionsSummary.total + uploadSessionsSummary.total, `Завершено OK: ${parseSessionsSummary.success + uploadSessionsSummary.success}`, '')}
    </div>
  `;
}

function renderPriceSettingsCard({
  intervalMin,
  fullIntervalMin,
  safeConcurrency,
  merchantId,
  ignoredMerchantIds,
  parseEnabled,
  fullParseEnabled,
  parseRunning,
  fullParseRunning,
  parseNextRunLabel,
  fullParseNextRunLabel,
}) {
  return `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Настройка расчета цены</h3>
          <div class="card__subtitle">Здесь управляется расписание пересчета цены и автоматическое формирование карточек для новых и существующих товаров.</div>
        </div>
        <form action="/panel/auto-pricing/toggle" method="post" style="margin:0">
          <button class="btn ${parseEnabled || fullParseEnabled ? 'btn--danger' : 'btn--success'}" type="submit">${parseEnabled || fullParseEnabled ? 'Выключить автоциклы' : 'Включить автоциклы'}</button>
        </form>
      </div>
      <div class="card__body">
        <form action="/panel/auto-pricing/settings" method="post">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Расчет цены (минуты)</label>
              <input class="form-input" name="intervalMin" type="number" min="0" step="0.1" value="${intervalMin}" style="max-width:180px">
              <div class="form-hint">Быстрый HTTP-опрос цен и продавцов. Можно дробное значение: <code>0.2</code> примерно 12 секунд.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Сформировать карточку по расписанию (минуты)</label>
              <input class="form-input" name="fullIntervalMin" type="number" min="0" step="0.1" value="${fullIntervalMin}" style="max-width:220px">
              <div class="form-hint">Тяжелый проход через карточку товара: обновляет бренд, категорию, изображения и данные продавцов.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Потоков</label>
              <input class="form-input" name="concurrency" type="number" min="1" max="100" value="${safeConcurrency}" style="max-width:140px">
              <div class="form-hint">Сколько товаров проверять одновременно.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Мой Merchant ID</label>
              <input class="form-input" type="text" value="${escapeAttr(merchantId || '')}" readonly style="max-width:220px">
              <div class="form-hint">Редактируется на главной странице.</div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Статус расчета цены</label>
              <div class="form-static">${parseRunning ? 'Идет запуск' : parseEnabled ? 'Включен' : 'Выключен'}</div>
              <div class="form-hint">Следующий запуск: ${parseNextRunLabel}</div>
            </div>
            <div class="form-group">
              <label class="form-label">Статус формирования карточек</label>
              <div class="form-static">${fullParseRunning ? 'Идет запуск' : fullParseEnabled ? 'Включен' : 'Выключен'}</div>
              <div class="form-hint">Следующий запуск: ${fullParseNextRunLabel}</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Merchant ID, с которыми не надо конкурировать</label>
            <textarea class="form-input" name="ignoredMerchantIds" rows="5" placeholder="По одному на строку или через запятую">${escapeHtml(ignoredMerchantIds || merchantId || '')}</textarea>
            <div class="form-hint">Эти продавцы видны в списке, но расчет цены не будет снижать цену относительно них.</div>
          </div>

          <div class="form-actions form-actions--compact">
            <button class="btn btn--primary" type="submit">Сохранить</button>
          </div>
        </form>
        <div class="form-actions form-actions--compact">
          <form action="/panel/auto-pricing/run" method="post" style="margin:0">
            <button class="btn btn--accent" type="submit">Запустить расчет цены сейчас</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderKaspiUploadSettingsCard({
  pushIntervalMin,
  uploadStateLabel,
  uploadNextRunLabel,
  uploadEnabled,
  latestUpload,
  latestUploadSession,
}) {
  return `
    <div class="card">
      <div class="card__header">
        <div>
          <h3 class="card__title">Настройка выгрузки в Kaspi</h3>
          <div class="card__subtitle">Отдельно настраивается период автозагрузки XML и виден статус последней отправки.</div>
        </div>
      </div>
      <div class="card__body">
        <form action="/panel/auto-pricing/settings" method="post">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Периодичность загрузки в Kaspi (минуты)</label>
              <input class="form-input" name="pushIntervalMin" type="number" min="0" step="0.1" value="${pushIntervalMin}" style="max-width:200px">
              <div class="form-hint"><code>0</code> отключает автозагрузку. Если Kaspi запросит OTP или сессия истечет, загрузка завершится ошибкой.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Статус выгрузки</label>
              <div class="form-static">${uploadStateLabel}</div>
              <div class="form-hint">Следующий запуск: ${uploadNextRunLabel}</div>
              ${latestUpload ? `<div class="form-hint" style="margin-top:6px">Последняя сессия: ${statusBadge(latestUploadSession.status)} ${escapeHtml(latestUpload.statusText || 'Статус обновляется')}</div>` : ''}
            </div>
            <div class="form-group">
              <label class="form-label">Автозагрузка</label>
              <div class="form-static">${uploadEnabled ? 'Включена' : 'Выключена'}</div>
              <div class="form-hint">Ручную загрузку можно запускать с товаров или главной страницы в любой момент.</div>
            </div>
          </div>
          <div class="form-actions form-actions--compact">
            <button class="btn btn--primary" type="submit">Сохранить</button>
          </div>
        </form>
        <div class="form-actions form-actions--compact">
          <form action="/panel/kaspi/upload" method="post" style="margin:0">
            <button class="btn btn--accent" type="submit">Загрузить в Kaspi сейчас</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

function getSessionResults(detailsText) {
  if (!detailsText) return [];
  try {
    const details = JSON.parse(detailsText);
    return Array.isArray(details.results) ? details.results : [];
  } catch {
    return [];
  }
}

function getUploadDetails(detailsText) {
  if (!detailsText) return null;
  try {
    const details = JSON.parse(detailsText);
    return details && typeof details === 'object' ? details.upload || null : null;
  } catch {
    return null;
  }
}

function renderSessionDetails(results) {
  if (!results.length) return '';

  const rows = results.map((result) => `
    <tr>
      <td>${escapeHtml(result.sku || '—')}</td>
      <td>${escapeHtml(formatPrice(result.kaspiPrice || 0))}</td>
      <td>${escapeHtml(formatPrice(result.oldPrice ?? result.oldUploadPrice ?? 0))} → ${escapeHtml(formatPrice(result.newPrice ?? result.newUploadPrice ?? 0))}</td>
      <td>${result.myPosition ? escapeHtml(String(result.myPosition)) : '—'}</td>
      <td>${result.error ? escapeHtml(shortError(result.error)) : escapeHtml(formatReason(result.reason))}</td>
    </tr>
  `).join('');

  return `
    <details style="margin-top:8px">
      <summary class="text-sm" style="cursor:pointer;color:var(--c-accent)">Показать товары (${results.length})</summary>
      <div class="table-wrap" style="margin-top:8px">
        <table>
          <thead><tr><th>SKU</th><th>Kaspi</th><th>Цена выгрузки</th><th>Позиция</th><th>Примечание</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
  `;
}

function renderMiniProgress(progress, processedLabel = null, totalLabel = null) {
  const fillClass = progress.status === 'error'
    ? 'session-progress__fill--bad'
    : progress.status === 'partial' || progress.status === 'aborted'
      ? 'session-progress__fill--warn'
      : '';
  const processed = processedLabel ?? progress.processed;
  const total = totalLabel ?? progress.total;

  return `
    <div class="session-progress">
      <div class="session-progress__head">
        <span>${escapeHtml(processed)} / ${escapeHtml(total)}</span>
        <span>${escapeHtml(progress.percent)}%</span>
      </div>
      <div class="session-progress__bar">
        <div class="session-progress__fill ${fillClass}" style="width:${escapeHtml(progress.percent)}%"></div>
      </div>
    </div>
  `;
}

function getProgress(processed, total, status) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeProcessed = Math.max(0, Number(processed) || 0);
  return {
    processed: safeProcessed,
    total: safeTotal || '—',
    status,
    percent: safeTotal > 0
      ? Math.max(0, Math.min(100, Math.round((safeProcessed / safeTotal) * 100)))
      : status === 'success' ? 100 : 0,
  };
}

function renderUploadProgress(upload) {
  if (!upload) return '—';

  const totalCount = formatCount(upload.totalCount);
  const processedCount = formatCount(upload.processedCount);
  const errorCount = formatCount(upload.errorCount);
  const progress = getProgress(Number(upload.processedCount || 0), Number(upload.totalCount || 0), upload.phase === 'completed' ? 'success' : 'running');
  return `
    ${renderMiniProgress(progress, processedCount, totalCount)}
    <div class="cell-sub">Ошибок: ${escapeHtml(errorCount)}${upload.warningCount != null ? ` • Предупреждений: ${escapeHtml(upload.warningCount)}` : ''}</div>
  `;
}

function renderUploadDetails(upload) {
  if (!upload) return '';

  const checks = Array.isArray(upload.checks) ? upload.checks : [];
  const checkRows = checks.slice(-10).reverse().map((check) => `
    <tr>
      <td>${renderLocalDateTime(check.checkedAt)}</td>
      <td>${escapeHtml(check.statusText || check.progressStatus || 'Статус обновляется')}</td>
      <td>${escapeHtml(formatCount(check.processedCount))} / ${escapeHtml(formatCount(check.totalCount))}</td>
      <td>${escapeHtml(formatCount(check.errorCount))}</td>
    </tr>
  `).join('');

  return `
    <div class="cell-sub" style="margin-top:6px">Файл: ${escapeHtml(upload.fileName || 'index.xml')}${upload.fileId ? ` • ID: ${escapeHtml(upload.fileId)}` : ''}</div>
    <div class="cell-sub">Статус Kaspi: ${escapeHtml(upload.statusText || upload.progressStatus || 'Статус обновляется')}</div>
    ${upload.uploadedAt ? `<div class="cell-sub">Дата загрузки в Kaspi: ${renderLocalDateTime(upload.uploadedAt)}</div>` : ''}
    ${renderUploadCounters(upload)}
    ${checkRows ? `
      <details style="margin-top:8px">
        <summary class="text-sm" style="cursor:pointer;color:var(--c-accent)">Проверки статуса (${checks.length})</summary>
        <div class="table-wrap" style="margin-top:8px">
          <table>
            <thead><tr><th>Проверено</th><th>Статус</th><th>Обработано</th><th>Ошибки</th></tr></thead>
            <tbody>${checkRows}</tbody>
          </table>
        </div>
      </details>` : ''}
  `;
}

function renderUploadCounters(upload) {
  const lines = [
    upload.unrecognizedCount != null ? `Нераспознанные: ${upload.unrecognizedCount}` : '',
    upload.restrictedCount != null ? `Ограниченные: ${upload.restrictedCount}` : '',
    upload.warningCount != null ? `Предупреждения: ${upload.warningCount}` : '',
    upload.unchangedCount != null ? `Без изменений: ${upload.unchangedCount}` : '',
  ].filter(Boolean);

  if (!lines.length) {
    return '';
  }

  return `<div class="cell-sub">${escapeHtml(lines.join(' • '))}</div>`;
}

function renderDeleteSessionForm(session) {
  if (session.status === 'running') {
    return '<span class="text-sm text-muted">Активна</span>';
  }

  return `
    <form action="/panel/parse-sessions/${encodeURIComponent(session.id)}/delete" method="post" style="margin:0" onsubmit="return confirm('Очистить сессию #${escapeHtml(session.id)}?')">
      <button class="btn btn--ghost btn--xs" type="submit">Очистить</button>
    </form>
  `;
}

function renderClearSessionsForm({ label, confirm, type = '', types = [], triggerSource = '' }) {
  const typeInputs = type
    ? `<input type="hidden" name="type" value="${escapeAttr(type)}">`
    : types.map((value) => `<input type="hidden" name="types" value="${escapeAttr(value)}">`).join('');
  const sourceInput = triggerSource ? `<input type="hidden" name="triggerSource" value="${escapeAttr(triggerSource)}">` : '';

  return `
    <form action="/panel/parse-sessions/clear" method="post" style="margin:0" onsubmit="return confirm('${escapeAttr(confirm)}')">
      ${typeInputs}
      ${sourceInput}
      <button class="btn btn--danger btn--sm" type="submit">${escapeHtml(label)}</button>
    </form>
  `;
}

function summarizeSessions(sessions) {
  return {
    total: sessions.length,
    running: sessions.filter((session) => session.status === 'running').length,
    success: sessions.filter((session) => session.status === 'success').length,
    errors: sessions.filter((session) => ['error', 'partial', 'aborted'].includes(session.status)).length,
  };
}

function metricCard(label, value, note, modifier = '') {
  return `
    <div class="session-metric ${modifier}">
      <div class="session-metric__label">${escapeHtml(label)}</div>
      <div class="session-metric__value">${escapeHtml(value)}</div>
      <div class="session-metric__note">${escapeHtml(note)}</div>
    </div>
  `;
}

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusBadge(status) {
  if (status === 'success') return '<span class="badge badge--green">OK</span>';
  if (status === 'running') return '<span class="badge badge--blue badge--pulse">Идет</span>';
  if (status === 'partial') return '<span class="badge badge--warning">Частично</span>';
  if (status === 'aborted') return '<span class="badge badge--gray">Прервано</span>';
  return '<span class="badge badge--red">Ошибка</span>';
}

function sourceBadge(source) {
  return source === 'auto'
    ? '<span class="badge badge--blue">Авто</span>'
    : '<span class="badge badge--gray">Ручной</span>';
}

function parseTypeLabel(type) {
  if (type === 'light_parse') return 'Расчет цены';
  if (type === 'auto_pricing') return 'Расчет цены';
  if (type === 'full_parse') return 'Сформировать карточку';
  return type || 'Сессия';
}

function renderLocalDateTime(value) {
  return renderDateTime(value);
}

function formatIntervalMinutes(value) {
  const minutes = Number(value || 0) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return '0';
  return minutes >= 1
    ? String(Number(minutes.toFixed(2))).replace(/\.0+$/, '')
    : String(Number(minutes.toFixed(3))).replace(/\.0+$/, '');
}

function formatCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : '—';
}

function formatPrice(value) {
  const amount = Number(value || 0);
  if (!amount) return '—';
  return `${amount.toLocaleString('ru-RU')} ₸`;
}

function formatReason(value) {
  const reasonMap = {
    BEAT_COMPETITOR: 'Ниже конкурента на шаг',
    MIN_PRICE_FLOOR: 'Упор в минимум',
    MAX_PRICE_CAP: 'Упор в максимум',
    NO_COMPETITOR_TO_BEAT: 'Нет конкурента',
  };
  return reasonMap[value] || value || '—';
}

function shortError(error) {
  return String(error || '').replace(/\s+/g, ' ').slice(0, 120);
}
