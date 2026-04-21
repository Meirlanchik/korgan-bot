# Kaspi Web Server

Панель публикует `index.xml` для Kaspi, умеет загружать XML/XLSX/CSV, скачивать прайс-лист из кабинета продавца и пересчитывать цены по конкурентам.

## XML из кабинета Kaspi

Кнопка `Скачать из Kaspi кабинета` в панели открывает личный кабинет Kaspi, входит по `KASPI_CABINET_EMAIL` или `KASPI_CABINET_LOGIN`, скачивает XML-прайс и заменяет локальный `index.xml`.

Кнопка `Загрузить XML в Kaspi` открывает страницу загрузки прайс-листа и отправляет текущий `index.xml` из панели обратно в кабинет Kaspi.

Если Kaspi попросит одноразовый код, отправь его Telegram-командой `/kaspi_code 123456`. Веб-кнопка тоже ждет этот код.

## Парсер

Отдельный парсер лежит в `src/kaspiParser.js`.

```bash
npm run parser:test -- <kaspiId>
```

Он вернет название товара, цену карточки и список продавцов. Город берется из `KASPI_CITY_ID`.

## Автопрайсинг

Для товара в панели можно заполнить:

- `Kaspi ID товара`
- `Минимальная цена`
- `Максимальная цена`
- `Свой Merchant ID для исключения`
- `Включить автопрайсинг`

Настройки хранятся отдельно от Kaspi XML в `AUTO_PRICING_FILE`, по умолчанию `/app/uploads/auto-pricing.json`.

Алгоритм:

1. Парсит продавцов товара в Kaspi.
2. Исключает свое предложение по `ownMerchantId`, если он задан.
3. Сортирует цены конкурентов по возрастанию.
4. Берет первую цену конкурента `>= minPrice`.
5. Ставит `competitorPrice - 1`, но не ниже `minPrice` и не выше `maxPrice`.
6. Сохраняет новую цену в опубликованный `index.xml`.

## Ручные запросы

```http
GET /api/parser/:kaspiId
GET /api/auto-pricing
POST /api/auto-pricing/run
POST /api/auto-pricing/:sku/run
```

В Telegram доступны команды `/parse_kaspi <kaspiId>`, `/kaspi_pull`, `/kaspi_push` и `/auto_price`.

## Настройки

```env
KASPI_PRICE_UPDATE_INTERVAL_MS=600000
KASPI_PRICE_UPDATE_PRODUCT_DELAY_MS=1000
AUTO_PRICING_FILE=/app/uploads/auto-pricing.json
KASPI_BROWSER_PATH=/usr/bin/chromium-browser
KASPI_CABINET_EMAIL=mail@example.com
KASPI_CABINET_PASSWORD=secret
```

`KASPI_PRICE_UPDATE_INTERVAL_MS=0` отключает фоновый автопрайсинг.
