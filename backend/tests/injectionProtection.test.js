import test from "node:test";
import assert from "node:assert/strict";
import {
  stripNullBytes,
  escapeHtml,
  sanitizeText,
  containsSqlInjection,
  sanitizeObject,
  sanitizeMiddleware,
} from "../middleware/sanitize.js";

test("Injection Protection - Null Byte Sanitization", () => {
  const input = "user_name\0admin";
  const cleaned = stripNullBytes(input);
  assert.equal(cleaned, "user_nameadmin");

  const urlEncodedInput = "file.png%00.exe";
  const urlCleaned = stripNullBytes(urlEncodedInput);
  assert.equal(urlCleaned, "file.png.exe");
});

test("Injection Protection - HTML & XSS Script Tag Stripping", () => {
  const scriptInput = "Hello <script>alert('XSS')</script> World";
  const cleanScript = sanitizeText(scriptInput);
  assert.equal(cleanScript, "Hello  World");

  const iframeInput = "Check this <iframe src='http://evil.com'></iframe> out";
  const cleanIframe = sanitizeText(iframeInput);
  assert.equal(cleanIframe, "Check this  out");

  const eventHandlerInput = "<img src='valid.jpg' onerror='alert(1)' />";
  const cleanEventHandler = sanitizeText(eventHandlerInput);
  assert.ok(!cleanEventHandler.includes("onerror="));

  const jsProtocol = "javascript:alert(document.cookie)";
  const cleanJsProtocol = sanitizeText(jsProtocol);
  assert.ok(!cleanJsProtocol.toLowerCase().includes("javascript:"));
});

test("Injection Protection - Strict HTML Stripping for identifiers/names", () => {
  const nameWithTags = "<b>John</b> <i>Doe</i>";
  const strippedName = sanitizeText(nameWithTags, { stripAllHtml: true });
  assert.equal(strippedName, "John Doe");
});

test("Injection Protection - Preservation of Legitimate Unicode & Nepali Text", () => {
  const nepaliText = "हाम्रो नयाँ उत्पादन - सुती कुर्ता (Size XL)";
  const sanitized = sanitizeText(nepaliText);
  assert.equal(sanitized, nepaliText);

  const priceWithSymbols = "Rs. 1,500 / $25.99 & 100% Cotton!";
  const sanitizedPrice = sanitizeText(priceWithSymbols);
  assert.equal(sanitizedPrice, priceWithSymbols);
});

test("Injection Protection - SQL Injection Detection", () => {
  assert.equal(containsSqlInjection("' OR '1'='1"), true);
  assert.equal(containsSqlInjection("admin' UNION SELECT * FROM users --"), true);
  assert.equal(containsSqlInjection("; DROP TABLE orders; --"), true);
  assert.equal(containsSqlInjection("Regular product search query"), false);
});

test("Injection Protection - Prototype Pollution Prevention in Objects", () => {
  const maliciousJson = JSON.parse(`{
    "title": "Clean Title",
    "__proto__": { "polluted": "yes" },
    "constructor": { "prototype": { "polluted": "yes" } },
    "nested": {
      "name": "<script>alert(1)</script>Safe Name",
      "__proto__": { "isAdmin": true }
    }
  }`);

  const cleaned = sanitizeObject(maliciousJson);

  // Prototype must not be polluted
  assert.equal(cleaned.__proto__.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).isAdmin, undefined);

  // Values inside cleaned object must be sanitized
  assert.equal(cleaned.title, "Clean Title");
  assert.equal(cleaned.nested.name, "Safe Name");
  assert.equal(cleaned.nested.__proto__.isAdmin, undefined);
});

test("Injection Protection - Express Middleware Handler", () => {
  const req = {
    body: {
      name: "Customer <script>evil()</script>",
      address: {
        city: "Kathmandu\0",
        street: "New Road",
      },
      __proto__: { backdoor: true },
    },
    query: {
      search: "<iframe src='x'></iframe>Kurtha",
    },
    params: {
      id: "prod_123%00",
    },
  };

  const res = {};
  let nextCalled = false;
  sanitizeMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.body.name, "Customer");
  assert.equal(req.body.address.city, "Kathmandu");
  assert.equal(req.body.address.street, "New Road");
  assert.equal(req.query.search, "Kurtha");
  assert.equal(req.params.id, "prod_123");
  assert.equal(({}).backdoor, undefined);
});

test("Validation & Sanitization - Email Format Validation", async () => {
  const validator = (await import("validator")).default;

  // Valid emails
  assert.equal(validator.isEmail("customer@example.com"), true);
  assert.equal(validator.isEmail("sudeep.subedi@aamaclothings.com.np"), true);
  assert.equal(validator.isEmail("admin+test@domain.org"), true);

  // Invalid emails
  assert.equal(validator.isEmail("not-an-email"), false);
  assert.equal(validator.isEmail("user@"), false);
  assert.equal(validator.isEmail("@domain.com"), false);
  assert.equal(validator.isEmail("user@domain"), false);
  assert.equal(validator.isEmail("<script>alert(1)</script>@evil.com"), false);
});

test("Validation & Sanitization - Price & Discount Numeric Boundaries", () => {
  // Price validation: positive number
  const isValidPrice = (price) => {
    const num = Number(price);
    return !isNaN(num) && num > 0;
  };

  assert.equal(isValidPrice(1500), true);
  assert.equal(isValidPrice("2499.50"), true);
  assert.equal(isValidPrice(0), false);
  assert.equal(isValidPrice(-500), false);
  assert.equal(isValidPrice("invalid_price"), false);
  assert.equal(isValidPrice(""), false);

  // Discount validation: 0% to 100%
  const isValidDiscount = (discount) => {
    if (discount === undefined || discount === null || discount === "") return true;
    const num = Number(discount);
    return !isNaN(num) && num >= 0 && num <= 100;
  };

  assert.equal(isValidDiscount(0), true);
  assert.equal(isValidDiscount(25), true);
  assert.equal(isValidDiscount(100), true);
  assert.equal(isValidDiscount("15.5"), true);
  assert.equal(isValidDiscount(-1), false);
  assert.equal(isValidDiscount(101), false);
  assert.equal(isValidDiscount("50%"), false);
});

