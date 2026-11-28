import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requireProfileImageWorkspace,
  updateAccountProfileImage,
} from "../controllers/accountProfileController.js";

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("profile image endpoint rejects unsupported workspaces before upload", () => {
  const response = createResponse();
  let continued = false;
  requireProfileImageWorkspace(
    { auth: { role: "CUSTOMER" } },
    response,
    () => { continued = true; },
  );

  assert.equal(response.statusCode, 403);
  assert.equal(continued, false);
});

test("profile image upload requires an image file", async () => {
  const response = createResponse();
  await updateAccountProfileImage({ auth: { accountId: "account-1" } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Choose an image to upload.");
});
