import { fetchTextResource } from '../http.js';
import { truncate } from '../utils.js';
import { stripHtml } from './feeds.js';

const SKIP_PATTERNS = [
  /подписывайтесь/i,
  /читайте также/i,
  /материалы по теме/i,
  /новости партн[её]ров/i,
  /реклама/i,
  /^фото[: ]/i,
  /^видео[: ]/i,
  /^источник[: ]/i,
  /^©/i,
  /cookie/i,
  /^сюжет[: ]/i,
];

/**
 * Вытаскивает основной текст статьи: сначала <article>/<main>, затем абзацы <p>.
 * Без внешних зависимостей и без «читалки» — этого достаточно для пересказа.
 */
export function extractArticleText(html, { maxChars = 1_500 } = {}) {
  const source = String(html ?? '');
  if (!source) return '';

  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|iframe|form|header|footer|nav|aside|template)[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    );

  const container =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(cleaned)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(cleaned)?.[1] ??
    cleaned;

  const paragraphs = [];
  const seen = new Set();
  let length = 0;

  for (const match of container.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripHtml(match[1]);
    if (text.length < 60) continue;
    if (SKIP_PATTERNS.some((pattern) => pattern.test(text))) continue;
    if (seen.has(text)) continue;

    seen.add(text);
    paragraphs.push(text);
    length += text.length + 1;

    if (length >= maxChars * 1.5) break;
  }

  const text = (paragraphs.length > 0 ? paragraphs.join(' ') : stripHtml(container))
    .replace(/\s+/g, ' ')
    .trim();

  return truncate(text, maxChars);
}

/**
 * Загружает и кэширует текст статей. Ошибки не пробрасываются:
 * нет текста — модель перескажет по описанию из RSS.
 */
export function createArticleFetcher({
  timeoutMs = 6_000,
  maxChars = 1_500,
  userAgent,
  fetchImpl = fetch,
  cacheTtlMs = 3_600_000,
  maxCache = 500,
  logger,
} = {}) {
  const cache = new Map();

  async function get(url) {
    if (!/^https?:\/\//i.test(String(url ?? ''))) return null;

    const cached = cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.text;

    let text = null;

    try {
      const response = await fetchTextResource(url, {
        timeoutMs,
        userAgent,
        fetchImpl,
        maxBytes: 3_000_000,
        accept: 'text/html,application/xhtml+xml',
      });

      if (!response.contentType || /html|text\/plain/i.test(response.contentType)) {
        text = extractArticleText(response.text, { maxChars }) || null;
      }
    } catch (error) {
      logger?.debug('Не удалось прочитать статью', { url, error: error.message ?? String(error) });
    }

    cache.set(url, { text, expiresAt: Date.now() + (text ? cacheTtlMs : 600_000) });

    if (cache.size > maxCache) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    return text;
  }

  return { get, clear: () => cache.clear() };
}
