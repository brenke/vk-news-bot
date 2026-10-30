const MENTION_RE = /^\s*(?:\[(?:club|public|id)\d+\|[^\]]*\]\s*)+/i;
const PREFIXED_RE = /^[/!]\s*([\p{L}\p{N}_]+)(?:@[\w.]+)?\s*([\s\S]*)$/u;
const BARE_RE = /^([\p{L}\p{N}_]+)(?:@[\w.]+)?[\s,:-]+([\s\S]*)$/u;

const NEWS_ALIASES = new Set(['новости', 'новость', 'news', 'ньюс', 'новостей']);
const HELP_ALIASES = new Set(['помощь', 'помоги', 'help', 'старт', 'start', 'команды']);

const QUOTE_PAIRS = [
  ['"', '"'],
  ['«', '»'],
  ['“', '”'],
  ['„', '“'],
  ['„', '»'],
  ["'", "'"],
];

function stripWrappingQuotes(text) {
  let value = text.trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [open, close] of QUOTE_PAIRS) {
      if (value.startsWith(open) && value.endsWith(close) && value.length > open.length + close.length) {
        value = value.slice(open.length, -close.length).trim();
        changed = true;
      }
    }
  }

  return value;
}

function cleanTopic(raw) {
  let topic = String(raw ?? '').replace(/\s+/g, ' ').trim();

  topic = topic.replace(/^(?:по\s+теме|на\s+тему|про|об|о|по)\s+/i, '').trim();

  for (const [open, close] of QUOTE_PAIRS) {
    if (topic.startsWith(open)) {
      const end = topic.indexOf(close, open.length);
      if (end > open.length) {
        return { topic: topic.slice(open.length, end).trim(), exact: true };
      }
    }
  }

  topic = stripWrappingQuotes(topic);
  topic = topic.replace(/^[,;:\-—–\s]+/, '').trim();
  topic = topic.replace(/[.,;:!?]+$/, '').trim();

  return { topic, exact: false };
}

/**
 * Разбирает сообщение и возвращает команду.
 * @param {string} rawText
 * @returns {{kind:'news', topic:string, exact:boolean}|{kind:'help'}|{kind:'unknown', command:string}|null}
 */
export function parseCommand(rawText) {
  let text = String(rawText ?? '').trim();
  if (!text) return null;

  const hadMention = MENTION_RE.test(text);
  if (hadMention) text = text.replace(MENTION_RE, '').trim();

  const prefixed = PREFIXED_RE.exec(text);
  if (prefixed) {
    const command = prefixed[1].toLowerCase();
    const rest = prefixed[2];

    if (NEWS_ALIASES.has(command)) {
      return { kind: 'news', ...cleanTopic(rest) };
    }
    if (HELP_ALIASES.has(command)) {
      return { kind: 'help' };
    }
    return { kind: 'unknown', command };
  }

  if (hadMention) {
    const trimmed = text.trim();
    const singleWord = /^([\p{L}\p{N}_]+)(?:@[\w.]+)?$/u.exec(trimmed);
    const bare = singleWord ? [trimmed, singleWord[1], ''] : BARE_RE.exec(trimmed);
    const command = String(bare?.[1] ?? '').toLowerCase();
    const rest = bare?.[2] ?? '';

    if (NEWS_ALIASES.has(command)) {
      return { kind: 'news', ...cleanTopic(rest) };
    }
    if (HELP_ALIASES.has(command)) {
      return { kind: 'help' };
    }
  }

  return null;
}

export { NEWS_ALIASES, HELP_ALIASES };
