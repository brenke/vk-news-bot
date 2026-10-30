import { randomInt } from 'node:crypto';
import { sleep } from '../utils.js';

export class VkError extends Error {
  constructor(code, message, { method, params } = {}) {
    super(`VK API ${method ?? ''}: ${message} (код ${code})`);
    this.name = 'VkError';
    this.code = code;
    this.method = method;
    this.params = params;
  }
}

const RETRYABLE_CODES = new Set([1, 6, 10]);

function serializeValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export class VkApi {
  constructor({ token, groupId, version = '5.199', requestTimeoutMs = 20_000, logger }) {
    this.token = token;
    this.groupId = groupId;
    this.version = version;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
    this.baseUrl = 'https://api.vk.com/method/';
  }

  /**
   * Вызов метода VK API с повторами на сетевые ошибки и лимиты.
   * @returns {Promise<any>}
   */
  async call(method, params = {}, { retries = 2 } = {}) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      body.set(key, serializeValue(value));
    }
    body.set('access_token', this.token);
    body.set('v', this.version);

    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(this.baseUrl + method, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const payload = await response.json();

        if (payload.error) {
          const { error_code: code, error_msg: message } = payload.error;
          if (RETRYABLE_CODES.has(code) && attempt < retries) {
            this.logger?.warn('VK API временная ошибка, повтор', { method, code, attempt: attempt + 1 });
            await sleep(400 * (attempt + 1));
            lastError = new VkError(code, message, { method, params });
            continue;
          }
          throw new VkError(code, message, { method, params });
        }

        return payload.response;
      } catch (error) {
        if (error instanceof VkError) throw error;

        lastError = error;
        if (attempt >= retries) break;

        this.logger?.warn('VK API: сеть недоступна, повтор', { method, error, attempt: attempt + 1 });
        await sleep(500 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`VK API ${method}: неизвестная ошибка`);
  }

  async sendMessage(peerId, message, extra = {}) {
    return this.call('messages.send', {
      peer_id: peerId,
      message,
      random_id: randomInt(1, 2 ** 31 - 1),
      ...extra,
    });
  }

  async setTyping(peerId) {
    try {
      await this.call('messages.setActivity', {
        peer_id: peerId,
        type: 'typing',
        group_id: this.groupId,
      });
    } catch {
      // Индикатор набора — необязательная функция, ошибки игнорируем.
    }
  }
}
