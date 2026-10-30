import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchFeed,
  loadFeedsFromJson,
  normalizeLink,
  parseDate,
  parseFeed,
  stripHtml,
} from '../src/news/feeds.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Тест</title>
    <item>
      <title>Курс доллара &amp; евро</title>
      <link>https://example.com/news/1?utm_source=rss&amp;utm_medium=feed</link>
      <description><![CDATA[<p>ЦБ <b>снизил</b> курс&nbsp;доллара</p>]]></description>
      <pubDate>Thu, 30 Oct 2026 09:15:00 +0300</pubDate>
      <guid>https://example.com/news/1</guid>
    </item>
    <item>
      <title>Без ссылки</title>
      <description>Эта новость должна отброситься</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Атом</title>
  <entry>
    <title>Atom-новость</title>
    <link rel="alternate" href="https://atom.example/item/1"/>
    <summary>Краткое описание</summary>
    <updated>2026-10-29T12:00:00Z</updated>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item>
    <title>RDF-новость</title>
    <link>https://rdf.example/1</link>
    <dc:date>2026-10-28T10:00:00+03:00</dc:date>
    <description>Описание RDF</description>
  </item>
</rdf:RDF>`;

const feed = { name: 'Тест', url: 'https://example.com/rss' };

test('разбор RSS 2.0: CDATA, HTML-теги, сущности, tracking-параметры', () => {
  const items = parseFeed(RSS, feed);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Курс доллара & евро');
  assert.equal(items[0].link, 'https://example.com/news/1');
  assert.equal(items[0].description, 'ЦБ снизил курс доллара');
  assert.equal(items[0].source, 'Тест');
  assert.equal(items[0].date.toISOString(), '2026-10-30T06:15:00.000Z');
});

test('разбор Atom', () => {
  const items = parseFeed(ATOM, feed);

  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://atom.example/item/1');
  assert.equal(items[0].description, 'Краткое описание');
});

test('разбор RSS 1.0 (RDF) с dc:date', () => {
  const items = parseFeed(RDF, feed);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'RDF-новость');
  assert.equal(items[0].date.toISOString(), '2026-10-28T07:00:00.000Z');
});

test('битый XML не роняет разбор', () => {
  const items = parseFeed('<rss><channel><item><title>Обрыв', feed);
  assert.ok(Array.isArray(items));
});

test('stripHtml раскрывает сущности и убирает теги', () => {
  assert.equal(stripHtml('&laquo;Привет&raquo; <b>мир</b>&hellip;'), '«Привет» мир…');
  assert.equal(stripHtml('a<br>b'), 'a b');
});

test('normalizeLink отбрасывает трекинг и не-http ссылки', () => {
  assert.equal(normalizeLink('https://example.com/a?utm_source=x&id=5#top'), 'https://example.com/a?id=5');
  assert.equal(normalizeLink('javascript:alert(1)'), '');
  assert.equal(normalizeLink('не ссылка'), '');
});

test('parseDate понимает RFC и dd.mm.yyyy', () => {
  assert.equal(parseDate('Thu, 30 Oct 2026 09:15:00 +0300').toISOString(), '2026-10-30T06:15:00.000Z');
  assert.equal(parseDate('30.10.2026 12:00').toISOString(), '2026-10-30T12:00:00.000Z');
  assert.equal(parseDate(''), null);
});

test('ошибка сети не выбрасывается наружу', async () => {
  const result = await fetchFeed(feed, {
    fetchImpl: async () => {
      throw new Error('ETIMEDOUT');
    },
    logger: { warn: () => {} },
  });

  assert.equal(result.items.length, 0);
  assert.ok(result.error);
});

test('fetchFeed декодирует windows-1251', async () => {
  const ascii = (value) => [...value].map((char) => char.charCodeAt(0));
  const header = '<?xml version="1.0" encoding="windows-1251"?><rss><channel><item><title>';
  const middle = '</title><link>https://example.com/1</link></item></channel></rss>';
  // «Курс доллара» в windows-1251
  const title = [0xca, 0xf3, 0xf0, 0xf1, 0x20, 0xe4, 0xee, 0xeb, 0xeb, 0xe0, 0xf0, 0xe0];

  const bytes = Uint8Array.from([...ascii(header), ...title, ...ascii(middle)]);

  const result = await fetchFeed(feed, {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'application/xml' },
      arrayBuffer: async () => bytes.buffer,
    }),
    logger: { warn: () => {} },
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Курс доллара');
});

test('loadFeedsFromJson фильтрует мусор и подставляет имя из домена', () => {
  const feeds = loadFeedsFromJson(
    JSON.stringify([
      { url: 'https://lenta.ru/rss/news' },
      { name: 'Битый', url: 'ftp://example.com/rss' },
      { name: 'Выключенный', url: 'https://example.com/rss', enabled: false },
      null,
    ]),
  );

  assert.equal(feeds.length, 2);
  assert.equal(feeds[0].name, 'lenta.ru');
  assert.equal(feeds[1].enabled, false);
});
