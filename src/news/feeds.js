import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { fetchTextResource } from '../http.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

const TRACKING_PARAMS = /^(utm_|yclid$|gclid$|fbclid$|_openstat$|from$)/i;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    if ('#cdata' in value) return toText(value['#cdata']);
    if ('#text' in value) return toText(value['#text']);
  }
  return '';
}

function safeFromCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Убирает HTML-теги и раскрывает базовые сущности. */
export function stripHtml(input) {
  if (input === undefined || input === null) return '';

  let text = String(input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  text = text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);

  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeLink(link) {
  if (!link) return '';

  try {
    const url = new URL(String(link).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

    url.hash = '';
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(param)) url.searchParams.delete(param);
    }

    return url.toString();
  } catch {
    return '';
  }
}

export function parseDate(value) {
  const raw = toText(value).trim();
  if (!raw) return null;

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) return new Date(timestamp);

  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2}))?$/.exec(raw);
  if (match) {
    const [, day, month, year, hours = '0', minutes = '0'] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function extractLink(raw) {
  for (const candidate of asArray(raw)) {
    if (typeof candidate === 'string') {
      if (candidate.trim()) return candidate.trim();
      continue;
    }
    if (candidate && typeof candidate === 'object') {
      const rel = candidate['@_rel'];
      if (rel && rel !== 'alternate') continue;
      const href = candidate['@_href'] ?? toText(candidate);
      if (href) return String(href).trim();
    }
  }
  return '';
}

function extractRawItems(document) {
  const channel = document?.rss?.channel;
  if (channel) return asArray(channel.item);

  const rdf = document?.['rdf:RDF'] ?? document?.RDF;
  if (rdf) return asArray(rdf.item);

  const atom = document?.feed;
  if (atom) return asArray(atom.entry);

  return [];
}

/**
 * Разбирает RSS 2.0 / RSS 1.0 (RDF) / Atom.
 * @returns {Array<{id:string,title:string,link:string,description:string,date:Date|null,source:string,feedUrl:string}>}
 */
export function parseFeed(xml, feed) {
  const document = parser.parse(String(xml ?? ''));
  const items = [];
  const seen = new Set();

  for (const raw of extractRawItems(document)) {
    if (!raw || typeof raw !== 'object') continue;

    const title = stripHtml(toText(raw.title));
    let link = normalizeLink(extractLink(raw.link));

    if (!link) {
      const guid = toText(raw.guid ?? raw.id);
      if (/^https?:\/\//i.test(guid)) link = normalizeLink(guid);
    }

    if (!title || !link || seen.has(link)) continue;
    seen.add(link);

    const description = stripHtml(
      toText(raw.description ?? raw.summary ?? raw['content:encoded'] ?? raw.content ?? raw['media:description']),
    ).slice(0, 600);

    const date = parseDate(
      raw.pubDate ?? raw['dc:date'] ?? raw.updated ?? raw.published ?? raw.date ?? raw['a10:updated'],
    );

    items.push({
      id: createHash('sha1').update(link).digest('hex').slice(0, 16),
      title,
      link,
      description,
      date,
      source: feed.name,
      feedUrl: feed.url,
    });
  }

  return items;
}

export async function fetchFeed(feed, { timeoutMs = 12_000, userAgent, fetchImpl = fetch, logger } = {}) {
  try {
    const { text: xml } = await fetchTextResource(feed.url, {
      timeoutMs,
      userAgent,
      fetchImpl,
      accept: 'application/rss+xml, application/xml, text/xml, */*',
    });

    const items = parseFeed(xml, feed);
    if (items.length === 0) throw new Error('в фиде не найдено ни одной новости');

    return { feed, items, error: null };
  } catch (error) {
    logger?.warn('Не удалось загрузить фид', { feed: feed.name, error: error.message ?? String(error) });
    return { feed, items: [], error };
  }
}

/**
 * Загрузчик фидов с кэшем и ограничением параллельности.
 */
export function createFeedLoader({ feeds, cacheTtlMs = 300_000, timeoutMs = 12_000, concurrency = 6, userAgent, logger, fetchImpl = fetch }) {
  const cache = new Map();

  const loadOne = (feed) => {
    const cached = cache.get(feed.url);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = fetchFeed(feed, { timeoutMs, userAgent, logger, fetchImpl }).then((result) => {
      if (result.error) {
        // Неудачный фид кэшируем ненадолго, чтобы не долбить его на каждый запрос.
        const entry = cache.get(feed.url);
        if (entry) entry.expiresAt = Date.now() + Math.min(cacheTtlMs, 60_000);
      }
      return result.items;
    });

    cache.set(feed.url, { promise, expiresAt: Date.now() + cacheTtlMs });
    return promise;
  };

  const loadAll = async () => {
    const active = feeds.filter((feed) => feed.enabled !== false);
    const results = [];

    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), active.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= active.length) return;
        results[index] = await loadOne(active[index]);
      }
    });

    await Promise.all(workers);
    return results.flat();
  };

  return { loadAll, loadOne, clear: () => cache.clear() };
}

export function loadFeedsFromJson(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`Не удалось разобрать config/feeds.json: ${error.message}`);
  }

  if (!Array.isArray(data)) throw new Error('config/feeds.json должен содержать массив объектов { "name", "url" }');

  return data
    .filter((feed) => feed && typeof feed.url === 'string' && feed.url.startsWith('http'))
    .map((feed) => ({
      name: String(feed.name ?? new URL(feed.url).hostname),
      url: feed.url,
      enabled: feed.enabled !== false,
    }));
}
