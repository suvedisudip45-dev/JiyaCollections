import assert from "node:assert/strict";
import { test } from "node:test";
import { saveAccountProfileImage } from "../services/accountProfileImageService.js";

test("profile image service updates the authenticated account and removes its replaced asset", async () => {
  const updatedAccountIds = [];
  const deletedAssets = [];
  const database = {
    authAccount: {
      async findUnique({ where }) {
        assert.equal(where.id, "account-1");
        return { id: where.id, profileImagePublicId: "old-profile" };
      },
      async update({ where, data }) {
        updatedAccountIds.push(where.id);
        return {
          profileImageUrl: data.profileImageUrl,
          profileImagePublicId: data.profileImagePublicId,
        };
      },
    },
  };
  const mediaStorage = {
    uploader: {
      async upload(_filePath, options) {
        assert.equal(options.folder, "aashrit-corner/profile-images");
        assert.equal(options.resource_type, "image");
        return { secure_url: "https://images.example/profile.webp", public_id: "new-profile" };
      },
      async destroy(publicId) {
        deletedAssets.push(publicId);
        return { result: "ok" };
      },
    },
  };

  const updated = await saveAccountProfileImage({
    database,
    mediaStorage,
    accountId: "account-1",
    filePath: "profile-upload.webp",
  });

  assert.deepEqual(updatedAccountIds, ["account-1"]);
  assert.equal(updated.profileImageUrl, "https://images.example/profile.webp");
  assert.deepEqual(deletedAssets, ["old-profile"]);
});

test("profile image service removes a newly uploaded asset if the account update fails", async () => {
  const deletedAssets = [];
  const database = {
    authAccount: {
      async findUnique() {
        return { id: "account-1", profileImagePublicId: null };
      },
      async update() {
        throw new Error("database write failed");
      },
    },
  };
  const mediaStorage = {
    uploader: {
      async upload() {
        return { secure_url: "https://images.example/profile.webp", public_id: "orphan-profile" };
      },
      async destroy(publicId) {
        deletedAssets.push(publicId);
      },
    },
  };

  await assert.rejects(
    saveAccountProfileImage({
      database,
      mediaStorage,
      accountId: "account-1",
      filePath: "profile-upload.webp",
    }),
    /database write failed/,
  );
  assert.deepEqual(deletedAssets, ["orphan-profile"]);
});
