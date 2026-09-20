import { prisma } from "../config/db.js";

const normalizeStatus = (status, fallback = "ACTIVE") => {
  const value = String(status || fallback).trim().toUpperCase();
  return ["ACTIVE", "DRAFT", "PAUSED", "ARCHIVED"].includes(value) ? value : fallback;
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
