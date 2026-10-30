import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommand } from '../src/commands.js';

test('команда со слэшем и темой в кавычках', () => {
  assert.deepEqual(parseCommand('/новости "курс доллара"'), {
    kind: 'news',
    topic: 'курс доллара',
    exact: true,
  });
});

test('команда с @упоминанием сообщества', () => {
  assert.deepEqual(parseCommand('/новости@club123 ИИ'), { kind: 'news', topic: 'ИИ', exact: false });
});

test('команда с восклицательным знаком', () => {
  assert.deepEqual(parseCommand('!новости спорт'), { kind: 'news', topic: 'спорт', exact: false });
});

test('команда после упоминания бота', () => {
  assert.deepEqual(parseCommand('[club42|Новостной бот] /новости выборы'), {
    kind: 'news',
    topic: 'выборы',
    exact: false,
  });
});

test('команда без слэша после упоминания', () => {
  assert.deepEqual(parseCommand('[club42|Новостной бот] новости выборы'), {
    kind: 'news',
    topic: 'выборы',
    exact: false,
  });
});

test('пустая тема', () => {
  assert.deepEqual(parseCommand('/новости'), { kind: 'news', topic: '', exact: false });
});

test('приставка «про» отбрасывается', () => {
  assert.deepEqual(parseCommand('/новости про ИИ'), { kind: 'news', topic: 'ИИ', exact: false });
});

test('справка', () => {
  assert.deepEqual(parseCommand('/помощь'), { kind: 'help' });
  assert.deepEqual(parseCommand('/start'), { kind: 'help' });
});

test('обычный текст игнорируется', () => {
  assert.equal(parseCommand('привет, как дела?'), null);
  assert.equal(parseCommand('новости без команды'), null);
  assert.equal(parseCommand(''), null);
});

test('неизвестная команда распознаётся, но не как новости', () => {
  assert.deepEqual(parseCommand('/погода Москва'), { kind: 'unknown', command: 'погода' });
});
