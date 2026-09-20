import { prisma } from "../config/db.js";

const defaultLetterBody = `Dear {{customer.first_name}},

{{opening}}

{{story_content}}

{{continuity}}

{{closing}}

{{signature}}`;

const ensureDefaultStorySeed = async () => {
  const storyCount = await prisma.story.count();
  if (storyCount > 0) {
    return true;
  }

  const story = await prisma.story.create({
    data: {
      title: "The Welcome Story",
      description: "A gentle onboarding story for new customers.",
      status: "ACTIVE",
      assignmentEnabled: true,
      allowNewCustomers: true,
      allowAfterCompletion: true,
      assignmentWeight: 1,
    },
  });

  const letters = [
    {
      sequenceNumber: 1,
      title: "The First Greeting",
      summary: "A friendly introduction to the story world.",
      continuitySummary: "The journey begins with a quiet hello and a hopeful glance toward tomorrow.",
      content: "A small note arrives carrying a promise of wonder, and the story begins with curiosity, comfort, and a new beginning.",
    },
    {
      sequenceNumber: 2,
      title: "The Hidden Door",
      summary: "The first clue appears in plain sight.",
      continuitySummary: "The door was noticed before, but now it seems to be gently waiting for the right moment.",
      content: "An unexpected clue appears in the evening light, guiding the next step toward the forgotten route behind the house.",
    },
    {
      sequenceNumber: 3,
      title: "The Promised Path",
      summary: "The story reaches its first full turn.",
      continuitySummary: "The path finally feels decided, and the next chapter is ready to be discovered.",
      content: "With a steady heart, the path becomes clear and the promise of the next chapter begins to unfold with quiet confidence.",
    },
  ];

  for (const letter of letters) {
    await prisma.storyLetter.create({
      data: {
        storyId: story.id,
        ...letter,
        status: "ACTIVE",
      },
    });
  }

  const template = await prisma.letterTemplate.create({
    data: {
      name: "Classic Welcome Letter",
      description: "Default template for personalized story delivery.",
      status: "ACTIVE",
      selectionWeight: 1,
      repetitionWindow: 3,
      body: defaultLetterBody,
    },
  });

  await prisma.letterTemplateVersion.create({
    data: {
      templateId: template.id,
      versionNumber: 1,
      body: defaultLetterBody,
    },
  });

  return true;
};

const normalizeText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const buildStoryOpening = (customerName, storyTitle, isFirstLetter, isLastLetter, isNewStory) => {
  if (isNewStory) return `This is where our story begins for ${customerName}, and the first spark of ${storyTitle} starts to glow.`;
  if (isFirstLetter) return `This is where our story begins again for ${customerName}, and the path before us feels full of possibility.`;
  if (isLastLetter) return `The final turn of ${storyTitle} is here, and the ending arrives with a warm and hopeful glow.`;
  return `The story continues for ${customerName}, and the next page of ${storyTitle} opens with a gentle promise.`;
};

