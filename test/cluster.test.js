import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterItems, isSameStory, titleFeatures } from '../src/news/cluster.js';

const item = (title, source, link, score = 1) => ({
  title,
  source,
  link,
  score,
  description: '',
  date: new Date(),
});

test('разные заголовки об одном событии склеиваются', () => {
  const items = [
    item('В ОАЭ закрыли пляжи из-за разлива нефти с китайского супертанкера', 'Лента.ру', 'https://a', 10),
    item('Разлив нефти у берегов ОАЭ: закрыты пляжи в трёх эмиратах', 'РБК', 'https://b', 5),
    item('ЦБ снизил ключевую ставку до 16%', 'Ведомости', 'https://c', 8),
  ];

  const result = clusterItems(items, { maxSources: 2 });

  assert.equal(result.length, 2);

  const oil = result.find((entry) => /нефт/i.test(entry.title));
  assert.equal(oil.clusterSize, 2);
  assert.equal(oil.sources.length, 1);
  assert.equal(oil.sources[0].link, 'https://b');
  assert.equal(oil.link, 'https://a', 'главной должна стать самая релевантная');
});

test('похожие по теме, но разные события не склеиваются', () => {
  const dollar = titleFeatures('Курс доллара вырос до 80 рублей');
  const euro = titleFeatures('Курс евро вырос до 90 рублей');
  assert.equal(isSameStory(dollar, euro), false);

  const items = [
    item('Курс доллара вырос до 80 рублей', 'Лента.ру', 'https://a'),
    item('Курс евро вырос до 90 рублей', 'РБК', 'https://b'),
  ];

  assert.equal(clusterItems(items).length, 2);
});

test('разные числа в заголовке — разные события', () => {
  const first = titleFeatures('В ЕС договорились выдать 42,6 млн баррелей нефти');
  const second = titleFeatures('Из резервов США выделят 6,3 млрд баррелей нефти');

  assert.equal(isSameStory(first, second), false);
});

test('цепочка похожих новостей склеивается в один сюжет', () => {
  const items = [
    item('Разлив нефти в Ормузском проливе закрыл пляжи ОАЭ', 'ТАСС', 'https://a', 5),
    item('Разлив нефти у берегов ОАЭ: закрыты пляжи в трёх эмиратах', 'РБК', 'https://b', 4),
    item('ОАЭ закрыли пляжи из-за разлива нефти', 'Коммерсантъ', 'https://c', 3),
  ];

  const result = clusterItems(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].clusterSize, 3);
});

test('количество дополнительных источников ограничено', () => {
  const items = [
    item('Разлив нефти в Ормузском проливе закрыл пляжи ОАЭ', 'Лента.ру', 'https://a', 10),
    item('Разлив нефти у берегов ОАЭ: закрыты пляжи', 'РБК', 'https://b', 9),
    item('Пляжи ОАЭ закрыты из-за разлива нефти', 'ТАСС', 'https://c', 8),
    item('ОАЭ закрыли пляжи после разлива нефти', 'МК', 'https://d', 7),
  ];

  const result = clusterItems(items, { maxSources: 1 });
  assert.equal(result.length, 1);
  assert.equal(result[0].sources.length, 1);
  assert.equal(result[0].clusterSize, 4);
});
