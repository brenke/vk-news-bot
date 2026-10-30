import { parseCommand } from './commands.js';
import { loadConfig } from './config.js';
import { formatError, formatHelp, formatNews, formatNoResults, splitMessage } from './format.js';
import { createLinkShortener } from './links.js';
import { createLogger } from './logger.js';
import { createNewsService } from './news/service.js';
import { createCooldown } from './ratelimit.js';
import { truncate } from './utils.js';
import { VkApi } from './vk/api.js';
import { normalizeMessageEvent } from './vk/events.js';
import { runLongPoll } from './vk/longpoll.js';

const GREETING = [
  '👋 Привет! Я бот новостей.',
  '',
  'Напишите /новости "тема" — найду 5 свежих новостей с описанием и ссылками.',
  'Подробнее: /помощь',
].join('\n');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const api = new VkApi({
    token: config.vk.token,
    groupId: config.vk.groupId,
    version: config.vk.apiVersion,
    requestTimeoutMs: config.vk.requestTimeoutMs,
    logger,
  });

  const service = createNewsService({ config, logger });
  const shortener = createLinkShortener({
    api,
    mode: config.links.shortener,
    cacheTtlMs: config.links.cacheTtlMs,
    timeoutMs: config.links.timeoutMs,
    logger,
  });
  const cooldown = createCooldown({ seconds: config.bot.cooldownSec });
  const controller = new AbortController();

  let stopping = false;
  const shutdown = (reason) => {
    if (stopping) return;
    stopping = true;
    logger.info('Останавливаюсь', { reason });
    controller.abort();
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error('unhandledRejection', { error }));
  process.on('uncaughtException', (error) => logger.error('uncaughtException', { error }));

  async function send(peerId, text) {
    for (const chunk of splitMessage(text, config.bot.messageLimit)) {
      try {
        await api.sendMessage(peerId, chunk);
      } catch (error) {
        logger.error('Не удалось отправить сообщение', { peerId, code: error.code, error });
        return;
      }
    }
  }

  async function handleNews(event, command) {
    const topic = truncate(command.topic, config.bot.maxTopicLength);

    if (!topic) {
      await send(event.peerId, formatHelp(config.news));
      return;
    }

    const gate = cooldown.check(event.peerId);
    if (!gate.allowed) {
      logger.debug('Антифлуд: запрос пропущен', { peerId: event.peerId, retryAfterSec: gate.retryAfterSec });
      return;
    }

    cooldown.hit(event.peerId);
    logger.info('Запрос новостей', {
      peerId: event.peerId,
      fromId: event.fromId,
      topic,
      exact: command.exact,
    });

    await api.setTyping(event.peerId);

    // Пока ищем и пересказываем, поддерживаем индикатор «печатает».
    const typingTimer = setInterval(() => {
      void api.setTyping(event.peerId);
    }, 4_000);
    typingTimer.unref?.();

    try {
      const result = await service.get(topic, { exact: command.exact });

      if (result.items.length === 0) {
        await send(event.peerId, formatNoResults(topic, config.news));
        return;
      }

      const links = await shortener.shortenMany(result.items.map((item) => item.link));
      const items = result.items.map((item) => ({ ...item, link: links.get(item.link) ?? item.link }));

      await send(event.peerId, formatNews({ ...result, items }));
    } catch (error) {
      logger.error('Ошибка при поиске новостей', { topic, error });
      await send(event.peerId, formatError(topic));
    } finally {
      clearInterval(typingTimer);
    }
  }

  async function onUpdate(update) {
    const event = normalizeMessageEvent(update, { groupId: config.vk.groupId });
    if (!event) return;

    if (event.actionType === 'chat_invite_user' && event.actionMemberId === -Number(config.vk.groupId)) {
      logger.info('Бот добавлен в беседу', { peerId: event.peerId });
      await send(event.peerId, GREETING);
      return;
    }

    if (event.isOutgoing || event.isService || !event.text.trim()) return;

    const command = parseCommand(event.text);
    if (!command) return;

    if (command.kind === 'help') {
      await send(event.peerId, formatHelp(config.news));
      return;
    }

    if (command.kind === 'news') {
      await handleNews(event, command);
    }
  }

  try {
    const info = await api.call('groups.getById', { group_id: config.vk.groupId });
    const group = Array.isArray(info) ? info[0] : info?.groups?.[0] ?? info;

    logger.info('Бот запущен', {
      group: group?.name ?? config.vk.groupId,
      groupId: config.vk.groupId,
      feeds: service.feedsCount,
      ai: config.ai.enabled ? config.ai.model : 'выключен',
      windowHours: config.news.windowHours,
    });
  } catch (error) {
    logger.warn('Не удалось проверить сообщество — проверьте VK_TOKEN и VK_GROUP_ID', {
      code: error.code,
      error: error.message,
    });
  }

  await runLongPoll({
    api,
    groupId: config.vk.groupId,
    waitSec: config.vk.longPollWaitSec,
    logger,
    onUpdate,
    signal: controller.signal,
  });

  logger.info('Бот остановлен');
}

main().catch((error) => {
  console.error(`\nФатальная ошибка: ${error.message}\n`);
  if (process.env.LOG_LEVEL === 'debug') console.error(error.stack);
  process.exit(1);
});
