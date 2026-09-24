import { prisma } from "../config/db.js";

const defaultLetterBody = `प्रिय {{customer.first_name}} ज्यू,

{{opening}}

{{story.title}} को यो अध्याय हामीले तपाईको लागि नरम र जीवन्त ढंगले प्रस्तुत गर्न चाहन्छौं। {{letter.content}}

तपाईंले {{product.color}} {{product.name}} चयन गर्नुभएकोमा हामीलाई विशेष खुशी लागेको छ। यो सामान तपाईको दैनिक जीवनमा सहजता, आत्मविश्वास र सन्तोष थप्नेछ। हामीलाई पूरा विश्वास छ कि {{product.color}} {{product.name}} तपाईको रोजमर्रा जीवनलाई सजिलो र सुन्दर बनाउनेछ।

{{closing}}

सधैं तपाईको साथमा,
{{signature}}`;

const ensureDefaultStorySeed = async () => {
  const storyCount = await prisma.story.count();
  if (storyCount > 0) {
    return true;
  }

  const story = await prisma.story.create({
    data: {
      title: "स्वागत कथाको यात्रा",
      description: "नयाँ ग्राहकहरूको लागि नरम र मनमोहक सुरुवाती कथा।",
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
      title: "प्रथम नमस्कार",
      summary: "कथाको संसारमाfreundली परिचय।",
      continuitySummary: "यात्रा न्यानो नमस्कारसँग शुरू हुन्छ र भविष्यको आशा लिएर अगाडि बढ्छ।",
      content: "एक सानो पत्र आउँछ जसले आशा र जादूको वाचा लिएर, कथाको सुरुवात जिज्ञासा, आराम र नयाँ शुरुआतसँग हुन्छ।",
    },
    {
      sequenceNumber: 2,
      title: "लुकेको ढोका",
      summary: "पहिलो संकेत सजिलै देखिन्छ।",
      continuitySummary: "ढोका पहिले नै देखिएको थियो, तर अहिले यो सही समयको प्रतीक्षा गर्दै नरम रूपमा छ।",
      content: "शामको उज्यालोमा एक भनौठो संकेत देखा पर्दछ, र घर पछाडिको बिर्सिएको बाटोको अगाडि अर्को पाइलाको मार्ग देखाउँछ।",
    },
    {
      sequenceNumber: 3,
      title: "वाचा गरिएको बाटो",
      summary: "कथाले आफ्नो पहिलो मोड पूरा गर्‍यो।",
      continuitySummary: "बाटो अन्ततः निश्चित हुन्छ, र अर्को अध्यायको खोज सुरु गर्न तयार हुन्छ।",
      content: "स्थिर हृदयले बाटोलाई स्पष्ट बनाउँछ र अर्को अध्यायको वाचा शान्त आत्मविश्वाससहित खुल्दै जान्छ।",
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

  const templates = [
    {
      name: "सार्वभौमिक स्वागत पत्र",
      description: "कुनै पनि ग्राहकको लागि पूर्वनिर्धारित टेम्प्लेट।",
      status: "ACTIVE",
      targetGender: "ANY",
      selectionWeight: 1,
      repetitionWindow: 3,
      body: defaultLetterBody,
    },
    {
      name: "पुरुष कथाको पत्र",
      description: "पुरुषका लागि विशेष कथाको टेम्प्लेट।",
      status: "ACTIVE",
      targetGender: "MALE",
      selectionWeight: 1,
      repetitionWindow: 3,
      body: defaultLetterBody,
    },
    {
      name: "महिला कथाको पत्र",
      description: "महिलाका लागि विशेष कथाको टेम्प्लेट।",
      status: "ACTIVE",
      targetGender: "FEMALE",
      selectionWeight: 1,
      repetitionWindow: 3,
      body: defaultLetterBody,
    },
  ];

  for (const templateInput of templates) {
    const template = await prisma.letterTemplate.create({
      data: {
        ...templateInput,
      },
    });

    await prisma.letterTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        body: templateInput.body,
      },
    });
  }

  return true;
};

