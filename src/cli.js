import { loadConfig } from './config.js';
import { formatNews, formatNoResults } from './format.js';
import { createLinkShortener } from './links.js';
import { createLogger } from './logger.js';
import { createNewsService } from './news/service.js';

function usage() {
  console.log(`Проверка бота без ВКонтакте.

Использование:
  npm run cli -- "тема"            последние новости по теме
  npm run cli -- ИИ --limit 3      сколько новостей (по умолчанию 5)
  npm run cli -- "курс доллара" --exact

Опции:
  --hours N     за какой период искать, часов (по умолчанию из .env)
  --limit N     сколько новостей показать
  --exact       искать все слова темы
  --no-ai       не обращаться к DeepSeek
  --no-short    не сокращать ссылки
  --json        вывести сырые данные вместо готового сообщения
  --stats       показать статистику поиска
  --debug       подробные логи
  -h, --help    эта справка`);
}

function parseArgs(argv) {
  const options = { hours: null, limit: null, exact: false, json: false, stats: false, noAi: false, noShort: false, debug: false, words: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--hours':
        options.hours = Number(argv[++index]);
        break;
      case '--limit':
        options.limit = Number(argv[++index]);
        break;
      case '--exact':
        options.exact = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--stats':
        options.stats = true;
        break;
      case '--no-ai':
        options.noAi = true;
        break;
      case '--no-short':
        options.noShort = true;
        break;
      case '--debug':
        options.debug = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        options.words.push(arg);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const topic = options.words.join(' ').trim();
  if (!topic) {
    usage();
    process.exitCode = 1;
    return;
  }

  const config = loadConfig({ requireVk: false });
  if (options.debug) config.logLevel = 'debug';
  else if (config.logLevel === 'info') config.logLevel = 'warn';

  if (options.hours && Number.isFinite(options.hours) && options.hours > 0) config.news.windowHours = options.hours;
  if (options.limit && Number.isFinite(options.limit) && options.limit > 0) config.news.maxItems = options.limit;
  if (options.noAi) config.ai.enabled = false;

  const logger = createLogger(config.logLevel);
  const service = createNewsService({ config, logger });
  const startedAt = Date.now();

  const result = await service.get(topic, { exact: options.exact });
  const elapsed = Date.now() - startedAt;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          topic: result.topic,
          aiUsed: result.aiUsed,
          total: result.total,
          windowHours: result.windowHours,
          elapsedMs: elapsed,
          items: result.items.map((item) => ({
            title: item.title,
            source: item.source,
            date: item.date instanceof Date ? item.date.toISOString() : null,
            summary: item.summary,
            link: item.link,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (result.items.length === 0) {
    console.log(formatNoResults(topic, config.news));
  } else {
    const shortener = createLinkShortener({
      mode: options.noShort ? 'off' : config.links.shortener,
      cacheTtlMs: config.links.cacheTtlMs,
      timeoutMs: config.links.timeoutMs,
      logger,
    });

    const links = await shortener.shortenMany(result.items.map((item) => item.link));
    const items = result.items.map((item) => ({ ...item, link: links.get(item.link) ?? item.link }));

    console.log(formatNews({ ...result, items }));
  }

  if (options.stats) {
    console.log(
      `\n---\nИсточников: ${service.feedsCount} · найдено: ${result.total} · ИИ: ${result.aiUsed ? 'да' : 'нет'} · ${elapsed} мс`,
    );
  }
}

main().catch((error) => {
  console.error(`\nОшибка: ${error.message}\n`);
  process.exit(1);
});
