import { escapeHtml } from '../utils.js';
import { getSetting } from '../db.js';
import { getPanelAuthToken } from '../panelAuth.js';

const ICONS = {
  home: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/></svg>',
  products: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>',
  upload: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
  autoPrice: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>',
  syncLog: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  finance: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-2.21 0-4 .895-4 2s1.79 2 4 2 4 .895 4 2-1.79 2-4 2m0-10c1.707 0 3.164.535 3.742 1.286M12 8V6m0 12v-2m0 0c-1.707 0-3.164-.535-3.742-1.286"/></svg>',
  download: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>',
  profile: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 21a8 8 0 10-16 0"/><circle cx="12" cy="7" r="4"/></svg>',
  theme: '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0l-1.42-1.42M7.06 7.06L5.64 5.64"/><circle cx="12" cy="12" r="4"/></svg>',
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
.topbar__actions{display:flex;gap:8px;align-items:center}
.page{padding:28px 32px 48px;max-width:1280px;width:100%}

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
  white-space:nowrap;
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

/* ─── 2026 Design Refresh ─── */
:root{
  --c-bg:#eef3f8;--c-surface:rgba(255,255,255,.9);--c-surface-solid:#fff;
  --c-border:#dce5ef;--c-border-strong:#c5d2df;
  --c-text:#17202f;--c-text-secondary:#56657a;--c-text-muted:#8a98aa;
  --c-primary:#e31e24;--c-primary-hover:#b9151a;--c-primary-light:#fff0f1;
  --c-accent:#0f766e;--c-accent-hover:#115e59;--c-accent-light:#e6fffb;
  --c-success:#16803c;--c-success-light:#ecfdf3;--c-success-border:#b8efc8;
  --c-danger:#b42318;--c-danger-light:#fff1f0;--c-danger-border:#ffb7ad;
  --c-warning:#b7791f;--c-warning-light:#fff8e5;
  --radius:14px;--radius-sm:10px;--radius-lg:24px;--radius-xl:32px;
  --shadow-sm:0 1px 2px rgba(16,24,40,.05),0 1px 4px rgba(16,24,40,.04);
  --shadow:0 14px 34px rgba(22,35,57,.09);
  --shadow-lg:0 22px 60px rgba(22,35,57,.16);
  --font:'Manrope','Nunito Sans','Segoe UI',Arial,sans-serif;
  --sidebar-w:286px;
}
html{background:
  radial-gradient(circle at 16% -8%,rgba(227,30,36,.18),transparent 32%),
  radial-gradient(circle at 100% 10%,rgba(15,118,110,.16),transparent 34%),
  linear-gradient(135deg,#f8fbff 0%,#edf3f8 48%,#f8faf7 100%);
  color:var(--c-text);
}
body{background:transparent}
.shell::before{
  content:'';position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:linear-gradient(rgba(23,32,47,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(23,32,47,.04) 1px,transparent 1px);
  background-size:34px 34px;mask-image:linear-gradient(to bottom,#000,transparent 82%);
}
.sidebar{
  margin:16px 0 16px 16px;height:calc(100vh - 32px);bottom:auto;border-radius:28px;
  background:linear-gradient(160deg,#141925 0%,#202a3d 52%,#3a171b 100%);
  color:#dce6f2;box-shadow:var(--shadow-lg);overflow:hidden;
}
.sidebar::after{
  content:'';position:absolute;left:-40px;bottom:-70px;width:180px;height:180px;
  border-radius:999px;background:rgba(227,30,36,.22);filter:blur(8px);
}
.sidebar__logo{padding:26px 22px 22px;border-bottom:1px solid rgba(255,255,255,.1);position:relative;z-index:1}
.sidebar__logo-icon{
  width:44px;height:44px;border-radius:16px;background:linear-gradient(135deg,var(--c-primary),#ff8a4c);
  box-shadow:0 12px 28px rgba(227,30,36,.35);font-size:18px;
}
.sidebar__logo-text{font-size:16px;letter-spacing:-.02em}
.sidebar__nav{padding:18px 14px;gap:6px;position:relative;z-index:1}
.nav-link{
  padding:12px 14px;border-radius:16px;color:#d5dfeb;border:1px solid transparent;
}
.nav-link:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.09);transform:translateX(2px)}
.nav-link.active{
  background:linear-gradient(135deg,#fff,#f7fbff);color:#182132;box-shadow:0 16px 28px rgba(0,0,0,.16);
}
.nav-link.active svg{color:var(--c-primary)}
.sidebar__footer{position:relative;z-index:1;color:#9fadbf}
.content{margin-left:calc(var(--sidebar-w) + 16px);position:relative}
.topbar{
  top:16px;margin:16px 24px 0;padding:0 20px;height:68px;border:1px solid rgba(255,255,255,.7);
  border-radius:24px;background:rgba(255,255,255,.76);backdrop-filter:blur(18px);
  box-shadow:var(--shadow);border-bottom-color:rgba(255,255,255,.7);
}
.topbar__title{font-size:22px;font-weight:850;letter-spacing:-.04em}
.topbar__actions::before{
  content:'online';padding:7px 10px;border-radius:999px;background:var(--c-success-light);
  color:var(--c-success);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;
}
.page{max-width:1480px;padding:24px 24px 64px}
.card{
  border:1px solid rgba(255,255,255,.78);background:var(--c-surface);
  backdrop-filter:blur(18px);border-radius:var(--radius-lg);box-shadow:var(--shadow);
}
.card--flush{overflow:hidden}
.card__header{border-bottom:1px solid var(--c-border);padding:22px 24px}
.card__title{font-size:18px;font-weight:850;letter-spacing:-.03em}
.card__subtitle{color:var(--c-text-secondary)}
.card__body{padding:22px 24px}
.stats{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px}
.stat{
  position:relative;overflow:hidden;border-radius:22px;border:1px solid rgba(255,255,255,.78);
  background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(255,255,255,.72));box-shadow:var(--shadow-sm);
}
.stat::after{
  content:'';position:absolute;right:-28px;top:-38px;width:110px;height:110px;border-radius:999px;
  background:rgba(15,118,110,.08);
}
.stat__label{font-weight:850;color:#718096}
.stat__value{font-size:28px;letter-spacing:-.045em}
.btn{border-radius:14px;box-shadow:0 1px 0 rgba(255,255,255,.28) inset}
.btn--primary{background:linear-gradient(135deg,var(--c-primary),#ff5a3d)}
.btn--accent{background:linear-gradient(135deg,var(--c-accent),#14b8a6)}
.btn--success{background:linear-gradient(135deg,var(--c-success),#22c55e)}
.btn--ghost{background:rgba(255,255,255,.64);border:1px solid var(--c-border);color:var(--c-text-secondary)}
.btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(22,35,57,.12)}
.btn:disabled{cursor:not-allowed;opacity:.64;transform:none}
.form-input,.form-select,.form-file{
  border-radius:14px;border-color:var(--c-border-strong);background:rgba(255,255,255,.86);
}
.form-input:focus,.form-select:focus{border-color:var(--c-accent);box-shadow:0 0 0 4px rgba(15,118,110,.13)}
thead th{background:#f3f7fb;color:#69778a}
tbody tr{transition:background var(--transition),transform var(--transition)}
tbody tr:hover{background:rgba(15,118,110,.045)}
.badge{font-weight:850;border:1px solid transparent}
.badge--green{border-color:#b8efc8}
.badge--blue{background:#eaf5ff;color:#1769aa;border-color:#b9ddff}
.badge--gray{background:#eef2f6}
.quick-actions{gap:12px}
.quick-actions form{display:inline-flex}
.hero-panel{
  position:relative;overflow:hidden;margin-bottom:22px;padding:28px;border-radius:32px;color:#fff;
  background:linear-gradient(135deg,#111827 0%,#193346 48%,#b42318 125%);
  box-shadow:var(--shadow-lg);
}
.hero-panel::before{
  content:'';position:absolute;right:-90px;top:-110px;width:300px;height:300px;border-radius:999px;
  background:radial-gradient(circle,rgba(255,255,255,.24),transparent 64%);
}
.hero-panel::after{
  content:'';position:absolute;left:32%;bottom:-120px;width:260px;height:260px;border-radius:999px;
  background:radial-gradient(circle,rgba(20,184,166,.26),transparent 68%);
}
.hero-panel__content{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:end}
.hero-kicker{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.68);font-weight:900;margin-bottom:10px}
.hero-title{font-size:clamp(30px,4vw,54px);line-height:.95;letter-spacing:-.07em;margin:0 0 12px;font-weight:950}
.hero-text{max-width:760px;color:rgba(255,255,255,.78);font-size:15px;line-height:1.65}
.hero-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.hero-actions .btn--ghost{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.22)}
.status-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:24px;position:relative;z-index:1}
.status-chip{padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(12px)}
.status-chip__label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.62);font-weight:900}
.status-chip__value{margin-top:6px;font-size:20px;font-weight:900;letter-spacing:-.03em}
.automation-card{border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(247,250,252,.82));box-shadow:var(--shadow-sm)}
.session-focus{background:linear-gradient(135deg,#101828 0%,#1f3b52 55%,#b42318 130%)}
.session-metric{border-radius:22px;background:rgba(255,255,255,.86)}
#page-alerts{
  position:fixed;right:20px;bottom:20px;z-index:300;display:grid;gap:10px;
  max-width:min(440px,calc(100vw - 32px));pointer-events:none;
}
#page-alerts .alert{margin:0;box-shadow:var(--shadow-lg);pointer-events:auto;background:rgba(255,255,255,.95);backdrop-filter:blur(14px)}
.page > .alert{box-shadow:var(--shadow-sm)}
.loading-dim{opacity:.64;pointer-events:none}
@media(max-width:900px){
  .sidebar{margin:0;height:100vh;border-radius:0}
  .content{margin-left:0}
  .topbar{top:0;margin:0;border-radius:0;border-left:0;border-right:0;border-top:0}
  .page{padding:18px 14px 48px}
  .topbar__actions::before{display:none}
  .hero-panel__content{grid-template-columns:1fr}
  .hero-actions{justify-content:flex-start}
}

/* ─── korganBot top header ─── */
.shell{display:block;min-height:100vh}
.content{margin-left:0;padding-top:104px}
.app-header{
  position:fixed;top:14px;left:18px;right:18px;z-index:120;
  min-height:74px;padding:12px 14px;display:grid;
  grid-template-columns:auto minmax(260px,1fr) minmax(220px,auto) auto;gap:12px;align-items:center;
  border:1px solid rgba(255,255,255,.78);border-radius:26px;
  background:rgba(255,255,255,.78);backdrop-filter:blur(20px);box-shadow:var(--shadow);
}
.brand-mark{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--c-text)}
.brand-mark:hover{text-decoration:none}
.brand-mark__logo{
  width:44px;height:44px;border-radius:16px;display:grid;place-items:center;
  background:linear-gradient(135deg,#e31e24,#ff8a4c);color:#fff;font-weight:950;letter-spacing:-.08em;
  box-shadow:0 14px 30px rgba(227,30,36,.28);
}
.brand-mark__text{font-size:18px;font-weight:950;letter-spacing:-.05em;white-space:nowrap}
.header-nav{display:flex;align-items:center;gap:6px;min-width:0;overflow-x:auto;scrollbar-width:none}
.header-nav::-webkit-scrollbar{display:none}
.header-nav .nav-link{
  color:var(--c-text-secondary);background:rgba(255,255,255,.45);border:1px solid transparent;
  border-radius:16px;padding:10px 12px;white-space:nowrap;transform:none;
}
.header-nav .nav-link:hover{color:var(--c-text);background:rgba(255,255,255,.84);border-color:var(--c-border);transform:none}
.header-nav .nav-link.active{background:#17202f;color:#fff;box-shadow:0 12px 24px rgba(23,32,47,.14)}
.header-nav .nav-link.active svg{color:#fff}
.merchant-header{
  justify-self:center;text-align:center;padding:8px 16px;border-radius:18px;
  background:linear-gradient(180deg,rgba(255,255,255,.8),rgba(248,250,252,.64));border:1px solid var(--c-border);
  min-width:220px;
}
.merchant-header__label{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:var(--c-text-muted)}
.merchant-header__name{font-size:15px;font-weight:900;color:var(--c-text);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.merchant-header__id{font-size:12px;color:var(--c-text-secondary);margin-top:1px}
.profile-chip{
  display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:18px;
  color:var(--c-text);background:#fff;border:1px solid var(--c-border);text-decoration:none;font-weight:850;
  box-shadow:var(--shadow-sm);white-space:nowrap;
}
.profile-chip:hover{text-decoration:none;transform:translateY(-1px);box-shadow:var(--shadow)}
.topbar,.sidebar,.overlay{display:none}
.topbar__actions::before{content:none;display:none}
.page{padding-top:10px}
.page-field-title{display:none}
.label-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.label-row .form-label{margin-bottom:0}
.help-dot{
  width:20px;height:20px;border-radius:999px;border:1px solid var(--c-border-strong);
  background:#fff;color:var(--c-text-secondary);display:inline-grid;place-items:center;
  font-size:12px;font-weight:950;cursor:pointer;line-height:1;padding:0;
}
.help-dot:hover{color:var(--c-accent);border-color:var(--c-accent)}
.help-popover{
  position:fixed;z-index:500;max-width:min(320px,calc(100vw - 28px));
  padding:12px 14px;border-radius:16px;background:#17202f;color:#fff;
  box-shadow:var(--shadow-lg);font-size:13px;line-height:1.45;
}
.icon-btn{
  width:38px;height:38px;border-radius:14px;border:1px solid var(--c-border);
  background:#fff;color:var(--c-text);display:inline-grid;place-items:center;text-decoration:none;cursor:pointer;
}
.icon-btn:hover{text-decoration:none;color:var(--c-accent);box-shadow:var(--shadow-sm)}
.profile-grid{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(0,1.4fr);gap:18px;align-items:start}
.profile-hero{
  min-height:260px;display:flex;flex-direction:column;justify-content:flex-end;gap:18px;
  background:linear-gradient(135deg,#101828 0%,#173449 55%,#e31e24 145%);color:#fff;overflow:hidden;position:relative;
}
.profile-hero::after{
  content:'';position:absolute;right:-90px;top:-80px;width:260px;height:260px;border-radius:999px;
  background:radial-gradient(circle,rgba(255,255,255,.24),transparent 66%);
}
.profile-hero__mark{
  width:64px;height:64px;border-radius:22px;display:grid;place-items:center;font-size:34px;font-weight:950;
  background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.24);backdrop-filter:blur(12px);
}
.profile-hero__eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.66);font-weight:900}
.profile-hero__title{margin:6px 0 8px;font-size:clamp(30px,4vw,46px);line-height:.98;letter-spacing:-.07em}
.profile-hero__meta{color:rgba(255,255,255,.78);font-weight:750}
.settings-grid{display:grid;grid-template-columns:minmax(280px,.82fr) minmax(0,1.18fr);gap:18px;align-items:start}
.product-filter-bar{
  position:sticky;top:104px;z-index:60;backdrop-filter:blur(18px);
}
.filter-chips{display:inline-flex;align-items:center;gap:6px;padding:4px;border:1px solid var(--c-border);border-radius:16px;background:rgba(255,255,255,.64)}
.filter-chip{
  border:0;background:transparent;color:var(--c-text-secondary);border-radius:12px;
  padding:8px 11px;font:inherit;font-size:13px;font-weight:850;cursor:pointer;white-space:nowrap;
}
.filter-chip:hover{background:#fff;color:var(--c-text)}
.filter-chip.active{background:#17202f;color:#fff;box-shadow:var(--shadow-sm)}
.product-detail-grid{display:grid;grid-template-columns:minmax(280px,440px) minmax(0,1fr);gap:22px;align-items:start}
.gallery-viewer{position:relative;border-radius:26px;overflow:hidden;background:#f3f7fb;border:1px solid var(--c-border)}
.gallery-main{width:100%;height:420px;object-fit:contain;background:linear-gradient(135deg,#f8fafc,#eef3f8);display:block}
.gallery-empty{height:360px;border:1px dashed var(--c-border-strong);border-radius:24px;display:grid;place-items:center;color:var(--c-text-muted);background:#f7fafc}
.gallery-nav{
  position:absolute;top:42%;transform:translateY(-50%);width:40px;height:40px;border-radius:999px;
  border:1px solid rgba(255,255,255,.8);background:rgba(255,255,255,.82);backdrop-filter:blur(10px);
  color:var(--c-text);font-size:28px;line-height:1;cursor:pointer;z-index:2;
}
.gallery-nav--prev{left:12px}.gallery-nav--next{right:12px}
.gallery-thumbs{display:flex;gap:8px;padding:10px;overflow-x:auto;background:rgba(255,255,255,.72)}
.gallery-thumb{width:64px;height:54px;border-radius:12px;border:2px solid transparent;padding:0;overflow:hidden;background:#fff;cursor:pointer;flex:0 0 auto}
.gallery-thumb.active{border-color:var(--c-primary)}
.gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.external-link-icon{
  display:inline-grid;place-items:center;width:32px;height:32px;border-radius:12px;margin-left:8px;
  background:#fff;border:1px solid var(--c-border);vertical-align:middle;color:var(--c-accent);
}
.external-link-icon:hover{text-decoration:none;box-shadow:var(--shadow-sm)}
.compact-controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:18px}
.compact-control{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;border:1px solid var(--c-border);border-radius:16px;background:rgba(255,255,255,.72);min-width:180px}
.compact-control--field{min-height:46px}
.price-insight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:20px}
.price-insight{padding:16px;border:1px solid var(--c-border);border-radius:20px;background:linear-gradient(180deg,#fff,#f8fbff)}
.price-insight__label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--c-text-muted);font-weight:900}
.price-insight__value{margin-top:8px;font-size:23px;font-weight:950;letter-spacing:-.04em;color:var(--c-text)}
.price-insight__value small{display:block;font-size:12px;font-weight:700;color:var(--c-text-muted);letter-spacing:0;margin-top:3px}
.price-insight__hint{margin-top:6px;font-size:12px;color:var(--c-text-secondary)}
.warehouse-strip{display:grid;gap:10px}
.warehouse-line{display:grid;grid-template-columns:170px minmax(0,1fr);gap:12px;align-items:center;padding:12px;border:1px solid var(--c-border);border-radius:18px;background:rgba(255,255,255,.78)}
.warehouse-line__head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.warehouse-line__fields{display:none;grid-template-columns:repeat(3,minmax(110px,1fr));gap:10px}
.warehouse-line.is-open .warehouse-line__fields{display:grid}
.warehouse-line .form-group{margin-bottom:0}
.compact-filter-form .form-group{margin-bottom:0}
.compact-filter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end}
.compact-filter-actions{margin-top:12px;padding-top:12px}
.home-dashboard{display:grid;grid-template-columns:minmax(260px,.72fr) minmax(0,1.28fr);gap:18px;margin-bottom:22px}
.home-dashboard__focus{
  position:relative;overflow:hidden;min-height:190px;padding:24px;border-radius:28px;color:#fff;
  background:
    radial-gradient(circle at 88% 14%,rgba(255,255,255,.24),transparent 30%),
    linear-gradient(135deg,#101828 0%,#173449 58%,var(--c-primary) 145%);
  box-shadow:var(--shadow);
}
.home-dashboard__kicker{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.68);font-weight:950}
.home-dashboard__number{font-size:clamp(54px,7vw,92px);line-height:.95;letter-spacing:-.08em;font-weight:950;margin-top:18px}
.home-dashboard__caption{color:rgba(255,255,255,.76);font-weight:750;margin-top:8px}
.home-dashboard__stats{margin-bottom:0;align-content:stretch}
.operation-stats .stat{min-height:142px}
.finance-summary .stat:first-child{
  grid-column:span 2;
  background:
    radial-gradient(circle at 88% 0%,color-mix(in srgb,var(--c-accent) 18%,transparent),transparent 32%),
    var(--glass-bg);
}
.finance-side-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.finance-side-grid > .card{margin-bottom:0}
.finance-side-grid > .card:nth-child(3){grid-column:1/-1}
@media(max-width:1180px){
  .app-header{grid-template-columns:auto minmax(0,1fr) auto}
  .merchant-header{display:none}
  .settings-grid{grid-template-columns:1fr}
  .product-detail-grid{grid-template-columns:1fr}
  .home-dashboard,.finance-side-grid{grid-template-columns:1fr}
  .finance-summary .stat:first-child{grid-column:auto}
}
@media(max-width:760px){
  .app-header{position:sticky;top:0;left:0;right:0;border-radius:0;border-left:0;border-right:0;border-top:0;grid-template-columns:1fr auto;gap:10px}
  .content{padding-top:0}
  .header-nav{grid-column:1/-1;order:3;padding-top:4px}
  .profile-chip span{display:none}
  .brand-mark__text{font-size:17px}
  .profile-grid{grid-template-columns:1fr}
  .product-filter-bar{top:0}
  .gallery-main{height:320px}
  .warehouse-line{grid-template-columns:1fr}
  .warehouse-line__fields{grid-template-columns:1fr}
}

/* ─── UX polish + themes ─── */
:root{
  color-scheme:light;
  --surface-alpha:.82;
  --glass-border:rgba(255,255,255,.72);
  --glass-bg:rgba(255,255,255,var(--surface-alpha));
  --table-head:#eef5fb;
  --row-hover:rgba(15,118,110,.07);
  --input-bg:rgba(255,255,255,.92);
  --focus-ring:0 0 0 4px rgba(15,118,110,.16);
  --header-bg:rgba(255,255,255,.78);
  --header-active:#17202f;
}
html[data-theme="dark"]{
  color-scheme:dark;
  --c-bg:#071019;--c-surface:rgba(14,24,36,.86);--c-surface-solid:#111d2b;
  --c-border:rgba(148,163,184,.2);--c-border-strong:rgba(148,163,184,.34);
  --c-text:#ecf3fb;--c-text-secondary:#b6c3d5;--c-text-muted:#7f90a8;
  --c-primary:#ff514f;--c-primary-hover:#ff7370;--c-primary-light:rgba(255,81,79,.13);
  --c-accent:#2dd4bf;--c-accent-hover:#5eead4;--c-accent-light:rgba(45,212,191,.13);
  --c-success:#4ade80;--c-success-light:rgba(74,222,128,.13);--c-success-border:rgba(74,222,128,.25);
  --c-danger:#fb7185;--c-danger-light:rgba(251,113,133,.13);--c-danger-border:rgba(251,113,133,.28);
  --c-warning:#fbbf24;--c-warning-light:rgba(251,191,36,.14);
  --shadow-sm:0 1px 2px rgba(0,0,0,.24),0 1px 8px rgba(0,0,0,.16);
  --shadow:0 18px 46px rgba(0,0,0,.34);
  --shadow-lg:0 30px 80px rgba(0,0,0,.48);
  --surface-alpha:.76;
  --glass-border:rgba(148,163,184,.2);
  --glass-bg:rgba(14,24,36,var(--surface-alpha));
  --table-head:rgba(15,28,43,.95);
  --row-hover:rgba(45,212,191,.08);
  --input-bg:rgba(8,17,28,.8);
  --focus-ring:0 0 0 4px rgba(45,212,191,.17);
  --header-bg:rgba(10,19,30,.82);
  --header-active:#f7fbff;
}
html[data-theme="dark"]{
  background:
    radial-gradient(circle at 18% -10%,rgba(255,81,79,.2),transparent 30%),
    radial-gradient(circle at 100% 0%,rgba(45,212,191,.17),transparent 32%),
    linear-gradient(135deg,#060b12 0%,#0b1724 52%,#101521 100%);
}
html[data-theme="dark"] .shell::before{
  opacity:.32;
  background-image:linear-gradient(rgba(148,163,184,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.08) 1px,transparent 1px);
}
body{transition:background-color .25s ease,color .25s ease}
::selection{background:var(--c-accent-light);color:var(--c-text)}
a{font-weight:700}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{
  outline:none;box-shadow:var(--focus-ring);
}
.app-header{
  grid-template-columns:auto minmax(260px,1fr) minmax(220px,auto) auto auto;
  background:var(--header-bg);border-color:var(--glass-border);
}
.brand-mark__logo{background:linear-gradient(135deg,var(--c-primary),#ff9f43)}
.header-nav .nav-link{background:color-mix(in srgb,var(--c-surface-solid) 62%,transparent);color:var(--c-text-secondary)}
.header-nav .nav-link.active{background:var(--header-active);color:var(--c-bg)}
html[data-theme="dark"] .header-nav .nav-link.active{color:#071019}
.merchant-header,.profile-chip,.icon-btn,.help-dot,.external-link-icon{
  background:color-mix(in srgb,var(--c-surface-solid) 78%,transparent);border-color:var(--c-border);color:var(--c-text);
}
.theme-toggle{
  width:42px;height:42px;border-radius:16px;border:1px solid var(--c-border);
  background:color-mix(in srgb,var(--c-surface-solid) 78%,transparent);color:var(--c-text);
  display:inline-grid;place-items:center;cursor:pointer;box-shadow:var(--shadow-sm);
}
.theme-toggle:hover{color:var(--c-accent);transform:translateY(-1px);box-shadow:var(--shadow)}
.theme-toggle__moon{display:none}
html[data-theme="dark"] .theme-toggle__sun{display:none}
html[data-theme="dark"] .theme-toggle__moon{display:block}
.theme-toggle svg{display:block}
.page{animation:pageEnter .32s ease-out}
@keyframes pageEnter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.card,.stat,.automation-card,.session-metric,.warehouse-card,.warehouse-line,.price-insight{
  border-color:var(--glass-border);background:var(--glass-bg);box-shadow:var(--shadow-sm);
}
.card:hover,.stat:hover,.automation-card:hover,.price-insight:hover{
  box-shadow:var(--shadow);transform:translateY(-1px);
}
.card,.stat,.automation-card,.price-insight{transition:transform var(--transition),box-shadow var(--transition),border-color var(--transition),background var(--transition)}
.card__header{background:linear-gradient(180deg,color-mix(in srgb,var(--c-surface-solid) 66%,transparent),transparent);border-bottom-color:var(--c-border)}
.card__title{color:var(--c-text)}
.stat::after{background:color-mix(in srgb,var(--c-accent) 12%,transparent)}
.stat__value{color:var(--c-text)}
.stat__note{line-height:1.45}
.btn{min-height:38px}
.btn--ghost{background:color-mix(in srgb,var(--c-surface-solid) 62%,transparent);color:var(--c-text-secondary);border-color:var(--c-border)}
.btn--ghost:hover{background:color-mix(in srgb,var(--c-accent-light) 82%,var(--c-surface-solid));color:var(--c-accent)}
.form-input,.form-select,.form-file{
  background:var(--input-bg);color:var(--c-text);border-color:var(--c-border-strong);
}
.form-input::placeholder{color:var(--c-text-muted)}
.form-input:focus,.form-select:focus{box-shadow:var(--focus-ring);border-color:var(--c-accent)}
.form-actions{border-top-color:var(--c-border)}
.toggle__track{background:color-mix(in srgb,var(--c-text-muted) 42%,transparent)}
.toggle input:checked+.toggle__track{background:linear-gradient(135deg,var(--c-accent),var(--c-primary))}
.table-wrap{border-radius:0 0 var(--radius-lg) var(--radius-lg)}
thead th{background:var(--table-head);color:var(--c-text-muted);backdrop-filter:blur(12px)}
thead th a{color:inherit}
tbody tr:hover{background:var(--row-hover)}
tbody td{border-bottom-color:var(--c-border)}
td .cell-main{color:var(--c-text)}
.tabs{
  gap:8px;padding:6px;border:1px solid var(--c-border);border-radius:18px;background:var(--glass-bg);
  border-bottom-width:1px;display:inline-flex;max-width:100%;overflow-x:auto;
}
.tab{
  border:0;margin:0;border-radius:13px;padding:9px 15px;text-decoration:none;white-space:nowrap;
}
.tab:hover{text-decoration:none;background:color-mix(in srgb,var(--c-accent-light) 60%,transparent)}
.tab.active{background:var(--c-text);color:var(--c-bg);border:0}
html[data-theme="dark"] .tab.active{background:#f7fbff;color:#071019}
.badge--green{background:var(--c-success-light);color:var(--c-success);border-color:var(--c-success-border)}
.badge--red{background:var(--c-danger-light);color:var(--c-danger);border-color:var(--c-danger-border)}
.badge--blue{background:var(--c-accent-light);color:var(--c-accent);border-color:color-mix(in srgb,var(--c-accent) 26%,transparent)}
.badge--gray{background:color-mix(in srgb,var(--c-text-muted) 13%,transparent);color:var(--c-text-secondary);border-color:var(--c-border)}
.filter-chips{background:var(--input-bg);border-color:var(--c-border)}
.filter-chip:hover{background:var(--c-surface-solid)}
.filter-chip.active{background:var(--c-text);color:var(--c-bg)}
.bulk-bar{
  left:18px;right:18px;bottom:16px;border:1px solid var(--c-border);border-radius:24px;
  background:var(--header-bg);backdrop-filter:blur(18px);box-shadow:var(--shadow-lg);
}
.bulk-warehouse-panel{background:var(--c-surface-solid);border-color:var(--c-border)}
.profile-hero,.session-focus{
  background:
    radial-gradient(circle at 85% 0%,rgba(255,255,255,.24),transparent 28%),
    linear-gradient(135deg,#101828 0%,#173449 55%,var(--c-primary) 145%);
}
.gallery-viewer,.gallery-empty{background:var(--input-bg);border-color:var(--c-border)}
.gallery-main{background:linear-gradient(135deg,color-mix(in srgb,var(--c-surface-solid) 90%,transparent),color-mix(in srgb,var(--c-accent-light) 50%,transparent))}
.gallery-thumbs{background:color-mix(in srgb,var(--c-surface-solid) 70%,transparent)}
.gallery-thumb{background:var(--c-surface-solid)}
.compact-control,.warehouse-line{background:var(--glass-bg)}
.warehouse-line.is-open{border-color:color-mix(in srgb,var(--c-accent) 36%,var(--c-border))}
.price-insight__value{color:var(--c-text)}
.session-empty{background:linear-gradient(135deg,color-mix(in srgb,var(--c-surface-solid) 80%,transparent),color-mix(in srgb,var(--c-accent-light) 45%,transparent))}
.session-empty__title{color:var(--c-text)}
.session-progress__bar{background:color-mix(in srgb,var(--c-text-muted) 22%,transparent)}
#page-alerts .alert{background:var(--header-bg);border-color:var(--c-border);color:var(--c-text)}
html[data-theme="dark"] code{background:rgba(148,163,184,.14);color:var(--c-text)}
html[data-theme="dark"] .seller-row.is-me{background:rgba(45,212,191,.1)}
html[data-theme="dark"] .alert--success{background:rgba(74,222,128,.12);color:#bbf7d0}
html[data-theme="dark"] .alert--error{background:rgba(251,113,133,.12);color:#fecdd3}
@media(max-width:1180px){
  .app-header{grid-template-columns:auto minmax(0,1fr) auto auto}
}
@media(max-width:760px){
  .app-header{grid-template-columns:1fr auto auto}
  .theme-toggle{width:40px;height:40px}
  .bulk-bar{left:10px;right:10px;bottom:10px}
  .card__body,.card__header{padding:18px}
  .stats{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
}
`;

const NAV_ITEMS = [
  { id: 'home', href: '/panel/', label: 'Главная', icon: ICONS.home },
  { id: 'products', href: '/panel/products', label: 'Товары', icon: ICONS.products },
  { id: 'finance', href: '/panel/finance', label: 'Финансы', icon: ICONS.finance },
  { id: 'history', href: '/panel/history', label: 'История', icon: ICONS.syncLog },
  { id: 'settings', href: '/panel/settings', label: 'Настройки', icon: ICONS.autoPrice },
  { id: 'profile', href: '/panel/profile', label: 'Профиль', icon: ICONS.profile },
];

export function renderLayout({ title, content, message, error, activePage = '' }) {
  const profile = getHeaderProfile();
  const panelAuthToken = getPanelAuthToken();
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
  <title>${escapeHtml(title)} — korganBot</title>
  <script>
    (() => {
      const saved = localStorage.getItem('korgan-theme');
      const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = theme;
    })();
  </script>
  <style>${CSS}</style>
</head>
<body>
  <div class="shell">
    <header class="app-header">
      <a class="brand-mark" href="/panel/">
        <span class="brand-mark__logo">k</span>
        <span class="brand-mark__text">korganBot</span>
      </a>
      <nav class="header-nav">${nav}</nav>
      <div class="merchant-header">
        <div class="merchant-header__label">Магазин</div>
        <div class="merchant-header__name">${escapeHtml(profile.merchantName || 'Магазин не задан')}</div>
        <div class="merchant-header__id">Merchant ID: ${escapeHtml(profile.merchantId || '—')}</div>
      </div>
      <button class="theme-toggle" type="button" data-theme-toggle title="Переключить тему" aria-label="Переключить тему">
        <span class="theme-toggle__sun">${ICONS.theme}</span>
        <span class="theme-toggle__moon"><svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 009.8 9.8z"/></svg></span>
      </button>
      <a class="profile-chip" href="/panel/profile">${ICONS.profile}<span>Профиль</span></a>
    </header>
    <div class="content">
      <div class="page">
        ${alertHtml}
        ${content}
      </div>
    </div>
  </div>
  <div id="page-alerts"></div>
  <script>
  (() => {
    const alertsHost = document.getElementById('page-alerts');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const panelAuthToken = ${JSON.stringify(panelAuthToken)};
    const endpoint = protocol + '://' + location.host + '/ws' + (panelAuthToken ? ('?panelAuth=' + encodeURIComponent(panelAuthToken)) : '');
    let reconnectTimer = null;
    const checkIcon = ${JSON.stringify(ICONS.check)};
    const warnIcon = ${JSON.stringify(ICONS.warn)};

    const showAlert = (type, text) => {
      if (!alertsHost || !text) return;
      const node = document.createElement('div');
      node.className = 'alert ' + (type === 'error' ? 'alert--error' : 'alert--success');
      node.innerHTML = (type === 'error' ? warnIcon : checkIcon) + '<div class="alert__text"></div>';
      const textNode = node.querySelector('.alert__text');
      if (textNode) textNode.textContent = String(text || '');
      alertsHost.prepend(node);
      setTimeout(() => node.remove(), 5200);
    };

    const parseRedirectResult = (url) => {
      try {
        const parsed = new URL(url, location.origin);
        return {
          redirectTo: parsed.pathname + parsed.search,
          message: parsed.searchParams.get('message') || '',
          error: parsed.searchParams.get('error') || '',
        };
      } catch {
        return { redirectTo: '', message: '', error: '' };
      }
    };

    const readActionResponse = async (response, fallbackMessage) => {
      const contentType = response.headers.get('content-type') || '';
      if (response.status === 401) {
        throw new Error('Сессия панели истекла. Обновите страницу и войдите снова.');
      }
      if (contentType.includes('application/json')) {
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.ok === false) {
          throw new Error(result?.error || 'Операция завершилась с ошибкой.');
        }
        return result;
      }

      const redirected = parseRedirectResult(response.url);
      if (!response.ok || redirected.error) {
        throw new Error(redirected.error || 'Операция завершилась с ошибкой.');
      }
      return {
        ok: true,
        message: redirected.message || fallbackMessage,
        redirectTo: redirected.redirectTo,
      };
    };

    const setFormBusy = (form, busy) => {
      form.classList.toggle('loading-dim', busy);
      form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = busy;
      });
    };

    const hasSubmitterOverride = (submitter, attributeName) => {
      return Boolean(submitter && typeof submitter.hasAttribute === 'function' && submitter.hasAttribute(attributeName));
    };

    const resolveFormAction = (form, submitter) => {
      // Firefox can resolve submitter.formAction to the current page when the
      // button has no explicit formaction, so we only trust explicit overrides.
      if (hasSubmitterOverride(submitter, 'formaction')) {
        return submitter.formAction || form.action;
      }
      return form.action;
    };

    const resolveFormMethod = (form, submitter) => {
      if (hasSubmitterOverride(submitter, 'formmethod')) {
        return String(submitter.formMethod || submitter.getAttribute('formmethod') || 'post').toUpperCase();
      }
      return String(form.method || form.getAttribute('method') || 'post').toUpperCase();
    };

    const resolveFormEnctype = (form, submitter) => {
      if (hasSubmitterOverride(submitter, 'formenctype')) {
        return String(submitter.formEnctype || submitter.getAttribute('formenctype') || '');
      }
      return String(form.enctype || form.getAttribute('enctype') || '');
    };

    const submitEnhancedForm = async (form, submitter) => {
      const method = resolveFormMethod(form, submitter);
      const action = resolveFormAction(form, submitter);
      const isMultipart = resolveFormEnctype(form, submitter).toLowerCase().includes('multipart/form-data');
      const headers = {
        Accept: 'application/json',
        'X-Kaspi-Async': '1',
      };
      if (panelAuthToken) {
        headers['X-Kaspi-Panel-Auth'] = panelAuthToken;
      }
      let body;

      if (isMultipart) {
        body = new FormData(form);
        if (submitter?.name) body.append(submitter.name, submitter.value || '');
      } else {
        body = new URLSearchParams(new FormData(form));
        if (submitter?.name) body.set(submitter.name, submitter.value || '');
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      }

      const response = await fetch(action, {
        method,
        body,
        credentials: 'same-origin',
        headers,
      });
      return readActionResponse(response, 'Операция выполнена.');
    };

    const enhanceAsyncForms = (scope = document) => {
      scope.querySelectorAll('form[data-async-form="1"]').forEach((form) => {
        if (form.dataset.asyncBound === '1') return;
        form.dataset.asyncBound = '1';
        form.addEventListener('submit', async (event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          const submitter = event.submitter || form.querySelector('button[type="submit"]');
          try {
            setFormBusy(form, true);
            const result = await submitEnhancedForm(form, submitter);
            showAlert('success', result.message || 'Операция выполнена.');
            if (form.dataset.redirectOnSuccess === '1' && result.redirectTo) {
              setTimeout(() => { location.href = result.redirectTo; }, 350);
            }
            document.dispatchEvent(new CustomEvent('kaspi:form_success', { detail: { form, result } }));
          } catch (submitError) {
            showAlert('error', submitError?.message || 'Операция завершилась с ошибкой.');
          } finally {
            setFormBusy(form, false);
          }
        });
      });
    };

    window.KaspiPanel = Object.assign(window.KaspiPanel || {}, {
      showAlert,
      readActionResponse,
      submitEnhancedForm,
      enhanceAsyncForms,
    });

    const applyTheme = (theme) => {
      const normalized = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = normalized;
      localStorage.setItem('korgan-theme', normalized);
      const button = document.querySelector('[data-theme-toggle]');
      if (button) {
        button.setAttribute('aria-label', normalized === 'dark' ? 'Включить светлую тему' : 'Включить темную тему');
        button.title = normalized === 'dark' ? 'Светлая тема' : 'Темная тема';
      }
    };

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-theme-toggle]');
      if (!button) return;
      const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    applyTheme(document.documentElement.dataset.theme || 'light');

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

    const closeHelp = () => document.querySelectorAll('.help-popover').forEach((node) => node.remove());
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-help]');
      if (!button) {
        closeHelp();
        return;
      }
      event.preventDefault();
      const existing = document.querySelector('.help-popover[data-for="' + (button.dataset.helpId || '') + '"]');
      closeHelp();
      if (existing) return;
      const rect = button.getBoundingClientRect();
      const popover = document.createElement('div');
      const helpId = button.dataset.helpId || Math.random().toString(36).slice(2);
      button.dataset.helpId = helpId;
      popover.className = 'help-popover';
      popover.dataset.for = helpId;
      popover.textContent = button.dataset.help || '';
      document.body.appendChild(popover);
      const left = Math.min(window.innerWidth - popover.offsetWidth - 14, Math.max(14, rect.left - 12));
      const top = Math.min(window.innerHeight - popover.offsetHeight - 14, rect.bottom + 8);
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    });

    document.addEventListener('DOMContentLoaded', () => enhanceAsyncForms(document));
    connect();
  })();
  </script>
</body>
</html>`;
}

function getHeaderProfile() {
  try {
    return {
      merchantId: getSetting('merchant_id', ''),
      merchantName: getSetting('merchant_name', ''),
    };
  } catch {
    return { merchantId: '', merchantName: '' };
  }
}
