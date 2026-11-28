import { randomUUID } from "node:crypto";

export const saveAccountProfileImage = async ({
  database,
  mediaStorage,
  accountId,
  filePath,
}) => {
  const account = await database.authAccount.findUnique({
    where: { id: accountId },
    select: { id: true, profileImagePublicId: true },
  });
  if (!account) {
    throw Object.assign(new Error("Account not found."), { statusCode: 404 });
  }

  let uploadedPublicId = null;
  try {
    const uploaded = await mediaStorage.uploader.upload(filePath, {
      folder: "aashrit-corner/profile-images",
      public_id: randomUUID(),
      resource_type: "image",
      overwrite: false,
    });
    uploadedPublicId = uploaded.public_id || null;
    if (!uploaded.secure_url || !uploadedPublicId) {
      throw new Error("Cloudinary did not return a profile image URL and public ID.");
    }

    const updated = await database.authAccount.update({
      where: { id: account.id },
      data: {
        profileImageUrl: uploaded.secure_url,
        profileImagePublicId: uploadedPublicId,
      },
      select: { profileImageUrl: true, profileImagePublicId: true },
    });
    uploadedPublicId = null;

    if (account.profileImagePublicId && account.profileImagePublicId !== updated.profileImagePublicId) {
      try {
        await mediaStorage.uploader.destroy(account.profileImagePublicId, {
          resource_type: "image",
          invalidate: true,
        });
      } catch (error) {
        console.error("Unable to remove the previous account profile image.", error);
      }
    }

    return updated;
  } catch (error) {
    if (uploadedPublicId) {
      try {
        await mediaStorage.uploader.destroy(uploadedPublicId, { resource_type: "image" });
      } catch (cleanupError) {
        console.error("Unable to remove an unclaimed account profile image.", cleanupError);
      }
    }
    throw error;
  }
};
