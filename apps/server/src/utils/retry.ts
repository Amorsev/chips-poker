/**
 * PostgreSQL SERIALIZABLE transactions can be aborted with SQLSTATE 40001
 * (Prisma P2034) when a concurrent transaction touches the same row. That is a
 * normal, retryable outcome rather than a player-facing error. Keep retries
 * short and bounded: the competing work is a single small stat/wallet update.
 */
const RETRYABLE = new Set(['P2034']);

export async function withWriteRetry<T>(operation: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code) || attempt >= maxAttempts) throw error;
      const delayMs = 20 * attempt + Math.floor(Math.random() * 30);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
