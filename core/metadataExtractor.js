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
  constructor(entry) {
    this.entry = Array.isArray(entry) ? entry[0] : entry;
  }

  getPronunciation() {
    if (this.entry.phonetic) {
      return this.entry.phonetic;
    }

    const phoneticObj = this.entry.phonetics?.find((p) => p?.text);
    return phoneticObj ? phoneticObj.text : "N/A";
  }

  getAudioUrl() {
    const audioObj = this.entry.phonetics?.find(
      (p) => typeof p?.audio === "string" && p.audio.length > 0,
    );
    return audioObj ? audioObj.audio : null;
  }

  getCategory() {
    return this.entry.meanings?.[0]?.partOfSpeech || "N/A";
  }

  getShortDef() {
    return (
      this.entry.meanings?.[0]?.definitions?.[0]?.definition ||
      "No definition available."
    );
  }

  getFullDef() {
    return this.getShortDef();
  }

  getUsage() {
    const definitions = this.entry.meanings?.[0]?.definitions || [];

    return definitions
      .map((def) => def?.example)
      .filter((example) => typeof example === "string" && example.length > 0);
  }

  isValid() {
    return Boolean(
      this.entry &&
        typeof this.entry === "object" &&
        typeof this.entry.word === "string" &&
        this.entry.word.length > 0,
    );
  }

  /**
   * Combines all metadata for the entry into a single object
   * @return {Object|null} Complete metadata object or null if invalid
   */
  getMetaData() {
    if (!this.isValid()) return null;

    return {
      spelling: this.entry.word,
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

  /**
   * Merges primary API response with fallback API metadata, preferring non-null primary values
   * @param {Object|null} primaryResponse - The response from the primary API
   * @return {Object|null} Merged metadata object with fallback values filling gaps
   */
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