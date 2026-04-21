import { escapeHtml } from '../utils.js';

const ICONS = {
  home: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/></svg>',
  products: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>',
  upload: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
  autoPrice: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>',
  syncLog: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  finance: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-2.21 0-4 .895-4 2s1.79 2 4 2 4 .895 4 2-1.79 2-4 2m0-10c1.707 0 3.164.535 3.742 1.286M12 8V6m0 12v-2m0 0c-1.707 0-3.164-.535-3.742-1.286"/></svg>',
  download: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>',
  close: '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
  check: '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
  warn: '<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.4 14.31A1.73 1.73 0 003.42 21h17.16a1.73 1.73 0 001.53-2.83l-8.4-14.31a1.73 1.73 0 00-3.02 0z"/></svg>',
};

const CSS = `
/* ─── Reset & base ─── */
*,*::before,*::after{box-sizing:border-box}
:root{
  --c-bg:#f0f2f5;--c-surface:#fff;--c-border:#e1e5eb;
  --c-text:#1a1d23;--c-text-secondary:#5f6876;--c-text-muted:#8b93a1;
  --c-primary:#e53935;--c-primary-hover:#c62828;--c-primary-light:#ffebee;
  --c-accent:#1565c0;--c-accent-hover:#0d47a1;--c-accent-light:#e3f2fd;
  --c-success:#2e7d32;--c-success-light:#e8f5e9;--c-success-border:#a5d6a7;
  --c-danger:#c62828;--c-danger-light:#ffebee;--c-danger-border:#ef9a9a;
  --c-warning:#f57f17;--c-warning-light:#fffde7;
  --radius:10px;--radius-sm:6px;--radius-lg:14px;
  --shadow-sm:0 1px 3px rgba(0,0,0,.06);
  --shadow:0 2px 8px rgba(0,0,0,.08);
  --shadow-lg:0 8px 30px rgba(0,0,0,.12);
  --font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  --sidebar-w:260px;
  --transition:0.2s cubic-bezier(.4,0,.2,1);
}
html{font-family:var(--font);font-size:15px;color:var(--c-text);background:var(--c-bg);-webkit-font-smoothing:antialiased}
body{margin:0;min-height:100vh}
a{color:var(--c-accent);text-decoration:none}
a:hover{text-decoration:underline}

/* ─── Shell: sidebar + content ─── */
.shell{display:flex;min-height:100vh}

/* ─── Sidebar ─── */
.sidebar{
  position:fixed;top:0;left:0;bottom:0;width:var(--sidebar-w);
  background:#1a1d23;color:#c8cdd5;display:flex;flex-direction:column;
  z-index:100;transition:transform var(--transition);
}
.sidebar__logo{
  padding:24px 20px 20px;display:flex;align-items:center;gap:12px;
  border-bottom:1px solid rgba(255,255,255,.08);
}
.sidebar__logo-icon{
  width:38px;height:38px;border-radius:var(--radius);
  background:var(--c-primary);display:grid;place-items:center;
  font-weight:800;font-size:16px;color:#fff;flex-shrink:0;
}
.sidebar__logo-text{font-size:15px;font-weight:700;color:#fff;line-height:1.2}
.sidebar__logo-text small{display:block;font-size:11px;font-weight:400;color:#8b93a1;margin-top:2px}

.sidebar__nav{flex:1;padding:16px 12px;display:flex;flex-direction:column;gap:2px}
.nav-link{
  display:flex;align-items:center;gap:10px;padding:10px 14px;
  border-radius:var(--radius-sm);color:#c8cdd5;font-size:14px;
  font-weight:500;transition:all var(--transition);text-decoration:none;
}
.nav-link:hover{background:rgba(255,255,255,.06);color:#fff;text-decoration:none}
.nav-link.active{background:var(--c-primary);color:#fff}
.nav-link svg{flex-shrink:0;opacity:.7}
.nav-link.active svg{opacity:1}

.sidebar__footer{
  padding:16px 20px;border-top:1px solid rgba(255,255,255,.08);
  font-size:12px;color:#5f6876;
}

/* ─── Main content ─── */
.content{margin-left:var(--sidebar-w);flex:1;min-width:0}
.topbar{
  position:sticky;top:0;z-index:50;background:var(--c-surface);
  border-bottom:1px solid var(--c-border);padding:0 32px;
  height:60px;display:flex;align-items:center;justify-content:space-between;
  box-shadow:var(--shadow-sm);
}
.topbar__title{font-size:18px;font-weight:700;color:var(--c-text)}
.topbar__actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex:1;min-width:0}
.page{padding:28px 32px 48px;max-width:1280px;width:100%}
.live-strip{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;width:100%}
.live-pill{
  min-width:170px;max-width:240px;padding:8px 10px;border-radius:12px;
  border:1px solid var(--c-border);background:linear-gradient(180deg,#fff,#f8fafc);
  box-shadow:var(--shadow-sm);overflow:hidden;
}
.live-pill--running{border-color:#bbdefb;background:linear-gradient(180deg,#eef6ff,#fff)}
.live-pill--warn{border-color:#ffe082;background:linear-gradient(180deg,#fff8e1,#fff)}
.live-pill--error{border-color:#ef9a9a;background:linear-gradient(180deg,#fff1f1,#fff)}
.live-pill__label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-muted);margin-bottom:4px}
.live-pill__value{font-size:13px;font-weight:700;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.live-pill__note{font-size:11px;color:var(--c-text-secondary);margin-top:6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.live-pill__progress{height:6px;border-radius:999px;background:#e7edf5;overflow:hidden;margin-top:6px}
.live-pill__progress > span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--c-accent),#26a69a)}
.live-pill--warn .live-pill__progress > span{background:linear-gradient(90deg,var(--c-warning),#fbc02d)}
.live-pill--error .live-pill__progress > span{background:linear-gradient(90deg,var(--c-danger),#ef6c00)}
.live-pill--idle{min-width:auto}

/* ─── Mobile hamburger ─── */
.hamburger{
  display:none;background:none;border:0;padding:6px;cursor:pointer;color:var(--c-text);
}
.hamburger svg{width:24px;height:24px}
.overlay{display:none}

@media(max-width:900px){
  .sidebar{transform:translateX(-100%)}
  .sidebar.open{transform:translateX(0)}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99}
  .sidebar.open~.overlay{display:block}
  .content{margin-left:0}
  .hamburger{display:flex}
  .topbar{padding:0 16px}
  .topbar__actions{display:none}
  .page{padding:20px 16px 40px}
}

/* ─── Alerts ─── */
.alert{
  display:flex;align-items:flex-start;gap:10px;
  padding:14px 18px;border-radius:var(--radius);margin-bottom:20px;
  font-size:14px;line-height:1.5;animation:slideDown .25s ease-out;
}
.alert svg{flex-shrink:0;margin-top:1px}
.alert--success{background:var(--c-success-light);border:1px solid var(--c-success-border);color:var(--c-success)}
.alert--error{background:var(--c-danger-light);border:1px solid var(--c-danger-border);color:var(--c-danger)}
.alert__text{flex:1}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}

/* ─── Cards ─── */
.card{
  background:var(--c-surface);border:1px solid var(--c-border);
  border-radius:var(--radius-lg);padding:24px;margin-bottom:20px;
  box-shadow:var(--shadow-sm);
}
.card--flush{padding:0;overflow:hidden}
.card__header{
  padding:20px 24px;border-bottom:1px solid var(--c-border);
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
}
.card__title{font-size:16px;font-weight:700;margin:0}
.card__subtitle{font-size:13px;color:var(--c-text-secondary);margin:4px 0 0}
.card__body{padding:20px 24px}

/* ─── Stat cards grid ─── */
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat{
  background:var(--c-surface);border:1px solid var(--c-border);
  border-radius:var(--radius);padding:20px;box-shadow:var(--shadow-sm);
}
.stat__label{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--c-text-muted);margin-bottom:6px}
.stat__value{font-size:24px;font-weight:800;color:var(--c-text);line-height:1.1}
.stat__note{font-size:12px;color:var(--c-text-secondary);margin-top:4px}
.stat--danger{border-color:var(--c-danger-border);background:linear-gradient(180deg,#fff2f2,#fff)}

/* ─── Buttons ─── */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:9px 18px;border:0;border-radius:var(--radius-sm);
  font:inherit;font-size:14px;font-weight:600;cursor:pointer;
  transition:all var(--transition);text-decoration:none;line-height:1.4;
  white-space:nowrap;
}
.btn:hover{text-decoration:none}
.btn--primary{background:var(--c-primary);color:#fff}
.btn--primary:hover{background:var(--c-primary-hover)}
.btn--accent{background:var(--c-accent);color:#fff}
.btn--accent:hover{background:var(--c-accent-hover)}
.btn--success{background:var(--c-success);color:#fff}
.btn--success:hover{background:#1b5e20}
.btn--danger{background:var(--c-danger);color:#fff}
.btn--danger:hover{background:#b71c1c}
.btn--ghost{background:transparent;color:var(--c-text-secondary);border:1px solid var(--c-border)}
.btn--ghost:hover{background:var(--c-bg);color:var(--c-text)}
.btn--sm{padding:6px 12px;font-size:13px}
.btn--xs{padding:4px 8px;font-size:12px;border-radius:4px}

/* ─── Forms ─── */
.form-group{margin-bottom:18px}
.form-label{display:block;font-size:13px;font-weight:600;color:var(--c-text-secondary);margin-bottom:6px}
.form-hint{font-size:12px;color:var(--c-text-muted);margin-top:4px}
.form-static{padding:10px 0;font-size:14px;font-weight:600}
.form-input,.form-select,.form-file{
  width:100%;padding:10px 14px;border:1px solid var(--c-border);
  border-radius:var(--radius-sm);font:inherit;font-size:14px;
  background:var(--c-surface);color:var(--c-text);
  transition:border-color var(--transition),box-shadow var(--transition);
}
.form-input--sm,.form-select--sm{padding:6px 10px;font-size:13px}
.form-input:focus,.form-select:focus{
  outline:none;border-color:var(--c-primary);
  box-shadow:0 0 0 3px rgba(229,57,53,.12);
}
.form-file{padding:8px 12px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:600px){.form-row{grid-template-columns:1fr}}

.form-actions{display:flex;gap:10px;margin-top:24px;padding-top:20px;border-top:1px solid var(--c-border)}
.form-section{margin-top:28px;padding-top:24px;border-top:1px solid var(--c-border)}
.form-section__title{font-size:15px;font-weight:700;margin:0 0 4px;color:var(--c-text)}
.form-section__desc{font-size:13px;color:var(--c-text-secondary);margin:0 0 18px}

/* ─── Toggle switch ─── */
.toggle{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;font-weight:500}
.toggle input{display:none}
.toggle__track{
  width:44px;height:24px;background:#ccc;border-radius:12px;
  position:relative;transition:background var(--transition);flex-shrink:0;
}
.toggle__track::after{
  content:'';position:absolute;top:3px;left:3px;
  width:18px;height:18px;border-radius:50%;background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform var(--transition);
}
.toggle input:checked+.toggle__track{background:var(--c-primary)}
.toggle input:checked+.toggle__track::after{transform:translateX(20px)}

/* ─── Table ─── */
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:14px}
thead th{
  padding:12px 16px;text-align:left;font-size:12px;font-weight:600;
  text-transform:uppercase;letter-spacing:.4px;color:var(--c-text-muted);
  background:var(--c-bg);border-bottom:1px solid var(--c-border);
  white-space:nowrap;position:sticky;top:0;
}
tbody td{
  padding:12px 16px;border-bottom:1px solid var(--c-border);
  vertical-align:middle;color:var(--c-text);
}
tbody tr:hover{background:#f8f9fb}
tbody tr:last-child td{border-bottom:0}
td .cell-main{font-weight:600;color:var(--c-text)}
td .cell-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}

/* ─── Session dashboards ─── */
.session-hero{display:grid;grid-template-columns:minmax(280px,1.35fr) repeat(4,minmax(140px,1fr));gap:14px;margin-bottom:20px}
.session-focus,.session-metric{
  border-radius:18px;padding:18px;border:1px solid var(--c-border);
  box-shadow:var(--shadow-sm);min-height:126px;
}
.session-focus{
  background:linear-gradient(135deg,#18202d 0%,#253a5c 54%,#8e2524 100%);
  color:#fff;border:0;display:flex;flex-direction:column;justify-content:space-between;
}
.session-focus__label,.session-metric__label{font-size:12px;text-transform:uppercase;letter-spacing:.7px;opacity:.72;margin-bottom:8px}
.session-focus__title{font-size:24px;font-weight:850;line-height:1.05;margin:0 0 6px}
.session-focus__meta{font-size:13px;color:rgba(255,255,255,.78);line-height:1.45}
.session-metric{background:linear-gradient(180deg,#fff,#f8fafc)}
.session-metric--ok{background:linear-gradient(180deg,#f2fbf4,#fff)}
.session-metric--warn{background:linear-gradient(180deg,#fffbea,#fff)}
.session-metric--danger{background:linear-gradient(180deg,#fff1f1,#fff)}
.session-metric--blue{background:linear-gradient(180deg,#edf6ff,#fff)}
.session-metric__value{font-size:28px;font-weight:850;line-height:1;color:var(--c-text)}
.session-metric__note{font-size:12px;color:var(--c-text-secondary);margin-top:8px;line-height:1.35}
.session-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.session-progress{min-width:150px}
.session-progress__head{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--c-text-secondary);margin-bottom:6px}
.session-progress__bar{height:8px;border-radius:999px;background:#e9edf3;overflow:hidden}
.session-progress__fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--c-accent),#26a69a)}
.session-progress__fill--bad{background:linear-gradient(90deg,var(--c-danger),#ef6c00)}
.session-progress__fill--warn{background:linear-gradient(90deg,var(--c-warning),#fbc02d)}
.session-message{max-width:440px;line-height:1.45}
.session-message strong{display:block;margin-bottom:4px}
.session-link{display:block;color:inherit;text-decoration:none}
.session-link:hover .cell-main,.session-link:hover{color:var(--c-accent)}
.session-empty{
  padding:34px 24px;text-align:center;color:var(--c-text-secondary);
  background:linear-gradient(135deg,#fafafa,#f3f7fb);
}
.session-empty__title{font-weight:750;color:var(--c-text);font-size:16px;margin-bottom:4px}
@media(max-width:1100px){.session-hero{grid-template-columns:repeat(2,minmax(0,1fr))}.session-focus{grid-column:1/-1}}
@media(max-width:640px){.session-hero{grid-template-columns:1fr}.session-toolbar{width:100%}.session-toolbar .btn,.session-toolbar form{width:100%}.session-toolbar button{width:100%}}
td .cell-sub{font-size:12px;color:var(--c-text-muted)}

/* ─── Badges ─── */
.badge{
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;
}
.badge--green{background:#e8f5e9;color:#2e7d32}
.badge--red{background:#ffebee;color:#c62828}
.badge--gray{background:#f0f2f5;color:#5f6876}
.badge--blue{background:#e3f2fd;color:#1565c0}

/* ─── Action buttons in tables ─── */
.actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.actions form{display:inline;margin:0;padding:0;border:0;background:none}

/* ─── Empty state ─── */
.empty{text-align:center;padding:48px 24px;color:var(--c-text-muted)}
.empty__icon{font-size:48px;margin-bottom:12px;opacity:.4}
.empty__text{font-size:15px;margin-bottom:16px}

/* ─── Info grid (key-value) ─── */
.info-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.info-item{}
.info-item__label{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--c-text-muted);margin-bottom:2px}
.info-item__value{font-size:15px;font-weight:600;color:var(--c-text);word-break:break-all}

/* ─── Quick action buttons ─── */
.quick-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.quick-actions form{display:inline;margin:0;padding:0;border:0;background:none}

/* ─── File drop zone ─── */
.dropzone{
  border:2px dashed var(--c-border);border-radius:var(--radius);
  padding:32px;text-align:center;cursor:pointer;
  transition:all var(--transition);position:relative;
}
.dropzone:hover,.dropzone.drag-over{border-color:var(--c-primary);background:var(--c-primary-light)}
.dropzone input[type="file"]{
  position:absolute;inset:0;opacity:0;cursor:pointer;
}
.dropzone__icon{font-size:36px;margin-bottom:8px;opacity:.5}
.dropzone__text{font-size:14px;color:var(--c-text-secondary)}
.dropzone__hint{font-size:12px;color:var(--c-text-muted);margin-top:4px}

/* ─── Code ─── */
code{
  display:inline;padding:2px 7px;border-radius:4px;font-size:13px;
  background:#f0f2f5;color:var(--c-text);font-family:'SF Mono',Monaco,Consolas,monospace;
}

/* ─── Utilities ─── */
.mt-0{margin-top:0}.mb-0{margin-bottom:0}
.gap-sm{gap:8px}.gap-md{gap:16px}
.flex{display:flex}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}
.justify-between{justify-content:space-between}
.text-muted{color:var(--c-text-muted)}
.text-sm{font-size:13px}
.fw-600{font-weight:600}
.w-full{width:100%}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}

/* ─── Modal ─── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:none;place-items:center}
.modal-overlay.active{display:grid}
.modal{background:var(--c-surface);border-radius:var(--radius-lg);padding:0;max-width:600px;width:calc(100% - 32px);max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg)}
.modal__header{padding:20px 24px;border-bottom:1px solid var(--c-border);display:flex;justify-content:space-between;align-items:center}
.modal__header h3{margin:0;font-size:16px;font-weight:700}
.modal__body{padding:20px 24px}
.modal__close{background:none;border:0;cursor:pointer;padding:4px;color:var(--c-text-muted)}

/* ─── Bulk bar ─── */
.bulk-bar{position:fixed;bottom:0;left:var(--sidebar-w);right:0;background:var(--c-surface);border-top:2px solid var(--c-primary);padding:12px 24px;display:none;align-items:center;gap:12px;z-index:80;box-shadow:0 -4px 20px rgba(0,0,0,.1);flex-wrap:wrap}
.bulk-bar.active{display:flex}
.bulk-bar__count{font-weight:700;font-size:14px;color:var(--c-primary);white-space:nowrap}
.bulk-bar__form{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1}
.bulk-warehouse-details{min-width:190px}
.bulk-warehouse-details[open]{flex-basis:100%}
.bulk-warehouse-summary{list-style:none}
.bulk-warehouse-summary::-webkit-details-marker{display:none}
.bulk-warehouse-panel{
  margin-top:10px;padding:14px;border:1px solid var(--c-border);border-radius:var(--radius);
  background:#f8fafb;max-width:min(1080px,calc(100vw - 80px));max-height:min(55vh,520px);overflow:auto;
}
.bulk-warehouse-grid{grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.bulk-warehouse-card{background:var(--c-surface)}
@media(max-width:900px){.bulk-bar{left:0}}
@media(max-width:900px){.bulk-warehouse-panel{max-width:100%}}

/* ─── Sortable headers ─── */
th.sortable{cursor:pointer;user-select:none;position:relative}
th.sortable:hover{color:var(--c-primary)}
th.sortable::after{content:'';display:inline-block;width:0;height:0;margin-left:6px;vertical-align:middle;opacity:.3}
th.sortable.asc::after{border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid currentColor;opacity:1}
th.sortable.desc::after{border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;opacity:1}

/* ─── Product image ─── */
.product-img{width:40px;height:40px;border-radius:6px;object-fit:cover;background:#f0f2f5;flex-shrink:0}
.product-img-lg{width:80px;height:80px;border-radius:8px;object-fit:cover;background:#f0f2f5}
.product-img-xl{width:120px;height:120px;border-radius:10px;object-fit:cover;background:#f0f2f5}
.product-gallery{display:flex;gap:8px;flex-wrap:wrap}

/* ─── Warehouses ─── */
.warehouse-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.warehouse-card{border:1px solid var(--c-border);border-radius:var(--radius);padding:16px;background:#fafbfc}
.warehouse-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.warehouse-card__title{font-size:15px;font-weight:700;color:var(--c-text);margin:0}
.warehouse-card__meta{font-size:12px;color:var(--c-text-muted);word-break:break-all}
.warehouse-card__fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.warehouse-card__fields .form-group{margin-bottom:0}
.warehouse-card__fields .form-group--full{grid-column:1 / -1}
@media(max-width:640px){.warehouse-card__fields{grid-template-columns:1fr}}

/* ─── Tabs ─── */
.tabs{display:flex;gap:0;border-bottom:2px solid var(--c-border);margin-bottom:20px}
.tab{padding:10px 20px;font-size:14px;font-weight:600;color:var(--c-text-muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all var(--transition)}
.tab:hover{color:var(--c-text)}
.tab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.tab-content{display:none}
.tab-content.active{display:block}

/* ─── Seller row ─── */
.seller-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--c-border)}
.seller-row:last-child{border-bottom:0}
.seller-row.is-me{background:var(--c-primary-light);margin:0 -24px;padding:8px 24px;border-radius:var(--radius-sm)}
.seller-name{font-weight:500;font-size:14px}
.seller-price{font-weight:700;font-size:14px}
.seller-meta{font-size:12px;color:var(--c-text-muted)}

/* ─── Clickable price ─── */
.price-click{cursor:pointer;color:var(--c-accent);text-decoration:underline;font-weight:700}
.price-click:hover{color:var(--c-accent-hover)}
.automation-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.automation-card{border:1px solid var(--c-border);border-radius:var(--radius);padding:18px;background:linear-gradient(180deg,#fff,#f9fbfd)}
.automation-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.automation-card__title{font-size:15px;font-weight:700;color:var(--c-text)}
.automation-card__meta{font-size:12px;color:var(--c-text-muted);margin-top:4px}
.merchant-list{display:grid;gap:12px}
.merchant-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}
.event-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--c-border)}
.event-row:last-child{border-bottom:0}
@media(max-width:640px){.merchant-row{grid-template-columns:1fr}}
`;

