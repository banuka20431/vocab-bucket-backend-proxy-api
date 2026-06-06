import dotenv from "dotenv";

import express from "express";
import cors from "cors";

import { Extractor, FallbackExtractor } from "./core/metadataExtractor.js";
import { fetchWordFromCache, trackWord } from "./core/CacheHandler.js";

const PRIMARY_API_URL =
  "https://www.dictionaryapi.com/api/v3/references/learners/json";
const FALLBACK_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";

const COLORS = {
  RESET: "\x1b[0m",
  BLUE: "\x1b[34m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
};

dotenv.config();
const app = express();
app.use(express.json());

const allowedOrigins = [
  process.env.EXTENSION_ORIGIN,
  process.env.LOCAL_EXTENSION_ORIGIN,
];

setupCORS();

app.post("/metadata", async (req, res) => {

  console.log(`\n\n`);
  Log(`[INFO]        -------- NEW REQUEST --------\n\n`);
  
  const incomingData = req?.body;

  if (incomingData == undefined) {
    return res
      .status(500)
      .json("[ERROR] Invalid request: unresolvable request!");
  }

  Log(`[INFO] Incoming data: `, incomingData);

  const requestedWord = incomingData?.word;

  if (requestedWord == undefined || typeof requestedWord != "string") {
    return res.status(500).json("[ERROR] Invalid request: invalid word!");
  }

  // Check cache and return cached metadata if present
  const cachedMetadata = await fetchWordFromCache(requestedWord);

  if (cachedMetadata != null) {
    return res.json({ meta: cachedMetadata });
  }

  // On cache miss: fetch word metadata from external APIs and validate response

  Log(`[CACHE MISS] Fetching "${requestedWord}"  metadata from API...`);

  let primaryResponseMetadata = null;
  let wordMetaData = null;
  let errmsg = null;

  const primaryAPI = `${process.env.API_URL || PRIMARY_API_URL}/${requestedWord}?key=${process.env.API_KEY}`;
  const fallbackAPI = `${FALLBACK_API_URL}/${requestedWord}`;

  const [primaryResponse, fallbackResponse] = await Promise.allSettled([
    fetch(primaryAPI),
    fetch(fallbackAPI),
  ]);

  if (primaryResponse.status == "fulfilled" && primaryResponse.value.ok) {
    const primaryResponseData = await primaryResponse.value.json();

    if (!isDataValid(primaryResponseData)) {
      errmsg = "[WARNING] Invalid fetch: no data were fetched from primary API";
      Log(errmsg);
    } else {
      Log(
        `[INFO] Primary response is ${typeof primaryResponseData} of length `,
        primaryResponseData?.length,
      );

      primaryResponseMetadata = new Extractor(
        primaryResponseData[0],
      ).getMetaData();

      Log(
        `[INFO] Extracted metadata of primary response:\n`,
        primaryResponseMetadata,
      );
    }
  } else {
    errmsg = "[WARNING] Failed to fetch from primary API";
    Log(errmsg);
  }

  if (fallbackResponse.status == "fulfilled" && fallbackResponse.value.ok) {
    const fallbackResponseData = await fallbackResponse.value.json();

    Log(`[INFO] Fallback response type: ${typeof fallbackResponseData}`);

    if (!isDataValid(fallbackResponseData)) {
      errmsg =
        "[WARNING] Invalid fetch: No data were fetched from fallback API";
      Log(errmsg);
    } else {
      Log(
        `[INFO] Fallback response is ${typeof fallbackResponseData} of length `,
        fallbackResponseData?.length,
      );

      wordMetaData = new FallbackExtractor(fallbackResponseData).aggregate(
        primaryResponseMetadata,
      );

      Log(`[INFO] Extracted metadata of fallback response:\n`, wordMetaData);
    }
  } else {
    errmsg = "[WARNING] Failed to fetch from fallback API";
    Log(errmsg);
    wordMetaData = primaryResponseMetadata;
  }

  if (wordMetaData == null) {
    errmsg = "[ERROR] Invalid fetch: no data were fetched";
    return res.status(500).json(errmsg);
  }

  // Use requested word for caching to maintain consistancy
  // (API responses can contain slightly different versions)
  await trackWord(wordMetaData, requestedWord);

  Log(`[INFO] Aggregated metadata:\n`, wordMetaData);

  res.json({
    meta: JSON.stringify(wordMetaData),
  });
});

app.listen(process.env.PORT, () => {
  Log("[SUCCESS] Server listening...");
});

function setupCORS() {
  const corsOptions = {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(Log("[ERROR] Not allowed by CORS")));
      }
    },
    methods: ["POST"],
  };

  app.use(cors(corsOptions));
}

function isDataValid(data) {
  return data != null && Array.isArray(data) && data?.length > 0;
}

/**
 * Logger function that colors console output based on label
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments to log
 */
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
