import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { parseKaspiProductById } from '../kaspiParser.js';
import { defaultConfigFromEnv, getCurrentStatus, processPriceList, writeCurrentXml } from '../kaspiPriceList.js';
import { safeFileName, delay, formatDateTime } from '../utils.js';
import { pullKaspiPriceList } from './kaspiSync.js';
import { resolveOtp, hasPendingOtp, waitForKaspiOtp } from './otp.js';
import { runAutoPricingNow, runKaspiUploadNow } from './scheduler.js';

export async function startTelegramBot() {
  const token = config.telegram.token;
  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN is empty, bot is disabled');
    return;
  }

  const apiBase = `https://api.telegram.org/bot${token}`;
  const fileBase = `https://api.telegram.org/file/bot${token}`;
  const allowedChatIds = new Set(config.telegram.allowedChatIds);
  let offset = 0;

  const sendMessage = async (chatId, text) => {
    await telegramRequest(apiBase, 'sendMessage', { chat_id: chatId, text });
  };

  const guard = async (message) => {
    const chatId = String(message.chat.id);
    if (allowedChatIds.size === 0 || allowedChatIds.has(chatId)) {
      return true;
    }
    await sendMessage(message.chat.id, 'Нет доступа к этому боту.');
    return false;
  };

  const handleMessage = async (message) => {
    if (!message || !(await guard(message))) return;

    if (message.text === '/start') {
      await sendMessage(message.chat.id, [
        'Загрузи XML, XLSX или CSV прайс-лист.',
        'Я проверю файл и обновлю Kaspi XML.',
        '',
        `Ссылка для Kaspi: ${config.publicFeedUrl}`,
        'Команды: /status, /link, /kaspi_pull, /kaspi_push, /auto_price, /parse_kaspi 123456',
        'Если Kaspi попросит код, пришли /kaspi_code 123456',
      ].join('\n'));
      return;
    }

    if (message.text === '/link') {
      await sendMessage(message.chat.id, config.publicFeedUrl);
      return;
    }

    if (message.text?.startsWith('/kaspi_code')) {
      await handleKaspiCode(message, sendMessage);
      return;
    }

    if (message.text === '/kaspi_pull') {
      await handleKaspiPull(message, sendMessage);
      return;
    }

    if (message.text === '/kaspi_push') {
      await handleKaspiPush(message, sendMessage);
      return;
    }

    if (message.text?.startsWith('/parse_kaspi')) {
      await handleParseKaspi(message, sendMessage);
      return;
    }

    if (message.text === '/auto_price') {
      await handleAutoPrice(message, sendMessage);
      return;
    }

    if (message.text === '/status') {
      await handleStatus(message, sendMessage);
      return;
    }

    if (message.document) {
      await handleDocument({ apiBase, fileBase, message, sendMessage });
      return;
    }

    await sendMessage(message.chat.id, 'Пришли файлом XML, XLSX или CSV прайс-лист.');
  };

  runPolling({ apiBase, getOffset: () => offset, setOffset: (v) => { offset = v; }, handleMessage });
  console.log('Telegram bot is running');
}

async function handleKaspiCode(message, sendMessage) {
  const code = message.text.replace('/kaspi_code', '').trim();

  if (!code) {
    await sendMessage(message.chat.id, 'Пришли код так: /kaspi_code 123456');
    return;
  }

  if (!hasPendingOtp()) {
    await sendMessage(message.chat.id, 'Сейчас нет активного запроса кода.');
    return;
  }

  resolveOtp(code);
  await sendMessage(message.chat.id, 'Код принял, продолжаю вход.');
}

async function handleKaspiPull(message, sendMessage) {
  await sendMessage(message.chat.id, 'Начинаю скачивать прайс-лист из кабинета Kaspi.');
  try {
    const result = await pullKaspiPriceList(
      async (text) => sendMessage(message.chat.id, text),
      waitForKaspiOtp,
    );
    await sendMessage(message.chat.id, `Готово. Из Kaspi скачано и опубликовано ${result.offersCount} товаров.\n${config.publicFeedUrl}`);
  } catch (error) {
    await sendMessage(message.chat.id, `Не получилось скачать из Kaspi: ${error.message}`);
  }
}

async function handleKaspiPush(message, sendMessage) {
  await sendMessage(message.chat.id, 'Начинаю загружать текущий XML в кабинет Kaspi.');
  try {
    const result = await runKaspiUploadNow({
      triggerSource: 'manual',
      onMessage: async (text) => sendMessage(message.chat.id, text),
    });
    await sendMessage(message.chat.id, `Готово. XML отправлен в Kaspi: ${path.basename(result.filePath)}`);
  } catch (error) {
    await sendMessage(message.chat.id, `Не получилось загрузить XML в Kaspi: ${error.message}`);
  }
}

