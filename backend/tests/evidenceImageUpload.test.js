import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v2 as cloudinary } from "cloudinary";
import { uploadEvidenceImage } from "../utils/evidenceImageUpload.js";

const stubUpload = (t, implementation) => {
  const original = cloudinary.uploader.upload;
  cloudinary.uploader.upload = implementation;
  t.after(() => {
    cloudinary.uploader.upload = original;
  });
};

const createEvidenceFile = async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-upload-test-"));
  const filePath = path.join(directory, "evidence.png");
  await fs.writeFile(filePath, "test image");
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { path: filePath };
};

test("evidence upload passes a bounded timeout and removes its temporary file", async (t) => {
  const file = await createEvidenceFile(t);
  let uploadOptions;
  stubUpload(t, async (_filePath, options) => {
    uploadOptions = options;
    return { secure_url: "https://example.test/evidence.png", public_id: "return-evidence/test" };
  });

  const result = await uploadEvidenceImage(file, "return-evidence");

  assert.equal(result.secure_url, "https://example.test/evidence.png");
  assert.equal(uploadOptions.timeout, 60_000);
  assert.equal(uploadOptions.folder, "return-evidence");
  await assert.rejects(fs.access(file.path), { code: "ENOENT" });
});

test("nested Cloudinary timeout errors return a clear retryable error", async (t) => {
  const file = await createEvidenceFile(t);
  stubUpload(t, async () => {
    throw { error: { message: "Request Timeout", http_code: 499, name: "TimeoutError" } };
  });

  await assert.rejects(uploadEvidenceImage(file, "return-evidence"), {
    statusCode: 504,
    code: "EVIDENCE_UPLOAD_TIMEOUT",
    message: /server could not upload.*Cloudinary.*return was not recorded.*administrator/i,
  });
  await assert.rejects(fs.access(file.path), { code: "ENOENT" });
});

test("other evidence-upload failures do not expose provider details", async (t) => {
  const file = await createEvidenceFile(t);
  stubUpload(t, async () => {
    throw { error: { message: "provider credentials or internal details", http_code: 401 } };
  });

  await assert.rejects(uploadEvidenceImage(file, "return-evidence"), {
    statusCode: 502,
    code: "EVIDENCE_UPLOAD_FAILED",
    message: "The evidence image could not be uploaded. The return was not recorded.",
  });
});
