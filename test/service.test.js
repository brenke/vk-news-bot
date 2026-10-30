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
      fulltext: true,
      fulltextCandidates: 8,
      fulltextTimeoutMs: 2_000,
      fulltextMaxChars: 500,
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

function textResponse(body, contentType) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    headers: { get: () => contentType },
    arrayBuffer: async () => bytes.buffer,
    text: async () => body,
  };
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

test('с включённым ИИ читает статью и передаёт текст модели', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vk-news-bot-'));
  const feedsPath = path.join(dir, 'feeds.json');

  writeFileSync(feedsPath, JSON.stringify([{ name: 'Фиде', url: 'https://feed.example/rss' }]));

  const articleHtml = `<html><body><article><p>${'Подробности события с ключевыми цифрами и деталями. '.repeat(6)}</p></article></body></html>`;
  let deepseekBody = null;

  const fetchImpl = async (url, init) => {
    if (url.includes('deepseek')) {
      deepseekBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"items":[{"index":1,"summary":"Кратко о главном из статьи."}]}' } }],
          usage: { total_tokens: 100 },
        }),
      };
    }

    if (url.includes('article.example')) {
      return textResponse(articleHtml, 'text/html; charset=utf-8');
    }

    return textResponse(rss('Курс доллара снизился', 'https://article.example/1'), 'application/rss+xml');
  };

  const config = makeConfig(feedsPath);
  config.ai = {
    enabled: true,
    apiKey: 'test',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    timeoutMs: 2_000,
    maxTokens: 500,
  };

  const result = await createNewsService({ config, logger: null, fetchImpl }).get('доллар');

  assert.equal(result.aiUsed, true);
  assert.equal(result.items[0].summary, 'Кратко о главном из статьи.');
  assert.match(JSON.stringify(deepseekBody), /Подробности события с ключевыми цифрами/);
});
