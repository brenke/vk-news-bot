import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDateLabel, formatHelp, formatNews, formatNoResults, splitMessage } from '../src/format.js';

const NOW = new Date('2026-10-30T12:00:00+03:00');

test('даты: сегодня, вчера, давно (Москва)', () => {
  assert.equal(formatDateLabel(new Date('2026-10-30T09:05:00+03:00'), 'Europe/Moscow', NOW), 'сегодня, 09:05');
  assert.equal(formatDateLabel(new Date('2026-10-29T18:30:00+03:00'), 'Europe/Moscow', NOW), 'вчера, 18:30');
  assert.equal(formatDateLabel(new Date('2026-10-25T08:00:00+03:00'), 'Europe/Moscow', NOW), '25 окт., 08:00');
  assert.equal(formatDateLabel(null, 'Europe/Moscow', NOW), 'время неизвестно');
});

test('сообщение содержит тему, новости и ссылки', () => {
  const text = formatNews({
    topic: 'курс доллара',
    total: 1,
    windowHours: 72,
    timeZone: 'Europe/Moscow',
    aiUsed: true,
    items: [
      {
        title: 'ЦБ снизил курс доллара',
        source: 'Ведомости',
        date: new Date('2026-10-30T09:15:00+03:00'),
        summary: 'Официальный курс опустился до 80 рублей.',
        link: 'https://example.com/1',
      },
    ],
  });

  assert.match(text, /Новости по теме «курс доллара»/);
  assert.match(text, /1\. ЦБ снизил курс доллара/);
  assert.match(text, /Ведомости · сегодня, 09:15/);
  assert.match(text, /Официальный курс опустился/);
  assert.match(text, /https:\/\/example\.com\/1/);
});

test('длинная выдача подрезается по лимиту', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    title: `Очень длинный заголовок новости номер ${index + 1} `.repeat(2),
    source: 'Источник',
    date: NOW,
    summary: 'Описание '.repeat(20),
    link: `https://example.com/${index + 1}`,
  }));

  const text = formatNews({
    topic: 'тест',
    total: items.length,
    windowHours: 72,
    timeZone: 'Europe/Moscow',
    items,
  }, { maxLength: 1_500 });

  assert.ok(text.length <= 1_500, `длина ${text.length}`);
  assert.match(text, /…и ещё \d+/);
});

test('даже одна гигантская новость попадает в ответ', () => {
  const text = formatNews(
    {
      topic: 'тест',
      total: 1,
      windowHours: 72,
      timeZone: 'Europe/Moscow',
      items: [
        {
          title: 'Т'.repeat(5_000),
          source: 'Источник',
          date: NOW,
          summary: '',
          link: 'https://example.com/1',
        },
      ],
    },
    { maxLength: 1_000 },
  );

  assert.ok(text.length <= 1_000);
  assert.match(text, /https:\/\/example\.com\/1/);
});

test('пустая выдача — подсказка', () => {
  const text = formatNoResults('абракадабра', { windowHours: 48 });
  assert.match(text, /ничего не нашлось/);
  assert.match(text, /48 ч/);
});

test('справка содержит команду', () => {
  assert.match(formatHelp({ maxItems: 5, windowHours: 72 }), /\/новости "тема"/);
});

test('splitMessage не теряет текст и соблюдает лимит', () => {
  const text = Array.from({ length: 200 }, (_, index) => `строка ${index} https://example.com/${index}`).join('\n');
  const chunks = splitMessage(text, 500);

  assert.ok(chunks.every((chunk) => chunk.length <= 500));
  assert.equal(chunks.join('\n'), text);
  assert.ok(chunks.length > 1);
});