export const normalizeGenderValue = (value, fallback = "PREFER_NOT_TO_SAY") => {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  return ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY", "ANY"].includes(normalized) ? normalized : fallback;
};

export const resolveTemplateGenderPool = (gender, templates = []) => {
  const customerGender = normalizeGenderValue(gender, "PREFER_NOT_TO_SAY");
  const normalizedTemplates = templates.map((template) => ({
    ...template,
    targetGender: normalizeGenderValue(template?.targetGender ?? "ANY", "ANY"),
  }));

  const directMatches = normalizedTemplates.filter((template) => template.targetGender === customerGender);
  if (directMatches.length) {
    return directMatches;
  }

  const anyMatches = normalizedTemplates.filter((template) => template.targetGender === "ANY");
  if (anyMatches.length) {
    return anyMatches;
  }

  if (["OTHER", "PREFER_NOT_TO_SAY"].includes(customerGender)) {
    return normalizedTemplates;
  }

  return normalizedTemplates;
};

const normalizeText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const buildLetterHtmlDocument = (content = "") => {
  const safeContent = escapeHtml(content || "").replace(/\n/g, "<br />");

  return `<!doctype html>
  <html lang="ne">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Personalized Story Letter</title>
      <style>
        @import url("https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap");
        @page { size: A4; margin: 18mm; }
        body {
          margin: 0;
          font-family: "Noto Sans Devanagari", "Noto Sans Nepali", "Mangal", "Arial", sans-serif;
          color: #111827;
          background: #ffffff;
          line-height: 1.75;
        }
        .letter-wrapper {
          max-width: 760px;
          margin: 0 auto;
          padding: 24px;
        }
        .letter-inner {
          white-space: pre-wrap;
          font-size: 14px;
          word-break: break-word;
        }
      </style>
    </head>
    <body>
      <div class="letter-wrapper">
        <div class="letter-inner">${safeContent}</div>
      </div>
    </body>
  </html>`;
};

export const buildPrintIdempotencyKey = ({ orderId, assignmentId = null, letterId = null }) => {
  const safeOrderId = normalizeText(orderId, "unknown-order");
  const safeAssignmentId = normalizeText(assignmentId, "assignment");
  const safeLetterId = normalizeText(letterId, "letter");

  return `PERSONALIZED_LETTER:${safeOrderId}:${safeAssignmentId}:${safeLetterId}`;
};

