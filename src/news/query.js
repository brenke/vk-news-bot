const STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'по', 'с', 'со', 'не', 'что', 'как', 'за', 'из', 'от', 'до', 'для', 'при',
  'про', 'об', 'о', 'а', 'но', 'или', 'же', 'ли', 'бы', 'то', 'это', 'этот', 'эта', 'эти', 'весь',
  'все', 'всё', 'был', 'была', 'было', 'были', 'будет', 'может', 'можно', 'есть', 'уже', 'еще',
  'ещё', 'только', 'также', 'так', 'там', 'тут', 'где', 'когда', 'почему', 'который', 'которые',
  'которая', 'которое', 'свой', 'своя', 'свои', 'его', 'ее', 'её', 'их', 'мы', 'вы', 'они', 'он',
  'она', 'оно', 'я', 'ты', 'чем', 'кто', 'что-то', 'этот', 'the', 'a', 'an', 'of', 'in', 'on',
  'новости', 'новость', 'новостей', 'новостям', 'новостях', 'свежие', 'свежих', 'последние',
  'последних', 'главные', 'главное', 'срочно', 'сегодня', 'вчера',
]);

// Окончания отсортированы по убыванию длины: срезаем самое длинное подходящее.
const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ов', 'ев', 'ей', 'ой', 'ый', 'ий', 'ым', 'им', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'их', 'ых',
  'ую', 'юю', 'ям', 'ам', 'ом', 'ем', 'ах', 'ях', 'ия', 'ии', 'ье', 'ья', 'ет', 'ут', 'ют',
  'ит', 'ат', 'ят', 'ла', 'ло', 'ли', 'ешь', 'ишь', 'у', 'ю', 'а', 'я', 'ы', 'и', 'о', 'е', 'ь',
].sort((a, b) => b.length - a.length);

const SINGLE_LETTER_ENDINGS = new Set(['у', 'ю', 'а', 'я', 'ы', 'и', 'о', 'е', 'ь']);

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Очень лёгкий стеммер: срезает типичные русские окончания. */
export function stem(word) {
  const value = normalizeText(word);
  if (value.length < 4) return value;

  for (const ending of ENDINGS) {
    if (!value.endsWith(ending)) continue;

    const rest = value.length - ending.length;

    // Короткие слова режем только по одному символу, иначе «билет» превращается в «бил».
    if (SINGLE_LETTER_ENDINGS.has(ending)) {
      if (rest < 3) continue;
    } else if (value.length < 6 || rest < 4) {
      continue;
    }

    return value.slice(0, rest);
  }

  return value;
}

export function tokenizeWords(text) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const result = [];

  for (const word of words) {
    if (word.length < 2 && !/\d/.test(word)) continue;
    if (STOP_WORDS.has(word)) continue;
    result.push(word);
  }

  return result;
}

export function buildQuery(topic, { exact = false, synonyms = null } = {}) {
  const normalized = normalizeText(topic);
  const tokens = [];
  const seen = new Set();

  for (const word of tokenizeWords(topic)) {
    const value = stem(word);
    if (!value || seen.has(value)) continue;
    seen.add(value);

    const extras = [];
    if (!exact && synonyms instanceof Map) {
      for (const extraWord of synonyms.get(value) ?? []) {
        const extraStem = stem(extraWord);
        if (extraStem && extraStem !== value && !extras.includes(extraStem)) extras.push(extraStem);
      }
    }

    tokens.push({ word, stem: value, extras });
  }

  if (tokens.length === 0 && normalized) {
    tokens.push({ word: normalized, stem: stem(normalized) || normalized, extras: [] });
  }

  return { topic: String(topic ?? '').trim(), phrase: normalized, exact: Boolean(exact), tokens };
}

function stemsMatch(a, b) {
  if (a === b) return true;

  // Допускаем небольшие расхождения суффиксов: «доллар» / «долларов», «новост» / «новостной».
  if (a.length >= 6 && b.length >= 6 && Math.abs(a.length - b.length) <= 2) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }

  return false;
}

function hasStem(stems, target) {
  for (const value of stems) {
    if (stemsMatch(value, target)) return true;
  }
  return false;
}

/** Более мягкое совпадение — только для курируемых синонимов. */
function hasStemLoose(stems, target) {
  if (target.length < 5) return stems.has(target);
  for (const value of stems) {
    if (value === target) return true;
    if (value.length >= 5 && (value.startsWith(target) || target.startsWith(value))) return true;
  }
  return false;
}

export function prepareItem(item) {
  const titleNorm = normalizeText(item.title);
  const descNorm = normalizeText(item.description);

  return {
    ...item,
    titleNorm,
    descNorm,
    titleStems: new Set(titleNorm.split(' ').filter(Boolean).map(stem)),
    descStems: new Set(descNorm.split(' ').filter(Boolean).map(stem)),
  };
}

/**
 * Оценка релевантности. null — новость не подходит по теме.
 */
export function scoreItem(prepared, query) {
  if (query.tokens.length === 0) return null;

  let matched = 0;
  let score = 0;

  for (const token of query.tokens) {
    if (hasStem(prepared.titleStems, token.stem)) {
      matched += 1;
      score += 6;
      continue;
    }
    if (hasStem(prepared.descStems, token.stem)) {
      matched += 1;
      score += 2;
      continue;
    }

    if (!query.exact && token.extras?.length) {
      if (token.extras.some((extra) => hasStemLoose(prepared.titleStems, extra))) {
        matched += 0.6;
        score += 3;
      } else if (token.extras.some((extra) => hasStemLoose(prepared.descStems, extra))) {
        matched += 0.6;
        score += 1.5;
      }
    }
  }

  if (matched === 0) return null;

  if (query.exact) {
    if (query.tokens.length > 1 && matched < query.tokens.length) return null;
    if (query.phrase && (prepared.titleNorm.includes(query.phrase) || prepared.descNorm.includes(query.phrase))) {
      score += 8;
    }
  }

  return { score, matched, coverage: Math.min(1, matched / query.tokens.length) };
}
