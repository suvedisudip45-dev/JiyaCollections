/**
 * Nepali Unicode Phonetic Transliteration Utility
 * ─────────────────────────────────────────────────────────────
 * Converts Romanized English input (e.g. "tshirt", "suti kurta",
 * "nepali poshak") into accurate Devanagari Unicode script.
 *
 * Supports:
 * - Exact e-commerce vocabulary dictionary override
 * - Syllable-based consonant-vowel-matra segmentation
 * - Half-letters (halant / virama) and conjunct consonants (क्ष, त्र, ज्ञ)
 * - Digraph consonants (kh, gh, ch, chh, jh, th, dh, ph, bh, sh)
 * - Matras, independent vowels, anusvara, and numbers
 */

// Common garment and e-commerce word overrides for natural translation
const DICTIONARY = {
  "tshirt": "टिसर्ट",
  "t-shirt": "टिसर्ट",
  "tee": "टी",
  "shirt": "सर्ट",
  "pants": "प्यान्ट्स",
  "pant": "प्यान्ट",
  "trouser": "ट्राउजर",
  "trousers": "ट्राउजर्स",
  "jeans": "जिन्स",
  "kurta": "कुर्ता",
  "kurti": "कुर्ती",
  "suruwal": "सुरुवाल",
  "sari": "साडी",
  "saree": "साडी",
  "blouse": "ब्लाउज",
  "shawl": "शाल",
  "dupatta": "दुपट्टा",
  "jacket": "ज्याकेट",
  "hoodie": "हुडी",
  "sweater": "स्वेटर",
  "cardigan": "कार्डिगन",
  "coat": "कोट",
  "blazer": "ब्लेजर",
  "vest": "भेस्ट",
  "innerwear": "इनरवेयर",
  "socks": "मोजा",
  "shoes": "जुत्ता",
  "sneakers": "स्निकर्स",
  "sandals": "चप्पल",
  "cap": "टोपी",
  "hat": "टोपी",
  "belt": "बेल्ट",
  "bag": "झोला",
  "cotton": "सुती",
  "pure cotton": "शुद्ध सुती",
  "wool": "उन",
  "woolen": "ऊनी",
  "silk": "रेशम",
  "linen": "लिनन",
  "polyester": "पलिएस्टर",
  "fabric": "फेब्रिक",
  "care": "हेरचाह",
  "size": "साइज",
  "fit": "फिट",
  "slim fit": "स्लिम फिट",
  "regular fit": "रेगुलर फिट",
  "oversized": "ओभरसाइज्ड",
  "about": "बारेमा",
  "overview": "विवरण",
  "unisex": "युनिसेक्स",
  "men": "पुरुष",
  "women": "महिला",
  "kids": "बालबालिका",
  "black": "कालो",
  "white": "सेतो",
  "red": "रातो",
  "blue": "नीलो",
  "green": "हरियो",
  "yellow": "पहेँलो",
  "grey": "खैरो",
  "gray": "खैरो",
  "pink": "गुलाबी",
  "purple": "बैजनी",
  "aama": "आमा",
  "clothings": "क्लोथिङ्स",
  "clothing": "क्लोथिङ",
  "nepal": "नेपाल",
  "nepali": "नेपाली",
  "kathmandu": "काठमाडौँ",
  "pokhara": "पोखरा",
  "lalitpur": "ललितपुर",
  "bhaktapur": "भक्तपुर",
};

// Independent vowels (when at start of word or after another vowel)
const INDEPENDENT_VOWELS = {
  "aa": "आ",
  "a": "अ",
  "ee": "ई",
  "ii": "ई",
  "i": "इ",
  "oo": "ऊ",
  "uu": "ऊ",
  "u": "उ",
  "ai": "ऐ",
  "au": "औ",
  "e": "ए",
  "o": "ओ",
  "ri": "ऋ",
  "om": "ॐ",
};

