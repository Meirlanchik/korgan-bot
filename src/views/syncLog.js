import { escapeHtml, formatDateTime } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderSyncLogPage({ logs, message, error }) {
    const rows = logs.map(l => {
        const dt = formatDateTime(l.created_at);
        const badge = l.status === 'success'
            ? '<span class="badge badge--green">OK</span>'
            : l.status === 'info'
                ? '<span class="badge badge--blue">INFO</span>'
                : l.status === 'partial'
                    ? '<span class="badge" style="background:#fff8e1;color:#f57f17">Частично</span>'
                    : '<span class="badge badge--red">Ошибка</span>';

        const typeMap = {
            auto_pricing: 'Расчет цены',
            product_parse: 'Формирование карточки',
            product_update: 'Сохранение товара',
            pull_kaspi: 'Скачивание из Kaspi',
            push_kaspi: 'Загрузка в Kaspi',
            xml_generate: 'Генерация XML',
            scheduler: 'Планировщик',
            settings: 'Настройки',
            server: 'Сервер',
            import: 'Импорт',
        };
        const typeLabel = typeMap[l.type] || escapeHtml(l.type);

        let details = '';
        if (l.details) {
            try {
                const d = JSON.parse(l.details);
                if (d.changes && d.changes.length) {
                    details = '<div style="margin-top:6px;font-size:12px">' +
                        d.changes.slice(0, 10).map(c =>
                            `<div class="text-muted">${escapeHtml(c.sku || '')}: ${escapeHtml(String(c.oldPrice || '?'))} → ${escapeHtml(String(c.newPrice || '?'))} (${escapeHtml(c.reason || '')})</div>`
                        ).join('') +
                        (d.changes.length > 10 ? `<div class="text-muted">...и ещё ${d.changes.length - 10}</div>` : '') +
                        '</div>';
                }
                if (d.results && d.results.length) {
                    details += '<div style="margin-top:6px;font-size:12px">' +
                        d.results.slice(0, 10).map(r =>
                            `<div class="text-muted">${escapeHtml(r.sku || '')}: ${escapeHtml(String(r.oldPrice ?? '?'))} → ${escapeHtml(String(r.newPrice ?? '?'))}</div>`
                        ).join('') +
                        (d.results.length > 10 ? `<div class="text-muted">...и ещё ${d.results.length - 10}</div>` : '') +
                        '</div>';
                }
                if (d.count !== undefined) {
                    details += `<div class="text-sm text-muted" style="margin-top:4px">Товаров: ${d.count}</div>`;
                }
                if (!details && typeof d === 'object') {
                    details += `<div class="text-sm text-muted" style="margin-top:4px">${escapeHtml(JSON.stringify(d))}</div>`;
                }
            } catch { /* ignore */ }
        }

        return `<tr>
      <td>${escapeHtml(dt)}</td>
      <td>${typeLabel}</td>
      <td>${badge}</td>
      <td>${escapeHtml(l.message || '—')}${details}</td>
    </tr>`;
    }).join('');

    return renderLayout({
        title: 'Журнал синхронизаций',
        activePage: 'synclog',
        message,
        error,
        content: `
      <div class="card card--flush">
        <div class="card__header">
          <h3 class="card__title">Журнал синхронизаций</h3>
          <span class="text-sm text-muted">Последние 100 записей</span>
        </div>
        ${rows ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Время</th><th>Тип</th><th>Статус</th><th>Сообщение</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `
        <div class="card__body">
          <p class="text-muted">Записей пока нет.</p>
        </div>`}
      </div>
    `,
    });
}
