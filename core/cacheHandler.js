import wordTracker from "./redisClient.js";

function getCacheHitThreshold() {
  const parsed = Number.parseInt(process.env.CACHE_HIT_THRESHOLD, 10);
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
}

export async function fetchWordFromCache(word) {
  if (!wordTracker.isReady) {
    return null;
  }

  try {
    const cachedWordMetaData = await wordTracker.getCachedMetadata(word);
    if (cachedWordMetaData) {
      console.log(`[CACHE HIT] Serving "${word}" directly from Redis...`);
      return cachedWordMetaData;
    }
    return null;
  } catch (err) {
    console.error(`[CACHE ERROR] Failed to read "${word}":`, err.message);
    return null;
  }
}

export async function trackWord(wordMetadata, requestedWord) {
  if (!wordTracker.isReady) {
    return;
  }

  try {
    const wordCount = await wordTracker.incrementWordCount(requestedWord);
    const threshold = getCacheHitThreshold();

    if (wordCount >= threshold) {
      console.log(
        `[PROMOTING] "${requestedWord}" hit ${wordCount} request(s). Saving to cache.`,
      );
      await wordTracker.cacheWordMetadata(wordMetadata, requestedWord);
    }
  } catch (err) {
    console.error(
      `[CACHE ERROR] Failed to track/cache "${requestedWord}":`,
      err.message,
    );
  }
}