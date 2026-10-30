import { stem, tokenizeWords } from './query.js';

const MIN_SHARED = 3;
const JACCARD_THRESHOLD = 0.35;
const CONTAINMENT_THRESHOLD = 0.65;

// «80», «16%», «6,3 млрд» — если у двух новостей числа не пересекаются,
// это, скорее всего, разные события (курс доллара на 80 и на 90 рублей).
const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

export function titleFeatures(title) {
  const stems = new Set(
    tokenizeWords(title)
      .map(stem)
      .filter((value) => value.length >= 2),
  );

  const numbers = new Set(
    (String(title).match(NUMBER_RE) ?? []).map((value) => value.replace(',', '.')),
  );

  return { stems, numbers };
}

function stemsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 2) {
    return a.startsWith(b) || b.startsWith(a);
  }
  return false;
}

function sharedCount(small, large) {
  let shared = 0;

  for (const value of small) {
    if (large.has(value)) {
      shared += 1;
      continue;
    }
    for (const other of large) {
      if (stemsMatch(value, other)) {
        shared += 1;
        break;
      }
    }
  }

  return shared;
}

function numbersConflict(a, b) {
  if (a.size === 0 || b.size === 0) return false;

  for (const value of a) {
    if (b.has(value)) return false;
  }

  return true;
}

/** Похожи ли две новости на одно и то же событие. */
export function isSameStory(a, b) {
  if (numbersConflict(a.numbers, b.numbers)) return false;

  const [small, large] = a.stems.size <= b.stems.size ? [a.stems, b.stems] : [b.stems, a.stems];
  if (small.size < MIN_SHARED) return false;

  const shared = sharedCount(small, large);
  if (shared < MIN_SHARED) return false;

  const jaccard = shared / (a.stems.size + b.stems.size - shared);
  const containment = shared / small.size;

  return jaccard >= JACCARD_THRESHOLD || containment >= CONTAINMENT_THRESHOLD;
}

/**
 * Склеивает новости об одном событии в один пункт.
 * Главной остаётся самая релевантная, остальные источники — в sources.
 *
 * @param {Array<{title:string, score?:number, source:string, link:string}>} items
 */
export function clusterItems(items, { maxSources = 2 } = {}) {
  const clusters = [];

  for (const item of items) {
    const entry = { item, features: titleFeatures(item.title) };
    const target = clusters.find((cluster) =>
      cluster.members.some((member) => isSameStory(member.features, entry.features)),
    );

    if (target) {
      target.members.push(entry);
    } else {
      clusters.push({ members: [entry] });
    }
  }

  return clusters
    .map((cluster) => {
      const members = [...cluster.members].sort((a, b) => (b.item.score ?? 0) - (a.item.score ?? 0));
      const [primary, ...rest] = members;
      const others = rest.slice(0, Math.max(0, maxSources));

      return {
        ...primary.item,
        sources: others.map((entry) => ({ source: entry.item.source, link: entry.item.link })),
        relatedTitles: others.map((entry) => entry.item.title),
        clusterSize: members.length,
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
