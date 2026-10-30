import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewsSearch, dedupeItems } from '../src/news/search.js';

const NOW = new Date('2026-10-30T12:00:00Z').getTime();
const config = { news: { windowHours: 72, maxCandidates: 10, maxItems: 5 } };

const makeItem = (overrides) => ({
  id: overrides.link,
  title: 'Заголовок',
  description: 'Описание',
  link: 'https://example.com/1',
  date: new Date(NOW - 3_600_000),
  source: 'Тест',
  feedUrl: 'https://example.com/rss',
  ...overrides,
});

const search = (items) =>
  createNewsSearch({
    config,
    loader: { loadAll: async () => items },
    logger: null,
    now: () => NOW,
  });

test('фильтрует по периоду, теме и убирает дубли', async () => {
  const items = [
    makeItem({ title: 'Курс доллара вырос', link: 'https://example.com/a' }),
    makeItem({ title: 'Курс доллара вырос', link: 'https://example.com/a' }),
    makeItem({ title: 'Доллар: итоги недели', link: 'https://example.com/old', date: new Date(NOW - 5 * 86_400_000) }),
    makeItem({ title: 'Курс доллара: прогноз', link: 'https://example.com/future', date: new Date(NOW + 3 * 86_400_000) }),
    makeItem({ title: 'Погода в Москве', link: 'https://example.com/weather' }),
    makeItem({ title: 'Курс доллара без даты', link: 'https://example.com/undated', date: null }),
  ];

  const result = await search(items).search('курс доллара');

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].link, 'https://example.com/a');
  assert.equal(result.total, 1);
});

test('для темы из двух слов требует оба слова', async () => {
  const items = [
    makeItem({ title: 'Курс доллара обновил максимум', link: 'https://example.com/both' }),
    makeItem({ title: 'Доллар подешевел', link: 'https://example.com/one' }),
  ];

  const result = await search(items).search('курс доллара');

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].link, 'https://example.com/both');
});

test('кавычки не спасают нерелевантное', async () => {
  const items = [makeItem({ title: 'Ночь искусств в Калуге', link: 'https://example.com/art' })];
  const result = await search(items).search('искусственный интеллект', { exact: true });

  assert.equal(result.items.length, 0);
});

test('свежие новости идут выше старых при равной релевантности', async () => {
  const items = [
    makeItem({ title: 'Футбол: вчерашний матч', link: 'https://example.com/old', date: new Date(NOW - 48 * 3_600_000) }),
    makeItem({ title: 'Футбол: сегодняшний матч', link: 'https://example.com/new', date: new Date(NOW - 3_600_000) }),
  ];

  const result = await search(items).search('футбол');

  assert.equal(result.items[0].link, 'https://example.com/new');
});

test('dedupeItems убирает перепечатки с одинаковым заголовком', () => {
  const items = [
    makeItem({ title: 'ЦБ снизил курс доллара', link: 'https://a.example/1' }),
    makeItem({ title: 'ЦБ снизил курс доллара', link: 'https://b.example/1' }),
    makeItem({ title: 'Другая новость', link: 'https://c.example/1' }),
  ];

  const result = dedupeItems(items);
  assert.equal(result.length, 2);
});
