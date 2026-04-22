import { escapeAttr, escapeHtml } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderProfilePage({
  merchantId = '',
  merchantName = '',
  ignoredMerchantIds = [],
  panelUser = '',
  cityId = '',
  message = '',
  error = '',
} = {}) {
  const merchantRows = (ignoredMerchantIds.length ? ignoredMerchantIds : [merchantId || ''])
    .map((value) => renderMerchantRow(value))
    .join('');

  return renderLayout({
    title: 'Профиль',
    activePage: 'profile',
    message,
    error,
    content: `
      <div class="profile-grid">
        <section class="card profile-hero">
          <div class="profile-hero__head">
            <div class="profile-hero__mark">k</div>
            <div>
              <div class="profile-hero__eyebrow">Магазин</div>
              <h2 class="profile-hero__title">${escapeHtml(merchantName || 'Название магазина не задано')}</h2>
              <div class="profile-hero__meta">Короткая сводка по магазину и доступу к панели.</div>
            </div>
          </div>
          <div class="profile-facts">
            <div class="profile-fact">
              <span>Merchant ID</span>
              <strong>${escapeHtml(merchantId || '—')}</strong>
            </div>
            <div class="profile-fact">
              <span>Город Kaspi</span>
              <strong>${escapeHtml(cityId || '—')}</strong>
            </div>
            <div class="profile-fact">
              <span>Логин панели</span>
              <strong>${escapeHtml(panelUser || '—')}</strong>
            </div>
          </div>
        </section>

        <section class="card profile-settings-card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Данные магазина</h3>
              <div class="card__subtitle">Слева краткая карточка магазина, справа рабочие настройки без лишнего визуального шума.</div>
            </div>
          </div>
          <div class="card__body">
            <form method="post" action="/panel/settings/general" data-async-form="1">
              <input type="hidden" name="returnTo" value="/panel/profile">
              <input type="hidden" name="merchantId" value="${escapeAttr(merchantId)}">
              <input type="hidden" name="merchantName" value="${escapeAttr(merchantName)}">
              <input type="hidden" name="cityId" value="${escapeAttr(cityId)}">

              <div class="profile-summary-grid">
                <div class="profile-summary-item">
                  <span>ID магазина</span>
                  <strong>${escapeHtml(merchantId || '—')}</strong>
                </div>
                <div class="profile-summary-item profile-summary-item--wide">
                  <span>Название</span>
                  <strong>${escapeHtml(merchantName || 'Название магазина не задано')}</strong>
                </div>
                <div class="profile-summary-item">
                  <span>Город</span>
                  <strong>${escapeHtml(cityId || '—')}</strong>
                </div>
              </div>

              <div class="profile-form-stack">
                <section class="profile-form-panel">
                  <div class="profile-form-panel__head">
                    <div>
                      <h4 class="form-section__title">Мои Merchant ID</h4>
                      <p class="form-section__desc">Эти ID исключаются из конкурентов при авторасчете цены.</p>
                    </div>
                    <button class="btn btn--ghost btn--sm" type="button" onclick="addIgnoredMerchantRow()">Добавить ID</button>
                  </div>
                  <div id="ignoredMerchantList" class="merchant-list">${merchantRows}</div>
                </section>

                <section class="profile-form-panel">
                  <div class="profile-form-panel__head">
                    <div>
                      <h4 class="form-section__title">Доступ к панели</h4>
                      <p class="form-section__desc">Пароль обновится только если заполнить поле.</p>
                    </div>
                  </div>
                  <div class="profile-access-grid">
                    <div class="form-group">
                      <label class="form-label">Логин</label>
                      <input class="form-input" name="panelUser" type="text" value="${escapeAttr(panelUser)}" placeholder="admin">
                    </div>
                    <div class="form-group">
                      ${labelWithHelp('Пароль', 'Новый пароль для входа в панель. После смены может понадобиться войти снова.')}
                      <input class="form-input" name="panelPassword" type="password" value="" placeholder="Оставь пустым, если не меняешь">
                    </div>
                  </div>
                </section>
              </div>

              <div class="form-actions">
                <button class="btn btn--primary" type="submit">Сохранить профиль</button>
              </div>
            </form>
          </div>
        </section>
      </div>

      <script>
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
        const container = document.getElementById('ignoredMerchantList');
        if (!row || !container) return;
        row.remove();
        if (!container.children.length) addIgnoredMerchantRow('');
      }
      </script>
    `,
  });
}

function renderMerchantRow(value = '') {
  return `
    <div class="merchant-row">
      <input class="form-input" type="text" name="ignoredMerchantIds[]" value="${escapeAttr(value)}" placeholder="Например, 30452124">
      <button class="btn btn--ghost btn--sm" type="button" onclick="removeIgnoredMerchantRow(this)">Убрать</button>
    </div>
  `;
}

function labelWithHelp(label, help) {
  return `
    <div class="label-row">
      <label class="form-label">${escapeHtml(label)}</label>
      <button class="help-dot" type="button" data-help="${escapeAttr(help)}">?</button>
    </div>
  `;
}
