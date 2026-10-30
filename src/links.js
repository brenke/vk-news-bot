import { mapLimit } from './utils.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 10 * 60 * 1_000;

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * Сокращение ссылок: vk.cc через VK API, затем clck.ru и tinyurl.com.
 * Результат кэшируется, чтобы не дёргать сервисы на каждый ответ.
 */
export function createLinkShortener({ api = null, mode = 'auto', logger, fetchImpl = fetch, cacheTtlMs = DEFAULT_TTL_MS, timeoutMs = 8_000 } = {}) {
  const cache = new Map();

  async function viaVk(url) {
    if (!api) return null;
    try {
      const result = await api.call('utils.getShortLink', { url, private: 0 });
      const short = result?.short_url;
      return isHttpUrl(short) ? short : null;
    } catch (error) {
      logger?.warn('vk.cc не смог сократить ссылку', { error: error.message ?? String(error) });
      return null;
    }
  }

  async function fetchText(endpoint, url) {
    try {
      const response = await fetchImpl(endpoint(url), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'vK-news-bot/1.0' },
      });
      if (!response.ok) return null;
      const text = (await response.text()).trim();
      return isHttpUrl(text) ? text : null;
    } catch {
      return null;
    }
  }

  const viaClck = (url) => fetchText((value) => `https://clck.ru/--?url=${encodeURIComponent(value)}`, url);

  const viaTinyUrl = (url) =>
    fetchText((value) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(value)}`, url);

  async function shortenOne(url) {
    if (!isHttpUrl(url)) return url;

    const cached = cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.short;

    let short = null;

    if (mode !== 'off') {
      if (mode === 'vk' || mode === 'auto') short = await viaVk(url);
      if (!short && mode !== 'vk') short = (await viaClck(url)) ?? (await viaTinyUrl(url));
    }

    if (short && short.length < url.length) {
      cache.set(url, { short, expiresAt: Date.now() + cacheTtlMs });
      return short;
    }

    cache.set(url, { short: url, expiresAt: Date.now() + FAILURE_TTL_MS });
    return url;
  }

  return {
    async shortenMany(urls) {
      const unique = [...new Set(urls.filter(isHttpUrl))];
      const shortened = await mapLimit(unique, 2, shortenOne);
      return new Map(unique.map((url, index) => [url, shortened[index]]));
    },
    async shorten(url) {
      return shortenOne(url);
    },
    clear: () => cache.clear(),
  };
}

/**
 * Сокращает основную ссылку и ссылки на другие источники у списка новостей.
 */
export async function shortenItemLinks(shortener, items) {
  const urls = [];

  for (const item of items) {
    urls.push(item.link);
    for (const source of item.sources ?? []) urls.push(source.link);
  }

  const map = await shortener.shortenMany(urls);

  return items.map((item) => ({
    ...item,
    link: map.get(item.link) ?? item.link,
    sources: (item.sources ?? []).map((source) => ({
      ...source,
      link: map.get(source.link) ?? source.link,
    })),
  }));
}
