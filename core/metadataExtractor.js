export class Extractor {
  constructor(entry) {
    this.entry = entry;
    this.audioBase = process.env.API_AUDIO_URL?.trim() || "";
  }

  // Strip Merriam-Webster formatting tags like {bc}, {it}, etc.
  _clean(text) {
    if (typeof text !== "string" || !text) return "";
    return text.replace(/\{.*?\}/g, "").trim();
  }

  // 1. Pronunciation (IPA)
  getPronunciation() {
    return this.entry.hwi?.prs?.[0]?.ipa || "N/A";
  }

  // 2. Audio clip URL
  getAudioUrl() {
    const audio = this.entry.hwi?.prs?.[0]?.sound?.audio;
    if (!audio || !this.audioBase) return null;

    let subdir = audio.charAt(0);
    if (audio.startsWith("bix")) subdir = "bix";
    else if (audio.startsWith("gg")) subdir = "gg";
    else if (!/[a-zA-Z]/.test(subdir)) subdir = "number";

    const base = this.audioBase.endsWith("/")
      ? this.audioBase
      : `${this.audioBase}/`;

    return `${base}${subdir}/${audio}.mp3`;
  }

  // 3. Category (Part of Speech)
  getCategory() {
    return this.entry.fl || "N/A";
  }

  // 4. Short Definition
  getShortDef() {
    return (
      this._clean(this.entry.shortdef?.[0]) || "No short definition available."
    );
  }

  // 5. Full Definition (first primary definition from sense sequence)
  getFullDef() {
    const dt = this.entry.def?.[0]?.sseq?.[0]?.[0]?.[1]?.dt;
    const textEntry = Array.isArray(dt)
      ? dt.find((item) => item?.[0] === "text")
      : null;

    return textEntry ? this._clean(textEntry[1]) : this.getShortDef();
  }

  // 6. Usage (Example sentences)
  getUsage() {
    const dt = this.entry.def?.[0]?.sseq?.[0]?.[0]?.[1]?.dt;
    const visEntry = Array.isArray(dt)
      ? dt.find((item) => item?.[0] === "vis")
      : null;

    return Array.isArray(visEntry?.[1])
      ? visEntry[1].map((ex) => this._clean(ex?.t)).filter(Boolean)
      : [];
  }

  isValid() {
    return Boolean(
      this.entry &&
        typeof this.entry === "object" &&
        typeof this.entry.meta?.id === "string" &&
        this.entry.meta.id.length > 0,
    );
  }

  /**
   * Combines all metadata for the entry into a single object
   * @return {Object|null} Complete metadata object or null if invalid
   */
  getMetaData() {
    if (!this.isValid()) return null;

    return {
      spelling: this.entry.meta.id.replace(/[^a-zA-Z \-']/g, "").trim(),
      pronunciation: this.getPronunciation(),
      category: this.getCategory(),
      definition: {
        full: this.getFullDef(),
        short: this.getShortDef(),
      },
      usage: this.getUsage(),
      audioURL: this.getAudioUrl(),
      timestamp: new Date().toISOString(),
    };
  }
}

export class FallbackExtractor {
  constructor(payload, word = "") {
    this.word = word;
    this.entries = Array.isArray(payload?.en) ? payload.en : [];
    this.primaryEntry =
      this.entries.find(
        (entry) =>
          Array.isArray(entry?.definitions) && entry.definitions.length > 0,
      ) ||
      this.entries[0] ||
      null;
  }

  _stripHtml(html) {
    if (typeof html !== "string" || !html) return "";

    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec) =>
        String.fromCodePoint(Number.parseInt(dec, 10)),
      )
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  getPronunciation() {
    return "N/A";
  }

  getAudioUrl() {
    return null;
  }

  getCategory() {
    const pos = this.primaryEntry?.partOfSpeech;
    return typeof pos === "string" && pos.trim()
      ? pos.trim().toLowerCase()
      : "N/A";
  }

  getShortDef() {
    const defs = this.primaryEntry?.definitions || [];
    for (const item of defs) {
      const cleaned = this._stripHtml(item?.definition);
      if (cleaned) return cleaned;
    }
    return "No definition available.";
  }

  getFullDef() {
    return this.getShortDef();
  }

  getUsage() {
    const defs = this.primaryEntry?.definitions || [];
    const examples = [];

    for (const def of defs) {
      if (Array.isArray(def?.parsedExamples)) {
        for (const ex of def.parsedExamples) {
          const cleaned = this._stripHtml(ex?.example);
          if (cleaned) examples.push(cleaned);
        }
      } else if (Array.isArray(def?.examples)) {
        for (const ex of def.examples) {
          const cleaned = this._stripHtml(ex);
          if (cleaned) examples.push(cleaned);
        }
      }
    }

    return [...new Set(examples)].slice(0, 5);
  }

  isValid() {
    return Boolean(
      this.primaryEntry &&
        Array.isArray(this.primaryEntry.definitions) &&
        this.primaryEntry.definitions.some(
          (item) => this._stripHtml(item?.definition).length > 0,
        ),
    );
  }

  getMetaData() {
    if (!this.isValid()) return null;

    return {
      spelling: this.word,
      pronunciation: this.getPronunciation(),
      category: this.getCategory(),
      definition: {
        full: this.getFullDef(),
        short: this.getShortDef(),
      },
      usage: this.getUsage(),
      audioURL: this.getAudioUrl(),
      timestamp: new Date().toISOString(),
    };
  }

  aggregate(primaryResponse) {
    const metadata = this.getMetaData();

    if (!metadata) return primaryResponse;
    if (!primaryResponse) return metadata;

    const mergedUsage = [
      ...new Set([...(primaryResponse.usage || []), ...(metadata.usage || [])]),
    ];

    return {
      spelling: primaryResponse.spelling || metadata.spelling,

      pronunciation:
        primaryResponse.pronunciation && primaryResponse.pronunciation !== "N/A"
          ? primaryResponse.pronunciation
          : metadata.pronunciation,

      category:
        primaryResponse.category && primaryResponse.category !== "N/A"
          ? primaryResponse.category
          : metadata.category,

      definition: {
        full:
          primaryResponse.definition?.full &&
          !primaryResponse.definition.full.includes("No short definition")
            ? primaryResponse.definition.full
            : metadata.definition?.full,

        short:
          primaryResponse.definition?.short &&
          !primaryResponse.definition.short.includes("No short definition")
            ? primaryResponse.definition.short
            : metadata.definition?.short,
      },

      usage: mergedUsage,
      audioURL: primaryResponse.audioURL || metadata.audioURL,
      timestamp: new Date().toISOString(),
    };
  }
}