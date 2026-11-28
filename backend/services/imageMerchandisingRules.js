/**
 * Image Merchandising Rules — Product Catalog Validation
 * ───────────────────────────────────────────────────────
 * Enforces business rules for product image coverage and featured-image selection:
 *
 * Rule 1:  At least ONE valid gallery image is STRICTLY REQUIRED.
 *          A product cannot be created or updated without a gallery image.
 *
 * Rule 2:  The Cover/Featured image MUST come from the gallery images.
 *          Color-option (variant) images CANNOT be designated as the Cover image.
 *
 * Rule 3:  If no explicit featured selection is made, the first gallery image
 *          is automatically promoted to Cover status.
 */

/**
 * Validates that the product image payload satisfies merchandising rules.
 *
 * @param {Object} params
 * @param {string[]} params.galleryUrls         – URLs of uploaded/existing gallery images
 * @param {Object[]} params.colorImages         – Array of { color, image } color-option entries
 * @param {Object[]} params.variants            – Array of variant objects (may have .image)
 * @param {string}   params.featuredType        – 'gallery' | 'variant' | undefined
 * @param {number}   params.featuredIndex       – index of the selected featured image
 * @param {boolean}  [params.isUpdate=false]    – true when updating an existing product
 *
 * @returns {{ valid: boolean, message?: string, resolvedFeaturedUrl?: string }}
 */
export const validateImageMerchandisingRules = ({
  galleryUrls = [],
  colorImages = [],
  variants = [],
  featuredType,
  featuredIndex,
  isUpdate = false,
}) => {
  // ── Rule 1: At least one gallery image is required ───────────────
  if (!galleryUrls || galleryUrls.length === 0) {
    return {
      valid: false,
      message:
        "At least one gallery image is required. Upload a product photo to the main image gallery.",
    };
  }

  // ── Rule 2: Cover image cannot come from color-option images ────
  if (featuredType === "variant") {
    // Resolve the image URL that would become the cover
    const idx = parseInt(featuredIndex, 10);
    if (!isNaN(idx) && idx >= 0 && idx < variants.length) {
      const candidateUrl = variants[idx]?.image;
      // Check if this URL belongs to a color-option image
      const isColorOptionImage = colorImages.some(
        (ci) => ci.image && ci.image === candidateUrl
      );
      if (isColorOptionImage) {
        return {
          valid: false,
          message:
            "A color-option image cannot be set as the Cover/Featured image. Please select a gallery image as the Cover.",
        };
      }
    }
    // variant-type featured selection is blocked entirely — cover must be gallery
    return {
      valid: false,
      message:
        "The Cover/Featured image must be selected from the gallery images, not from color variants.",
    };
  }

  // ── Rule 3: Auto-resolve featured URL from gallery ──────────────
  let resolvedFeaturedUrl = "";
  if (featuredType === "gallery") {
    const idx = parseInt(featuredIndex, 10);
    if (!isNaN(idx) && idx >= 0 && idx < galleryUrls.length) {
      resolvedFeaturedUrl = galleryUrls[idx];
    } else {
      // Invalid index — fall back to first gallery image
      resolvedFeaturedUrl = galleryUrls[0];
    }
  } else {
    // No explicit selection — default to first gallery image
    resolvedFeaturedUrl = galleryUrls[0];
  }

  if (!resolvedFeaturedUrl) {
    return {
      valid: false,
      message: "Could not determine a valid Cover image. Ensure the gallery contains at least one image.",
    };
  }

  return { valid: true, resolvedFeaturedUrl };
};

/**
 * Assembles the final ordered image array with the featured/cover image at index 0.
 * Deduplicates URLs and appends remaining gallery, variant, and color-option images.
 *
 * @param {Object} params
 * @param {string}   params.featuredUrl  – the resolved cover image URL
 * @param {string[]} params.galleryUrls  – all gallery image URLs
 * @param {Object[]} params.variants     – variant objects with optional .image
 * @param {Object[]} params.colorImages  – color-option objects with optional .image
 *
 * @returns {string[]} Ordered, deduplicated image URL array
 */
export const assembleProductImages = ({
  featuredUrl,
  galleryUrls = [],
  variants = [],
  colorImages = [],
}) => {
  const allImages = [];
  const seen = new Set();

  const add = (url) => {
    if (url && !seen.has(url)) {
      seen.add(url);
      allImages.push(url);
    }
  };

  // Cover image first
  add(featuredUrl);

  // Remaining gallery images
  galleryUrls.forEach(add);

  // Variant images
  variants.forEach((v) => add(v.image));

  // Color-option images (never promoted to cover, but still in the gallery)
  colorImages.forEach((ci) => add(ci.image));

  return allImages;
};

export default { validateImageMerchandisingRules, assembleProductImages };
