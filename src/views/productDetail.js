import { escapeHtml, escapeAttr, formatDateTime } from '../utils.js';
import { renderLayout } from './layout.js';
import { kaspiImageUrl } from '../helpers/product.js';

export function renderProductDetailPage({
    product,
    warehouses,
    sellers,
    history = [],
    buildState = null,
    merchantId,
    ignoredMerchantIds = [],
    message,
    error,
}) {
    const images = safeJsonParse(product.images, []);
    const currentKaspiPrice = product.last_kaspi_price || product.city_price || product.price || 0;
    const uploadPrice = product.upload_price || product.city_price || product.price || 0;
    const priceDiff = product.first_place_price ? uploadPrice - product.first_place_price : 0;
    const parsedAt = product.last_parsed_at
        ? formatDateTime(product.last_parsed_at, { dateStyle: 'short', timeStyle: 'short' })
        : '—';
    const resolvedKaspiCode = resolvedKaspiCodeForDisplay(product);
    const pricingPreviewData = JSON.stringify({
        sellers,
        ignoredMerchantIds,
        merchantId,
        firstPlacePrice: Number(product.first_place_price || 0),
        currentUploadPrice: Number(uploadPrice || 0),
    }).replace(/</g, '\\u003c');
    const historyItems = Array.isArray(history) ? history : [];
    const historySummary = summarizeHistory(historyItems);
    const buildStatusLabel = buildState?.state === 'building'
        ? `Формируется с ${formatDateTime(buildState.startedAt, { dateStyle: 'short', timeStyle: 'short' })}`
        : product.last_parsed_at
            ? `Сформирована ${formatDateTime(product.last_parsed_at, { dateStyle: 'short', timeStyle: 'short' })}`
            : 'Не сформирована';

    const gallery = images.length
        ? images.map((img) =>
            `<img class="product-img-lg" src="${escapeAttr(kaspiImageUrl(img))}" alt="" loading="lazy" onclick="this.classList.toggle('product-img-xl')">`
        ).join('')
        : '<div class="product-img-lg" style="display:grid;place-items:center;font-size:32px;color:#ccc">📦</div>';

    const warehouseCards = buildWarehouseDescriptors(warehouses, merchantId, product.pre_order).map((warehouse) => {
        const fullId = warehouse.store_id || '';
        return `
      <div class="warehouse-card">
        <div class="warehouse-card__head">
          <div>
            <h4 class="warehouse-card__title">${escapeHtml(warehouse.short_id)}</h4>
            <div class="warehouse-card__meta">Полный ID: ${escapeHtml(fullId || '—')}</div>
          </div>
          <span class="badge ${warehouse.enabled ? 'badge--green' : 'badge--gray'}">${warehouse.enabled ? 'Вкл' : 'Выкл'}</span>
        </div>
        <div class="warehouse-card__fields">
          <div class="form-group form-group--full">
            <label class="form-label">ID склада</label>
            <input class="form-input form-input--sm" name="storeId[]" type="text" value="${escapeAttr(fullId)}" placeholder="${escapeAttr(defaultStoreId(warehouse.short_id, merchantId))}">
            <div class="form-hint">Можно поправить вручную. Пустой ID не сохранится.</div>
          </div>
          <div class="form-group">
            <label class="form-label">Статус</label>
            <select name="warehouseEnabled[]" class="form-select form-select--sm">
              <option value="1"${warehouse.enabled ? ' selected' : ''}>Вкл</option>
              <option value="0"${!warehouse.enabled ? ' selected' : ''}>Выкл</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Предзаказ</label>
            <input class="form-input form-input--sm warehouse-pre-order" name="warehousePreOrder[]" type="number" min="0" max="30" value="${warehouse.pre_order}">
          </div>
          <div class="form-group">
            <label class="form-label">Остаток Kaspi</label>
            <input class="form-input form-input--sm" name="stockCount[]" type="number" min="0" value="${warehouse.stock_count}">
          </div>
          <div class="form-group">
            <label class="form-label">Факт. остаток</label>
            <input class="form-input form-input--sm" name="actualStock[]" type="number" min="0" value="${warehouse.actual_stock}">
          </div>
        </div>
      </div>`;
    }).join('');

    const myMerchant = String(merchantId || '').trim();
    const sellerRows = sellers.map((seller) => {
        const isMe = String(seller.merchant_id || '').trim() === myMerchant;
        return `<div class="seller-row${isMe ? ' is-me' : ''}">
      <div>
        <div class="seller-name">${escapeHtml(seller.merchant_name || seller.merchant_id || '—')}${isMe ? ' (Вы)' : ''}</div>
        <div class="seller-meta">
          ${seller.merchant_rating ? `Рейтинг: ${seller.merchant_rating}` : ''}
          ${seller.merchant_reviews_quantity ? ` • ${seller.merchant_reviews_quantity} отз.` : ''}
          ${seller.delivery_type ? ` • ${escapeHtml(seller.delivery_type)}` : ''}
        </div>
      </div>
      <div class="seller-price">${formatPrice(seller.price)}</div>
    </div>`;
    }).join('');

    const historyRows = historyItems.map(renderHistoryRow).join('');

    return renderLayout({
        title: `${product.model || product.sku}`,
        activePage: 'products',
        message,
        error,
        content: `
      <div style="margin-bottom:16px">
        <a href="/panel/products" class="text-sm text-muted" style="text-decoration:none">&larr; Назад к товарам</a>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="switchTab('general', this)">Основное</div>
        <div class="tab" onclick="switchTab('sellers', this)">Продавцы (${sellers.length})</div>
        <div class="tab" onclick="switchTab('settings', this)">Настройки</div>
        <div class="tab" onclick="switchTab('history', this)">История (${historyItems.length})</div>
      </div>

      <form id="product-save-form" data-product-async="1" action="/panel/products/${encodeURIComponent(product.sku)}" method="post">

      <div class="tab-content active" id="tab-general">
        <div class="card">
          <div class="card__body">
            <div class="flex gap-md flex-wrap" style="margin-bottom:20px">
              <div class="product-gallery">${gallery}</div>
              <div style="flex:1;min-width:250px">
                <h2 style="margin:0 0 4px">${escapeHtml(product.model || '—')}</h2>
                <div class="text-sm text-muted" style="margin-bottom:12px">
                  SKU: ${escapeHtml(product.sku)}${resolvedKaspiCode ? ` • Код товара Kaspi: ${escapeHtml(resolvedKaspiCode)}` : ''} • Обновлено: ${escapeHtml(parsedAt)}
                </div>
                <div class="info-grid" style="gap:8px">
                  <div class="info-item">
                    <div class="info-item__label">Бренд</div>
                    <div class="info-item__value">${escapeHtml(product.brand || '—')}</div>
                  </div>
                  <div class="info-item">
                    <div class="info-item__label">Категория</div>
                    <div class="info-item__value">${escapeHtml(product.category || '—')}</div>
                  </div>
                  <div class="info-item">
                    <div class="info-item__label">Позиция</div>
                    <div class="info-item__value">${product.my_position ? `${product.my_position} из ${product.seller_count || '?'}` : '—'}</div>
                  </div>
                  <div class="info-item">
                    <div class="info-item__label">Kaspi страница</div>
                    <div class="info-item__value">${product.shop_link ? `<a href="https://kaspi.kz${escapeAttr(product.shop_link)}" target="_blank" rel="noreferrer">Открыть</a>` : '—'}</div>
                  </div>
                  <div class="info-item">
                    <div class="info-item__label">Формирование</div>
                    <div class="info-item__value">${escapeHtml(buildStatusLabel)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">В продаже</label>
                <select name="available" class="form-select">
                  <option value="1"${product.available ? ' selected' : ''}>Да</option>
                  <option value="0"${!product.available ? ' selected' : ''}>Нет</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Предзаказ (дни)</label>
                <input class="form-input" id="productPreOrder" name="pre_order" type="number" min="0" max="30" value="${product.pre_order || 0}">
                <div class="form-hint">При изменении заполняет предзаказ по складам.</div>
              </div>
              <div class="form-group">
                <label class="form-label">Город</label>
                <input class="form-input" name="city_id" type="text" value="${escapeAttr(product.city_id || '750000000')}">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Цена на Kaspi сейчас</label>
                <div class="form-static">${formatPrice(currentKaspiPrice)}</div>
              </div>
              <div class="form-group">
                <label class="form-label">Цена выгрузки</label>
                <div class="form-static" id="uploadPriceValue">${formatPrice(uploadPrice)}</div>
              </div>
              <div class="form-group">
                <label class="form-label">1-е место</label>
                <div class="form-static">${product.first_place_price ? `${formatPrice(product.first_place_price)} (${escapeHtml(product.first_place_seller || '?')})` : '—'}</div>
              </div>
              <div class="form-group">
                <label class="form-label">Разница</label>
                <div class="form-static" id="uploadPriceDiff" style="color:${priceDiff > 0 ? 'var(--c-danger)' : priceDiff < 0 ? 'var(--c-success)' : 'inherit'}">${priceDiff ? `${priceDiff > 0 ? '+' : ''}${formatPrice(priceDiff)}` : '—'}</div>
              </div>
            </div>

            <div style="padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#f7fafc,#eef5ff);border:1px solid var(--c-border)">
              <div class="fw-600" style="margin-bottom:4px">Логика карточки</div>
              <div class="text-sm text-muted">Новый товар сначала получает карточку автоматически через “Сформировать карточку”, а дальше участвует в “Расчете цены” по расписанию. Вся история видна во вкладке ниже.</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Склады</h3>
              <div class="card__subtitle">Каждый склад редактируется отдельно: ID, статус, остатки и предзаказ.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="warehouse-grid">
              ${warehouseCards}
            </div>
          </div>
        </div>
      </div>

      <div class="tab-content" id="tab-sellers">
        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Продавцы</h3>
              <div class="card__subtitle">Список обновляется при формировании карточки и при каждом расчете цены.</div>
            </div>
          </div>
          <div class="card__body">
            ${sellerRows || '<p class="text-muted">Данных по продавцам пока нет. Они появятся после первого формирования карточки.</p>'}
          </div>
        </div>
      </div>

      <div class="tab-content" id="tab-settings">
        <div class="card">
          <div class="card__header"><h3 class="card__title">Настройки расчета цены</h3></div>
          <div class="card__body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Расчет цены</label>
                <select name="auto_pricing_enabled" class="form-select">
                  <option value="1"${product.auto_pricing_enabled ? ' selected' : ''}>Включен</option>
                  <option value="0"${!product.auto_pricing_enabled ? ' selected' : ''}>Выключен</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Шаг бота (₸)</label>
                <input class="form-input" id="priceStepInput" name="price_step" type="number" min="1" value="${product.price_step || 1}">
                <div class="form-hint">На сколько тенге снижать цену относительно конкурента.</div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Цена выгрузки</label>
                <div class="form-static" id="uploadPriceValueSettings">${formatPrice(uploadPrice)}</div>
                <div class="form-hint">Пересчитывается сразу по сохраненным продавцам без нового запроса к Kaspi.</div>
              </div>
              <div class="form-group">
                <label class="form-label">Причина расчета</label>
                <div class="form-static" id="uploadPriceReason">${escapeHtml(formatReason(product.last_reason))}</div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Минимальная цена</label>
                <input class="form-input" id="minPriceInput" name="min_price" type="number" min="0" value="${product.min_price || 0}">
              </div>
              <div class="form-group">
                <label class="form-label">Максимальная цена</label>
                <input class="form-input" id="maxPriceInput" name="max_price" type="number" min="0" value="${product.max_price || 0}">
              </div>
            </div>
            <div class="form-hint">Merchant ID и список продавцов, с которыми не нужно конкурировать, задаются в разделе “Настройки”.</div>
          </div>
        </div>
      </div>

      <div class="tab-content" id="tab-history">
        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">История карточки</h3>
              <div class="card__subtitle">Видно, когда товар добавился, когда формировалась карточка и как пересчитывалась цена.</div>
            </div>
          </div>
          <div class="card__body">
            <div class="info-grid" style="margin-bottom:18px">
              <div class="info-item">
                <div class="info-item__label">Всего событий</div>
                <div class="info-item__value">${escapeHtml(historySummary.total)}</div>
              </div>
              <div class="info-item">
                <div class="info-item__label">Изменений цены</div>
                <div class="info-item__value">${escapeHtml(historySummary.priceChanges)}</div>
              </div>
              <div class="info-item">
                <div class="info-item__label">Последний расчет цены</div>
                <div class="info-item__value">${escapeHtml(historySummary.lastCalculation)}</div>
              </div>
              <div class="info-item">
                <div class="info-item__label">Последнее формирование карточки</div>
                <div class="info-item__value">${escapeHtml(historySummary.lastCardBuild)}</div>
              </div>
            </div>
            ${renderHistoryChart(historyItems)}
          </div>
        </div>

        <div class="card card--flush">
          <div class="card__header">
            <div>
              <h3 class="card__title">Лента событий</h3>
              <div class="card__subtitle">Последние операции по товару со временем, ценами и ссылкой на сессию.</div>
            </div>
          </div>
          ${historyRows ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Операция</th>
                  <th>Источник</th>
                  <th>Цены</th>
                  <th>Позиция</th>
                  <th>Детали</th>
                </tr>
              </thead>
              <tbody>${historyRows}</tbody>
            </table>
          </div>` : `
          <div class="card__body">
            <p class="text-muted">История пока пустая. Она начнет заполняться после импорта, формирования карточки и расчета цены.</p>
          </div>`}
        </div>
      </div>

      </form>

      <div class="form-actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn--primary" type="submit" form="product-save-form">Сохранить</button>
        <form data-product-async="1" action="/panel/products/${encodeURIComponent(product.sku)}/parse" method="post" style="margin:0">
          <button class="btn btn--ghost" type="submit">Переформировать</button>
        </form>
        <form data-product-async="1" action="/panel/products/${encodeURIComponent(product.sku)}/auto-price" method="post" style="margin:0">
          <button class="btn btn--accent" type="submit">Рассчитать цену</button>
        </form>
        <form data-product-async="1" action="/panel/products/${encodeURIComponent(product.sku)}/toggle-available" method="post" style="margin:0">
          <button class="btn ${product.available ? 'btn--danger' : 'btn--success'}" id="productToggleAvailableButton" type="submit">${product.available ? 'Снять с продажи' : 'Выставить в продажу'}</button>
        </form>
        <form data-product-async="1" action="/panel/products/${encodeURIComponent(product.sku)}/delete" method="post" style="margin:0" onsubmit="return confirm('Удалить товар?')">
          <button class="btn btn--danger btn--sm" type="submit">Удалить</button>
        </form>
      </div>

      <script>
      function switchTab(name, el) {
        document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
        const nextTab = document.getElementById('tab-' + name);
        if (nextTab) nextTab.classList.add('active');
        if (el) el.classList.add('active');
      }

      const productPreOrderInput = document.getElementById('productPreOrder');
      if (productPreOrderInput) {
        productPreOrderInput.addEventListener('input', () => {
          document.querySelectorAll('.warehouse-pre-order').forEach((input) => {
            input.value = productPreOrderInput.value;
          });
        });
      }

      const pricingPreviewData = ${pricingPreviewData};
      const minPriceInput = document.getElementById('minPriceInput');
      const maxPriceInput = document.getElementById('maxPriceInput');
      const priceStepInput = document.getElementById('priceStepInput');
      const uploadPriceValue = document.getElementById('uploadPriceValue');
      const uploadPriceValueSettings = document.getElementById('uploadPriceValueSettings');
      const uploadPriceDiff = document.getElementById('uploadPriceDiff');
      const uploadPriceReason = document.getElementById('uploadPriceReason');

      [minPriceInput, maxPriceInput, priceStepInput].forEach((input) => {
        if (input) input.addEventListener('input', updateUploadPricePreview);
      });

      updateUploadPricePreview();

      document.querySelectorAll('form[data-product-async="1"]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          const submitter = event.submitter || form.querySelector('button[type="submit"]');
          if (!submitter) return;
          try {
            submitter.disabled = true;
            const result = await submitProductForm(form, submitter);
            handleProductActionSuccess(form, result);
            showProductAlert('success', result.message || 'Операция выполнена.');
          } catch (error) {
            showProductAlert('error', error?.message || 'Операция завершилась с ошибкой.');
          } finally {
            submitter.disabled = false;
          }
        });
      });

      function updateUploadPricePreview() {
        const preview = calculatePreviewPrice();
        const priceText = preview.price > 0 ? formatPriceValue(preview.price) : '—';

        if (uploadPriceValue) uploadPriceValue.textContent = priceText;
        if (uploadPriceValueSettings) uploadPriceValueSettings.textContent = priceText;
        if (uploadPriceReason) uploadPriceReason.textContent = preview.reasonLabel;

        if (!uploadPriceDiff) return;
        const firstPlacePrice = Number(pricingPreviewData.firstPlacePrice || 0);
        if (!firstPlacePrice || !preview.price) {
          uploadPriceDiff.textContent = '—';
          uploadPriceDiff.style.color = 'inherit';
          return;
        }

        const diff = preview.price - firstPlacePrice;
        uploadPriceDiff.textContent = diff ? (diff > 0 ? '+' : '') + formatPriceValue(diff) : '0 ₸';
        uploadPriceDiff.style.color = diff > 0
          ? 'var(--c-danger)'
          : diff < 0
            ? 'var(--c-success)'
            : 'inherit';
      }

      async function submitProductForm(form, submitter) {
        const formData = new FormData(form);
        if (submitter.name) {
          formData.append(submitter.name, submitter.value || '');
        }
        const response = await fetch(submitter.formAction || form.action, {
          method: (submitter.formMethod || form.method || 'post').toUpperCase(),
          body: formData,
          headers: {
            Accept: 'application/json',
            'X-Kaspi-Async': '1',
          },
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.ok === false) {
          throw new Error(result?.error || 'Операция завершилась с ошибкой.');
        }
        return result;
      }

      function handleProductActionSuccess(form, result) {
        const actionPath = new URL(form.action, location.origin).pathname;
        if (/\/delete$/.test(actionPath)) {
          location.href = result.redirectTo || '/panel/products';
          return;
        }
        if (/\/toggle-available$/.test(actionPath)) {
          const button = document.getElementById('productToggleAvailableButton');
          if (button) {
            const available = Number(result.available || 0) === 1;
            button.textContent = available ? 'Снять с продажи' : 'Выставить в продажу';
            button.classList.toggle('btn--danger', available);
            button.classList.toggle('btn--success', !available);
          }
        }
      }

      function showProductAlert(type, text) {
        if (window.KaspiPanel && typeof window.KaspiPanel.showAlert === 'function') {
          window.KaspiPanel.showAlert(type, text);
          return;
        }
        if (text) alert(text);
      }

      function calculatePreviewPrice() {
        const minPrice = Number(minPriceInput?.value || 0);
        const maxPrice = Number(maxPriceInput?.value || 0);
        const step = Math.max(1, Number(priceStepInput?.value || 1));
        const currentPrice = Number(pricingPreviewData.currentUploadPrice || 0);
        const sellers = Array.isArray(pricingPreviewData.sellers) ? pricingPreviewData.sellers : [];
        const ignoredIds = new Set(
          [...(pricingPreviewData.ignoredMerchantIds || []), pricingPreviewData.merchantId]
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        );

        if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0 || maxPrice <= 0 || minPrice > maxPrice) {
          return {
            price: currentPrice,
            reasonLabel: 'Укажите корректные мин/макс',
          };
        }

        const competitorSellers = sellers
          .filter((seller) => Number.isFinite(Number(seller.price)) && Number(seller.price) > 0)
          .filter((seller) => !sellerMerchantIds(seller).some((merchantId) => ignoredIds.has(merchantId)))
          .sort((a, b) => Number(a.price) - Number(b.price));

        const competitor = competitorSellers.find((seller) => Number(seller.price) >= minPrice);
        if (!competitor) {
          return {
            price: Math.max(minPrice, Math.min(currentPrice || minPrice, maxPrice)),
            reasonLabel: 'Нет конкурента выше минимума',
          };
        }

        const candidatePrice = Number(competitor.price) - step;
        const price = Math.max(minPrice, Math.min(candidatePrice, maxPrice));
        return {
          price,
          reasonLabel: candidatePrice < minPrice
            ? 'Упор в минимальную цену'
            : candidatePrice > maxPrice
              ? 'Упор в максимальную цену'
              : 'Ниже конкурента на шаг',
        };
      }

      function sellerMerchantIds(seller = {}) {
        return [
          seller.merchant_id,
          seller.merchantId,
          seller.merchantUID,
          seller.merchantUid,
          seller.uid,
          seller.id,
        ].map((value) => String(value || '').trim()).filter(Boolean);
      }

      function formatPriceValue(value) {
        const amount = Number(value || 0);
        if (!amount) return '0 ₸';
        return amount.toLocaleString('ru-RU') + ' ₸';
      }
      </script>
    `,
    });
}

function renderHistoryChart(historyItems) {
    const points = historyItems
        .filter((item) => positiveNumber(item.new_upload_price) || positiveNumber(item.kaspi_price))
        .slice(0, 24)
        .reverse();

    if (!points.length) {
        return '<div class="text-muted">График появится, когда накопится история цен по Kaspi и цене выгрузки.</div>';
    }

    const width = 760;
    const height = 220;
    const padX = 28;
    const padY = 24;
    const values = points
        .flatMap((item) => [positiveNumber(item.new_upload_price), positiveNumber(item.kaspi_price)])
        .filter(Boolean);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = Math.max(1, maxValue - minValue);
    const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;

    const yFor = (value) => height - padY - ((value - minValue) / range) * (height - padY * 2);
    const xFor = (index) => padX + stepX * index;

    const uploadSeries = buildSeries(points, 'new_upload_price', xFor, yFor);
    const kaspiSeries = buildSeries(points, 'kaspi_price', xFor, yFor);
    const guides = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = padY + (height - padY * 2) * ratio;
        return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="#e6edf5" stroke-dasharray="4 4"></line>`;
    }).join('');
    const labels = points.map((item, index) => {
        if (points.length > 6 && index % Math.ceil(points.length / 6) !== 0 && index !== points.length - 1) {
            return '';
        }
        const x = xFor(index);
        return `<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#8b93a1">${escapeHtml(formatShortDate(item.created_at))}</text>`;
    }).join('');

    return `
      <div style="border:1px solid var(--c-border);border-radius:16px;padding:16px;background:linear-gradient(180deg,#fcfdff,#f6f9fc)">
        <div class="flex gap-md flex-wrap items-center" style="margin-bottom:12px">
          <div class="text-sm"><span style="display:inline-block;width:12px;height:12px;border-radius:999px;background:#1565c0;margin-right:6px;vertical-align:middle"></span>Цена выгрузки</div>
          <div class="text-sm"><span style="display:inline-block;width:12px;height:12px;border-radius:999px;background:#ef6c00;margin-right:6px;vertical-align:middle"></span>Цена на Kaspi</div>
          <div class="text-sm text-muted">Диапазон: ${escapeHtml(formatPrice(minValue))} - ${escapeHtml(formatPrice(maxValue))}</div>
        </div>
        <div style="overflow-x:auto">
          <svg viewBox="0 0 ${width} ${height}" width="100%" height="220" role="img" aria-label="История изменения цен">
            ${guides}
            ${uploadSeries.polyline}
            ${kaspiSeries.polyline}
            ${uploadSeries.points}
            ${kaspiSeries.points}
            ${labels}
          </svg>
        </div>
      </div>
    `;
}

