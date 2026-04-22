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

    const galleryImages = images.map((img) => kaspiImageUrl(img)).filter(Boolean);
    const gallery = galleryImages.length
        ? `
          <div class="gallery-viewer" data-gallery>
            <button class="gallery-nav gallery-nav--prev" type="button" data-gallery-prev aria-label="Предыдущее фото">‹</button>
            <img class="gallery-main" src="${escapeAttr(galleryImages[0])}" alt="" data-gallery-main loading="eager">
            <button class="gallery-nav gallery-nav--next" type="button" data-gallery-next aria-label="Следующее фото">›</button>
            <div class="gallery-thumbs">
              ${galleryImages.map((src, index) => `<button class="gallery-thumb${index === 0 ? ' active' : ''}" type="button" data-gallery-index="${index}"><img src="${escapeAttr(src)}" alt="" loading="lazy"></button>`).join('')}
            </div>
          </div>
        `
        : '<div class="gallery-empty">Фото пока нет</div>';

    const warehouseCards = buildWarehouseDescriptors(warehouses, merchantId, product.pre_order).slice(0, 5).map((warehouse) => {
        const fullId = warehouse.store_id || '';
        return `
      <div class="warehouse-line${warehouse.enabled ? ' is-open' : ''}">
        <input type="hidden" name="storeId[]" value="${escapeAttr(fullId || defaultStoreId(warehouse.short_id, merchantId))}">
        <input type="hidden" name="warehouseEnabled[]" value="${warehouse.enabled ? '1' : '0'}" data-warehouse-enabled-value>
        <div class="warehouse-line__head">
          <div>
            <h4 class="warehouse-card__title">${escapeHtml(warehouse.short_id)}</h4>
          </div>
          <label class="toggle">
            <input type="checkbox" data-warehouse-toggle${warehouse.enabled ? ' checked' : ''}>
            <span class="toggle__track"></span>
          </label>
        </div>
        <div class="warehouse-line__fields">
          <div class="form-group">
            <label class="form-label">Остаток Kaspi</label>
            <input class="form-input form-input--sm" name="stockCount[]" type="number" min="0" value="${warehouse.stock_count}">
          </div>
          <div class="form-group">
            <label class="form-label">Факт. остаток</label>
            <input class="form-input form-input--sm" name="actualStock[]" type="number" min="0" value="${warehouse.actual_stock}">
          </div>
          <div class="form-group">
            <label class="form-label">Предзаказ, дней</label>
            <input class="form-input form-input--sm warehouse-pre-order" name="warehousePreOrder[]" type="number" min="0" max="30" value="${warehouse.pre_order}">
          </div>
        </div>
      </div>`;
    }).join('');

    const myMerchant = String(merchantId || '').trim();
    const ownMerchantIds = new Set([myMerchant, ...ignoredMerchantIds].map((value) => String(value || '').trim()).filter(Boolean));
    const sellerRows = sellers.map((seller) => {
        const sellerId = String(seller.merchant_id || '').trim();
        const isMe = sellerId && ownMerchantIds.has(sellerId);
        return `<div class="seller-row${isMe ? ' is-me' : ''}">
      <div>
        <div class="seller-name">${escapeHtml(seller.merchant_name || seller.merchant_id || '—')}${isMe ? ` <span class="badge badge--green">${sellerId === myMerchant ? 'Вы' : 'свой ID'}</span>` : ''}</div>
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
        <a href="/panel/products" class="btn btn--ghost btn--sm" style="text-decoration:none">&larr; Назад к товарам</a>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="switchTab('general', this)">Основное</div>
        <div class="tab" onclick="switchTab('sellers', this)">Продавцы (${sellers.length})</div>
        <div class="tab" onclick="switchTab('settings', this)">Настройки</div>
      </div>

      <form id="product-save-form" action="/panel/products/${encodeURIComponent(product.sku)}" method="post" data-async-form="1" data-redirect-on-success="1">

      <div class="tab-content active" id="tab-general">
        <div class="card">
          <div class="card__body">
            <div class="product-detail-grid">
              <div>${gallery}</div>
              <div style="flex:1;min-width:250px">
                <h2 style="margin:0 0 4px">
                  ${escapeHtml(product.model || '—')}
                  ${product.shop_link ? `<a class="external-link-icon" href="https://kaspi.kz${escapeAttr(product.shop_link)}" target="_blank" rel="noreferrer" title="Открыть карточку Kaspi" aria-label="Открыть карточку Kaspi">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 17L17 7M9 7h8v8"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 17H7V9"/></svg>
                  </a>` : ''}
                </h2>
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
                </div>

                <div class="compact-controls">
                  <div class="compact-control">
                    <span class="form-label">В продаже</span>
                    <input type="hidden" name="available" value="${product.available ? '1' : '0'}" data-toggle-value="available">
                    <label class="toggle">
                      <input type="checkbox" data-hidden-toggle="available"${product.available ? ' checked' : ''}>
                      <span class="toggle__track"></span>
                    </label>
                  </div>
                  <div class="form-group" style="max-width:150px;margin-bottom:0">
                    <label class="form-label">Предзаказ, дней</label>
                    <input class="form-input form-input--sm" id="productPreOrder" name="pre_order" type="number" min="0" max="30" value="${product.pre_order || 0}">
                  </div>
                </div>
              </div>
            </div>

            <div class="price-insight-grid">
              ${priceInsight('Цена на Kaspi сейчас', formatPrice(currentKaspiPrice), 'Текущая цена из последнего чтения Kaspi')}
              ${priceInsight('Цена выгрузки', `<span id="uploadPriceValue">${formatPrice(uploadPrice)}</span>`, 'Эта цена попадет в XML')}
              ${priceInsight('1-е место', product.first_place_price ? `${formatPrice(product.first_place_price)}<small>${escapeHtml(product.first_place_seller || '?')}</small>` : '—', 'Самый дешевый продавец')}
              ${priceInsight('Разница', `<span id="uploadPriceDiff" style="color:${priceDiff > 0 ? 'var(--c-danger)' : priceDiff < 0 ? 'var(--c-success)' : 'inherit'}">${priceDiff ? `${priceDiff > 0 ? '+' : ''}${formatPrice(priceDiff)}` : '—'}</span>`, 'Цена выгрузки минус 1-е место')}
            </div>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-content" id="tab-sellers">
        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Продавцы</h3>
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
                <div class="compact-control compact-control--field">
                  <span class="form-label">Авторасчет</span>
                  <input type="hidden" name="auto_pricing_enabled" value="${product.auto_pricing_enabled ? '1' : '0'}" data-toggle-value="auto_pricing_enabled">
                  <label class="toggle">
                    <input type="checkbox" data-hidden-toggle="auto_pricing_enabled"${product.auto_pricing_enabled ? ' checked' : ''}>
                    <span class="toggle__track"></span>
                  </label>
                </div>
              </div>
              <div class="form-group">
                ${labelWithHelp('Шаг бота (₸)', 'На сколько тенге korganBot ставит цену ниже конкурента, если это не нарушает минимум и максимум.')}
                <input class="form-input" id="priceStepInput" name="price_step" type="number" min="1" value="${product.price_step || 1}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Цена выгрузки</label>
                <div class="form-static" id="uploadPriceValueSettings">${formatPrice(uploadPrice)}</div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                ${labelWithHelp('Минимальная цена', 'korganBot никогда не поставит цену ниже этого значения. Должна быть меньше или равна максимальной цене.')}
                <input class="form-input" id="minPriceInput" name="min_price" type="number" min="0" value="${product.min_price || 0}">
              </div>
              <div class="form-group">
                ${labelWithHelp('Максимальная цена', 'Верхняя граница цены выгрузки. Если конкурент слишком дорогой, цена не поднимется выше этого значения.')}
                <input class="form-input" id="maxPriceInput" name="max_price" type="number" min="0" value="${product.max_price || 0}">
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">Склады</h3>
            </div>
          </div>
          <div class="card__body">
            <div class="warehouse-strip">${warehouseCards}</div>
          </div>
        </div>
      </div>

      </form>

      <div class="card" style="margin-top:16px;padding:18px 24px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn--primary" type="submit" form="product-save-form">Сохранить</button>
          <form action="/panel/products/${encodeURIComponent(product.sku)}/auto-price" method="post" data-async-form="1" data-redirect-on-success="1" style="margin:0">
            <button class="btn btn--accent btn--sm" type="submit">Рассчитать</button>
          </form>
          <form action="/panel/products/${encodeURIComponent(product.sku)}/parse" method="post" data-async-form="1" data-redirect-on-success="1" style="margin:0">
            <button class="btn btn--ghost btn--sm" type="submit">Сформировать</button>
          </form>
          <div style="flex:1"></div>
          <form action="/panel/products/${encodeURIComponent(product.sku)}/delete" method="post" data-async-form="1" data-redirect-on-success="1" style="margin:0" onsubmit="return confirm('Удалить товар?')">
            <button class="btn btn--danger btn--sm" type="submit">Удалить</button>
          </form>
        </div>
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
      const productForm = document.getElementById('product-save-form');

      document.querySelectorAll('[data-hidden-toggle]').forEach((checkbox) => {
        const key = checkbox.dataset.hiddenToggle;
        const hidden = document.querySelector('[data-toggle-value="' + key + '"]');
        const sync = () => {
          if (hidden) hidden.value = checkbox.checked ? '1' : '0';
        };
        checkbox.addEventListener('change', sync);
        sync();
      });

      document.querySelectorAll('[data-warehouse-toggle]').forEach((checkbox) => {
        const card = checkbox.closest('.warehouse-line');
        const hidden = card && card.querySelector('[data-warehouse-enabled-value]');
        const sync = () => {
          if (hidden) hidden.value = checkbox.checked ? '1' : '0';
          if (card) card.classList.toggle('is-open', checkbox.checked);
        };
        checkbox.addEventListener('change', sync);
        sync();
      });

      if (productForm) {
        productForm.addEventListener('submit', (event) => {
          const min = Number(minPriceInput?.value || 0);
          const max = Number(maxPriceInput?.value || 0);
          const step = Number(priceStepInput?.value || 0);
          if (min < 0 || max < 0 || step < 1 || (min > 0 && max > 0 && min > max)) {
            event.preventDefault();
            window.KaspiPanel?.showAlert?.('error', 'Проверь цены: минимум не может быть больше максимума, шаг должен быть от 1.');
          }
        }, { capture: true });
      }

      (() => {
        const galleries = document.querySelectorAll('[data-gallery]');
        galleries.forEach((gallery) => {
          const images = Array.from(gallery.querySelectorAll('.gallery-thumb img')).map((img) => img.src);
          const main = gallery.querySelector('[data-gallery-main]');
          let current = 0;
          const show = (index) => {
            if (!images.length || !main) return;
            current = (index + images.length) % images.length;
            main.src = images[current];
            gallery.querySelectorAll('.gallery-thumb').forEach((thumb, thumbIndex) => {
              thumb.classList.toggle('active', thumbIndex === current);
            });
          };
          gallery.querySelector('[data-gallery-prev]')?.addEventListener('click', () => show(current - 1));
          gallery.querySelector('[data-gallery-next]')?.addEventListener('click', () => show(current + 1));
          gallery.querySelectorAll('[data-gallery-index]').forEach((button) => {
            button.addEventListener('click', () => show(Number(button.dataset.galleryIndex || 0)));
          });
        });
      })();

      [minPriceInput, maxPriceInput, priceStepInput].forEach((input) => {
        if (input) input.addEventListener('input', updateUploadPricePreview);
      });

      updateUploadPricePreview();

      function updateUploadPricePreview() {
        const preview = calculatePreviewPrice();
        const priceText = preview.price > 0 ? formatPriceValue(preview.price) : '—';

        if (uploadPriceValue) uploadPriceValue.textContent = priceText;
        if (uploadPriceValueSettings) uploadPriceValueSettings.textContent = priceText;
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
    if (status === 'partial') return '<span class="badge badge--warning">Частично</span>';
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

function priceInsight(label, value, hint = '') {
    return `
      <div class="price-insight">
        <div class="price-insight__label">${escapeHtml(label)}</div>
        <div class="price-insight__value">${value}</div>
        ${hint ? `<div class="price-insight__hint">${escapeHtml(hint)}</div>` : ''}
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
