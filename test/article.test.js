import assert from 'node:assert/strict';
import test from 'node:test';
import { createArticleFetcher, extractArticleText } from '../src/news/article.js';

const LONG_SKIP = 'Читайте также: другая новость о том, как всё изменилось после решения регулятора';

const HTML = `<!doctype html>
<html><head><style>.x{color:red}</style><script>var a = 1;</script></head>
<body>
<header>Меню сайта</header>
<article>
  <h1>Заголовок</h1>
  <p>Первый абзац с важной новостью и цифрами: ЦБ снизил ставку до 16 процентов годовых, сообщил регулятор.</p>
  <p>${LONG_SKIP}</p>
  <p>Второй абзац объясняет последствия для рынка и добавляет детали, которых нет в заголовке статьи.</p>
  <p>Короткий абзац</p>
</article>
<footer>© 2026</footer>
</body></html>`;

test('извлекает абзацы статьи и отбрасывает служебное', () => {
  const text = extractArticleText(HTML);

  assert.match(text, /Первый абзац/);
  assert.match(text, /Второй абзац/);
  assert.doesNotMatch(text, /Читайте также/);
  assert.doesNotMatch(text, /Короткий абзац/);
  assert.doesNotMatch(text, /Меню сайта/);
  assert.doesNotMatch(text, /var a/);
});

test('уважает лимит символов', () => {
  const text = extractArticleText(HTML, { maxChars: 60 });

  assert.ok(text.length <= 60, `длина ${text.length}`);
  assert.match(text, /…$/);
});

test('без <article> берёт абзацы из body', () => {
  const html = '<html><body><div><p>Абзац без тега article, но достаточно длинный, чтобы попасть в текст пересказа.</p></div></body></html>';

  assert.match(extractArticleText(html), /Абзац без тега article/);
});

test('фетчер кэширует текст статьи', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => new TextEncoder().encode(HTML).buffer,
    };
  };

  const fetcher = createArticleFetcher({ fetchImpl, maxChars: 500 });

  const first = await fetcher.get('https://example.com/a');
  const second = await fetcher.get('https://example.com/a');

  assert.ok(first);
  assert.equal(first, second);
  assert.equal(calls, 1);
});

test('фетчер молча возвращает null при ошибке и не-html ответе', async () => {
  const failing = createArticleFetcher({
    fetchImpl: async () => {
      throw new Error('ECONNRESET');
    },
  });
  assert.equal(await failing.get('https://example.com/b'), null);

  const pdf = createArticleFetcher({
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
  });
  assert.equal(await pdf.get('https://example.com/c'), null);
});

test('не-http ссылки не запрашиваются', async () => {
  let called = false;
  const fetcher = createArticleFetcher({
    fetchImpl: async () => {
      called = true;
      throw new Error('не должен вызываться');
    },
  });

  assert.equal(await fetcher.get('не ссылка'), null);
  assert.equal(called, false);
});
