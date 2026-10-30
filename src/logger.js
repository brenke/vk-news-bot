const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function formatExtra(extra) {
  if (!extra || Object.keys(extra).length === 0) return '';

  const parts = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value instanceof Error) {
      parts.push(`${key}=${value.name}: ${value.message}`);
    } else if (typeof value === 'object' && value !== null) {
      try {
        parts.push(`${key}=${JSON.stringify(value)}`);
      } catch {
        parts.push(`${key}=[object]`);
      }
    } else {
      parts.push(`${key}=${value}`);
    }
  }

  return ` ${parts.join(' ')}`;
}

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (name, message, extra) => {
    if (LEVELS[name] < threshold) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}${formatExtra(extra)}`;
    if (name === 'error' || name === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    level,
    debug: (message, extra) => write('debug', message, extra),
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra),
    child: (prefix) => {
      const parent = createLogger(level);
      const wrap = (name) => (message, extra) => parent[name](`[${prefix}] ${message}`, extra);
      return { ...parent, debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
    },
  };
}
