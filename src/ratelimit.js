/** Антифлуд: не чаще одного запроса в N секунд на беседу. */
export function createCooldown({ seconds = 10 } = {}) {
  const until = new Map();

  return {
    check(key) {
      const deadline = until.get(key) ?? 0;
      const leftMs = deadline - Date.now();

      if (leftMs <= 0) {
        until.delete(key);
        return { allowed: true, retryAfterSec: 0 };
      }

      return { allowed: false, retryAfterSec: Math.ceil(leftMs / 1_000) };
    },
    hit(key) {
      if (seconds <= 0) return;
      until.set(key, Date.now() + seconds * 1_000);

      if (until.size > 5_000) {
        const now = Date.now();
        for (const [entryKey, deadline] of until) {
          if (deadline <= now) until.delete(entryKey);
        }
      }
    },
    reset: () => until.clear(),
  };
}
