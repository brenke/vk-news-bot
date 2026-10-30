import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNewsService } from '../src/news/service.js';

function makeConfig(feedsPath) {
  return {
    ai: { enabled: false, apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', timeoutMs: 1_000, maxTokens: 500 },
    news: {
      windowHours: 72,
      maxItems: 5,
      maxCandidates: 10,
      timeZone: 'Europe/Moscow',
      cacheTtlMs: 300_000,
      responseCacheTtlMs: 180_000,
      requestTimeoutMs: 2_000,
      concurrency: 2,
      userAgent: 'test',
      feedsPath,
    },
  };
}

function rss(title, link) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
  <item>
    <title>${title}</title>
    <link>${link}</link>
    <description>Краткое описание новости</description>
    <pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate>
  </item>
</channel></rss>`;
}

test('сервис собирает новости из фидов и кэширует ответ', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vk-news-bot-'));
  const feedsPath = path.join(dir, 'feeds.json');

  writeFileSync(
    feedsPath,
    JSON.stringify([
      { name: 'Первый', url: 'https://one.example/rss' },
      { name: 'Второй', url: 'https://two.example/rss' },
    ]),
  );

  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const xml = url.includes('one')
      ? rss('Курс доллара снизился', 'https://one.example/1')
      : rss('Доллар: мнение аналитика', 'https://two.example/1');

    return {
      ok: true,
      headers: { get: () => 'application/rss+xml; charset=utf-8' },
      arrayBuffer: async () => new TextEncoder().encode(xml).buffer,
    };
  };

  const config = makeConfig(feedsPath);
  const service = createNewsService({ config, logger: null, fetchImpl });

  const first = await service.get('доллар');
  const second = await service.get('доллар');

  assert.equal(first.items.length, 2);
  assert.equal(first.aiUsed, false);
  assert.ok(first.items[0].summary);
  assert.equal(calls, 2, 'второй запрос должен браться из кэша');
  assert.deepEqual(second.items.map((item) => item.link), first.items.map((item) => item.link));
});

test('сервис не падает, если фид недоступен', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vk-news-bot-'));
  const feedsPath = path.join(dir, 'feeds.json');

  writeFileSync(feedsPath, JSON.stringify([{ name: 'Мёртвый', url: 'https://dead.example/rss' }]));

  const service = createNewsService({
    config: makeConfig(feedsPath),
    logger: null,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });

  const result = await service.get('доллар');
  assert.equal(result.items.length, 0);
});
