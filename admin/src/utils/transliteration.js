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
 * Parses legacy text or rich description sections into a consistent block shape.
 */
export const parseStructuredDescription = (raw) => {
  const normalizeSection = (section) => typeof section === "string"
    ? { blocks: section ? [{ type: "paragraph", text: section }] : [] }
    : section && typeof section === "object" && Array.isArray(section.blocks)
      ? { blocks: section.blocks.filter((block) => ["paragraph", "list", "table"].includes(block?.type)) }
      : { blocks: [] };
  const empty = { about: { blocks: [] }, fabricCare: { blocks: [] }, sizeChart: null };
  const normalizeSizeChart = (chart, legacySection) => {
    if (chart && typeof chart === "object" && Array.isArray(chart.headers) && Array.isArray(chart.rows)) {
      return {
        title: String(chart.title || "Garment Sizing Guide"),
        subtitle: String(chart.subtitle || ""),
        headers: chart.headers.map((header) => String(header ?? "")),
        rows: chart.rows.map((row) => chart.headers.map((_, index) => String(row?.[index] ?? ""))),
        fitTip: String(chart.fitTip || ""),
      };
    }

    const legacy = normalizeSection(legacySection).blocks;
    const table = legacy.find((block) => block.type === "table");
    const fitTip = legacy.flatMap((block) => (
      block.type === "paragraph" ? [String(block.text || "")] :
        block.type === "list" && Array.isArray(block.items) ? block.items.map(String) : []
    )).filter(Boolean).join("\n");
    if (table) {
      return {
        title: "Garment Sizing Guide",
        subtitle: "",
        headers: table.headers.map((header) => String(header ?? "")),
        rows: table.rows.map((row) => table.headers.map((_, index) => String(row?.[index] ?? ""))),
        fitTip,
      };
    }
    return fitTip ? { title: "Garment Sizing Guide", subtitle: "", headers: [], rows: [], fitTip } : null;
  };
  const normalizeDescription = (description) => ({
    about: normalizeSection(description.about),
    fabricCare: normalizeSection(description.fabricCare),
    sizeChart: normalizeSizeChart(description.sizeChart, description.sizeFit),
  });

  if (!raw) return empty;

  if (typeof raw === "object") {
    return normalizeDescription(raw);
  }

  if (typeof raw === "string") {
    if (raw.trim().startsWith("{") && raw.trim().endsWith("}")) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return normalizeDescription(parsed);
        }
      } catch {
        // Fallback to plain string
      }
    }
    return { ...empty, about: normalizeSection(raw) };
  }

  return empty;
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

export default {
  transliterateText,
  parseStructuredDescription,
  getSizeChartValidationError,
};
