import { escapeHtml } from '../utils.js';

export function renderError(error) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ошибка — korganBot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
  <script>
    (() => {
      const saved = localStorage.getItem('korgan-theme');
      const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = theme;
    })();
  </script>
  <style>
    *{box-sizing:border-box}
    :root{--bg:#eef3f8;--surface:rgba(255,255,255,.9);--border:#dce5ef;--text:#17202f;--text-muted:#56657a;--primary:#e31e24;--primary-hover:#b9151a;--shadow:0 14px 34px rgba(22,35,57,.09)}
    html[data-theme="dark"]{--bg:#071019;--surface:rgba(14,24,36,.86);--border:rgba(148,163,184,.2);--text:#ecf3fb;--text-muted:#b6c3d5;--primary:#ff514f;--primary-hover:#ff7370;--shadow:0 18px 46px rgba(0,0,0,.34)}
    html{background:var(--bg)}
    html[data-theme="dark"]{background:linear-gradient(135deg,#060b12 0%,#0b1724 52%,#101521 100%)}
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased}
    .err{background:var(--surface);border:1px solid var(--border);border-radius:28px;padding:56px 48px;max-width:480px;width:calc(100% - 32px);text-align:center;box-shadow:var(--shadow);backdrop-filter:blur(18px);animation:fadeIn .4s ease-out}
    .err__icon{font-size:64px;margin-bottom:20px;filter:drop-shadow(0 4px 12px rgba(0,0,0,.1))}
    .err__title{font-size:24px;font-weight:800;margin:0 0 10px;letter-spacing:-.03em}
    .err__message{font-size:15px;color:var(--text-muted);margin:0 0 28px;line-height:1.6;word-break:break-word}
    .err__back{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:16px;background:linear-gradient(135deg,var(--primary),#ff5a3d);color:#fff;text-decoration:none;font-weight:700;font-size:14px;transition:all .22s cubic-bezier(.4,0,.2,1);box-shadow:0 8px 20px rgba(227,30,36,.25)}
    .err__back:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(227,30,36,.35)}
    .err__back:active{transform:scale(.97)}
    @keyframes fadeIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    @media(max-width:480px){.err{padding:40px 28px;border-radius:22px}}
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