const buildRenderedTemplate = (templateBody, context) => {
  const customerFirstName = normalizeText(context.customer?.firstName || context.customer?.name || "Customer", "Customer");
  const customerLastName = normalizeText(context.customer?.lastName || "", "");
  const productName = normalizeText(context.product?.name || context.order?.productName || "your item", "your item");
  const storyTitle = normalizeText(context.story?.title || "the story", "the story");
  const letterTitle = normalizeText(context.letter?.title || "the letter", "the letter");
  const letterContent = normalizeText(context.letter?.content || "", "");
  const previousContinuity = normalizeText(context.previousLetter?.continuitySummary || context.previousLetter?.summary || "", "");
  const opening = normalizeText(context.opening || buildStoryOpening(customerFirstName, storyTitle, context.flags?.isFirstLetterOfStory, context.flags?.isLastLetterOfStory, context.flags?.isNewStory), "");
  const continuity = normalizeText(context.continuity || previousContinuity || "The path ahead feels warm and full of wonder.", "The path ahead feels warm and full of wonder.");
  const storyContent = normalizeText(context.story_content || letterContent || "The story unfolds gently and beautifully.", "The story unfolds gently and beautifully.");
  const closing = normalizeText(context.closing || `Until then, enjoy your ${productName}.`, `Until then, enjoy your ${productName}.`);
  const signature = normalizeText(context.signature || "With love,\nThe Aama Story Team", "With love,\nThe Aama Story Team");

  let output = templateBody;
  const replacements = {
    "{{customer.first_name}}": customerFirstName,
    "{{customer.last_name}}": customerLastName,
    "{{customer.display_name}}": `${customerFirstName} ${customerLastName}`.trim() || customerFirstName,
    "{{product.name}}": productName,
    "{{story.title}}": storyTitle,
    "{{letter.title}}": letterTitle,
    "{{letter.content}}": letterContent,
    "{{previous_letter.continuity_summary}}": previousContinuity,
    "{{previous_letter.summary}}": previousContinuity,
    "{{opening}}": opening,
    "{{continuity}}": continuity,
    "{{story_content}}": storyContent,
    "{{closing}}": closing,
    "{{signature}}": signature,
  };

  Object.entries(replacements).forEach(([key, value]) => {
    output = output.split(key).join(value);
  });

  return output
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const pickEligibleStory = async (tx, customerId, excludeStoryId = null) => {
  const activeStories = await tx.story.findMany({
    where: {
      status: "ACTIVE",
      assignmentEnabled: true,
      allowNewCustomers: true,
      ...(excludeStoryId ? { id: { not: excludeStoryId } } : {}),
    },
    orderBy: { assignmentWeight: "desc" },
  });

  if (!activeStories.length) return null;

  const counts = await tx.customerStoryAssignment.groupBy({
    by: ["storyId"],
    where: { status: "ACTIVE" },
    _count: { storyId: true },
  });

  const countMap = Object.fromEntries(counts.map((item) => [item.storyId, item._count.storyId]));

  return activeStories
    .slice()
    .sort((a, b) => (countMap[a.id] ?? 0) - (countMap[b.id] ?? 0) || Number(b.assignmentWeight || 1) - Number(a.assignmentWeight || 1))[0];
};

const getOrCreateCustomerAssignment = async (tx, customerId) => {
  const existing = await tx.customerStoryAssignment.findFirst({
    where: { customerId, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });

  if (existing) return existing;

  const story = await pickEligibleStory(tx, customerId);
  if (!story) return null;

  return tx.customerStoryAssignment.create({
    data: {
      customerId,
      storyId: story.id,
      status: "ACTIVE",
      nextSequenceNumber: 1,
      startedAt: new Date(),
    },
  });
};

const selectTemplateForCustomer = async (tx, customerId) => {
  const activeTemplates = await tx.letterTemplate.findMany({
    where: { status: "ACTIVE" },
    orderBy: { selectionWeight: "desc" },
  });

  if (!activeTemplates.length) {
    return null;
  }

  const recent = await tx.letterDelivery.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { templateId: true },
  });

  const recentIds = new Set(recent.map((item) => item.templateId).filter(Boolean));
  const candidates = activeTemplates.filter((template) => !recentIds.has(template.id));
  const pool = candidates.length ? candidates : activeTemplates;

  const totalWeight = pool.reduce((sum, template) => sum + Number(template.selectionWeight || 1), 0);
  const roulette = Math.random() * totalWeight;
  let cursor = 0;

  for (const template of pool) {
    cursor += Number(template.selectionWeight || 1);
    if (roulette <= cursor) {
      const version = await tx.letterTemplateVersion.findFirst({
        where: { templateId: template.id },
        orderBy: { versionNumber: "desc" },
      });
      return { template, version };
    }
  }

  const fallback = pool[0];
  const fallbackVersion = await tx.letterTemplateVersion.findFirst({
    where: { templateId: fallback.id },
    orderBy: { versionNumber: "desc" },
  });

  return { template: fallback, version: fallbackVersion };
};

const resolveNextStoryForCustomer = async (tx, customerId, currentStoryId) => {
  const stories = await tx.story.findMany({
    where: {
      status: "ACTIVE",
      assignmentEnabled: true,
      allowAfterCompletion: true,
      id: { not: currentStoryId },
    },
    orderBy: { assignmentWeight: "desc" },
  });

  if (!stories.length) return null;

  const counts = await tx.customerStoryAssignment.groupBy({
    by: ["storyId"],
    where: { status: "ACTIVE" },
    _count: { storyId: true },
  });

  const countMap = Object.fromEntries(counts.map((item) => [item.storyId, item._count.storyId]));

  return stories
    .slice()
    .sort((a, b) => (countMap[a.id] ?? 0) - (countMap[b.id] ?? 0) || Number(b.assignmentWeight || 1) - Number(a.assignmentWeight || 1))[0];
};