// Dependent vowel signs (matras)
const MATRAS = {
  "aa": "ा",
  "a": "", // Inherent 'a' vowel removes halant
  "ee": "ी",
  "ii": "ी",
  "i": "ि",
  "oo": "ू",
  "uu": "ू",
  "u": "ु",
  "ai": "ै",
  "au": "ौ",
  "e": "े",
  "o": "ो",
  "ri": "ृ",
};

// Consonant base forms with halant (्)
const CONSONANTS = [
  // 3-char conjuncts & compounds
  { roman: "ksh", nepali: "क्ष्" },
  { roman: "gny", nepali: "ज्ञ्" },
  { roman: "chh", nepali: "छ्" },
  { roman: "tth", nepali: "ठ्" },
  { roman: "ddh", nepali: "ढ्" },
  { roman: "shh", nepali: "ष्" },

  // 2-char consonants & compounds
  { roman: "kh", nepali: "ख्" },
  { roman: "gh", nepali: "घ्" },
  { roman: "ng", nepali: "ङ्" },
  { roman: "ch", nepali: "च्" },
  { roman: "jh", nepali: "झ्" },
  { roman: "ny", nepali: "ञ्" },
  { roman: "th", nepali: "थ्" },
  { roman: "dh", nepali: "ध्" },
  { roman: "ph", nepali: "फ्" },
  { roman: "bh", nepali: "भ्" },
  { roman: "sh", nepali: "श्" },
  { roman: "tr", nepali: "त्र्" },
  { roman: "gy", nepali: "ज्ञ्" },
  { roman: "tt", nepali: "ट्" },
  { roman: "dd", nepali: "ड्" },
  { roman: "nn", nepali: "ण्" },

  // 1-char consonants
  { roman: "k", nepali: "क्" },
  { roman: "g", nepali: "ग्" },
  { roman: "c", nepali: "च्" },
  { roman: "j", nepali: "ज्" },
  { roman: "z", nepali: "ज्" },
  { roman: "t", nepali: "त्" },
  { roman: "d", nepali: "द्" },
  { roman: "n", nepali: "न्" },
  { roman: "p", nepali: "प्" },
  { roman: "f", nepali: "फ्" },
  { roman: "b", nepali: "ब्" },
  { roman: "v", nepali: "भ्" },
  { roman: "w", nepali: "व्" },
  { roman: "m", nepali: "म्" },
  { roman: "y", nepali: "य्" },
  { roman: "r", nepali: "र्" },
  { roman: "l", nepali: "ल्" },
  { roman: "s", nepali: "स्" },
  { roman: "h", nepali: "ह्" },
  { roman: "x", nepali: "क्ष्" },
  { roman: "q", nepali: "क्" },
];

const DIGITS = {
  "0": "०",
  "1": "१",
  "2": "२",
  "3": "३",
  "4": "४",
  "5": "५",
  "6": "६",
  "7": "७",
  "8": "८",
  "9": "९",
};

/**
 * Transliterates a single Romanized English word to Nepali Devanagari Unicode.
 * @param {string} word
 * @returns {string} Nepali Unicode word
 */
