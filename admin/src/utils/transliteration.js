import axios from "axios";
import { backendUrl } from "../App";

// Client-side quick transliteration dictionary
const QUICK_DICTIONARY = {
  tshirt: "टिसर्ट",
  "t-shirt": "टिसर्ट",
  shirt: "सर्ट",
  pant: "प्यान्ट",
  pants: "प्यान्ट्स",
  hoodie: "हुडी",
  jacket: "ज्याकेट",
  kurta: "कुर्ता",
  kurti: "कुर्ती",
  saree: "साडी",
  sari: "साडी",
  cotton: "सुती",
  wool: "उन",
  unisex: "युनिसेक्स",
  nepal: "नेपाल",
  aama: "आमा",
};

/**
 * Transliterates text from Romanized English to Nepali Unicode.
 * First tries backend API; falls back to client dictionary lookup.
 *
 * @param {string} text - English Romanized text
 * @param {string} [token] - Optional auth token
 * @returns {Promise<string>} Transliterated Nepali Unicode string
 */
export const transliterateText = async (text, token) => {
  if (!text || !text.trim()) return "";

  try {
    const headers = token ? { token } : {};
    const res = await axios.post(
      `${backendUrl}/api/product/transliterate`,
      { text },
      { headers }
    );
    if (res.data?.success && res.data?.transliterated) {
      return res.data.transliterated;
    }
  } catch (err) {
    console.warn("Backend transliteration failed, using fallback:", err.message);
  }

  // Fallback simple word mapper
  return text
    .split(/\b/)
    .map((word) => QUICK_DICTIONARY[word.toLowerCase()] || word)
    .join("");
};

/**
 * Parses a raw description string into structured sections:
 * { about: string, fabricCare: string, sizeFit: string }
 */
export const parseStructuredDescription = (raw) => {
  if (!raw) return { about: "", fabricCare: "", sizeFit: "" };

  if (typeof raw === "object") {
    return {
      about: raw.about || "",
      fabricCare: raw.fabricCare || "",
      sizeFit: raw.sizeFit || "",
    };
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return {
            about: parsed.about || "",
            fabricCare: parsed.fabricCare || "",
            sizeFit: parsed.sizeFit || "",
          };
        }
      } catch {
        // Fallback to plain string
      }
    }
    return { about: trimmed, fabricCare: "", sizeFit: "" };
  }

  return { about: "", fabricCare: "", sizeFit: "" };
};

export default {
  transliterateText,
  parseStructuredDescription,
};