function buildSeries(historyItems, field, xFor, yFor) {
    const points = historyItems
        .map((item, index) => {
            const value = positiveNumber(item[field]);
            return value
                ? { x: xFor(index), y: yFor(value), value }
                : null;
        })
        .filter(Boolean);

    if (!points.length) {
        return { polyline: '', points: '' };
    }

    const color = field === 'kaspi_price' ? '#ef6c00' : '#1565c0';
    return {
        polyline: `<polyline fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points.map((point) => `${point.x},${point.y}`).join(' ')}"></polyline>`,
        points: points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" fill="${color}"></circle>`).join(''),
    };
}

function renderHistoryRow(item) {
    const sessionLink = item.session_id
        ? `<a href="/panel/parse-sessions/${encodeURIComponent(item.session_id)}" class="text-sm">Сессия #${escapeHtml(item.session_id)}</a>`
        : '';
    const reason = formatReason(item.reason);
    const details = parseHistoryDetails(item.details);
    const extra = [
        item.kaspi_price ? `Kaspi: ${formatPrice(item.kaspi_price)}` : '',
        item.competitor_price ? `Конкурент: ${formatPrice(item.competitor_price)}` : '',
        reason !== '—' ? `Причина: ${escapeHtml(reason)}` : '',
        details.kaspiId ? `Kaspi ID: ${escapeHtml(details.kaspiId)}` : '',
    ].filter(Boolean);

    return `<tr>
      <td>
        <div>${escapeHtml(formatDateTime(item.created_at, { dateStyle: 'short', timeStyle: 'short' }))}</div>
        ${sessionLink ? `<div class="cell-sub">${sessionLink}</div>` : ''}
      </td>
      <td>
        <div class="cell-main">${escapeHtml(historyEventLabel(item.event_type))}</div>
        <div class="cell-sub">${historyStatusBadge(item.status)}${item.parse_mode ? ` <span class="badge badge--gray">${escapeHtml(item.parse_mode)}</span>` : ''}</div>
      </td>
      <td>${historySourceBadge(item.trigger_source)}</td>
      <td>
        <div>${renderHistoryPriceChange(item)}</div>
        ${extra.length ? `<div class="cell-sub">${extra.join(' • ')}</div>` : ''}
      </td>
      <td>${item.my_position ? `${escapeHtml(item.my_position)} из ${escapeHtml(item.seller_count || '—')}` : item.seller_count ? `— из ${escapeHtml(item.seller_count)}` : '—'}</td>
      <td>
        <div>${escapeHtml(item.message || '—')}</div>
        ${details.title ? `<div class="cell-sub">${escapeHtml(details.title)}</div>` : ''}
      </td>
    </tr>`;
}

