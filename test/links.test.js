import assert from 'node:assert/strict';
import test from 'node:test';
import { createLinkShortener } from '../src/links.js';

const LONG = 'https://www.vedomosti.ru/finance/news/2026/10/29/1241268-ofitsialnii-kurs';

test('сокращает через vk.cc и кэширует результат', async () => {
  let calls = 0;
  const api = {
    async call(method, params) {
      calls += 1;
      assert.equal(method, 'utils.getShortLink');
      assert.equal(params.url, LONG);
      return { short_url: 'https://vk.cc/abc123' };
    },
  };

  const shortener = createLinkShortener({ api, mode: 'auto' });

  assert.equal(await shortener.shorten(LONG), 'https://vk.cc/abc123');
  assert.equal(await shortener.shorten(LONG), 'https://vk.cc/abc123');
  assert.equal(calls, 1);
});

test('при ошибке VK падает на clck.ru', async () => {
  const api = {
    async call() {
      throw new Error('Access denied');
    },
  };
  const fetchImpl = async (url) => {
    assert.match(url, /clck\.ru/);
    return { ok: true, text: async () => 'https://clck.ru/3WmkCR' };
  };

  const shortener = createLinkShortener({ api, mode: 'auto', fetchImpl, logger: null });
  assert.equal(await shortener.shorten(LONG), 'https://clck.ru/3WmkCR');
});

test('если все сервисы упали, остаётся исходная ссылка', async () => {
  const fetchImpl = async () => ({ ok: false, text: async () => '' });
  const shortener = createLinkShortener({ mode: 'clck', fetchImpl, logger: null });

  assert.equal(await shortener.shorten(LONG), LONG);
});

test('режим vk не использует сторонние сервисы', async () => {
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return { ok: true, text: async () => 'https://clck.ru/x' };
  };

  const shortener = createLinkShortener({
    api: { call: async () => { throw new Error('nope'); } },
    mode: 'vk',
    fetchImpl,
  });

  assert.equal(await shortener.shorten(LONG), LONG);
  assert.equal(fetched, false);
});

test('mode=off ничего не меняет и не ходит в сеть', async () => {
  let fetched = false;
  const shortener = createLinkShortener({
    mode: 'off',
    fetchImpl: async () => {
      fetched = true;
      return { ok: true, text: async () => 'https://clck.ru/x' };
    },
  });

  assert.equal(await shortener.shorten(LONG), LONG);
  assert.equal(fetched, false);
});

test('shortenMany дедуплицирует и сохраняет соответствие', async () => {
  let calls = 0;
  const api = {
    async call(method, params) {
      calls += 1;
      const id = params.url.endsWith('/one') ? 'one' : 'two';
      return { short_url: `https://vk.cc/${id}` };
    },
  };

  const shortener = createLinkShortener({ api, mode: 'vk' });
  const map = await shortener.shortenMany([
    'https://example.com/one',
    'https://example.com/two',
    'https://example.com/one',
    'не ссылка',
  ]);

  assert.equal(map.get('https://example.com/one'), 'https://vk.cc/one');
  assert.equal(map.get('https://example.com/two'), 'https://vk.cc/two');
  assert.equal(map.has('не ссылка'), false);
  assert.equal(calls, 2);
});
