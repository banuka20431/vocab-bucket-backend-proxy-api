import { createClient } from "redis";

const DEFAULT_TTL_SEC = 2592000; // 30 days

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 ? fallback : parsed;
}

class WordTracker {
  constructor() {
    this.client = null;

    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      console.warn(
        "[REDIS WARNING] REDIS_URL is not set; running without Redis caching.",
      );
      return;
    }

    this.client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });

    this.client.on("ready", () => {
      console.log("[REDIS] Connected and ready.");
    });

    this.client.on("reconnecting", () => {
      console.warn("[REDIS] Reconnecting...");
    });

    this.client.on("error", (err) => {
      console.error("[REDIS ERROR]", err.message);
    });

    this.client.connect().catch((err) => {
      console.error(
        "[REDIS INIT FAILED] Starting in degraded (no-cache) mode:",
        err.message,
      );
    });
  }

  get isReady() {
    return Boolean(this.client?.isReady);
  }

  async incrementWordCount(word) {
    const key = `cache:count:${word}`;
    const count = await this.client.incr(key);

    if (count === 1) {
      const ttl = parsePositiveInt(
        process.env.CACHE_TRACKED_WORD_TTL_SEC,
        DEFAULT_TTL_SEC,
      );
      await this.client.expire(key, ttl);
    }

    return count;
  }

  async cacheWordMetadata(wordMetaData, requestedWord) {
    const key = `cache:metadata:${requestedWord}`;
    const ttl = parsePositiveInt(
      process.env.CACHE_METADATA_TTL_SEC,
      DEFAULT_TTL_SEC,
    );

    await this.client.set(key, JSON.stringify(wordMetaData), { EX: ttl });
  }

  async getCachedMetadata(word) {
    return this.client.get(`cache:metadata:${word}`);
  }

  async getWordCount(word) {
    const count = await this.client.get(`cache:count:${word}`);
    return count ? Number.parseInt(count, 10) : 0;
  }

  async deleteWordCount(word) {
    await this.client.del(`cache:count:${word}`);
  }

  async close() {
    if (this.client?.isOpen) {
      await this.client.close();
    }
  }
}

export default new WordTracker();