export const transliterateWord = (word) => {
  if (!word || typeof word !== "string") return "";

  const trimmed = word.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct dictionary lookup
  if (DICTIONARY[lower]) {
    return DICTIONARY[lower];
  }

  // Handle plural 's' or 'es' in English (e.g., shirts -> सर्टहरू)
  if (lower.endsWith("s") && DICTIONARY[lower.slice(0, -1)]) {
    return DICTIONARY[lower.slice(0, -1)] + "हरू";
  }

  let result = "";
  let i = 0;
  const len = lower.length;

  while (i < len) {
    const char = lower[i];

    // Numbers
    if (DIGITS[char]) {
      result += DIGITS[char];
      i++;
      continue;
    }

    // Non-alphabetic characters (preserve punctuation, hyphens, brackets)
    if (!/[a-z]/.test(char)) {
      result += char;
      i++;
      continue;
    }

    // Check for independent vowels when:
    // 1. At start of string (i === 0)
    // 2. Preceding character was not a consonant with halant removed
    const isAtWordStart = i === 0 || !/[a-z]/.test(lower[i - 1]);
    const twoChars = lower.slice(i, i + 2);
    const threeChars = lower.slice(i, i + 3);

    // Try multi-char vowels at start
    if (isAtWordStart) {
      if (INDEPENDENT_VOWELS[twoChars]) {
        result += INDEPENDENT_VOWELS[twoChars];
        i += 2;
        continue;
      }
      if (INDEPENDENT_VOWELS[char]) {
        result += INDEPENDENT_VOWELS[char];
        i += 1;
        continue;
      }
    }

    // Check consonants
    let matchedConsonant = null;
    let matchedLen = 0;

    for (const entry of CONSONANTS) {
      if (lower.startsWith(entry.roman, i)) {
        matchedConsonant = entry.nepali;
        matchedLen = entry.roman.length;
        break;
      }
    }

    if (matchedConsonant) {
      i += matchedLen;

      // Check if a vowel immediately follows this consonant
      const nextTwo = lower.slice(i, i + 2);
      const nextOne = lower[i] || "";

      if (MATRAS[nextTwo] !== undefined) {
        // Matra exists: remove halant (्) from consonant and append matra
        const base = matchedConsonant.slice(0, -1); // remove halant
        result += base + MATRAS[nextTwo];
        i += 2;
      } else if (MATRAS[nextOne] !== undefined) {
        const base = matchedConsonant.slice(0, -1); // remove halant
        result += base + MATRAS[nextOne];
        i += 1;
      } else {
        // No vowel follows — keep halant (half consonant) unless it's the very last char
        // In colloquial Nepali romanization, a trailing consonant without 'a' often has inherent 'a'
        // e.g. "ram" -> "राम", "nepal" -> "नेपाल"
        if (i === len || !/[a-z]/.test(lower[i])) {
          // Inherent 'a' at word end for natural reading
          result += matchedConsonant.slice(0, -1);
        } else {
          result += matchedConsonant;
        }
      }
      continue;
    }

    // Single unhandled vowel
    if (INDEPENDENT_VOWELS[char]) {
      result += INDEPENDENT_VOWELS[char];
      i++;
      continue;
    }

    // Fallback
    result += char;
    i++;
  }

  return result;
};

/**
 * Transliterates full text (multi-word, sentences, paragraphs) into Nepali Unicode.
 * Preserves newlines, spacing, formatting, and non-roman symbols.
 *
 * @param {string} text - English Romanized text
 * @returns {string} Nepali Unicode text
 */
export const transliterateToNepali = (text) => {
  if (!text || typeof text !== "string") return "";

  // Split by word boundaries while preserving whitespace & punctuation
  return text.replace(/([A-Za-z0-9'-]+)/g, (match) => {
    return transliterateWord(match);
  });
};

/**
 * Utility to parse and validate structured descriptions
 * Support the description sections and optional product-specific size chart:
 * - about / overview
 * - fabricCare
 * - sizeChart (with legacy sizeFit conversion)
 */
export const parseStructuredDescription = (rawDescription) => {
  if (!rawDescription) {
    return {
      about: "",
      fabricCare: "",
      sizeFit: "",
      sizeChart: null,
      rawText: "",
      isStructured: false,
    };
  }

  if (typeof rawDescription === "object" && rawDescription !== null) {
    return {
      about: normalizeDescriptionSection(rawDescription.about),
      fabricCare: normalizeDescriptionSection(rawDescription.fabricCare),
      sizeFit: normalizeDescriptionSection(rawDescription.sizeFit),
      sizeChart: normalizeSizeChart(rawDescription.sizeChart, rawDescription.sizeFit),
      rawText: JSON.stringify(rawDescription),
      isStructured: true,
    };
  }

  if (typeof rawDescription === "string") {
    const trimmed = rawDescription.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return {
            about: normalizeDescriptionSection(parsed.about),
            fabricCare: normalizeDescriptionSection(parsed.fabricCare),
            sizeFit: normalizeDescriptionSection(parsed.sizeFit),
            sizeChart: normalizeSizeChart(parsed.sizeChart, parsed.sizeFit),
            rawText: trimmed,
            isStructured: true,
          };
        }
      } catch {
        // not valid JSON, treat as raw text
      }
    }
    return {
      about: rawDescription,
      fabricCare: "",
      sizeFit: "",
      sizeChart: null,
      rawText: trimmed,
      isStructured: false,
    };
  }

  return {
    about: "",
    fabricCare: "",
    sizeFit: "",
    sizeChart: null,
    rawText: "",
    isStructured: false,
  };
};

