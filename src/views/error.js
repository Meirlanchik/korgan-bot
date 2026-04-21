import { escapeHtml } from '../utils.js';

export function renderError(error) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ошибка — Kaspi Panel</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#1a1d23}
    .err{background:#fff;border:1px solid #e1e5eb;border-radius:14px;padding:48px;max-width:480px;width:calc(100% - 32px);text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .err__icon{font-size:56px;margin-bottom:16px}
    .err__title{font-size:22px;font-weight:800;margin:0 0 8px}
    .err__message{font-size:15px;color:#5f6876;margin:0 0 24px;line-height:1.5;word-break:break-word}
    .err__back{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:8px;background:#e53935;color:#fff;text-decoration:none;font-weight:600;font-size:14px;transition:background .2s}
    .err__back:hover{background:#c62828}
  </style>
</head>
<body>
  <div class="err">
    <div class="err__icon">⚠️</div>
    <h1 class="err__title">Что-то пошло не так</h1>
    <p class="err__message">${escapeHtml(error.message)}</p>
    <a class="err__back" href="/panel/">← Вернуться в панель</a>
  </div>
</body>
</html>`;
}
