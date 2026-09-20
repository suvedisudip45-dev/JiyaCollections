import { prisma } from "../config/db.js";

export const normalizeStatus = (status, fallback = "ACTIVE") => {
  const value = String(status || fallback).trim().toUpperCase();
  return ["ACTIVE", "DRAFT", "PAUSED", "ARCHIVED"].includes(value) ? value : fallback;
};

export const toggleArchiveState = (status, fallback = "ACTIVE") => {
  const current = normalizeStatus(status, fallback);
  return current === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
};

export const normalizeLetterSequenceOrder = (orderedIds = []) => {
  const seen = new Set();
  const normalized = [];

  for (const rawId of orderedIds || []) {
    const value = String(rawId ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
};

export const listStories = async () => {
  const stories = await prisma.story.findMany({
    include: {
      letters: {
        orderBy: { sequenceNumber: "asc" },
      },
      _count: {
        select: {
          assignments: true,
          deliveries: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return stories.map((story) => ({
    ...story,
    letterCount: story.letters.length,
    assignmentCount: story._count.assignments,
    deliveryCount: story._count.deliveries,
  }));
};

export const getStoryById = async (storyId) => {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: {
      letters: {
        orderBy: { sequenceNumber: "asc" },
      },
      _count: {
        select: {
          assignments: true,
          deliveries: true,
        },
      },
    },
  });

  if (!story) {
    throw new Error("STORY_NOT_FOUND");
  }

  return {
    ...story,
    letterCount: story.letters.length,
    assignmentCount: story._count.assignments,
    deliveryCount: story._count.deliveries,
  };
};

export const createStory = async (payload = {}) => {
  const title = String(payload.title || "").trim();
  if (!title) {
    throw new Error("STORY_TITLE_REQUIRED");
  }

  return prisma.story.create({
    data: {
      title,
      description: payload.description || "",
      status: normalizeStatus(payload.status, "ACTIVE"),
      assignmentEnabled: payload.assignmentEnabled !== false,
      allowNewCustomers: payload.allowNewCustomers !== false,
      allowAfterCompletion: payload.allowAfterCompletion !== false,
      assignmentWeight: Number(payload.assignmentWeight ?? 1),
    },
  });
};

export const updateStory = async (storyId, payload = {}) => {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new Error("STORY_NOT_FOUND");
  }

  const updates = {};
  if (payload.title !== undefined) {
    const title = String(payload.title || "").trim();
    if (!title) throw new Error("STORY_TITLE_REQUIRED");
    updates.title = title;
  }
  if (payload.description !== undefined) updates.description = payload.description || "";
  if (payload.status !== undefined) updates.status = normalizeStatus(payload.status, story.status);
  if (payload.assignmentEnabled !== undefined) updates.assignmentEnabled = Boolean(payload.assignmentEnabled);
  if (payload.allowNewCustomers !== undefined) updates.allowNewCustomers = Boolean(payload.allowNewCustomers);
  if (payload.allowAfterCompletion !== undefined) updates.allowAfterCompletion = Boolean(payload.allowAfterCompletion);
  if (payload.assignmentWeight !== undefined) updates.assignmentWeight = Number(payload.assignmentWeight ?? story.assignmentWeight ?? 1);

  return prisma.story.update({
    where: { id: storyId },
    data: updates,
  });
};

export const listStoryLetters = async (storyId) => {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new Error("STORY_NOT_FOUND");
  }

  return prisma.storyLetter.findMany({
    where: { storyId },
    orderBy: { sequenceNumber: "asc" },
  });
};

export const createStoryLetter = async (storyId, payload = {}) => {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) {
    throw new Error("STORY_NOT_FOUND");
  }

  const sequenceNumber = Number(payload.sequenceNumber ?? 0);
  const title = String(payload.title || "").trim();
  const content = String(payload.content || "").trim();

  if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0) {
    throw new Error("INVALID_SEQUENCE_NUMBER");
  }

  if (!title) {
    throw new Error("LETTER_TITLE_REQUIRED");
  }

  if (!content) {
    throw new Error("LETTER_CONTENT_REQUIRED");
  }

  return prisma.storyLetter.create({
    data: {
      storyId,
      sequenceNumber,
      title,
      summary: payload.summary || "",
      continuitySummary: payload.continuitySummary || "",
      content,
      status: normalizeStatus(payload.status, "ACTIVE"),
    },
  });
};

export const updateStoryLetter = async (letterId, payload = {}) => {
  const existing = await prisma.storyLetter.findUnique({ where: { id: letterId } });
  if (!existing) throw new Error("LETTER_NOT_FOUND");

  const updates = {};
  if (payload.sequenceNumber !== undefined) {
    const sequenceNumber = Number(payload.sequenceNumber ?? existing.sequenceNumber);
    if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0) throw new Error("INVALID_SEQUENCE_NUMBER");
    updates.sequenceNumber = sequenceNumber;
  }
  if (payload.title !== undefined) {
    const title = String(payload.title || "").trim();
    if (!title) throw new Error("LETTER_TITLE_REQUIRED");
    updates.title = title;
  }
  if (payload.summary !== undefined) updates.summary = payload.summary || "";
  if (payload.continuitySummary !== undefined) updates.continuitySummary = payload.continuitySummary || "";
  if (payload.content !== undefined) {
    const content = String(payload.content || "").trim();
    if (!content) throw new Error("LETTER_CONTENT_REQUIRED");
    updates.content = content;
  }
  if (payload.status !== undefined) updates.status = normalizeStatus(payload.status, existing.status);

  return prisma.storyLetter.update({
    where: { id: letterId },
    data: updates,
  });
};

