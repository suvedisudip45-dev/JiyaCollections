import test from "node:test";
import assert from "node:assert/strict";
import {
  getSizeChartValidationError,
  transliterateWord,
  transliterateToNepali,
  parseStructuredDescription,
} from "../utils/nepaliTransliteration.js";
import { validateImageMerchandisingRules, assembleProductImages } from "../services/imageMerchandisingRules.js";

test("Nepali Transliteration: Translates common garment words and transliterates phrases", () => {
  assert.equal(transliterateWord("tshirt"), "टिसर्ट");
  assert.equal(transliterateWord("shirt"), "सर्ट");
  assert.equal(transliterateWord("pant"), "प्यान्ट");
  assert.equal(transliterateWord("kurta"), "कुर्ता");
  assert.equal(transliterateWord("cotton"), "सुती");

  const sentence = transliterateToNepali("Aama Cotton T-shirt Unisex");
  assert.ok(sentence.includes("सुती") || sentence.includes("टिसर्ट") || sentence.includes("आमा"));
});

test("Structured Description: Correctly parses structured JSON and text fallback", () => {
  const structured = parseStructuredDescription({
    about: "Premium everyday hoodie",
    fabricCare: "100% Organic Cotton. Machine wash cold.",
    sizeFit: "Regular fit. Model is 6ft wearing size L.",
  });
  assert.equal(structured.isStructured, true);
  assert.equal(structured.about, "Premium everyday hoodie");
  assert.equal(structured.fabricCare, "100% Organic Cotton. Machine wash cold.");
  assert.equal(structured.sizeFit, "Regular fit. Model is 6ft wearing size L.");

  const fromJsonString = parseStructuredDescription(JSON.stringify({
    about: "Pure Silk Saree",
    fabricCare: "Dry clean only",
    sizeFit: "Free size",
  }));
  assert.equal(fromJsonString.isStructured, true);
  assert.equal(fromJsonString.about, "Pure Silk Saree");

  const plain = parseStructuredDescription("Simple unstructured product description.");
  assert.equal(plain.isStructured, false);
  assert.equal(plain.about, "Simple unstructured product description.");
});

test("Structured description preserves paragraph whitespace and validates rich content blocks", () => {
  const paragraph = "  First paragraph.\n\nSecond line.\n";
  const chart = {
    blocks: [
      { type: "paragraph", text: paragraph },
      { type: "list", items: [" Point one ", "Point two"] },
      {
        type: "table",
        headers: ["Size", "Chest (cm)"],
        rows: [["S", "88"], ["M", "96"]],
      },
      { type: "unsupported", html: "<script>bad()</script>" },
    ],
  };
  const parsed = parseStructuredDescription(JSON.stringify({
    about: chart,
    fabricCare: "  Cotton\n\nWash cold  ",
    sizeFit: { blocks: [{ type: "table", headers: ["Size"], rows: [["XL"]] }] },
  }));

  assert.equal(parsed.about.blocks[0].text, paragraph);
  assert.deepEqual(parsed.about.blocks[1], { type: "list", items: [" Point one ", "Point two"] });
  assert.deepEqual(parsed.about.blocks[2], {
    type: "table",
    headers: ["Size", "Chest (cm)"],
    rows: [["S", "88"], ["M", "96"]],
  });
  assert.equal(parsed.about.blocks.length, 3);
  assert.equal(parsed.fabricCare, "  Cotton\n\nWash cold  ");
  assert.deepEqual(parsed.sizeFit.blocks[0].rows, [["XL"]]);
});

test("Structured description preserves optional product size charts and converts legacy size-fit tables", () => {
  const chart = {
    title: "Bottomwear measurements",
    subtitle: "Measurements in cm",
    headers: ["Size", "Waist", "Inseam"],
    rows: [["S", "72", "76"], ["M", "78", "78"]],
    fitTip: "Measure around the waist.\nKeep the tape level.",
  };
  const parsed = parseStructuredDescription(JSON.stringify({
    about: { blocks: [{ type: "paragraph", text: "Cotton trousers" }] },
    fabricCare: { blocks: [] },
    sizeChart: chart,
  }));
  assert.deepEqual(parsed.sizeChart, chart);

  const legacy = parseStructuredDescription(JSON.stringify({
    about: "Legacy product",
    sizeFit: {
      blocks: [
        { type: "table", headers: ["Size", "Waist"], rows: [["S", "72"], ["M", "78"]] },
        { type: "paragraph", text: "Measure at the narrowest point." },
      ],
    },
  }));
  assert.deepEqual(legacy.sizeChart, {
    title: "Garment Sizing Guide",
    subtitle: "",
    headers: ["Size", "Waist"],
    rows: [["S", "72"], ["M", "78"]],
    fitTip: "Measure at the narrowest point.",
  });
  assert.equal(getSizeChartValidationError(chart), "");
  assert.match(getSizeChartValidationError({ headers: ["Size", "Waist"], rows: [["S", ""]] }), /Complete every size/);
  assert.match(getSizeChartValidationError({ headers: ["Size"], rows: [["S"]] }), /at least one measurement column/);
  assert.equal(getSizeChartValidationError(null), "");
});

test("Image Merchandising Rules: Requires at least 1 gallery image and restricts cover selection", () => {
  // 1. Missing gallery images should fail
  const noGallery = validateImageMerchandisingRules({
    galleryUrls: [],
    colorImages: [{ color: "Red", image: "https://example.com/red.jpg" }],
  });
  assert.equal(noGallery.valid, false);
  assert.ok(noGallery.message.includes("At least one gallery image is required"));

  // 2. Color option cannot be selected as cover
  const colorCoverAttempt = validateImageMerchandisingRules({
    galleryUrls: ["https://example.com/gallery1.jpg"],
    colorImages: [{ color: "Red", image: "https://example.com/red.jpg" }],
    variants: [{ color: "Red", image: "https://example.com/red.jpg" }],
    featuredType: "variant",
    featuredIndex: 0,
  });
  assert.equal(colorCoverAttempt.valid, false);

  // 3. Valid gallery cover
  const validGalleryCover = validateImageMerchandisingRules({
    galleryUrls: ["https://example.com/gallery1.jpg", "https://example.com/gallery2.jpg"],
    colorImages: [{ color: "Blue", image: "https://example.com/blue.jpg" }],
    featuredType: "gallery",
    featuredIndex: 1,
  });
  assert.equal(validGalleryCover.valid, true);
  assert.equal(validGalleryCover.resolvedFeaturedUrl, "https://example.com/gallery2.jpg");

  // 4. Assemble puts Cover at index 0 and deduplicates
  const assembled = assembleProductImages({
    featuredUrl: "https://example.com/gallery2.jpg",
    galleryUrls: ["https://example.com/gallery1.jpg", "https://example.com/gallery2.jpg"],
    variants: [{ image: "https://example.com/blue.jpg" }],
    colorImages: [{ image: "https://example.com/blue.jpg" }],
  });
  assert.equal(assembled[0], "https://example.com/gallery2.jpg");
  assert.equal(assembled.length, 3); // gallery2 (cover), gallery1, blue
});