const NAV_ITEMS = [
  { id: 'home', href: '/panel/', label: 'Главная', icon: ICONS.home },
  { id: 'products', href: '/panel/products', label: 'Товары', icon: ICONS.products },
  { id: 'finance', href: '/panel/finance', label: 'Финансы', icon: ICONS.finance },
  { id: 'history', href: '/panel/history', label: 'История', icon: ICONS.syncLog },
  { id: 'settings', href: '/panel/settings', label: 'Настройки', icon: ICONS.autoPrice },
  { id: 'xml', href: '/panel/xml', label: 'Загрузить XML', icon: ICONS.upload },
  { id: 'download', href: '/panel/download', label: 'Скачать XML', icon: ICONS.download },
];

export function renderLayout({ title, content, message, error, activePage = '' }) {
  const nav = NAV_ITEMS.map((item) =>
    `<a class="nav-link${item.id === activePage ? ' active' : ''}" href="${item.href}">${item.icon}<span>${item.label}</span></a>`
  ).join('');

  const alertHtml = [
    message ? `<div class="alert alert--success">${ICONS.check}<div class="alert__text">${escapeHtml(message)}</div></div>` : '',
    error ? `<div class="alert alert--error">${ICONS.warn}<div class="alert__text">${escapeHtml(error)}</div></div>` : '',
  ].join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — Kaspi Panel</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar__logo">
        <div class="sidebar__logo-icon">K</div>
        <div class="sidebar__logo-text">Kaspi Panel<small>Управление прайс-листом</small></div>
      </div>
      <nav class="sidebar__nav">${nav}</nav>
      <div class="sidebar__footer">&copy; ${new Date().getFullYear()} Kaspi Price Manager</div>
    </aside>
    <div class="overlay" id="overlay" onclick="document.getElementById('sidebar').classList.remove('open');this.style.display='none'"></div>
    <div class="content">
      <header class="topbar">
        <div class="flex items-center gap-sm">
          <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open');document.getElementById('overlay').style.display='block'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <span class="topbar__title">${escapeHtml(title)}</span>
        </div>
        <div class="topbar__actions" id="topbar-actions"></div>
      </header>
      <div class="page">
        <div id="page-alerts">${alertHtml}</div>
        ${content}
      </div>
    </div>
  </div>
  <script>
  (() => {
    const alertsHost = document.getElementById('page-alerts');
    const topbarActions = document.getElementById('topbar-actions');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const endpoint = protocol + '://' + location.host + '/ws';
    let reconnectTimer = null;
    const sessionStore = new Map();
    const trackedTypes = new Set(['light_parse', 'auto_pricing', 'full_parse', 'selected_products', 'single_product', 'kaspi_download', 'kaspi_upload']);
    const checkIcon = ${JSON.stringify(ICONS.check)};
    const warnIcon = ${JSON.stringify(ICONS.warn)};

    const showAlert = (type, text) => {
      if (!alertsHost || !text) return;
      const node = document.createElement('div');
      node.className = 'alert ' + (type === 'error' ? 'alert--error' : 'alert--success');
      node.innerHTML = (type === 'error' ? warnIcon : checkIcon) + '<div class="alert__text"></div>';
      const textNode = node.querySelector('.alert__text');
      if (textNode) {
        textNode.textContent = String(text || '');
      }
      alertsHost.prepend(node);
      setTimeout(() => {
        node.remove();
      }, 5000);
    };

    const formatDateTime = (value) => {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Almaty',
      }).format(date);
    };

    const parseSessionDetails = (value) => {
      if (!value) return {};
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    };

    const progressForSession = (session) => {
      const details = parseSessionDetails(session?.details);
      const upload = details.upload || null;
      if (upload) {
        const total = Number(upload.totalCount || session?.total_count || 0);
        const processed = Number(upload.processedCount || session?.success_count || 0) + Number(upload.errorCount || 0);
        const errors = Number(upload.errorCount || session?.error_count || 0);
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : (session?.status === 'success' ? 100 : 0);
        return { total, processed, errors, percent };
      }
      const total = Number(session?.total_count || 0);
      const processed = Number(session?.success_count || 0) + Number(session?.error_count || 0);
      const errors = Number(session?.error_count || 0);
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : (session?.status === 'success' ? 100 : 0);
      return { total, processed, errors, percent };
    };

    const groupKeyForType = (type) => {
      if (type === 'light_parse' || type === 'auto_pricing') return 'pricing';
      if (type === 'full_parse' || type === 'selected_products' || type === 'single_product') return 'build';
      if (type === 'kaspi_download') return 'pull';
      if (type === 'kaspi_upload') return 'push';
      return 'other';
    };

    const groupLabel = (groupKey) => {
      if (groupKey === 'pricing') return 'Расчет цены';
      if (groupKey === 'build') return 'Формирование';
      if (groupKey === 'pull') return 'Загрузка с Kaspi';
      if (groupKey === 'push') return 'Выгрузка в Kaspi';
      return 'Фоновые задачи';
    };

    const preferSession = (candidate, current) => {
      if (!current) return true;
      if (candidate.status === 'running' && current.status !== 'running') return true;
      if (candidate.status !== 'running' && current.status === 'running') return false;
      return Number(candidate.id || 0) > Number(current.id || 0);
    };

    const buildLiveCard = (session) => {
      const progress = progressForSession(session);
      const details = parseSessionDetails(session?.details);
      const upload = details.upload || null;
      const groupKey = groupKeyForType(session.type);
      const tone = session.status === 'error'
        ? 'live-pill live-pill--error'
        : session.status === 'partial' || session.status === 'aborted'
          ? 'live-pill live-pill--warn'
          : session.status === 'running'
            ? 'live-pill live-pill--running'
            : 'live-pill';
      const meta = progress.total
        ? (String(progress.processed) + '/' + String(progress.total) + ' • ' + String(progress.percent) + '%')
        : session.status === 'running'
          ? 'В работе'
          : 'Ожидание';
      const note = upload?.statusText || session.message || 'Фоновая задача активна';
      return '<div class="' + tone + '">'
        + '<div class="live-pill__label">' + groupLabel(groupKey) + '</div>'
        + '<div class="live-pill__value">#' + String(session.id || '—') + ' • ' + meta + '</div>'
        + '<div class="live-pill__progress"><span style="width:' + String(progress.percent || 0) + '%"></span></div>'
        + '<div class="live-pill__note">' + String(note || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
        + '</div>';
    };

    const renderTopbarLiveStrip = () => {
      if (!topbarActions) return;
      const grouped = new Map();
      for (const session of sessionStore.values()) {
        if (!trackedTypes.has(session.type)) continue;
        const groupKey = groupKeyForType(session.type);
        const current = grouped.get(groupKey);
        if (preferSession(session, current)) {
          grouped.set(groupKey, session);
        }
      }

      const items = ['build', 'pricing', 'pull', 'push']
        .map((groupKey) => grouped.get(groupKey))
        .filter(Boolean);

      if (!items.length) {
        topbarActions.innerHTML = '<div class="live-strip"><div class="live-pill live-pill--idle"><div class="live-pill__label">Фоновые задачи</div><div class="live-pill__value">Сейчас спокойно</div><div class="live-pill__note">Новых активных сессий нет</div></div></div>';
        return;
      }

      topbarActions.innerHTML = '<div class="live-strip">' + items.map(buildLiveCard).join('') + '</div>';
    };

    const loadInitialSessions = async () => {
      try {
        const response = await fetch('/api/parse-sessions?limit=40', {
          headers: { Accept: 'application/json' },
        });
        const sessions = await response.json();
        if (Array.isArray(sessions)) {
          sessions.forEach((session) => {
            if (session && session.id != null) {
              sessionStore.set(String(session.id), session);
            }
          });
        }
      } catch {
        // Ignore initial realtime dashboard bootstrap issues.
      }
      renderTopbarLiveStrip();
    };

    window.KaspiPanel = Object.assign(window.KaspiPanel || {}, {
      showAlert,
      formatDateTime,
    });

    const connect = () => {
      let socket;
      try {
        socket = new WebSocket(endpoint);
      } catch {
        reconnect();
        return;
      }

      window.KaspiPanelSocket = socket;

      socket.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          document.dispatchEvent(new CustomEvent('kaspi:ws', { detail: parsed }));
          if (parsed && parsed.type) {
            if (parsed.type === 'parse_session_updated' && parsed.payload && parsed.payload.id != null) {
              sessionStore.set(String(parsed.payload.id), parsed.payload);
              renderTopbarLiveStrip();
            }
            document.dispatchEvent(new CustomEvent('kaspi:' + parsed.type, { detail: parsed.payload }));
          }
        } catch {
          // Ignore invalid socket frames.
        }
      });

      socket.addEventListener('close', reconnect);
      socket.addEventListener('error', () => {
        try {
          socket.close();
        } catch {
          // Ignore double close.
        }
      });
    };

    const reconnect = () => {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 2000);
    };

    connect();
    loadInitialSessions();
  })();
  </script>
</body>
</html>`;
}
