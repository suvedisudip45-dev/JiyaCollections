import test from "node:test";
import assert from "node:assert/strict";
import { transliterateWord, transliterateToNepali, parseStructuredDescription } from "../utils/nepaliTransliteration.js";
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
