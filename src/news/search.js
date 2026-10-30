import { buildQuery, normalizeText, prepareItem, scoreItem, stem, tokenizeWords } from './query.js';

const MAX_FUTURE_SKEW_MS = 2 * 60 * 60 * 1_000;

function titleStems(title) {
  return new Set(
    tokenizeWords(title)
      .map(stem)
      .filter((value) => value.length >= 3),
  );
}

/**
 * Убирает дубли: одинаковые ссылки и перепечатки с почти одинаковым заголовком.
 */
export function dedupeItems(items) {
  const seenLinks = new Set();
  const seenTitles = new Set();
  const kept = [];

  for (const item of items) {
    if (seenLinks.has(item.link)) continue;

    const key = normalizeText(item.title);
    if (seenTitles.has(key)) continue;

    const stems = titleStems(item.title);
    const isContained = stems.size >= 4 && kept.some((other) => [...stems].every((value) => other.stems.has(value)));
    if (isContained) continue;

    seenLinks.add(item.link);
    seenTitles.add(key);
    kept.push({ item, stems });
  }

  return kept.map((entry) => entry.item);
}

export function createNewsSearch({ config, loader, logger, synonyms = null, now = () => Date.now() }) {
  return {
    async search(topic, { exact = false } = {}) {
      const startedAt = Date.now();
      const rawItems = await loader.loadAll();

      const windowMs = config.news.windowHours * 3_600_000;
      const currentTime = now();
      const fresh = [];
      let undated = 0;

      for (const item of rawItems) {
        const timestamp = item.date instanceof Date ? item.date.getTime() : 0;
        if (!timestamp) {
          undated += 1;
          continue;
        }
        if (timestamp > currentTime + MAX_FUTURE_SKEW_MS) continue;
        if (timestamp < currentTime - windowMs) continue;

        fresh.push({
          ...item,
          ageHours: Math.max(0, (currentTime - timestamp) / 3_600_000),
        });
      }

      fresh.sort((a, b) => a.ageHours - b.ageHours);
      const unique = dedupeItems(fresh);

      const query = buildQuery(topic, { exact, synonyms });
      const scored = [];

      for (const item of unique) {
        const prepared = prepareItem(item);
        const relevance = scoreItem(prepared, query);
        if (!relevance) continue;

        const freshness = 1 - Math.min(1, prepared.ageHours / config.news.windowHours);
        scored.push({
          ...prepared,
          score: relevance.score + freshness * 3,
          relevance: relevance.score,
          coverage: relevance.coverage,
        });
      }

      const minCoverage = query.exact ? 0.999 : query.tokens.length >= 3 ? 0.5 : 0.6;
      let selected = scored.filter((item) => item.coverage >= minCoverage);
      if (selected.length === 0 && !query.exact) {
        selected = scored.filter((item) => item.coverage >= 0.5);
      }

      selected.sort((a, b) => b.coverage - a.coverage || b.score - a.score || b.date - a.date);

      const result = {
        items: selected.slice(0, config.news.maxCandidates),
        total: selected.length,
        query,
        stats: {
          loaded: rawItems.length,
          fresh: fresh.length,
          unique: unique.length,
          undated,
          ms: Date.now() - startedAt,
        },
      };

      logger?.info('Поиск по теме завершён', {
        topic,
        exact,
        matched: result.total,
        candidates: result.items.length,
        loaded: rawItems.length,
        ms: result.stats.ms,
      });

      return result;
    },
  };
}
