import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUserPrompt, parseModelResponse, refineNews } from '../src/ai/deepseek.js';

const items = [
  {
    title: 'ЦБ снизил курс доллара',
    description: 'Официальный курс опустился до 80 рублей.',
    source: 'Ведомости',
    date: new Date('2026-10-30T09:15:00Z'),
    link: 'https://example.com/1',
  },
  {
    title: 'Доллар подешевел на бирже',
    description: 'Торги открылись снижением.',
    source: 'РБК',
    date: new Date('2026-10-30T08:00:00Z'),
    link: 'https://example.com/2',
  },
];

test('промпт содержит тему и нумерованный список', () => {
  const prompt = buildUserPrompt({ topic: 'курс доллара', items });
  assert.match(prompt, /Тема: курс доллара/);
  assert.match(prompt, /\[1\] Ведомости/);
  assert.match(prompt, /\[2\] РБК/);
});

test('промпт использует текст статьи вместо короткого описания', () => {
  const withArticle = [
    {
      ...items[0],
      description: 'Короткое описание.',
      articleText: 'Полный текст статьи с ключевыми цифрами и подробностями события.',
    },
  ];

  const prompt = buildUserPrompt({ topic: 'курс доллара', items: withArticle });

  assert.match(prompt, /Текст: Полный текст статьи/);
  assert.doesNotMatch(prompt, /Текст: Короткое описание/);
});

test('parseModelResponse понимает ```json и отбрасывает неверные индексы', () => {
  const response = parseModelResponse(
    '```json\n{"items":[{"index":2,"summary":"Второе описание"},{"index":9,"summary":"мусор"},{"index":2,"summary":"дубль"}]}\n```',
    { items, limit: 5 },
  );

  assert.equal(response.length, 1);
  assert.equal(response[0].item.link, 'https://example.com/2');
  assert.equal(response[0].summary, 'Второе описание');
});

test('parseModelResponse уважает лимит', () => {
  const response = parseModelResponse(
    JSON.stringify({
      items: [
        { index: 1, summary: 'Первое' },
        { index: 2, summary: 'Второе' },
      ],
    }),
    { items, limit: 1 },
  );

  assert.equal(response.length, 1);
});

test('parseModelResponse возвращает null на мусоре', () => {
  assert.equal(parseModelResponse('не JSON', { items, limit: 5 }), null);
  assert.equal(parseModelResponse('{"items":"нет"}', { items, limit: 5 }), null);
});

test('refineNews подменяет только описания, ссылки остаются из RSS', async () => {
  let requestBody;
  const fetchImpl = async (url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"items":[{"index":1,"summary":"Курс ЦБ опустился до 80 рублей."}]}' } }],
        usage: { total_tokens: 123 },
      }),
    };
  };

  const config = {
    ai: { enabled: true, apiKey: 'test', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', timeoutMs: 1_000, maxTokens: 500 },
  };

  const result = await refineNews({ topic: 'курс доллара', items, limit: 5, config, logger: null, fetchImpl });

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].item.link, 'https://example.com/1');
  assert.equal(result.items[0].summary, 'Курс ЦБ опустился до 80 рублей.');
  assert.equal(requestBody.response_format.type, 'json_object');
});

test('refineNews молча отдаёт null при ошибке API', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const config = {
    ai: { enabled: true, apiKey: 'test', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', timeoutMs: 1_000, maxTokens: 500 },
  };

  const result = await refineNews({ topic: 'тест', items, limit: 5, config, logger: null, fetchImpl });
  assert.equal(result, null);
});

test('refineNews не делает запрос, если ИИ выключен', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error('не должен вызываться');
  };

  const result = await refineNews({
    topic: 'тест',
    items,
    limit: 5,
    config: { ai: { enabled: false } },
    logger: null,
    fetchImpl,
  });

  assert.equal(result, null);
  assert.equal(called, false);
});
