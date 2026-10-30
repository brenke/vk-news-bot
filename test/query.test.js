import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuery, prepareItem, scoreItem, stem, tokenizeWords } from '../src/news/query.js';

test('стемминг приводит словоформы к одной основе', () => {
  assert.equal(stem('новости'), stem('новость'));
  assert.equal(stem('доллара'), stem('доллары'));
  assert.equal(stem('выборы'), 'выбор');
});

test('стоп-слова выкидываются из темы', () => {
  assert.deepEqual(tokenizeWords('новости про то, как все'), []);
  assert.deepEqual(tokenizeWords('новости про курс доллара'), ['курс', 'доллара']);
});

test('оценка находит словоформы в заголовке', () => {
  const query = buildQuery('доллар');
  const item = prepareItem({ title: 'Курс доллара вырос', description: '' });
  const result = scoreItem(item, query);

  assert.ok(result);
  assert.equal(result.matched, 1);
  assert.ok(result.score >= 6);
});

test('регрессия: «искусственный интеллект» не должен цеплять «Ночь искусств»', () => {
  const query = buildQuery('искусственный интеллект');
  const item = prepareItem({ title: 'Калуга готовится к «Ночи искусств»', description: 'Акция пройдёт 3 ноября' });

  assert.equal(scoreItem(item, query), null);
});

test('«искусственный интеллект» находит текст про искусственный интеллект', () => {
  const query = buildQuery('искусственный интеллект');
  const item = prepareItem({
    title: 'Новая модель ИИ',
    description: 'Лаборатория искусственного интеллекта показала результаты',
  });

  assert.ok(scoreItem(item, query));
});

test('кавычки требуют все слова темы', () => {
  const exactQuery = buildQuery('курс доллара', { exact: true });
  const partial = prepareItem({ title: 'Доллар подешевел', description: '' });

  assert.equal(scoreItem(partial, exactQuery), null);
});

test('нерелевантная новость не проходит', () => {
  const query = buildQuery('футбол');
  const item = prepareItem({ title: 'Новый смартфон Apple', description: 'Обзор камеры и экрана' });

  assert.equal(scoreItem(item, query), null);
});

test('регрессия: «выборы» не цепляет «Выборг»', () => {
  const query = buildQuery('выборы');
  const item = prepareItem({ title: 'В Выборге пройдёт хоккейный матч', description: '' });

  assert.equal(scoreItem(item, query), null);
});

test('короткие слова: «цена» и «цены» совпадают', () => {
  const query = buildQuery('цена');
  const item = prepareItem({ title: 'Цены на нефть выросли', description: '' });

  assert.ok(scoreItem(item, query));
});

test('синонимы расширяют категорийную тему', () => {
  const synonyms = new Map([['спорт', ['футбол', 'хоккей']]]);
  const query = buildQuery('спорт', { synonyms });

  assert.deepEqual(query.tokens[0].extras, ['футбол', 'хокк']);

  const item = prepareItem({ title: 'Футбольный матч завершился вничью', description: '' });
  const result = scoreItem(item, query);

  assert.ok(result);
  assert.ok(result.coverage >= 0.6);
});

test('в точном режиме синонимы не подмешиваются', () => {
  const synonyms = new Map([['спорт', ['футбол']]]);
  const query = buildQuery('спорт', { exact: true, synonyms });

  assert.deepEqual(query.tokens[0].extras, []);
});