function summarizeHistory(historyItems) {
    const items = Array.isArray(historyItems) ? historyItems : [];
    const lastCalculation = items.find((item) => item.event_type === 'light_parse' && item.status === 'success');
    const lastCardBuild = items.find((item) => item.event_type === 'full_parse' && item.status === 'success');
    const priceChanges = items.filter((item) => {
        const oldPrice = positiveNumber(item.old_upload_price);
        const newPrice = positiveNumber(item.new_upload_price);
        return oldPrice && newPrice && oldPrice !== newPrice;
    }).length;

    return {
        total: String(items.length),
        priceChanges: String(priceChanges),
        lastCalculation: lastCalculation ? formatDateTime(lastCalculation.created_at, { dateStyle: 'short', timeStyle: 'short' }) : '—',
        lastCardBuild: lastCardBuild ? formatDateTime(lastCardBuild.created_at, { dateStyle: 'short', timeStyle: 'short' }) : '—',
    };
}

function renderHistoryPriceChange(item) {
    const oldPrice = positiveNumber(item.old_upload_price);
    const newPrice = positiveNumber(item.new_upload_price);

    if (oldPrice && newPrice) {
        return `${formatPrice(oldPrice)} → ${formatPrice(newPrice)}`;
    }
    if (newPrice) {
        return formatPrice(newPrice);
    }
    return '—';
}

