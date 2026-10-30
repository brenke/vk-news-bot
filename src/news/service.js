import { readFileSync } from 'node:fs';
import { refineNews } from '../ai/deepseek.js';
import { mapLimit, truncate } from '../utils.js';
import { createArticleFetcher } from './article.js';
import { createFeedLoader, loadFeedsFromJson } from './feeds.js';
import { createNewsSearch } from './search.js';
import { loadSynonyms } from './synonyms.js';

export function loadFeeds(feedsPath) {
  let json;
  try {
    json = readFileSync(feedsPath, 'utf8');
  } catch (error) {
    throw new Error(`Не удалось прочитать список RSS-источников (${feedsPath}): ${error.message}`);
  }

  const feeds = loadFeedsFromJson(json);
  if (feeds.length === 0) throw new Error(`Список RSS-источников пуст: ${feedsPath}`);

  return feeds;
}

/**
 * Поиск + отбор моделью + кэш ответов по теме.
 */
export function createNewsService({ config, logger, fetchImpl = fetch, now = () => Date.now() }) {
  const feeds = loadFeeds(config.news.feedsPath);

  const loader = createFeedLoader({
    feeds,
    cacheTtlMs: config.news.cacheTtlMs,
    timeoutMs: config.news.requestTimeoutMs,
    concurrency: config.news.concurrency,
    userAgent: config.news.userAgent,
    logger,
    fetchImpl,
  });

  const search = createNewsSearch({
    config,
    loader,
    logger,
    synonyms: loadSynonyms(config.news.synonymsPath),
    now,
  });

  const articleFetcher = createArticleFetcher({
    timeoutMs: config.news.fulltextTimeoutMs,
    maxChars: config.news.fulltextMaxChars,
    userAgent: config.news.userAgent,
    fetchImpl,
    logger,
  });

  const cache = new Map();

  async function build(topic, { exact }) {
    const found = await search.search(topic, { exact });

    if (config.ai.enabled && config.news.fulltext !== false && found.items.length > 0) {
      const limit = config.news.fulltextCandidates ?? 8;
      const targets = found.items.slice(0, limit);
      const texts = await mapLimit(targets, 4, (item) => articleFetcher.get(item.link));

      targets.forEach((item, index) => {
        if (texts[index]) item.articleText = texts[index];
      });

      logger?.debug('Тексты статей загружены', { requested: targets.length, ok: texts.filter(Boolean).length });
    }

    let items;
    let aiUsed = false;

    if (config.ai.enabled && found.items.length > 0) {
      const refined = await refineNews({
        topic,
        items: found.items,
        limit: config.news.maxItems,
        config,
        logger,
        fetchImpl,
      });

      if (refined) {
        aiUsed = true;
        items = refined.items.slice(0, config.news.maxItems).map(({ item, summary }) => ({ ...item, summary }));
      }
    }

    if (!items) {
      items = found.items.slice(0, config.news.maxItems).map((item) => ({
        ...item,
        summary: truncate(item.description, 240),
      }));
    }

    return {
      topic,
      items,
      total: Math.max(found.total, items.length),
      aiUsed,
      windowHours: config.news.windowHours,
      timeZone: config.news.timeZone,
    };
  }

  function get(topic, { exact = false } = {}) {
    const key = `${exact ? '=' : '~'}${topic.toLowerCase()}`;
    const existing = cache.get(key);
    if (existing && existing.expiresAt > now()) return existing.promise;

    const entry = { expiresAt: now() + config.news.responseCacheTtlMs, promise: null };

    entry.promise = build(topic, { exact })
      .then((result) => {
        // Пустой результат не кэшируем надолго: тему могли сформулировать неудачно.
        if (result.items.length === 0) entry.expiresAt = now() + 30_000;
        return result;
      })
      .catch((error) => {
        cache.delete(key);
        throw error;
      });

    cache.set(key, entry);

    if (cache.size > 200) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey && oldestKey !== key) cache.delete(oldestKey);
    }

    return entry.promise;
  }

  return {
    get,
    feedsCount: feeds.length,
    feeds: feeds.map((feed) => feed.name),
    clearCache: () => cache.clear(),
  };
}
