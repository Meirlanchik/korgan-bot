import { escapeHtml, normalizeDateInput, renderDateTime, renderDateTimeScript } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderParseSessionsPage({ sessions, message, error }) {
  const summary = summarizeSessions(sessions);
  const hasRunningSessions = summary.running > 0;
  const rows = sessions.map(renderSessionRow).join('');

  return renderLayout({
    title: 'Сессии операций',
    activePage: 'history',
    message,
    error,
    content: `
      ${renderOverview(summary)}

      <div class="card card--flush">
        <div class="card__header">
          <div>
            <h3 class="card__title">Журнал парсинга и загрузки</h3>
            <div class="card__subtitle">Все ручные и автоматические запуски. Активные сессии не очищаются, чтобы не потерять прогресс.</div>
          </div>
          <div class="session-toolbar">
            <a class="btn btn--ghost btn--sm" href="/panel/parse-sessions">Обновить</a>
            ${renderClearSessionsForm({
              label: 'Очистить завершенные',
              confirm: 'Очистить все завершенные сессии? Активные сессии останутся.',
            })}
          </div>
        </div>
        ${rows ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Сессия</th>
                <th>Статус</th>
                <th>Прогресс</th>
                <th>Время</th>
                <th>Итог</th>
                <th style="text-align:right">Действие</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `
        <div class="session-empty">
          <div class="session-empty__title">Сессий пока нет</div>
          <div>Когда запустишь парсинг или загрузку в Kaspi, здесь появится понятный отчет.</div>
        </div>`}
      </div>
      ${renderDateTimeScript()}
      ${hasRunningSessions ? `<script>setTimeout(() => location.reload(), 10000);</script>` : ''}
    `,
  });
}

export function renderParseSessionDetailPage({
  session,
  relatedLogs = [],
  message,
  error,
}) {
  const details = parseSessionDetails(session.details);
  const results = Array.isArray(details.results) ? details.results : [];
  const upload = details.upload || null;
  const processedCount = Number(session.success_count || 0) + Number(session.error_count || 0);
  const progress = getProgress(session, upload, processedCount);
  const rawDetails = formatRawDetails(session.details);

  return renderLayout({
    title: `Сессия #${session.id}`,
    activePage: 'history',
    message,
    error,
    content: `
      <div class="session-toolbar" style="margin-bottom:16px">
        <a class="btn btn--ghost btn--sm" href="/panel/parse-sessions">К списку сессий</a>
        <a class="btn btn--ghost btn--sm" href="/panel/auto-pricing">К настройкам</a>
      </div>

      <div class="session-hero">
        <div class="session-focus">
          <div>
            <div class="session-focus__label">Сессия</div>
            <div class="session-focus__title">#${escapeHtml(session.id)} ${escapeHtml(typeLabel(session.type))}</div>
            <div class="session-focus__meta">${sourceLabelText(session.trigger_source)} • ${renderLocalDateTime(session.started_at)}</div>
          </div>
          <div class="session-focus__meta">${escapeHtml(session.message || statusText(session.status))}</div>
        </div>
        ${metricCard('Статус', stripTags(statusBadge(session.status)), `Потоков: ${escapeHtml(session.concurrency || 1)}`, statusCardClass(session.status))}
        ${metricCard('Прогресс', `${escapeHtml(progress.processed)} / ${escapeHtml(progress.total)}`, `Успешно: ${escapeHtml(progress.success)} • Ошибок: ${escapeHtml(progress.errors)}`, 'session-metric--blue')}
        ${metricCard('Длительность', escapeHtml(formatDuration(session)), `Старт: ${renderLocalDateTime(session.started_at)}`, 'session-metric--warn')}
        ${metricCard('Завершение', session.finished_at ? renderLocalDateTime(session.finished_at) : 'В работе', session.finished_at ? 'Сессия завершена' : 'Журнал обновляется', 'session-metric--ok')}
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Сводка</h3>
            <div class="card__subtitle">Основные поля записи parse session.</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <tbody>
              <tr><td>ID</td><td>#${escapeHtml(session.id)}</td></tr>
              <tr><td>Тип</td><td>${escapeHtml(typeLabel(session.type))}</td></tr>
              <tr><td>Источник</td><td>${escapeHtml(sourceLabelText(session.trigger_source))}</td></tr>
              <tr><td>Статус</td><td>${statusBadge(session.status)}</td></tr>
              <tr><td>Всего товаров</td><td>${escapeHtml(formatCount(session.total_count))}</td></tr>
              <tr><td>Успешно</td><td>${escapeHtml(formatCount(session.success_count))}</td></tr>
              <tr><td>Ошибок</td><td>${escapeHtml(formatCount(session.error_count))}</td></tr>
              <tr><td>Позиций найдено</td><td>${escapeHtml(formatCount(session.positions_found))}</td></tr>
              <tr><td>Потоков</td><td>${escapeHtml(formatCount(session.concurrency || 1))}</td></tr>
              <tr><td>Повторов</td><td>${escapeHtml(formatCount(session.retry_count))}</td></tr>
              <tr><td>Сообщение</td><td>${escapeHtml(session.message || '—')}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card__header">
          <div>
            <h3 class="card__title">${upload ? 'Детали загрузки' : 'Результаты товаров'}</h3>
            <div class="card__subtitle">${upload ? 'Статус, проверки и ответ Kaspi.' : `Полный список результатов по товарам: ${results.length}.`}</div>
          </div>
        </div>
        ${upload ? renderUploadDetails(upload) : renderDetailedResultsTable(results)}
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card__header">
          <div>
            <h3 class="card__title">Связанные логи</h3>
            <div class="card__subtitle">Runtime-сообщения за время жизни этой сессии.</div>
          </div>
        </div>
        ${renderRelatedLogs(relatedLogs)}
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card__header">
          <div>
            <h3 class="card__title">Raw Details</h3>
            <div class="card__subtitle">Сырые данные из поля <code>details</code> в БД.</div>
          </div>
        </div>
        <pre style="margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;font-size:12px;background:#f7f9fc;border-top:1px solid var(--c-border)">${escapeHtml(rawDetails)}</pre>
      </div>

      ${renderDateTimeScript()}
      ${session.status === 'running' ? `<script>setTimeout(() => location.reload(), 10000);</script>` : ''}
    `,
  });
}

