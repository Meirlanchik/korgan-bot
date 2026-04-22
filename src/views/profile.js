import { escapeAttr, escapeHtml } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderProfilePage({
  merchantId = '',
  merchantName = '',
  ignoredMerchantIds = [],
  panelUser = '',
  email = '',
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
          <div class="profile-hero__mark">k</div>
          <div>
            <div class="profile-hero__eyebrow">Профиль магазина</div>
            <h2 class="profile-hero__title">${escapeHtml(merchantName || 'Название магазина не задано')}</h2>
            <div class="profile-hero__meta">Merchant ID: ${escapeHtml(merchantId || '—')}</div>
          </div>
        </section>

        <section class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Данные магазина</h3>
              <div class="card__subtitle">Эти данные используются в XML, расчетах цены и подсветке ваших продавцов.</div>
            </div>
          </div>
          <div class="card__body">
            <form method="post" action="/panel/settings/general" data-async-form="1">
              <input type="hidden" name="returnTo" value="/panel/profile">
              <div class="form-row">
                <div class="form-group">
                  ${labelWithHelp('Merchant ID', 'ID магазина Kaspi. Он нужен для XML и чтобы korganBot не конкурировал с вашим же магазином.')}
                  <input class="form-input" name="merchantId" type="text" value="${escapeAttr(merchantId)}" placeholder="Например, 30452124" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Название магазина</label>
                  <input class="form-input" name="merchantName" type="text" value="${escapeAttr(merchantName)}" placeholder="Например, ИП БАПИШЕВ">
                </div>
                <div class="form-group">
                  ${labelWithHelp('Почта', 'Контактная почта для профиля. Это не меняет логин Kaspi Кабинета.')}
                  <input class="form-input" name="email" type="email" value="${escapeAttr(email)}" placeholder="mail@example.com">
                </div>
                <div class="form-group">
                  ${labelWithHelp('Город', 'Код города Kaspi для цен в XML. Например, 710000000 или 750000000.')}
                  <input class="form-input" name="cityId" type="text" value="${escapeAttr(cityId)}" placeholder="710000000">
                </div>
              </div>

              <div class="form-section">
                <div class="flex justify-between items-center gap-md flex-wrap" style="margin-bottom:14px">
                  <div>
                    <h4 class="form-section__title">Мои Merchant ID</h4>
                    <p class="form-section__desc">korganBot исключает эти ID при расчете конкурентной цены.</p>
                  </div>
                  <button class="btn btn--ghost btn--sm" type="button" onclick="addIgnoredMerchantRow()">Добавить ID</button>
                </div>
                <div id="ignoredMerchantList" class="merchant-list">${merchantRows}</div>
              </div>

              <div class="form-section">
                <h4 class="form-section__title">Доступ к панели</h4>
                <p class="form-section__desc">Пароль меняется только если заполнить поле. Пустое поле оставит текущий пароль без изменений.</p>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Логин</label>
                    <input class="form-input" name="panelUser" type="text" value="${escapeAttr(panelUser)}" placeholder="admin">
                  </div>
                  <div class="form-group">
                    ${labelWithHelp('Пароль', 'Новый пароль для входа в панель. После смены может понадобиться войти снова.')}
                    <input class="form-input" name="panelPassword" type="password" value="" placeholder="Оставь пустым, если не меняешь">
                  </div>
                </div>
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