export const listTemplates = async () => {
  return prisma.letterTemplate.findMany({
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

export const createTemplate = async (payload = {}) => {
  const name = String(payload.name || "").trim();
  const body = String(payload.body || "").trim();

  if (!name) {
    throw new Error("TEMPLATE_NAME_REQUIRED");
  }

  if (!body) {
    throw new Error("TEMPLATE_BODY_REQUIRED");
  }

  return prisma.letterTemplate.create({
    data: {
      name,
      description: payload.description || "",
      status: normalizeStatus(payload.status, "ACTIVE"),
      selectionWeight: Number(payload.selectionWeight ?? 1),
      repetitionWindow: Number.isInteger(Number(payload.repetitionWindow)) ? Number(payload.repetitionWindow) : 3,
      body,
      createdBy: payload.createdBy || "admin",
      versions: {
        create: {
          versionNumber: 1,
          body,
          createdBy: payload.createdBy || "admin",
        },
      },
    },
    include: {
      versions: true,
    },
  });
};

export const updateTemplate = async (templateId, payload = {}) => {
  const existing = await prisma.letterTemplate.findUnique({
    where: { id: templateId },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!existing) throw new Error("TEMPLATE_NOT_FOUND");

  const updates = {};
  if (payload.name !== undefined) {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("TEMPLATE_NAME_REQUIRED");
    updates.name = name;
  }
  if (payload.description !== undefined) updates.description = payload.description || "";
  if (payload.status !== undefined) updates.status = normalizeStatus(payload.status, existing.status);
  if (payload.selectionWeight !== undefined) updates.selectionWeight = Number(payload.selectionWeight ?? existing.selectionWeight ?? 1);
  if (payload.repetitionWindow !== undefined) updates.repetitionWindow = Number.isInteger(Number(payload.repetitionWindow)) ? Number(payload.repetitionWindow) : existing.repetitionWindow ?? 3;
  if (payload.body !== undefined) {
    const body = String(payload.body || "").trim();
    if (!body) throw new Error("TEMPLATE_BODY_REQUIRED");
    updates.body = body;
  }

  const nextVersionNumber = (existing.versions?.length || 0) + 1;

  return prisma.letterTemplate.update({
    where: { id: templateId },
    data: {
      ...updates,
      ...(payload.body !== undefined ? {
        versions: {
          create: {
            versionNumber: nextVersionNumber,
            body: payload.body,
            createdBy: payload.createdBy || "admin",
          },
        },
      } : {}),
    },
    include: {
      versions: true,
    },
  });
};

export const toggleStoryArchive = async (storyId) => {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) throw new Error("STORY_NOT_FOUND");
  return updateStory(storyId, { status: toggleArchiveState(story.status, "ACTIVE") });
};

export const toggleStoryLetterArchive = async (letterId) => {
  const letter = await prisma.storyLetter.findUnique({ where: { id: letterId } });
  if (!letter) throw new Error("LETTER_NOT_FOUND");
  return updateStoryLetter(letterId, { status: toggleArchiveState(letter.status, "ACTIVE") });
};

export const toggleTemplateArchive = async (templateId) => {
  const template = await prisma.letterTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error("TEMPLATE_NOT_FOUND");
  return updateTemplate(templateId, { status: toggleArchiveState(template.status, "ACTIVE") });
};

export const reorderStoryLetters = async (storyId, orderedIds = []) => {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) throw new Error("STORY_NOT_FOUND");

  const currentLetters = await prisma.storyLetter.findMany({
    where: { storyId },
    orderBy: { sequenceNumber: "asc" },
  });

  const normalizedIds = normalizeLetterSequenceOrder(orderedIds);
  const allIds = normalizedIds.length ? normalizedIds : currentLetters.map((letter) => letter.id);
  const existingIds = new Set(currentLetters.map((letter) => letter.id));
  const finalOrder = [...allIds.filter((id) => existingIds.has(id))];

  for (const letter of currentLetters) {
    if (!finalOrder.includes(letter.id)) finalOrder.push(letter.id);
  }

  const updates = finalOrder.map((letterId, index) =>
    prisma.storyLetter.update({
      where: { id: letterId },
      data: { sequenceNumber: index + 1 },
    })
  );

  await prisma.$transaction(updates);
  return prisma.storyLetter.findMany({
    where: { storyId },
    orderBy: { sequenceNumber: "asc" },
  });
};
