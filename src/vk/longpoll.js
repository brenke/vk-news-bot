import { sleep } from '../utils.js';

/**
 * Бесконечный цикл Bots LongPoll API.
 * @param {object} options
 * @param {import('./api.js').VkApi} options.api
 * @param {number} options.groupId
 * @param {number} [options.waitSec]
 * @param {AbortSignal} [options.signal]
 * @param {(update: object) => unknown} options.onUpdate
 */
export async function runLongPoll({ api, groupId, waitSec = 25, logger, onUpdate, signal }) {
  let server = null;
  let key = null;
  let ts = null;
  let failures = 0;

  const refresh = async () => {
    const data = await api.call('groups.getLongPollServer', { group_id: groupId });
    if (!data?.server || !data?.key || !data?.ts) {
      throw new Error('groups.getLongPollServer вернул неполный ответ');
    }
    server = data.server;
    key = data.key;
    ts = data.ts;
    failures = 0;
    logger?.info('LongPoll: подключение установлено', { server: new URL(server).host });
  };

  while (!signal?.aborted) {
    try {
      if (!server || !key || !ts) await refresh();

      const url = new URL(server);
      url.searchParams.set('act', 'a_check');
      url.searchParams.set('key', key);
      url.searchParams.set('ts', ts);
      url.searchParams.set('wait', String(waitSec));

      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout((waitSec + 20) * 1_000)].filter(Boolean)),
        headers: { 'user-agent': 'vk-news-bot/1.0' },
      });

      if (!response.ok) {
        throw new Error(`LongPoll HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.failed) {
        failures += 1;
        logger?.warn('LongPoll: код failed, переподключение', { failed: data.failed });

        if (data.failed === 1 && data.ts) {
          ts = data.ts;
        } else if (data.failed === 2) {
          await refresh();
        } else {
          server = null;
          key = null;
          await refresh();
        }

        if (failures > 3) await sleep(Math.min(30_000, 1_000 * 2 ** failures), signal);
        continue;
      }

      failures = 0;
      if (data.ts) ts = data.ts;

      for (const update of data.updates ?? []) {
        Promise.resolve(onUpdate(update)).catch((error) => {
          logger?.error('LongPoll: ошибка обработки события', { type: update?.type, error });
        });
      }
    } catch (error) {
      if (signal?.aborted) break;

      failures += 1;
      const delay = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
      logger?.warn('LongPoll: ошибка соединения, повтор', { error, retryInMs: delay });

      await sleep(delay, signal);

      if (failures >= 4) {
        server = null;
        key = null;
        ts = null;
      }
    }
  }

  logger?.info('LongPoll: остановлен');
}
