import { escapeAttr, escapeHtml } from '../utils.js';
import { renderLayout } from './layout.js';

export function renderProductFormPage({ title, action, product, message, error }) {
  const availability = product.availabilities?.[0] || {};
  const cityPrice = product.cityPrices?.[0] || {};
  const autoPricing = product.autoPricing || {};
  const autoPricingChecked = autoPricing.kaspiId && autoPricing.autoPricingEnabled !== false;

  return renderLayout({
    title,
    activePage: 'products',
    message,
    error,
    content: `
      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">${escapeHtml(title)}</h3>
            <p class="card__subtitle">Заполните данные товара для Kaspi XML</p>
          </div>
          <a class="btn btn--ghost btn--sm" href="/panel/products">&larr; К списку</a>
        </div>
        <div class="card__body">
          <form action="${escapeAttr(action)}" method="post">

            <!-- Basic info -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="sku">SKU</label>
                <input class="form-input" id="sku" name="sku" type="text" maxlength="20" value="${escapeAttr(product.sku)}" required placeholder="Уникальный код">
                <div class="form-hint">Латиница, цифры, до 20 символов</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="brand">Бренд</label>
                <input class="form-input" id="brand" name="brand" type="text" value="${escapeAttr(product.brand)}" placeholder="Samsung, Apple...">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="model">Название товара</label>
              <input class="form-input" id="model" name="model" type="text" value="${escapeAttr(product.model)}" required placeholder="Полное название товара">
            </div>

            <!-- Price + location -->
            <div class="form-section">
              <div class="form-section__title">Цена и город</div>
              <div class="form-section__desc">Укажите цену и ID города для Kaspi</div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="cityPrice">Цена, ₸</label>
                  <input class="form-input" id="cityPrice" name="cityPrice" type="text" inputmode="numeric" value="${escapeAttr(cityPrice.price || product.price)}" required placeholder="15000">
                </div>
                <div class="form-group">
                  <label class="form-label" for="cityId">ID города</label>
                  <input class="form-input" id="cityId" name="cityId" type="text" inputmode="numeric" value="${escapeAttr(cityPrice.cityId || '710000000')}" required>
                  <div class="form-hint">710000000 — Астана, 750000000 — Алматы</div>
                </div>
              </div>
            </div>

            <!-- Stock -->
            <div class="form-section">
              <div class="form-section__title">Склад и наличие</div>
              <div class="form-section__desc">Настройки доступности товара на пункте выдачи</div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="storeId">ID склада</label>
                  <input class="form-input" id="storeId" name="storeId" type="text" value="${escapeAttr(availability.storeId || 'PP2')}" required>
                </div>
                <div class="form-group">
                  <label class="form-label" for="available">Наличие</label>
                  <select class="form-select" id="available" name="available">
                    <option value="yes"${availability.available !== 'no' ? ' selected' : ''}>В наличии</option>
                    <option value="no"${availability.available === 'no' ? ' selected' : ''}>Нет в наличии</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="stockCount">Остаток</label>
                  <input class="form-input" id="stockCount" name="stockCount" type="text" inputmode="numeric" value="${escapeAttr(availability.stockCount || '')}" placeholder="0">
                </div>
                <div class="form-group">
                  <label class="form-label" for="preOrder">Предзаказ, дней</label>
                  <input class="form-input" id="preOrder" name="preOrder" type="text" inputmode="numeric" value="${escapeAttr(availability.preOrder || '')}" placeholder="0">
                  <div class="form-hint">0 — обычный товар, 1–30 — предзаказ</div>
                </div>
              </div>
            </div>

            <!-- Auto pricing -->
            <div class="form-section">
              <div class="form-section__title">Автопрайсинг</div>
              <div class="form-section__desc">Бот будет парсить конкурентов и автоматически ставить оптимальную цену</div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="kaspiId">Kaspi ID товара</label>
                  <input class="form-input" id="kaspiId" name="kaspiId" type="text" value="${escapeAttr(autoPricing.kaspiId || '')}" placeholder="Числовой ID с Kaspi">
                </div>
                <div class="form-group">
                  <label class="form-label" for="ownMerchantId">Свой Merchant ID</label>
                  <input class="form-input" id="ownMerchantId" name="ownMerchantId" type="text" value="${escapeAttr(autoPricing.ownMerchantId || '')}" placeholder="Для исключения из расчёта">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="minPrice">Мин. цена, ₸</label>
                  <input class="form-input" id="minPrice" name="minPrice" type="text" inputmode="numeric" value="${escapeAttr(autoPricing.minPrice ?? '')}" placeholder="900">
                </div>
                <div class="form-group">
                  <label class="form-label" for="maxPrice">Макс. цена, ₸</label>
                  <input class="form-input" id="maxPrice" name="maxPrice" type="text" inputmode="numeric" value="${escapeAttr(autoPricing.maxPrice ?? '')}" placeholder="1500">
                </div>
              </div>
              <div class="form-group" style="margin-top:16px">
                <label class="toggle">
                  <input name="autoPricingEnabled" type="checkbox"${autoPricingChecked ? ' checked' : ''}>
                  <span class="toggle__track"></span>
                  Включить автопрайсинг для этого товара
                </label>
              </div>
            </div>

            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Сохранить</button>
              <a class="btn btn--ghost" href="/panel/products">Отмена</a>
            </div>
          </form>
        </div>
      </div>
    `,
  });
}