const ensureLetterRecords = async (storyId) => {
  const activeLetters = await prisma.storyLetter.count({
    where: { storyId, status: "ACTIVE" },
  });

  if (activeLetters > 0) return true;

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) return false;

  const defaultLetters = [
    {
      sequenceNumber: 1,
      title: "The Beginning",
      summary: "Welcome to the story.",
      continuitySummary: "The story begins with a meaningful first hello.",
      content: "The story begins with a reassuring first step, and curiosity opens the path ahead.",
    },
    {
      sequenceNumber: 2,
      title: "The Turning Point",
      summary: "The next chapter begins.",
      continuitySummary: "The path shifts, and the road ahead grows more vivid than before.",
      content: "A small shift in the light reveals the next chapter and quietly invites the heart to continue.",
    },
  ];

  for (const letter of defaultLetters) {
    await prisma.storyLetter.create({
      data: {
        storyId: story.id,
        ...letter,
        status: "ACTIVE",
      },
    });
  }

  return true;
};

export const getPersonalizedLetterStatus = async (orderId, manufacturerId) => {
  await ensureDefaultStorySeed();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      manufacturerId: true,
      status: true,
      amount: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (order.manufacturerId && order.manufacturerId !== manufacturerId) {
    throw new Error("PERMISSION_DENIED");
  }

  const existing = await prisma.letterDelivery.findFirst({
    where: { orderId },
    include: {
      story: true,
      storyLetter: true,
      template: true,
      templateVersion: true,
      assignment: true,
    },
  });

  if (existing) {
    return {
      available: true,
      status: existing.status,
      alreadyAllocated: true,
      orderId,
      letter: {
        id: existing.storyLetter.id,
        sequenceNumber: existing.storyLetter.sequenceNumber,
        title: existing.storyLetter.title,
      },
      story: {
        id: existing.story.id,
        title: existing.story.title,
      },
      template: {
        id: existing.template.id,
        name: existing.template.name,
      },
      renderedContent: existing.renderedContent,
      renderedHtml: existing.renderedHtml,
    };
  }

  return {
    available: true,
    status: "READY",
    alreadyAllocated: false,
    orderId,
    message: "Personalized letter is ready to be allocated.",
  };
};

