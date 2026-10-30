const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

function zonedParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );

    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: String(parts.hour ?? '0').padStart(2, '0'),
      minute: String(parts.minute ?? '0').padStart(2, '0'),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: String(date.getUTCHours()).padStart(2, '0'),
      minute: String(date.getUTCMinutes()).padStart(2, '0'),
    };
  }
}

export function formatDateLabel(date, timeZone = 'Europe/Moscow', now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'время неизвестно';

  const current = zonedParts(date, timeZone);
  const today = zonedParts(now, timeZone);
  const yesterday = zonedParts(new Date(now.getTime() - 86_400_000), timeZone);
  const time = `${current.hour}:${current.minute}`;

  if (current.year === today.year && current.month === today.month && current.day === today.day) {
    return `сегодня, ${time}`;
  }

  if (current.year === yesterday.year && current.month === yesterday.month && current.day === yesterday.day) {
    return `вчера, ${time}`;
  }

  const month = MONTHS_SHORT[current.month - 1] ?? '';
  const year = current.year === today.year ? '' : ` ${current.year}`;

  return `${current.day} ${month}${year}, ${time}`;
}

function itemBlock(item, index, timeZone) {
  const lines = [`${index + 1}. ${item.title}`, `${item.source} · ${formatDateLabel(item.date, timeZone)}`];
  if (item.summary) lines.push(item.summary);
  lines.push(`→ ${item.link}`);
  return lines.join('\n');
}

/**
 * @param {{topic:string, items:Array, total:number, aiUsed:boolean, windowHours:number, timeZone:string}} result
 */
export function formatNews(result, { maxLength = 3_900 } = {}) {
  const { topic, items, total = items.length, windowHours, timeZone = 'Europe/Moscow' } = result;
  const header = `📰 Новости по теме «${topic}»`;
  const footer = `\n\nПериод: ${windowHours} ч · найдено: ${total}`;

  let body = '';
  let shown = 0;

  for (const item of items) {
    const block = itemBlock(item, shown, timeZone);
    const candidate = body ? `${body}\n\n${block}` : block;

    if (header.length + 2 + candidate.length + footer.length > maxLength) break;

    body = candidate;
    shown += 1;
  }

  if (shown === 0) return formatNoResults(topic, { windowHours });

  const skipped = items.length - shown;
  let text = `${header}\n\n${body}`;
  if (skipped > 0) text += `\n\n…и ещё ${skipped}. Сузьте тему, чтобы увидеть остальное.`;
  else if (text.length + footer.length <= maxLength) text += footer;

  return text;
}

export function formatNoResults(topic, { windowHours = 72 } = {}) {
  return [
    `😕 По теме «${topic}» ничего не нашлось за последние ${windowHours} ч.`,
    '',
    'Попробуйте короче и общее, например:',
    '/новости "ключевое слово"',
    '/новости экономика',
  ].join('\n');
}

export function formatHelp({ maxItems = 5, windowHours = 72 } = {}) {
  return [
    '🤖 Бот новостей',
    '',
    'Как пользоваться:',
    `/новости "тема" — ${maxItems} свежих новостей с описанием и ссылками`,
    '/новости ИИ — кавычки необязательны',
    '/новости "курс доллара" — кавычки помогают, если в теме несколько слов',
    '/помощь — эта справка',
    '',
    `Ищу по RSS крупных СМИ за последние ${windowHours} ч.`,
  ].join('\n');
}

export function formatError(topic) {
  return `⚠️ Не получилось собрать новости по теме «${topic}». Попробуйте ещё раз через минуту.`;
}

export function splitMessage(text, limit = 4_000) {
  const value = String(text ?? '');
  if (value.length <= limit) return [value];

  const chunks = [];
  let current = '';

  for (const block of value.split('\n')) {
    if (current && current.length + 1 + block.length > limit) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? `${current}\n${block}` : block;
    }

    while (current.length > limit) {
      chunks.push(current.slice(0, limit));
      current = current.slice(limit);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