async function handleParseKaspi(message, sendMessage) {
  const kaspiId = message.text.replace('/parse_kaspi', '').trim();

  if (!kaspiId) {
    await sendMessage(message.chat.id, 'Пришли Kaspi ID так: /parse_kaspi 123456');
    return;
  }

  try {
    await sendMessage(message.chat.id, `Парсю Kaspi товар ${kaspiId}.`);
    const parsed = await parseKaspiProductById(kaspiId);
    const sellers = parsed.sellers
      .slice(0, 5)
      .map((s) => `${s.price} - ${s.merchantName || s.merchantId}`)
      .join('\n');
    await sendMessage(message.chat.id, [
      parsed.title,
      `Цена на карточке: ${parsed.price}`,
      `Продавцов: ${parsed.sellers.length}`,
      sellers ? `Первые продавцы:\n${sellers}` : 'Продавцов не нашел.',
    ].join('\n'));
  } catch (error) {
    await sendMessage(message.chat.id, `Парсер не сработал: ${error.message}`);
  }
}

async function handleAutoPrice(message, sendMessage) {
  await sendMessage(message.chat.id, 'Запускаю расчет цены по включенным товарам.');
  try {
    const results = await runAutoPricingNow({
      triggerSource: 'manual',
      onMessage: async (text) => sendMessage(message.chat.id, text),
    });
    const updated = results.filter((r) => r.updated).length;
    const failed = results.filter((r) => r.error).length;
    await sendMessage(message.chat.id, `Готово. Проверено ${results.length}, изменено ${updated}, ошибок ${failed}.\n${config.publicFeedUrl}`);
  } catch (error) {
    await sendMessage(message.chat.id, `Расчет цены не сработал: ${error.message}`);
  }
}

async function handleStatus(message, sendMessage) {
  try {
    const status = await getCurrentStatus(config.publicDir);
    await sendMessage(message.chat.id, formatStatus(status));
  } catch (error) {
    await sendMessage(message.chat.id, `Ошибка статуса: ${error.message}`);
  }
}

async function handleDocument({ apiBase, fileBase, message, sendMessage }) {
  const document = message.document;
  const name = document.file_name || 'price-list';
  const localPath = path.join(config.uploadDir, `${Date.now()}-${safeFileName(name)}`);

  try {
    await sendMessage(message.chat.id, `Принял файл ${name}, обрабатываю.`);
    const fileInfo = await telegramRequest(apiBase, 'getFile', { file_id: document.file_id });
    const fileUrl = `${fileBase}/${fileInfo.result.file_path}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      throw new Error(`Telegram не отдал файл: HTTP ${fileResponse.status}`);
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    await fs.writeFile(localPath, buffer);

    const result = await processPriceList(localPath, name, defaultConfigFromEnv());
    await writeCurrentXml(config.publicDir, result.xml);

    const warnings = result.warnings?.length ? `\n\nПредупреждения:\n${result.warnings.join('\n')}` : '';
    await sendMessage(message.chat.id, `Готово. Загружено ${result.offersCount} товаров из ${result.sourceType}.\n${config.publicFeedUrl}${warnings}`);
  } catch (error) {
    await sendMessage(message.chat.id, `Не загрузилось: ${error.message}`);
  } finally {
    await fs.rm(localPath, { force: true }).catch(() => {});
  }
}

function formatStatus(status) {
  if (!status.exists) {
    return 'XML еще не загружен.';
  }

  return [
    `XML активен: ${config.publicFeedUrl}`,
    `Товаров: ${status.offersCount}`,
    `Компания: ${status.company || '-'}`,
    `Merchant ID: ${status.merchantId || '-'}`,
    `Обновлен: ${formatDateTime(status.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}`,
  ].join('\n');
}

async function runPolling({ apiBase, getOffset, setOffset, handleMessage }) {
  while (true) {
    try {
      const updates = await telegramRequest(apiBase, 'getUpdates', {
        offset: getOffset(),
        timeout: 25,
        allowed_updates: ['message'],
      });

      for (const update of updates.result || []) {
        setOffset(update.update_id + 1);
        await handleMessage(update.message);
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await delay(3000);
    }
  }
}

async function telegramRequest(apiBase, method, payload) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method}: HTTP ${response.status}`);
  }

  const body = await response.json();
  if (!body.ok) {
    throw new Error(`Telegram API ${method}: ${body.description || 'unknown error'}`);
  }

  return body;
}
