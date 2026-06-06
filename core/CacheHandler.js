import wordTracker from "./redisClient.js";

export async function fetchWordFromCache(word) {
  if (!(await wordTracker.connect())) {
    console.log(`[ERROR] WordTracker is not ready!`);
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
    console.log(`[ERROR] fetching from cache failed: ${err}`);
    return null;
  }
}


export async function trackWord(wordMetadata, requestedWord) {
  try {
    await wordTracker.setOrIncrementWordCount(requestedWord);

    const wordCount = await wordTracker.getWordCount(requestedWord);

    const threshold = parseInt(process.env.CACHE_HIT_THRESHOLD) || 1;

    if (wordCount >= threshold) {
      console.log(
        `[PROMOTING] "${requestedWord}" hit ${wordCount} requests. Saving to cache.`,
      );
      await wordTracker.cacheWordMetadata(wordMetadata, requestedWord);
    }
  } catch (err) {
    console.log(`[ERROR] Init word tracking failed: ${err}`);
    return null;
  }
}
