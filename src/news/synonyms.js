import { existsSync, readFileSync } from 'node:fs';
import { stem } from './query.js';

export const DEFAULT_SYNONYMS = {
  спорт: ['футбол', 'хоккей', 'теннис', 'баскетбол', 'волейбол', 'бокс', 'мма', 'чемпионат', 'олимпиада', 'матч', 'тренер', 'сборная'],
  политика: ['президент', 'правительство', 'госдума', 'парламент', 'выборы', 'министр', 'закон', 'кремль'],
  экономика: ['цб', 'инфляция', 'рубль', 'доллар', 'евро', 'бюджет', 'налоги', 'биржа', 'банк', 'ввп'],
  технологии: ['ии', 'нейросеть', 'смартфон', 'процессор', 'google', 'apple', 'microsoft', 'openai', 'робот', 'чип'],
  наука: ['исследование', 'ученые', 'космос', 'физика', 'биология', 'открытие', 'эксперимент'],
  культура: ['фильм', 'сериал', 'музыка', 'концерт', 'театр', 'выставка', 'премьера', 'артист'],
  происшествия: ['пожар', 'дтп', 'авария', 'взрыв', 'погиб', 'спасатели', 'мчс', 'чп'],
};

/**
 * Загружает словарь синонимов: { "спорт": ["футбол", "хоккей"] }.
 * Ключи приводятся к той же основе, что и слова темы.
 * @returns {Map<string, string[]>}
 */
export function loadSynonyms(filePath) {
  const map = new Map();

  if (!filePath || !existsSync(filePath)) return map;

  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return map;
  }

  for (const [key, words] of Object.entries(data)) {
    if (!Array.isArray(words)) continue;

    const values = words.map((word) => String(word).trim()).filter(Boolean);
    if (values.length === 0) continue;

    const existing = map.get(stem(key)) ?? [];
    map.set(stem(key), [...new Set([...existing, ...values])]);
  }

  return map;
}
