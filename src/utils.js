export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

export const DISPLAY_TIME_ZONE =
  process.env.APP_TIME_ZONE
  || process.env.KASPI_TIME_ZONE
  || process.env.DISPLAY_TIME_ZONE
  || 'Asia/Almaty';

export function normalizeDateInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    return `${raw.replace(' ', 'T')}Z`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    return `${raw}Z`;
  }

  return raw;
}

export function formatDateTime(value, {
  dateStyle = 'short',
  timeStyle = 'medium',
  fallback = '—',
  timeZone = DISPLAY_TIME_ZONE,
} = {}) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return fallback;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value ?? fallback);

  return date.toLocaleString('ru-RU', {
    dateStyle,
    timeStyle,
    timeZone,
  });
}

export function renderDateTime(value, options = {}) {
  if (!value) return options.fallback || '—';

  return `<time data-local-datetime="${escapeAttr(value)}" data-date-style="${escapeAttr(options.dateStyle || 'short')}" data-time-style="${escapeAttr(options.timeStyle || 'medium')}" data-time-zone="${escapeAttr(options.timeZone || DISPLAY_TIME_ZONE)}">${escapeHtml(formatDateTime(value, options))}</time>`;
}

export function renderDateTimeScript() {
  return `<script>
  (() => {
    document.querySelectorAll('[data-local-datetime]').forEach((node) => {
      const value = node.getAttribute('data-local-datetime');
      if (!value) return;
      const normalized = /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(value)
        ? value.replace(' ', 'T') + 'Z'
        : /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?$/.test(value)
          ? value + 'Z'
          : value;
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return;
      const timeZone = node.getAttribute('data-time-zone') || ${JSON.stringify(DISPLAY_TIME_ZONE)};
      const dateStyle = node.getAttribute('data-date-style') || 'short';
      const timeStyle = node.getAttribute('data-time-style') || 'medium';
      node.textContent = new Intl.DateTimeFormat('ru-RU', { dateStyle, timeStyle, timeZone }).format(date);
      node.setAttribute('datetime', normalized);
    });
  })();
  </script>`;
}

export function safeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