const normalizeSizeChart = (chart, legacySection) => {
  if (chart && typeof chart === "object" && Array.isArray(chart.headers) && Array.isArray(chart.rows)) {
    const headers = chart.headers.slice(0, 20).map((header) => String(header ?? ""));
    return {
      title: String(chart.title || "Garment Sizing Guide"),
      subtitle: String(chart.subtitle || ""),
      headers,
      rows: chart.rows.slice(0, 100).map((row) =>
        headers.map((_, index) => String(Array.isArray(row) ? row[index] ?? "" : ""))
      ),
      fitTip: String(chart.fitTip || ""),
    };
  }

  const legacy = normalizeDescriptionSection(legacySection);
  const blocks = Array.isArray(legacy?.blocks) ? legacy.blocks : [];
  const table = blocks.find((block) => block.type === "table");
  const fitTip = blocks.flatMap((block) => (
    block.type === "paragraph" ? [block.text] :
      block.type === "list" ? block.items : []
  )).filter(Boolean).join("\n");

  if (table) {
    return {
      title: "Garment Sizing Guide",
      subtitle: "",
      headers: table.headers,
      rows: table.rows,
      fitTip,
    };
  }

  if (fitTip) {
    return { title: "Garment Sizing Guide", subtitle: "", headers: [], rows: [], fitTip };
  }
  return null;
};

export const getSizeChartValidationError = (chart) => {
  if (!chart) return "";
  if (!Array.isArray(chart.headers) || chart.headers.length < 2) {
    return "A size chart needs a size column and at least one measurement column.";
  }
  if (chart.headers.some((header) => !String(header ?? "").trim())) {
    return "Enter a heading for every size chart column.";
  }
  if (!Array.isArray(chart.rows) || chart.rows.length === 0) {
    return "Add at least one size row to the measurement chart.";
  }
  if (chart.rows.some((row) =>
    !Array.isArray(row)
    || row.length !== chart.headers.length
    || row.some((cell) => !String(cell ?? "").trim())
  )) {
    return "Complete every size and measurement cell before saving the product.";
  }
  return "";
};

const normalizeDescriptionSection = (section) => {
  if (typeof section === "string") return section;
  if (!section || typeof section !== "object" || !Array.isArray(section.blocks)) return "";

  const blocks = section.blocks.slice(0, 100).flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    if (block.type === "paragraph" && typeof block.text === "string") {
      return [{ type: "paragraph", text: block.text }];
    }
    if (block.type === "list" && Array.isArray(block.items)) {
      return [{ type: "list", items: block.items.slice(0, 100).map((item) => String(item ?? "")) }];
    }
    if (block.type === "table" && Array.isArray(block.headers) && Array.isArray(block.rows)) {
      const headers = block.headers.slice(0, 20).map((header) => String(header ?? ""));
      if (!headers.length) return [];
      const rows = block.rows.slice(0, 100).map((row) =>
        headers.map((_, index) => String(Array.isArray(row) ? row[index] ?? "" : ""))
      );
      return [{ type: "table", headers, rows }];
    }
    return [];
  });
  return { blocks };
};

export default {
  transliterateWord,
  transliterateToNepali,
  parseStructuredDescription,
  getSizeChartValidationError,
};
