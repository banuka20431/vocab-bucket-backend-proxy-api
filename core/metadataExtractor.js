export class Extractor {
  constructor(entry) {
    this.entry = entry;
    this.audioBase = process.env.API_AUDIO_URL;
  }

  // Helper to strip MW tags like {bc}, {it}, etc.
  _clean(text) {
    if (!text) return "";
    return text.replace(/\{.*?\}/g, "").trim();
  }

  // 1. How to pronounce (IPA)
  getPronunciation() {
    return this.entry.hwi?.prs?.[0]?.ipa || "N/A";
  }

  // 2. Audio clip URL
  getAudioUrl() {
    const audio = this.entry.hwi?.prs?.[0]?.sound?.audio;
    if (!audio) return null;

    let subdir = audio.charAt(0);
    if (audio.startsWith("bix")) subdir = "bix";
    else if (audio.startsWith("gg")) subdir = "gg";
    else if (!/[a-zA-Z]/.test(subdir)) subdir = "number";

    return `${this.audioBase}${subdir}/${audio}.mp3`;
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

  // 5. Full Definition
  // Note: Pulls the very first primary definition from the sense sequence
  getFullDef() {
    const dt = this.entry.def?.[0]?.sseq?.[0]?.[0]?.[1]?.dt;
    const textEntry = dt?.find((item) => item[0] === "text");
    return textEntry ? this._clean(textEntry[1]) : this.getShortDef();
  }

  // 6. Usage (Example sentences)
  getUsage() {
    const dt = this.entry.def?.[0]?.sseq?.[0]?.[0]?.[1]?.dt;
    const visEntry = dt?.find((item) => item[0] === "vis");
    // Returns an array of example strings
    return visEntry ? visEntry[1].map((ex) => this._clean(ex.t)) : [];
  }

  isValid() {
    return this.entry?.meta?.id !== undefined;
  }

  /**
   * Combines all metadata for the entry into a single object
   * @return {Object} Complete metadata object with spelling, pronunciation, category, definition, usage, audioURL, and timestamp
   * @author banuka20431
   */
  getMetaData() {
    
    if(!this.isValid()) return null;

    return {
      spelling: this.entry.meta.id.replace(/[^a-zA-Z \-']/g, ""),
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

    const phoneticObj = this.entry.phonetics?.find((p) => p.text);
    return phoneticObj ? phoneticObj.text : "N/A";
  }

  getAudioUrl() {
    const audioObj = this.entry.phonetics?.find(
      (p) => p.audio && p.audio.length > 0,
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
      .map((def) => def.example)
      .filter((example) => example !== undefined && example !== null);
  }

  isValid() {
    return this.entry?.word !== undefined;
  }

  /**
   * Combines all metadata for the entry into a single object
   * @return {Object} Complete metadata object with spelling, pronunciation, category, definition, usage, audioURL, and timestamp
   * @author banuka20431
   */
  getMetaData() {
    
    if(!this.isValid()) return null;

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
   * @param {Object} primaryResponse - The response from the primary API
   * @return {Object} Merged metadata object with fallback values filling gaps
   * @author vocab-bucket
   */
  aggregate(primaryResponse) {
    const metadata = this.getMetaData();

    if (!metadata) return primaryResponse;
    if (!primaryResponse) return metadata;

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

      usage:
        primaryResponse.usage && primaryResponse.usage.length > 0
          ? [...primaryResponse.usage, ...metadata.usage]
          : metadata.usage,

      audioURL: primaryResponse.audioURL || metadata.audioURL,

      timestamp: new Date().toISOString(),
    };
  }
}
