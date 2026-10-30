import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Простой загрузчик .env без внешних зависимостей.
 * Уже установленные переменные окружения имеют приоритет.
 */
export function loadEnv(file = path.join(ROOT_DIR, '.env')) {
  if (!existsSync(file)) return;

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1);
      }
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

function readString(name, fallback = '') {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
}

function readInt(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = readString(name);
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} должно быть целым числом от ${min} до ${max}, получено: "${raw}"`);
  }

  return value;
}

function readBool(name, fallback) {
  const raw = readString(name).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

/**
 * @param {{ requireVk?: boolean }} options
 */
export function loadConfig({ requireVk = true } = {}) {
  loadEnv();

  const config = {
    vk: {
      token: readString('VK_TOKEN'),
      groupId: readInt('VK_GROUP_ID', 0, { min: 0 }),
      apiVersion: readString('VK_API_VERSION', '5.199'),
      longPollWaitSec: readInt('VK_LONGPOLL_WAIT', 25, { min: 5, max: 90 }),
      requestTimeoutMs: readInt('VK_REQUEST_TIMEOUT_MS', 20_000, { min: 1_000, max: 120_000 }),
    },
    ai: {
      enabled: false,
      apiKey: readString('DEEPSEEK_API_KEY'),
      model: readString('DEEPSEEK_MODEL', 'deepseek-chat'),
      baseUrl: readString('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
      timeoutMs: readInt('DEEPSEEK_TIMEOUT_MS', 25_000, { min: 1_000, max: 180_000 }),
      maxTokens: readInt('DEEPSEEK_MAX_TOKENS', 1_200, { min: 100, max: 8_000 }),
    },
    news: {
      maxItems: readInt('NEWS_MAX_ITEMS', 5, { min: 1, max: 10 }),
      windowHours: readInt('NEWS_WINDOW_HOURS', 72, { min: 1, max: 720 }),
      maxCandidates: readInt('NEWS_MAX_CANDIDATES', 24, { min: 5, max: 100 }),
      timeZone: readString('NEWS_TIME_ZONE', 'Europe/Moscow'),
      cacheTtlMs: readInt('NEWS_CACHE_TTL_SEC', 300, { min: 0, max: 3_600 }) * 1_000,
      responseCacheTtlMs: readInt('NEWS_RESPONSE_CACHE_SEC', 180, { min: 0, max: 3_600 }) * 1_000,
      requestTimeoutMs: readInt('NEWS_REQUEST_TIMEOUT_MS', 12_000, { min: 1_000, max: 60_000 }),
      concurrency: readInt('NEWS_CONCURRENCY', 6, { min: 1, max: 20 }),
      userAgent: readString(
        'NEWS_USER_AGENT',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      ),
      feedsPath: path.resolve(ROOT_DIR, readString('NEWS_FEEDS_PATH', 'config/feeds.json')),
      synonymsPath: path.resolve(ROOT_DIR, readString('NEWS_SYNONYMS_PATH', 'config/synonyms.json')),
    },
    bot: {
      cooldownSec: readInt('BOT_COOLDOWN_SEC', 10, { min: 0, max: 3_600 }),
      maxTopicLength: readInt('BOT_MAX_TOPIC_LENGTH', 120, { min: 2, max: 500 }),
      messageLimit: 4_000,
    },
    logLevel: readString('LOG_LEVEL', 'info').toLowerCase(),
  };

  config.ai.enabled = Boolean(config.ai.apiKey) && readBool('DEEPSEEK_ENABLED', true);

  const errors = [];

  if (requireVk) {
    if (!config.vk.token) {
      errors.push('VK_TOKEN не задан. Получите ключ доступа сообщества в разделе «Работа с API».');
    }
    if (!config.vk.groupId) {
      errors.push('VK_GROUP_ID не задан. Укажите числовой ID сообщества (без минуса).');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Неверная конфигурация:\n- ${errors.join('\n- ')}`);
  }

  return config;
}
