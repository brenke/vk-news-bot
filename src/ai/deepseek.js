import { truncate } from '../utils.js';

const SYSTEM_PROMPT = `Ты — редактор новостной ленты для беседы ВКонтакте.
Тебе дают тему и пронумерованный список новостей, найденных в RSS-лентах СМИ.
Задача: выбрать новости, которые действительно относятся к теме, и написать к каждой краткое описание на русском языке.

Правила:
- Используй только факты из заголовка и описания. Не выдумывай цифры, имена, даты и события.
- Ссылки не возвращай: они уже есть у бота.
- Отбрасывай нерелевантное, рекламу, гороскопы, тесты и материалы, где тема упомянута лишь вскользь.
- Описание — 1–2 предложения, до 200 символов, по сути. Не повторяй заголовок дословно.
- Верни СТРОГО валидный JSON без markdown и пояснений:
{"items":[{"index":1,"summary":"краткое описание"}]}
- index — номер новости из списка, без повторов.
- Если подходящих новостей нет, верни {"items":[]}.`;

export function buildUserPrompt({ topic, items }) {
  const lines = [`Тема: ${topic}`, '', 'Новости:'];

  items.forEach((item, index) => {
    const date = item.date instanceof Date ? item.date.toISOString().slice(0, 16).replace('T', ' ') : 'дата неизвестна';
    lines.push(`[${index + 1}] ${item.source} · ${date}`);
    lines.push(`Заголовок: ${item.title}`);
    if (item.description) lines.push(`Описание: ${truncate(item.description, 320)}`);
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Разбирает ответ модели и сопоставляет его с исходными новостями.
 * Ссылки и даты всегда берутся из RSS, а не из ответа модели.
 */
export function parseModelResponse(content, { items, limit }) {
  let text = String(content ?? '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  const rawItems = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(rawItems)) return null;

  const result = [];
  const seen = new Set();

  for (const entry of rawItems) {
    const index = Number(entry?.index);
    if (!Number.isInteger(index) || index < 1 || index > items.length || seen.has(index)) continue;

    const summary = String(entry?.summary ?? '').replace(/\s+/g, ' ').trim();
    if (!summary) continue;

    seen.add(index);
    result.push({ item: items[index - 1], summary: truncate(summary, 400) });

    if (result.length >= limit) break;
  }

  return result;
}

export async function refineNews({ topic, items, limit, config, logger, fetchImpl = fetch }) {
  if (!config.ai.enabled || items.length === 0) return null;

  const body = {
    model: config.ai.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${buildUserPrompt({ topic, items })}\nВыбери до ${limit} новостей.`,
      },
    ],
    temperature: 0.2,
    max_tokens: config.ai.maxTokens,
    response_format: { type: 'json_object' },
    stream: false,
  };

  try {
    const response = await fetchImpl(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${truncate(details, 200)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error('модель вернула пустой ответ');

    const refined = parseModelResponse(content, { items, limit });
    if (!refined || refined.length === 0) {
      logger?.warn('DeepSeek не выбрал ни одной новости, использую выдачу RSS');
      return null;
    }

    logger?.info('DeepSeek отобрал новости', {
      input: items.length,
      output: refined.length,
      tokens: payload.usage?.total_tokens ?? null,
    });

    return { items: refined, usage: payload.usage ?? null };
  } catch (error) {
    logger?.warn('DeepSeek недоступен, отдаю новости из RSS без обработки', {
      error: error.message ?? String(error),
    });
    return null;
  }
}
