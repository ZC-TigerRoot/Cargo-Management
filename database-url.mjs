function requiredEnv(env, key) {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required database environment variable: ${key}`);
  }

  return value;
}

/**
 * Builds the PostgreSQL connection URL expected by Prisma from separate
 * database environment variables.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function databaseUrlFromEnv(env = process.env) {
  const host = requiredEnv(env, "DB_HOST");
  const port = requiredEnv(env, "DB_PORT");
  const database = requiredEnv(env, "DB_NAME");
  const user = requiredEnv(env, "DB_USER");
  const password = requiredEnv(env, "DB_PASSWORD");

  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535");
  }

  if (host.includes("://") || /[/?#\s]/.test(host)) {
    throw new Error("DB_HOST must be a hostname or IP address without a protocol or path");
  }

  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${urlHost}:${port}/${encodeURIComponent(database)}?schema=public`;
}
