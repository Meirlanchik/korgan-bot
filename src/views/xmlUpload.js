import { renderLayout } from './layout.js';

export function renderXmlUploadPage({ status, message, error }) {
  return renderLayout({
    title: 'Загрузить XML',
    activePage: 'xml',
    message,
    error,
    content: `
      <div class="stats" style="margin-bottom:24px">
        <div class="stat">
          <div class="stat__label">Опубликовано товаров</div>
          <div class="stat__value">${status.offersCount}</div>
        </div>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h3 class="card__title">Загрузить новый XML</h3>
            <p class="card__subtitle">Файл заменит текущий <code>index.xml</code>. Товары сразу появятся в панели и по публичной ссылке.</p>
          </div>
        </div>
        <div class="card__body">
          <form action="/panel/xml/upload" method="post" enctype="multipart/form-data">
            <div class="form-group">
              <label class="form-label">Kaspi XML файл</label>
              <div class="dropzone">
                <input id="xmlFile" name="xmlFile" type="file" accept=".xml,text/xml,application/xml" required>
                <div class="dropzone__icon">📋</div>
                <div class="dropzone__text">Перетащите XML файл сюда или нажмите для выбора</div>
                <div class="dropzone__hint">Только .xml &bull; SKU сохраняется до первого _</div>
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn--primary" type="submit">Заменить XML</button>
              <a class="btn btn--ghost" href="/panel/products">К товарам</a>
            </div>
          </form>
        </div>
      </div>
    `,
  });
}
