import express from "express";
import cors from "cors";

import { Extractor, FallbackExtractor } from "./core/metadataExtractor.js";
import { fetchWordFromCache, trackWord } from "./core/cacheHandler.js";
import wordTracker from "./core/redisClient.js";

const PRIMARY_API_URL = (
  process.env.API_URL ||
  "https://www.dictionaryapi.com/api/v3/references/learners/json"
).replace(/\/+$/, "");
const FALLBACK_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const UPSTREAM_TIMEOUT_MS = 5000;
const WORD_PATTERN = /^[\p{L}][\p{L}\s'-]{0,63}$/u;

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);

const COLORS = {
  RESET: "\x1b[0m",
  BLUE: "\x1b[34m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
};

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2kb" }));

const allowedOrigins = [
  process.env.EXTENSION_ORIGIN,
  process.env.LOCAL_EXTENSION_ORIGIN,
]
  .map((origin) => origin?.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      if (!IS_PRODUCTION) {
        return callback(null, true);
      }
      Log("[WARNING] Blocked request without Origin header");
      const err = new Error("Not allowed by CORS");
      err.status = 403;
      return callback(err);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    Log(`[WARNING] Blocked CORS origin: ${origin}`);
    const err = new Error("Not allowed by CORS");
    err.status = 403;
    return callback(err);
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
};

// Public health check (mounted before strict /metadata CORS)
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    redis: wordTracker.isReady,
  });
});

// Strict extension-origin CORS applied only to /metadata
app.use("/metadata", cors(corsOptions));

app.post("/metadata", async (req, res) => {
  Log("[INFO] -------- NEW REQUEST --------");

  const rawWord = req.body?.word;
  if (typeof rawWord !== "string") {
    return res.status(400).json("[ERROR] Invalid request: invalid word!");
  }

  const requestedWord = rawWord.trim().toLowerCase().replace(/\s+/g, " ");
  if (!WORD_PATTERN.test(requestedWord)) {
    return res.status(400).json("[ERROR] Invalid request: invalid word format!");
  }

  Log(`[INFO] Requested word: "${requestedWord}"`);

  // 1. Check Redis cache (fails open if Redis is unavailable)
  const cachedMetadata = await fetchWordFromCache(requestedWord);
  if (cachedMetadata !== null) {
    return res.json({ meta: cachedMetadata });
  }

  // 2. Cache miss -> fetch primary and fallback APIs in parallel with timeouts
  Log(`[CACHE MISS] Fetching "${requestedWord}" metadata from APIs...`);

  const encodedWord = encodeURIComponent(requestedWord);
  const apiKey = process.env.API_KEY?.trim();

  const primaryPromise = apiKey
    ? fetch(
        `${PRIMARY_API_URL}/${encodedWord}?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
      )
    : Promise.reject(new Error("API_KEY is not configured"));

  const fallbackPromise = fetch(`${FALLBACK_API_URL}/${encodedWord}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  const [primaryResponse, fallbackResponse] = await Promise.allSettled([
    primaryPromise,
    fallbackPromise,
  ]);

  let primaryResponseMetadata = null;
  let anyUpstreamReached = false;

  if (primaryResponse.status === "fulfilled") {
    anyUpstreamReached = true;
    if (primaryResponse.value.ok) {
      const primaryResponseData = await safeParseJson(
        primaryResponse.value,
        "primary API",
      );

      if (isDataValid(primaryResponseData)) {
        primaryResponseMetadata = new Extractor(
          primaryResponseData[0],
        ).getMetaData();
      } else {
        Log("[WARNING] Primary API returned no valid dictionary entries");
      }
    } else {
      Log(`[WARNING] Primary API returned HTTP ${primaryResponse.value.status}`);
    }
  } else {
    Log(
      `[WARNING] Primary API fetch failed: ${primaryResponse.reason?.message || primaryResponse.reason}`,
    );
  }

  // Preserve valid primary metadata even if fallback returns 200 with invalid data
  let wordMetaData = primaryResponseMetadata;

  if (fallbackResponse.status === "fulfilled") {
    anyUpstreamReached = true;
    if (fallbackResponse.value.ok) {
      const fallbackResponseData = await safeParseJson(
        fallbackResponse.value,
        "fallback API",
      );

      if (isDataValid(fallbackResponseData)) {
        wordMetaData = new FallbackExtractor(fallbackResponseData).aggregate(
          primaryResponseMetadata,
        );
      } else {
        Log("[WARNING] Fallback API returned no valid dictionary entries");
      }
    } else {
      Log(
        `[WARNING] Fallback API returned HTTP ${fallbackResponse.value.status}`,
      );
    }
  } else {
    Log(
      `[WARNING] Fallback API fetch failed: ${fallbackResponse.reason?.message || fallbackResponse.reason}`,
    );
  }

  if (wordMetaData === null) {
    if (!anyUpstreamReached) {
      return res
        .status(502)
        .json("[ERROR] Upstream dictionary services unavailable");
    }
    return res
      .status(404)
      .json(`[ERROR] No metadata found for "${requestedWord}"`);
  }

  // 3. Track word hit count and promote to cache if threshold reached
  await trackWord(wordMetaData, requestedWord);

  return res.json({
    meta: JSON.stringify(wordMetaData),
  });
});

// Express 5 centralized error handler (JSON parse errors, body size limits, CORS 403s)
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json("[ERROR] Invalid JSON payload");
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json("[ERROR] Request payload too large");
  }
  if (err.status === 403) {
    return res.status(403).json("[ERROR] Forbidden: origin not allowed");
  }

  Log("[ERROR] Unhandled server error:", err.message);
  return res.status(500).json("[ERROR] Internal server error");
});

const server = app.listen(PORT, HOST, () => {
  Log(`[SUCCESS] Server listening on http://${HOST}:${PORT}`);
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  Log(`[INFO] Received ${signal}. Shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    Log("[ERROR] Forced shutdown after timeout");
    process.exit(1);
  }, 4500);
  forceExitTimer.unref();

  server.close(async () => {
    try {
      await wordTracker.close();
      Log("[SUCCESS] HTTP server and Redis closed cleanly");
      process.exit(0);
    } catch (err) {
      Log("[ERROR] Error closing Redis:", err.message);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function safeParseJson(response, label) {
  try {
    return await response.json();
  } catch (err) {
    Log(`[WARNING] Failed to parse JSON from ${label}: ${err.message}`);
    return null;
  }
}

function isDataValid(data) {
  return Array.isArray(data) && data.length > 0;
}

function Log(message, ...args) {
  const labelMatch = message.match(
    /^\[(INFO|ERROR|WARNING|SUCCESS|CACHE MISS)\]/,
  );
  let color = COLORS.RESET;

  if (labelMatch) {
    switch (labelMatch[1]) {
      case "INFO":
        color = COLORS.BLUE;
        break;
      case "ERROR":
        color = COLORS.RED;
        break;
      case "WARNING":
        color = COLORS.YELLOW;
        break;
      case "SUCCESS":
        color = COLORS.GREEN;
        break;
      case "CACHE MISS":
        color = COLORS.CYAN;
        break;
    }
  }

  console.log(`${color}${message}${COLORS.RESET}`, ...args);
}