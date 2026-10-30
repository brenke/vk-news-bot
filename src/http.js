const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Загружает текстовый ресурс и корректно декодирует его с учётом charset
 * из заголовка или XML-декларации.
 */
export async function fetchTextResource(
  url,
  {
    timeoutMs = 12_000,
    userAgent = DEFAULT_USER_AGENT,
    fetchImpl = fetch,
    maxBytes = 3_000_000,
    accept = 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
  } = {},
) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': userAgent,
      accept,
      'accept-language': 'ru-RU,ru;q=0.9,en;q=0.5',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`ответ больше ${maxBytes} байт`);

  const contentType = response.headers?.get?.('content-type') ?? '';
  const head = new TextDecoder('latin1').decode(buffer.slice(0, 300));
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? 'utf-8';

  let text;
  try {
    text = new TextDecoder(charset).decode(buffer);
  } catch {
    text = new TextDecoder('utf-8').decode(buffer);
  }

  return { text, contentType, url: response.url ?? url };
}