export const printPersonalizedLetter = async (orderId, manufacturerId, idempotencyKey = null) => {
  await ensureDefaultStorySeed();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      letterDeliveries: true,
    },
  });

  if (!order) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (order.manufacturerId && order.manufacturerId !== manufacturerId) {
    throw new Error("PERMISSION_DENIED");
  }

  const existing = await prisma.letterDelivery.findFirst({
    where: { orderId },
    include: {
      story: true,
      storyLetter: true,
      template: true,
      templateVersion: true,
    },
  });

  if (existing) {
    return {
      success: true,
      message: "Letter already allocated for this order.",
      data: {
        id: existing.id,
        status: existing.status,
        orderId,
        story: { id: existing.story.id, title: existing.story.title },
        letter: { id: existing.storyLetter.id, sequenceNumber: existing.storyLetter.sequenceNumber, title: existing.storyLetter.title },
        template: { id: existing.template.id, name: existing.template.name },
        renderedContent: existing.renderedContent,
        renderedHtml: existing.renderedHtml,
      },
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.user.findUnique({
      where: { id: order.userId },
      select: { id: true, firstName: true, lastName: true, name: true, email: true },
    });

    if (!customer) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }

    let assignment = await getOrCreateCustomerAssignment(tx, customer.id);
    if (!assignment) {
      throw new Error("NO_ELIGIBLE_STORY");
    }

    let story = await tx.story.findUnique({ where: { id: assignment.storyId } });
    if (!story) {
      throw new Error("STORY_NOT_FOUND");
    }

    let nextLetter = await tx.storyLetter.findFirst({
      where: {
        storyId: story.id,
        sequenceNumber: assignment.nextSequenceNumber,
        status: "ACTIVE",
      },
    });

    if (!nextLetter) {
      await tx.customerStoryAssignment.update({
        where: { id: assignment.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      const nextStory = await resolveNextStoryForCustomer(tx, customer.id, story.id);
      if (!nextStory) {
        return {
          success: true,
          status: "NO_ELIGIBLE_STORY",
          available: false,
          message: "No eligible story is available for the customer right now.",
        };
      }

      assignment = await tx.customerStoryAssignment.create({
        data: {
          customerId: customer.id,
          storyId: nextStory.id,
          status: "ACTIVE",
          nextSequenceNumber: 1,
          startedAt: new Date(),
        },
      });

      story = nextStory;
      nextLetter = await tx.storyLetter.findFirst({
        where: { storyId: story.id, sequenceNumber: assignment.nextSequenceNumber, status: "ACTIVE" },
      });

      if (!nextLetter) {
        await ensureLetterRecords(story.id);
        nextLetter = await tx.storyLetter.findFirst({
          where: { storyId: story.id, sequenceNumber: 1, status: "ACTIVE" },
        });
      }
    }

    if (!nextLetter) {
      throw new Error("STORY_LETTER_NOT_FOUND");
    }

    const templateSelection = await selectTemplateForCustomer(tx, customer.id);
    const template = templateSelection?.template ?? (await tx.letterTemplate.findFirst({ where: { status: "ACTIVE" } }));
    if (!template) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }

    const templateVersion = templateSelection?.version ?? (await tx.letterTemplateVersion.findFirst({
      where: { templateId: template.id },
      orderBy: { versionNumber: "desc" },
    }));

    if (!templateVersion) {
      throw new Error("TEMPLATE_VERSION_NOT_FOUND");
    }

    const previousDelivery = await tx.letterDelivery.findFirst({
      where: {
        customerId: customer.id,
        customerStoryAssignmentId: assignment.id,
      },
      orderBy: { createdAt: "desc" },
    });

    const renderedContent = buildRenderedTemplate(template.body || defaultLetterBody, {
      customer,
      order: {
        id: order.id,
        productName: Array.isArray(order.items) ? (order.items[0]?.name || order.items[0]?.product?.name || "your item") : "your item",
      },
      ...({
        story: { id: story.id, title: story.title },
        letter: nextLetter,
        previousLetter: previousDelivery ? { continuitySummary: previousDelivery.renderedContent || "" } : null,
        opening: buildStoryOpening(customerFirstNameText(customer), story.title, assignment.nextSequenceNumber === 1, false, assignment.nextSequenceNumber === 1),
        continuity: previousDelivery ? "Last time, the story continued with quiet certainty and a sense of promise." : "This is where our story begins...",
        story_content: nextLetter.content,
        closing: `Until then, enjoy your ${Array.isArray(order.items) ? (order.items[0]?.name || order.items[0]?.product?.name || "item") : "item"}.`,
        signature: "With love,\nThe Aama Story Team",
      }),
      flags: {
        isFirstLetterOfStory: assignment.nextSequenceNumber === 1,
        isLastLetterOfStory: false,
        isNewStory: assignment.nextSequenceNumber === 1,
      },
    });

    const created = await tx.letterDelivery.create({
      data: {
        customerId: customer.id,
        orderId: order.id,
        manufacturerId: manufacturerId || order.manufacturerId,
        customerStoryAssignmentId: assignment.id,
        storyId: story.id,
        storyLetterId: nextLetter.id,
        templateId: template.id,
        templateVersionId: templateVersion.id,
        idempotencyKey: idempotencyKey || `${order.id}:${nextLetter.id}:${Date.now()}`,
        status: "PRINTED",
        reservedAt: new Date(),
        printedAt: new Date(),
        renderedContent,
        renderedHtml: `<html><body style="font-family:Arial,sans-serif;padding:32px;max-width:820px;margin:0 auto;white-space:pre-wrap;">${renderedContent.replace(/\n/g, "<br />")}</body></html>`,
      },
      include: {
        story: true,
        storyLetter: true,
        template: true,
        templateVersion: true,
      },
    });

    await tx.customerStoryAssignment.update({
      where: { id: assignment.id },
      data: {
        nextSequenceNumber: nextLetter.sequenceNumber + 1,
      },
    });

    return {
      success: true,
      data: {
        id: created.id,
        status: created.status,
        orderId: created.orderId,
        story: { id: created.story.id, title: created.story.title },
        letter: { id: created.storyLetter.id, sequenceNumber: created.storyLetter.sequenceNumber, title: created.storyLetter.title },
        template: { id: created.template.id, name: created.template.name },
        renderedContent: created.renderedContent,
        renderedHtml: created.renderedHtml,
      },
    };
  });

  return result;
};

const customerFirstNameText = (customer) => normalizeText(customer?.firstName || customer?.name || "Customer", "Customer");

export default { ensureDefaultStorySeed, getPersonalizedLetterStatus, printPersonalizedLetter };