const stripSizeFromVariant = (value = "") => {
  const clean = normalizeText(value, "");
  if (!clean) return "";

  return clean
    .replace(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|SIZE|Sizes?)\b/gi, "")
    .replace(/[-_/|,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const resolveProductDisplayName = (product = {}, fallback = "सामान") => {
  const directName = normalizeText(product.nepaliName || product.nameNepali || product.name || "", "");
  return directName || fallback;
};

const resolveColorDisplayName = (colorValue = "", fallback = "रंग") => {
  const value = normalizeText(colorValue, "");
  if (!value) return fallback;
  return value;
};

const buildStoryOpening = (customerName, storyTitle, isFirstLetter, isLastLetter, isNewStory) => {
  if (isNewStory) return `${customerName} को लागि हाम्रो कथाको सुरुवात हुन्छ, र ${storyTitle} को पहिलो उज्यालो चम्किन्छ।`;
  if (isFirstLetter) return `${customerName} को लागि कथाको फेरि सुरुवात हुन्छ, र आशा र सम्भावना नयाँ ढंगले अघि बढ्छ।`;
  if (isLastLetter) return `${storyTitle} को अन्तिम अध्याय आइपुग्यो, र यो यात्रा शान्ति र आशा साथ समाप्त हुन्छ।`;
  return `${customerName} को कथा निरन्तर जारी छ, र ${storyTitle} को अर्को पन्ना नरम आशा साथ खुल्दछ।`;
};

export const buildRenderedTemplate = (templateBody, context) => {
  const customerFirstName = normalizeText(context.customer?.firstName || context.customer?.name || "Customer", "Customer");
  const customerLastName = normalizeText(context.customer?.lastName || "", "");
  const productName = resolveProductDisplayName(context.product || context.order?.product || {}, "सामान");
  const productVariantRaw = normalizeText(context.product?.variant || context.order?.productVariant || context.order?.variant || context.product?.variantLabel || "", "");
  const productVariant = stripSizeFromVariant(productVariantRaw);
  const productColor = resolveColorDisplayName(context.product?.color || context.order?.colorName || context.order?.color || "", "रंग");
  const storyTitle = normalizeText(context.story?.title || "कथा", "कथा");
  const letterTitle = normalizeText(context.letter?.title || "पत्र", "पत्र");
  const letterContent = normalizeText(context.letter?.content || "", "");
  const previousContinuity = normalizeText(context.previousLetter?.continuitySummary || context.previousLetter?.summary || "", "");
  const opening = normalizeText(context.opening || buildStoryOpening(customerFirstName, storyTitle, context.flags?.isFirstLetterOfStory, context.flags?.isLastLetterOfStory, context.flags?.isNewStory), "");
  const continuity = normalizeText(context.continuity || previousContinuity || "अगाडि बढ्दै कथाको धारणा नरम र आशावादी हुँदै जान्छ।", "अगाडि बढ्दै कथाको धारणा नरम र आशावादी हुँदै जान्छ।");
  const storyContent = normalizeText(context.story_content || letterContent || "कथा सन्तुलित र मनमोहक रूपमा विकास हुँदै छ।", "कथा सन्तुलित र मनमोहक रूपमा विकास हुँदै छ।");
  const closing = normalizeText(
    context.closing || `तपाईंले ${productColor} ${productName} चयन गर्नुभएकोमा हामीलाई विशेष खुशी लागेको छ। यो सामान तपाईको दैनिक जीवनमा सहजता, आत्मविश्वास र सन्तोष थप्नेछ।`,
    `तपाईंले ${productColor} ${productName} चयन गर्नुभएकोमा हामीलाई विशेष खुशी लागेको छ। यो सामान तपाईको दैनिक जीवनमा सहजता, आत्मविश्वास र सन्तोष थप्नेछ।`
  );
  const signature = normalizeText(context.signature || "प्रेम सहित,\nThe Aama Story Team", "प्रेम सहित,\nThe Aama Story Team");

  let output = templateBody;
  const replacements = {
    "{{customer.first_name}}": customerFirstName,
    "{{customer.last_name}}": customerLastName,
    "{{customer.display_name}}": `${customerFirstName} ${customerLastName}`.trim() || customerFirstName,
    "{{product.name}}": productName,
    "{{product.variant}}": productVariant,
    "{{product.color}}": productColor,
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
  const customer = await tx.user.findUnique({
    where: { id: customerId },
    select: { id: true, gender: true },
  });

  const activeTemplates = await tx.letterTemplate.findMany({
    where: { status: "ACTIVE" },
    orderBy: { selectionWeight: "desc" },
  });

  if (!activeTemplates.length) {
    return null;
  }

  const genderPool = resolveTemplateGenderPool(customer?.gender, activeTemplates);

  const recent = await tx.letterDelivery.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { templateId: true },
  });

  const recentIds = new Set(recent.map((item) => item.templateId).filter(Boolean));
  const candidates = genderPool.filter((template) => !recentIds.has(template.id));
  const pool = candidates.length ? candidates : genderPool;

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

export const resolveAssignmentProgression = ({ currentSequenceNumber, storyLength, nextStoryId = null }) => {
  const safeCurrentSequence = Number(currentSequenceNumber ?? 1);
  const safeStoryLength = Number(storyLength ?? safeCurrentSequence);
  const isFinalLetter = safeStoryLength > 0 && safeCurrentSequence >= safeStoryLength;

  return {
    isFinalLetter,
    shouldCompleteCurrentStory: isFinalLetter,
    nextSequenceNumber: isFinalLetter ? 1 : safeCurrentSequence + 1,
    nextStoryId,
  };
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

export const resolveOrderReference = async (orderIdOrAssignmentId, manufacturerId = null) => {
  if (!orderIdOrAssignmentId) {
    throw new Error("ORDER_NOT_FOUND");
  }

  const directOrder = await prisma.order.findUnique({
    where: { id: orderIdOrAssignmentId },
    select: {
      id: true,
      userId: true,
      manufacturerId: true,
      status: true,
      amount: true,
    },
  });

  if (directOrder) {
    if (manufacturerId && directOrder.manufacturerId && directOrder.manufacturerId !== manufacturerId) {
      throw new Error("PERMISSION_DENIED");
    }
    return { order: directOrder, orderId: directOrder.id };
  }

  const assignment = await prisma.orderAssignment.findUnique({
    where: { id: orderIdOrAssignmentId },
    select: {
      id: true,
      orderId: true,
      manufacturerId: true,
      status: true,
    },
  });

  if (!assignment) {
    throw new Error("ORDER_NOT_FOUND");
  }

  if (manufacturerId && assignment.manufacturerId !== manufacturerId) {
    throw new Error("PERMISSION_DENIED");
  }

  const assignedOrder = await prisma.order.findUnique({
    where: { id: assignment.orderId },
    select: {
      id: true,
      userId: true,
      manufacturerId: true,
      status: true,
      amount: true,
    },
  });

  if (!assignedOrder) {
    throw new Error("ORDER_NOT_FOUND");
  }

  return { order: assignedOrder, orderId: assignedOrder.id, assignment };
};

export const getPersonalizedLetterStatus = async (orderId, manufacturerId) => {
  await ensureDefaultStorySeed();

  const { order } = await resolveOrderReference(orderId, manufacturerId);

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

  const { order } = await resolveOrderReference(orderId, manufacturerId);

  const existing = await prisma.letterDelivery.findFirst({
    where: {
      OR: [{ orderId }, { idempotencyKey: idempotencyKey || buildPrintIdempotencyKey({ orderId }) }],
    },
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

    const storyLetterCount = await tx.storyLetter.count({
      where: { storyId: story.id, status: "ACTIVE" },
    });

    if (storyLetterCount === 0) {
      await ensureLetterRecords(story.id);
    }

    let nextLetter = await tx.storyLetter.findFirst({
      where: {
        storyId: story.id,
        sequenceNumber: assignment.nextSequenceNumber || 1,
        status: "ACTIVE",
      },
    });

    if (!nextLetter) {
      const progression = resolveAssignmentProgression({
        currentSequenceNumber: assignment.nextSequenceNumber || 1,
        storyLength: storyLetterCount || 1,
      });

      await tx.customerStoryAssignment.update({
        where: { id: assignment.id },
        data: {
          status: progression.shouldCompleteCurrentStory ? "COMPLETED" : "ACTIVE",
          completedAt: progression.shouldCompleteCurrentStory ? new Date() : null,
          nextSequenceNumber: progression.nextSequenceNumber,
        },
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
        where: { storyId: story.id, sequenceNumber: 1, status: "ACTIVE" },
      });
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

    const firstOrderItem = Array.isArray(order.items) ? order.items[0] : null;
    const productId = firstOrderItem?.productId || firstOrderItem?._id || firstOrderItem?.id || "";
    let productRecord = null;
    if (productId) {
      productRecord = await tx.product.findUnique({
        where: { id: productId },
        select: { name: true, nepaliName: true },
      });
    }

    const productDisplayName = resolveProductDisplayName(
      {
        name: productRecord?.name || firstOrderItem?.name || firstOrderItem?.productName || "सामान",
        nepaliName: productRecord?.nepaliName || firstOrderItem?.nepaliName || firstOrderItem?.productNepaliName || firstOrderItem?.product?.nepaliName || "",
      },
      "सामान"
    );
    const variantDisplayName = stripSizeFromVariant(
      normalizeText(
        firstOrderItem?.variant || firstOrderItem?.variantName || firstOrderItem?.variantLabel || firstOrderItem?.color || "",
        ""
      )
    );
    const colorDisplayName = resolveColorDisplayName(
      firstOrderItem?.colorNepaliName || firstOrderItem?.colorNameNepali || firstOrderItem?.color || "",
      "रंग"
    );

    const renderedContent = buildRenderedTemplate(template.body || defaultLetterBody, {
      customer,
      product: {
        name: productDisplayName,
        nepaliName: productDisplayName,
        variant: variantDisplayName,
        variantLabel: variantDisplayName,
        color: colorDisplayName,
      },
      order: {
        id: order.id,
        productName: productDisplayName,
        productVariant: variantDisplayName,
        colorName: colorDisplayName,
      },
      ...({
        story: { id: story.id, title: story.title },
        letter: nextLetter,
        previousLetter: previousDelivery ? { continuitySummary: previousDelivery.renderedContent || "" } : null,
        opening: buildStoryOpening(customerFirstNameText(customer), story.title, assignment.nextSequenceNumber === 1, false, assignment.nextSequenceNumber === 1),
        continuity: previousDelivery ? "अघिल्लो पटक कथाले शान्त विश्वास र आशाको साथरहेर अगाडि बढ्यो।" : "कथाको यो नयाँ अध्याय सुरु हुन्छ।",
        story_content: nextLetter.content,
        closing: `तपाईंले ${productDisplayName}${variantDisplayName ? ` ${variantDisplayName}` : ""} चयन गर्नुभएकोमा हामीलाई विशेष खुशी लागेको छ।`,
        signature: "प्रेम सहित,\nThe Aama Story Team",
      }),
      flags: {
        isFirstLetterOfStory: assignment.nextSequenceNumber === 1,
        isLastLetterOfStory: false,
        isNewStory: assignment.nextSequenceNumber === 1,
      },
    });

    const deterministicIdempotencyKey = idempotencyKey || buildPrintIdempotencyKey({
      orderId: order.id,
      assignmentId: assignment.id,
      letterId: nextLetter.id,
    });

    const duplicateAllocation = await tx.letterDelivery.findFirst({
      where: {
        OR: [{ idempotencyKey: deterministicIdempotencyKey }, { orderId: order.id }],
      },
      include: {
        story: true,
        storyLetter: true,
        template: true,
        templateVersion: true,
      },
    });

    if (duplicateAllocation) {
      return {
        success: true,
        data: {
          id: duplicateAllocation.id,
          status: duplicateAllocation.status,
          orderId: duplicateAllocation.orderId,
          story: { id: duplicateAllocation.story.id, title: duplicateAllocation.story.title },
          letter: { id: duplicateAllocation.storyLetter.id, sequenceNumber: duplicateAllocation.storyLetter.sequenceNumber, title: duplicateAllocation.storyLetter.title },
          template: { id: duplicateAllocation.template.id, name: duplicateAllocation.template.name },
          renderedContent: duplicateAllocation.renderedContent,
          renderedHtml: duplicateAllocation.renderedHtml,
        },
      };
    }

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
        idempotencyKey: deterministicIdempotencyKey,
        status: "PRINTED",
        reservedAt: new Date(),
        printedAt: new Date(),
        renderedContent,
        renderedHtml: buildLetterHtmlDocument(renderedContent),
      },
      include: {
        story: true,
        storyLetter: true,
        template: true,
        templateVersion: true,
      },
    });

    const finalProgress = resolveAssignmentProgression({
      currentSequenceNumber: nextLetter.sequenceNumber,
      storyLength: await tx.storyLetter.count({ where: { storyId: story.id, status: "ACTIVE" } }),
      nextStoryId: null,
    });

    if (finalProgress.shouldCompleteCurrentStory) {
      await tx.customerStoryAssignment.update({
        where: { id: assignment.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          nextSequenceNumber: 1,
        },
      });

      const nextStory = await resolveNextStoryForCustomer(tx, customer.id, story.id);
      if (nextStory) {
        await tx.customerStoryAssignment.create({
          data: {
            customerId: customer.id,
            storyId: nextStory.id,
            status: "ACTIVE",
            nextSequenceNumber: 1,
            startedAt: new Date(),
          },
        });
      }
    } else {
      await tx.customerStoryAssignment.update({
        where: { id: assignment.id },
        data: {
          nextSequenceNumber: finalProgress.nextSequenceNumber,
          status: "ACTIVE",
          completedAt: null,
        },
      });
    }

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