function renderOverview(summary) {
  const focus = summary.runningSessions[0] || summary.latest;
  const focusTitle = focus
    ? `${summary.running ? 'Идет' : 'Последняя'} #${escapeHtml(focus.id)}`
    : 'Сессий нет';
  const focusMeta = focus
    ? `${escapeHtml(typeLabel(focus.type))} • ${sourceLabelText(focus.trigger_source)} • ${renderLocalDateTime(focus.started_at)}`
    : 'Запусти парсинг или загрузку, и прогресс появится здесь.';

  return `
    <div class="session-hero">
      <div class="session-focus">
        <div>
          <div class="session-focus__label">Главное сейчас</div>
          <div class="session-focus__title">${focusTitle}</div>
          <div class="session-focus__meta">${focusMeta}</div>
        </div>
        <div class="session-focus__meta">${focus ? escapeHtml(focus.message || statusText(focus.status)) : 'Журнал чистый.'}</div>
      </div>
      ${metricCard('Активные', summary.running, 'Сейчас выполняются и обновляются автоматически', 'session-metric--blue')}
      ${metricCard('Ошибки', summary.errors, `Проблемных товаров: ${summary.errorItems}`, 'session-metric--danger')}
      ${metricCard('Успешные', summary.success, `Обработано товаров: ${summary.processedItems}`, 'session-metric--ok')}
      ${metricCard('Загрузки Kaspi', summary.uploads, `Парсинги: ${summary.parses}`, 'session-metric--warn')}
    </div>
  `;
}

function renderSessionRow(session) {
  const details = parseSessionDetails(session.details);
  const results = Array.isArray(details.results) ? details.results : [];
  const upload = details.upload || null;
  const processedCount = Number(session.success_count || 0) + Number(session.error_count || 0);
  const progress = getProgress(session, upload, processedCount);
  const startedAt = renderLocalDateTime(session.started_at);
  const finishedAt = session.finished_at ? renderLocalDateTime(session.finished_at) : '—';
  const href = `/panel/parse-sessions/${encodeURIComponent(session.id)}`;

  return `<tr>
    <td>
      <a class="session-link" href="${href}">
        <div class="cell-main">#${escapeHtml(session.id)} ${escapeHtml(typeLabel(session.type))}</div>
        <div class="cell-sub">${sourceBadge(session.trigger_source)} Потоков: ${escapeHtml(session.concurrency || 1)}</div>
      </a>
    </td>
    <td>${statusBadge(session.status)}</td>
    <td>${renderProgressBlock(progress, session.status)}</td>
    <td>
      <a class="session-link" href="${href}"><div>${startedAt}</div></a>
      <div class="cell-sub">Финиш: ${finishedAt}</div>
      <div class="cell-sub">Длительность: ${escapeHtml(formatDuration(session))}</div>
    </td>
    <td>
      <div class="session-message">
        <strong>${escapeHtml(session.message || statusText(session.status))}</strong>
        ${upload ? renderUploadDetails(upload) : renderResultDetails(results)}
      </div>
    </td>
    <td>
      <div class="cell-actions">
        ${renderDeleteSessionForm(session)}
      </div>
    </td>
  </tr>`;
}