function historyEventLabel(eventType) {
    const map = {
        catalog_import: 'Новый товар',
        catalog_update: 'Обновление из файла',
        full_parse: 'Сформировать карточку',
        light_parse: 'Расчет цены',
    };
    return map[eventType] || eventType || 'Событие';
}

function historySourceBadge(source) {
    const normalized = String(source || '').trim();
    if (normalized === 'auto') return '<span class="badge badge--blue">Авто</span>';
    if (normalized === 'import') return '<span class="badge badge--gray">Импорт</span>';
    return '<span class="badge badge--gray">Ручной</span>';
}

function historyStatusBadge(status) {
    if (status === 'success') return '<span class="badge badge--green">OK</span>';
    if (status === 'partial') return '<span class="badge badge--gray">Частично</span>';
    return '<span class="badge badge--red">Ошибка</span>';
}

function parseHistoryDetails(detailsText) {
    if (!detailsText) return {};
    try {
        const parsed = JSON.parse(detailsText);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function formatShortDate(value) {
    const normalized = formatDateTime(value, { dateStyle: 'short', timeStyle: undefined, fallback: '—' });
    return normalized.replace(/\sг\.$/, '');
}

function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatPrice(n) {
    if (!n) return '—';
    return `${Number(n).toLocaleString('ru-RU')} ₸`;
}

function formatReason(value) {
    const reasonMap = {
        BEAT_COMPETITOR: 'Ниже конкурента на шаг',
        MIN_PRICE_FLOOR: 'Упор в минимальную цену',
        MAX_PRICE_CAP: 'Упор в максимальную цену',
        NO_COMPETITOR_TO_BEAT: 'Нет конкурента выше минимума',
    };
    return reasonMap[value] || value || '—';
}

function safeJsonParse(str, fallback) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

function resolvedKaspiCodeForDisplay(product) {
    const kaspiCode = String(product?.kaspi_id || '').trim();
    if (!kaspiCode) return '';

    const skuCode = String(product?.sku || '')
        .trim()
        .split(/[-–—]/)[0]
        .trim()
        .split('_')[0]
        .trim();

    return kaspiCode && kaspiCode !== skuCode ? kaspiCode : '';
}

function shortStoreId(id) {
    const value = String(id || '').trim();
    const match = value.match(/_?(PP\d+)$/i);
    return match ? match[1].toUpperCase() : value.toUpperCase();
}

function buildWarehouseDescriptors(warehouses, merchantId, defaultPreOrder = 0) {
    const defaults = ['PP1', 'PP2', 'PP3', 'PP4', 'PP5'];
    const byShortId = new Map();

    for (const warehouse of warehouses || []) {
        const shortId = shortStoreId(warehouse.store_id);
        if (!shortId) continue;
        byShortId.set(shortId, {
            short_id: shortId,
            store_id: String(warehouse.store_id || '').trim(),
            enabled: Number(warehouse.enabled ?? 0) ? 1 : 0,
            stock_count: Number(warehouse.stock_count || 0),
            actual_stock: Number(warehouse.actual_stock || 0),
            pre_order: Number(warehouse.pre_order ?? defaultPreOrder ?? 0),
        });
    }

    for (const shortId of defaults) {
        if (!byShortId.has(shortId)) {
            byShortId.set(shortId, {
                short_id: shortId,
                store_id: defaultStoreId(shortId, merchantId),
                enabled: shortId === 'PP1' || shortId === 'PP2' ? 1 : 0,
                stock_count: 0,
                actual_stock: 0,
                pre_order: Number(defaultPreOrder || 0),
            });
        }
    }

    return [...byShortId.values()].sort(compareWarehouseDescriptors);
}

function compareWarehouseDescriptors(a, b) {
    return sortWarehouseId(a.short_id) - sortWarehouseId(b.short_id) || a.short_id.localeCompare(b.short_id, 'ru');
}

function sortWarehouseId(value) {
    const match = String(value || '').match(/^PP(\d+)$/i);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function defaultStoreId(shortId, merchantId) {
    const normalizedMerchantId = String(merchantId || '').trim();
    if (!normalizedMerchantId || normalizedMerchantId === 'CompanyID') {
        return shortId;
    }
    return `${normalizedMerchantId}_${shortId}`;
}