function renderProgressBlock(progress, status) {
  const fillClass = status === 'error'
    ? 'session-progress__fill--bad'
    : status === 'partial' || status === 'aborted'
      ? 'session-progress__fill--warn'
      : '';

  return `
    <div class="session-progress">
      <div class="session-progress__head">
        <span>${escapeHtml(progress.processed)} / ${escapeHtml(progress.total)}</span>
        <span>${escapeHtml(progress.percent)}%</span>
      </div>
      <div class="session-progress__bar">
        <div class="session-progress__fill ${fillClass}" style="width:${escapeHtml(progress.percent)}%"></div>
      </div>
      <div class="cell-sub" style="margin-top:6px">Успешно: ${escapeHtml(progress.success)} • Ошибок: ${escapeHtml(progress.errors)}</div>
    </div>
  `;
}

function renderResultDetails(results) {
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
      <summary class="text-sm" style="cursor:pointer;color:var(--c-accent)">Товары в сессии (${results.length})</summary>
      <div class="table-wrap" style="margin-top:8px">
        <table>
          <thead><tr><th>SKU</th><th>Kaspi</th><th>Цена выгрузки</th><th>Позиция</th><th>Примечание</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
  `;
}

function renderDetailedResultsTable(results) {
  if (!results.length) {
    return `
      <div class="session-empty">
        <div class="session-empty__title">Деталей по товарам нет</div>
        <div>Сессия завершилась без массива <code>results</code> или это служебный запуск.</div>
      </div>
    `;
  }

  const rows = results.map((result) => `
    <tr>
      <td>${escapeHtml(result.sku || '—')}</td>
      <td>${escapeHtml(result.kaspiId || '—')}</td>
      <td>${escapeHtml(result.title || '—')}</td>
      <td>${escapeHtml(formatPrice(result.kaspiPrice || 0))}</td>
      <td>${escapeHtml(formatPrice(result.oldPrice ?? result.oldUploadPrice ?? 0))} → ${escapeHtml(formatPrice(result.newPrice ?? result.newUploadPrice ?? 0))}</td>
      <td>${result.myPosition ? escapeHtml(String(result.myPosition)) : '—'}</td>
      <td>${escapeHtml(formatCount(result.sellersCount))}</td>
      <td style="white-space:pre-wrap;word-break:break-word">${escapeHtml(result.error || formatReason(result.reason))}</td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Kaspi ID</th>
            <th>Название</th>
            <th>Kaspi цена</th>
            <th>Цена выгрузки</th>
            <th>Позиция</th>
            <th>Продавцов</th>
            <th>Детали</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderUploadDetails(upload) {
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
    <div class="cell-sub">Kaspi: ${escapeHtml(upload.statusText || upload.progressStatus || 'Статус обновляется')}</div>
    <div class="cell-sub">Файл: ${escapeHtml(upload.fileName || 'index.xml')}${upload.uploadedAt ? ` • Дата: ${renderLocalDateTime(upload.uploadedAt)}` : ''}</div>
    <div class="cell-sub">Нераспознанные: ${escapeHtml(formatCount(upload.unrecognizedCount))} • Ограниченные: ${escapeHtml(formatCount(upload.restrictedCount))} • Предупреждения: ${escapeHtml(formatCount(upload.warningCount))}</div>
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

function renderRelatedLogs(logs) {
  if (!logs.length) {
    return `
      <div class="session-empty">
        <div class="session-empty__title">Логов за это окно не найдено</div>
        <div>Возможно, сессия очень короткая или runtime-логи были очищены.</div>
      </div>
    `;
  }

  const rows = logs.map((log) => `
    <tr>
      <td>${renderLocalDateTime(log.created_at)}</td>
      <td>${escapeHtml(log.type || '—')}</td>
      <td>${logStatusBadge(log.status)}</td>
      <td style="white-space:pre-wrap;word-break:break-word">
        ${escapeHtml(log.message || '—')}
        ${log.details ? `
          <details style="margin-top:8px">
            <summary class="text-sm" style="cursor:pointer;color:var(--c-accent)">Детали лога</summary>
            <pre style="margin-top:8px;white-space:pre-wrap;word-break:break-word;font-size:12px;background:#f7f9fc;padding:10px;border-radius:10px">${escapeHtml(formatRawDetails(log.details))}</pre>
          </details>
        ` : ''}
      </td>
    </tr>
  `).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Когда</th><th>Тип</th><th>Статус</th><th>Сообщение</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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
    ? `<input type="hidden" name="type" value="${escapeHtml(type)}">`
    : types.map((value) => `<input type="hidden" name="types" value="${escapeHtml(value)}">`).join('');
  const sourceInput = triggerSource ? `<input type="hidden" name="triggerSource" value="${escapeHtml(triggerSource)}">` : '';

  return `
    <form action="/panel/parse-sessions/clear" method="post" style="margin:0" onsubmit="return confirm('${escapeHtml(confirm)}')">
      ${typeInputs}
      ${sourceInput}
      <button class="btn btn--danger btn--sm" type="submit">${escapeHtml(label)}</button>
    </form>
  `;
}

function summarizeSessions(sessions) {
  const runningSessions = sessions.filter((session) => session.status === 'running');
  return {
    latest: sessions[0] || null,
    runningSessions,
    running: runningSessions.length,
    success: sessions.filter((session) => session.status === 'success').length,
    partial: sessions.filter((session) => session.status === 'partial').length,
    errors: sessions.filter((session) => ['error', 'partial', 'aborted'].includes(session.status)).length,
    uploads: sessions.filter((session) => session.type === 'kaspi_upload').length,
    parses: sessions.filter((session) => session.type !== 'kaspi_upload').length,
    processedItems: sessions.reduce((sum, session) => sum + Number(session.success_count || 0), 0),
    errorItems: sessions.reduce((sum, session) => sum + Number(session.error_count || 0), 0),
    total: sessions.length,
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

function statusCardClass(status) {
  if (status === 'success') return 'session-metric--ok';
  if (status === 'running') return 'session-metric--blue';
  if (status === 'partial' || status === 'aborted') return 'session-metric--warn';
  return 'session-metric--danger';
}

function getProgress(session, upload, processedCount) {
  if (upload) {
    const total = Number(upload.totalCount || session.total_count || 0);
    const processed = Number(upload.processedCount || processedCount || 0);
    const errors = Number(upload.errorCount || session.error_count || 0);
    return buildProgress({ total, processed, success: Math.max(0, processed - errors), errors, status: session.status });
  }

  return buildProgress({
    total: Number(session.total_count || 0),
    processed: processedCount,
    success: Number(session.success_count || 0),
    errors: Number(session.error_count || 0),
    status: session.status,
  });
}

function buildProgress({ total, processed, success, errors, status }) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeProcessed = Math.max(0, Number(processed) || 0);
  const percent = safeTotal > 0
    ? Math.max(0, Math.min(100, Math.round((safeProcessed / safeTotal) * 100)))
    : status === 'success' ? 100 : 0;

  return {
    total: safeTotal || '—',
    processed: safeProcessed,
    success: Math.max(0, Number(success) || 0),
    errors: Math.max(0, Number(errors) || 0),
    percent,
  };
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

function sourceLabelText(source) {
  return source === 'auto' ? 'Авто' : 'Ручной';
}

function statusText(status) {
  const map = {
    success: 'Завершено успешно',
    running: 'Выполняется',
    partial: 'Завершено частично',
    aborted: 'Прервано',
    error: 'Ошибка',
  };
  return map[status] || 'Сессия';
}

function logStatusBadge(status) {
  if (status === 'success') return '<span class="badge badge--green">OK</span>';
  if (status === 'info') return '<span class="badge badge--blue">Info</span>';
  if (status === 'warning') return '<span class="badge badge--warning">Warn</span>';
  return '<span class="badge badge--red">Ошибка</span>';
}

function typeLabel(type) {
  const typeMap = {
    single_product: 'Один товар',
    all_products: 'Все товары',
    all_products_api: 'Все товары API',
    full_parse: 'Сформировать карточку',
    light_parse: 'Расчет цены',
    selected_products: 'Выбранные товары',
    auto_pricing: 'Расчет цены',
    kaspi_upload: 'Загрузка в Kaspi',
  };
  return typeMap[type] || type || 'Сессия';
}

function parseSessionDetails(detailsText) {
  if (!detailsText) return {};
  try {
    const details = JSON.parse(detailsText);
    return details && typeof details === 'object' ? details : {};
  } catch {
    return {};
  }
}

function formatRawDetails(detailsText) {
  if (!detailsText) return '{}';
  try {
    return JSON.stringify(JSON.parse(detailsText), null, 2);
  } catch {
    return String(detailsText);
  }
}

function shortError(error) {
  const value = String(error || '');
  if (!value) return '';
  return value.replace(/\s+/g, ' ').slice(0, 140);
}

function renderLocalDateTime(value) {
  return renderDateTime(value);
}

function formatDuration(session) {
  const durationMs = Number(session.duration_ms || 0);
  if (session.status === 'running' && session.started_at) {
    const runningMs = Date.now() - Date.parse(normalizeDateInput(session.started_at));
    return formatDurationMs(runningMs);
  }
  return formatDurationMs(durationMs);
}

function formatDurationMs(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds} сек`;
  return `${minutes} мин ${seconds} сек`;
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
    NO_COMPETITOR_ABOVE_MIN_PRICE: 'Нет конкурента выше минимума',
  };
  return reasonMap[value] || value || '—';
}

function formatCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : '—';
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
