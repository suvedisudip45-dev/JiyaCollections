-- CreateTable
CREATE TABLE `AuthAccount` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `accountLockedUntil` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `passwordResetLastRequestedAt` DATETIME(3) NULL,
    `passwordResetMonthlyKey` VARCHAR(7) NULL,
    `passwordResetMonthlyCount` INTEGER NOT NULL DEFAULT 0,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(64) NULL,
    `isEmailVerified` BOOLEAN NOT NULL DEFAULT false,
    `isPhoneVerified` BOOLEAN NOT NULL DEFAULT false,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuthAccount_email_key`(`email`),
    UNIQUE INDEX `AuthAccount_phone_key`(`phone`),
    INDEX `AuthAccount_email_idx`(`email`),
    INDEX `AuthAccount_phone_idx`(`phone`),
    INDEX `AuthAccount_role_status_idx`(`role`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `portalScope` VARCHAR(32) NOT NULL DEFAULT 'ADMIN',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_code_key`(`code`),
    INDEX `Role_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Permission_code_key`(`code`),
    INDEX `Permission_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermissionMapping` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RolePermissionMapping_roleId_idx`(`roleId`),
    INDEX `RolePermissionMapping_permissionId_idx`(`permissionId`),
    UNIQUE INDEX `RolePermissionMapping_roleId_permissionId_key`(`roleId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthAccountRoleMapping` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuthAccountRoleMapping_accountId_isActive_idx`(`accountId`, `isActive`),
    INDEX `AuthAccountRoleMapping_roleId_isActive_idx`(`roleId`, `isActive`),
    UNIQUE INDEX `AuthAccountRoleMapping_accountId_roleId_key`(`accountId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthSession` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `tokenFamilyId` VARCHAR(64) NOT NULL,
    `jti` VARCHAR(128) NOT NULL,
    `tokenType` VARCHAR(191) NOT NULL DEFAULT 'ACCESS',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedByTokenId` VARCHAR(128) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdIp` VARCHAR(64) NULL,
    `lastUsedIp` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `revocationReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuthSession_jti_key`(`jti`),
    INDEX `AuthSession_accountId_tokenType_revokedAt_idx`(`accountId`, `tokenType`, `revokedAt`),
    INDEX `AuthSession_tokenFamilyId_idx`(`tokenFamilyId`),
    INDEX `AuthSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtpChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `destination` VARCHAR(255) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'SMS',
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'LOGIN',
    `codeHash` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lastSentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,
    `isInvalidated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtpChallenge_destination_purpose_isInvalidated_idx`(`destination`, `purpose`, `isInvalidated`),
    INDEX `OtpChallenge_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminTwoFactorChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `targetPortal` VARCHAR(32) NOT NULL DEFAULT 'ADMIN',
    `purpose` VARCHAR(32) NOT NULL DEFAULT 'ADMIN_LOGIN',
    `method` VARCHAR(16) NULL,
    `otpHash` VARCHAR(64) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `resendCount` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSentAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `notificationId` VARCHAR(191) NULL,
    `requestIp` VARCHAR(64) NULL,
    `userAgentHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminTwoFactorChallenge_notificationId_key`(`notificationId`),
    INDEX `AdminTwoFactorChallenge_accountId_status_createdAt_idx`(`accountId`, `status`, `createdAt`),
    INDEX `AdminTwoFactorChallenge_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `identifier` VARCHAR(255) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NULL,
    `portal` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `status` VARCHAR(191) NOT NULL,
    `failureReason` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthAuditLog_identifier_createdAt_idx`(`identifier`, `createdAt`),
    INDEX `AuthAuditLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AuthAuditLog_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccessManagementAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorAccountId` VARCHAR(191) NULL,
    `targetAccountId` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccessManagementAuditLog_actorAccountId_createdAt_idx`(`actorAccountId`, `createdAt`),
    INDEX `AccessManagementAuditLog_targetAccountId_createdAt_idx`(`targetAccountId`, `createdAt`),
    INDEX `AccessManagementAuditLog_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `outboxId` VARCHAR(36) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(32) NULL,
    `action` VARCHAR(120) NOT NULL,
    `entityType` VARCHAR(80) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `beforeState` JSON NULL,
    `afterState` JSON NULL,
    `portalSource` VARCHAR(32) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'SUCCESS',
    `failureReason` VARCHAR(255) NULL,
    `correlationId` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SystemAuditLog_outboxId_key`(`outboxId`),
    INDEX `SystemAuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `SystemAuditLog_actorId_idx`(`actorId`),
    INDEX `SystemAuditLog_createdAt_idx`(`createdAt`),
    INDEX `SystemAuditLog_correlationId_idx`(`correlationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemAuditOutbox` (
    `id` VARCHAR(36) NOT NULL,
    `event` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimedAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SystemAuditOutbox_status_availableAt_createdAt_idx`(`status`, `availableAt`, `createdAt`),
    INDEX `SystemAuditOutbox_claimedAt_idx`(`claimedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `notificationType` VARCHAR(64) NOT NULL DEFAULT 'GENERAL',
    `channel` VARCHAR(16) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    `recipientName` VARCHAR(160) NULL,
    `recipientAddress` VARCHAR(255) NOT NULL,
    `subject` VARCHAR(255) NULL,
    `template` VARCHAR(120) NULL,
    `payload` JSON NULL,
    `provider` VARCHAR(64) NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `nextRetryAt` DATETIME(3) NULL,
    `lastAttemptAt` DATETIME(3) NULL,
    `queuedAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `failureCode` VARCHAR(120) NULL,
    `failureReason` TEXT NULL,
    `claimToken` VARCHAR(64) NULL,
    `claimExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Notification_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Notification_status_nextRetryAt_idx`(`status`, `nextRetryAt`),
    INDEX `Notification_channel_status_createdAt_idx`(`channel`, `status`, `createdAt`),
    INDEX `Notification_provider_providerMessageId_idx`(`provider`, `providerMessageId`),
    INDEX `Notification_status_claimExpiresAt_idx`(`status`, `claimExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `notificationId` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `provider` VARCHAR(64) NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `requestStartedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestFinishedAt` DATETIME(3) NULL,
    `httpStatus` INTEGER NULL,
    `providerStatus` VARCHAR(120) NULL,
    `providerErrorCode` VARCHAR(120) NULL,
    `providerErrorMessage` TEXT NULL,
    `failureCategory` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationAttempt_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `NotificationAttempt_provider_providerMessageId_idx`(`provider`, `providerMessageId`),
    UNIQUE INDEX `NotificationAttempt_notificationId_attemptNumber_key`(`notificationId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationEvent` (
    `id` VARCHAR(191) NOT NULL,
    `notificationId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(64) NULL,
    `providerEventId` VARCHAR(191) NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `eventTimestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `payloadHash` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationEvent_notificationId_eventTimestamp_idx`(`notificationId`, `eventTimestamp`),
    INDEX `NotificationEvent_provider_providerMessageId_idx`(`provider`, `providerMessageId`),
    UNIQUE INDEX `NotificationEvent_provider_providerEventId_key`(`provider`, `providerEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `notificationId` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `routingKey` VARCHAR(80) NOT NULL,
    `payload` JSON NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseToken` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `NotificationOutbox_eventKey_key`(`eventKey`),
    INDEX `NotificationOutbox_publishedAt_nextAttemptAt_leaseExpiresAt_idx`(`publishedAt`, `nextAttemptAt`, `leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncomingSms` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(64) NOT NULL DEFAULT 'SPARROW',
    `providerMessageId` VARCHAR(191) NULL,
    `fromNumber` VARCHAR(64) NOT NULL,
    `toShortCode` VARCHAR(64) NOT NULL,
    `keyword` VARCHAR(64) NULL,
    `text` VARCHAR(1600) NOT NULL,
    `payloadHash` VARCHAR(128) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processingStatus` VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    `processedAt` DATETIME(3) NULL,
    `replyText` VARCHAR(160) NULL,
    `replyStatus` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IncomingSms_provider_payloadHash_receivedAt_idx`(`provider`, `payloadHash`, `receivedAt`),
    INDEX `IncomingSms_processingStatus_receivedAt_idx`(`processingStatus`, `receivedAt`),
    UNIQUE INDEX `IncomingSms_provider_providerMessageId_key`(`provider`, `providerMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `isDisabled` BOOLEAN NOT NULL DEFAULT false,
    `disabledAt` DATETIME(3) NULL,
    `disabledBy` VARCHAR(191) NULL,
    `disabledReason` TEXT NULL,
    `firstName` VARCHAR(191) NULL DEFAULT '',
    `lastName` VARCHAR(191) NULL DEFAULT '',
    `phone` VARCHAR(191) NULL DEFAULT '',
    `gender` VARCHAR(191) NULL DEFAULT 'PREFER_NOT_TO_SAY',
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL DEFAULT '',
    `socialCustomerCode` VARCHAR(191) NULL,
    `socialCustomerPhone` VARCHAR(191) NULL DEFAULT '',
    `loyaltyTier` VARCHAR(191) NULL DEFAULT '',
    `isInactiveProfile` BOOLEAN NOT NULL DEFAULT false,
    `inactiveProfileData` JSON NOT NULL,
    `cartData` JSON NOT NULL,
    `addresses` JSON NOT NULL,

    UNIQUE INDEX `User_accountId_key`(`accountId`),
    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_socialCustomerCode_key`(`socialCustomerCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Story` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `assignmentEnabled` BOOLEAN NOT NULL DEFAULT true,
    `allowNewCustomers` BOOLEAN NOT NULL DEFAULT true,
    `allowAfterCompletion` BOOLEAN NOT NULL DEFAULT true,
    `assignmentWeight` DOUBLE NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Story_status_assignmentEnabled_idx`(`status`, `assignmentEnabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoryLetter` (
    `id` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `sequenceNumber` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `continuitySummary` TEXT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoryLetter_storyId_sequenceNumber_idx`(`storyId`, `sequenceNumber`),
    UNIQUE INDEX `StoryLetter_storyId_sequenceNumber_key`(`storyId`, `sequenceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LetterTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `targetGender` VARCHAR(191) NOT NULL DEFAULT 'ANY',
    `selectionWeight` DOUBLE NOT NULL DEFAULT 1,
    `repetitionWindow` INTEGER NULL DEFAULT 3,
    `body` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LetterTemplate_status_idx`(`status`),
    INDEX `LetterTemplate_targetGender_status_idx`(`targetGender`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LetterTemplateVersion` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LetterTemplateVersion_templateId_idx`(`templateId`),
    UNIQUE INDEX `LetterTemplateVersion_templateId_versionNumber_key`(`templateId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerStoryAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `nextSequenceNumber` INTEGER NOT NULL DEFAULT 1,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerStoryAssignment_customerId_status_idx`(`customerId`, `status`),
    INDEX `CustomerStoryAssignment_storyId_status_idx`(`storyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LetterDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `customerStoryAssignmentId` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `storyLetterId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateVersionId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RESERVED',
    `reservedAt` DATETIME(3) NULL,
    `printedAt` DATETIME(3) NULL,
    `packedAt` DATETIME(3) NULL,
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `renderedContent` TEXT NULL,
    `renderedHtml` TEXT NULL,
    `renderedDocumentUrl` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LetterDelivery_orderId_key`(`orderId`),
    UNIQUE INDEX `LetterDelivery_idempotencyKey_key`(`idempotencyKey`),
    INDEX `LetterDelivery_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `LetterDelivery_storyId_createdAt_idx`(`storyId`, `createdAt`),
    INDEX `LetterDelivery_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nepaliName` VARCHAR(191) NULL DEFAULT '',
    `description` TEXT NOT NULL,
    `price` DOUBLE NOT NULL,
    `image` JSON NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `subCategory` VARCHAR(191) NOT NULL,
    `sizes` JSON NOT NULL,
    `colors` JSON NOT NULL,
    `colorImages` JSON NOT NULL,
    `variants` JSON NOT NULL,
    `bestseller` BOOLEAN NOT NULL DEFAULT false,
    `newInStore` BOOLEAN NOT NULL DEFAULT false,
    `showInNavigation` BOOLEAN NOT NULL DEFAULT false,
    `isUnisex` BOOLEAN NOT NULL DEFAULT false,
    `isSpecialOffer` BOOLEAN NOT NULL DEFAULT false,
    `offerTag` VARCHAR(191) NULL DEFAULT '',
    `offerEndDate` DATETIME(3) NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `costPrice` DOUBLE NOT NULL DEFAULT 0,
    `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    `lowStockThreshold` INTEGER NOT NULL DEFAULT 5,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `date` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Product_published_idx`(`published`),
    INDEX `Product_category_idx`(`category`),
    INDEX `Product_bestseller_idx`(`bestseller`),
    INDEX `Product_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboBundle` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `color` VARCHAR(191) NULL DEFAULT '',
    `image` TEXT NULL,
    `bannerImage` TEXT NULL,
    `calculatedPrice` DOUBLE NOT NULL DEFAULT 0,
    `sellingPrice` DOUBLE NOT NULL DEFAULT 0,
    `discountPercentage` DOUBLE NOT NULL DEFAULT 0,
    `manualPriceOverride` BOOLEAN NOT NULL DEFAULT false,
    `priceReviewRequired` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComboBundle_slug_key`(`slug`),
    INDEX `ComboBundle_status_idx`(`status`),
    INDEX `ComboBundle_slug_idx`(`slug`),
    INDEX `ComboBundle_categoryId_status_idx`(`categoryId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboBundleProduct` (
    `id` VARCHAR(191) NOT NULL,
    `comboBundleId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `selectedColor` VARCHAR(100) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ComboBundleProduct_comboBundleId_idx`(`comboBundleId`),
    INDEX `ComboBundleProduct_productId_idx`(`productId`),
    UNIQUE INDEX `ComboBundleProduct_comboBundleId_productId_key`(`comboBundleId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `items` JSON NOT NULL,
    `amount` DOUBLE NOT NULL,
    `deliveryFee` DOUBLE NOT NULL DEFAULT 0,
    `address` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Order Placed',
    `paymentMethod` VARCHAR(191) NOT NULL,
    `payment` BOOLEAN NOT NULL DEFAULT false,
    `date` BIGINT NOT NULL,
    `checkoutGroupId` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `loyaltyDiscount` DOUBLE NULL DEFAULT 0,
    `rewardApplied` JSON NULL,
    `specialOrder` BOOLEAN NOT NULL DEFAULT false,
    `specialOrderReason` TEXT NULL,
    `specialOrderManufacturerIds` JSON NULL,
    `fulfillmentStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    `assignmentId` VARCHAR(191) NULL,
    `deliveryJobId` VARCHAR(191) NULL,
    `orderType` VARCHAR(191) NOT NULL DEFAULT 'ONLINE_STORE',
    `directOrderType` VARCHAR(191) NULL DEFAULT '',
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `assignedGiftId` VARCHAR(191) NULL,
    `assignedGiftInventoryId` VARCHAR(191) NULL,
    `assignedDistributorGiftInventoryId` VARCHAR(191) NULL,
    `giftStatus` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `locationDiscountManufacturerId` VARCHAR(191) NULL,
    `locationDiscountProvince` VARCHAR(120) NULL,
    `locationDiscountDistrict` VARCHAR(120) NULL,
    `locationPricingSnapshot` JSON NULL,
    `directNotes` TEXT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancellationReason` TEXT NULL,
    `cancelledByUserId` VARCHAR(191) NULL,
    `marketingCardRequired` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Order_fulfillmentStatus_idx`(`fulfillmentStatus`),
    INDEX `Order_userId_idx`(`userId`),
    INDEX `Order_orderType_idx`(`orderType`),
    INDEX `Order_manufacturerId_idx`(`manufacturerId`),
    INDEX `Order_distributorId_idx`(`distributorId`),
    INDEX `Order_date_idx`(`date`),
    INDEX `Order_checkoutGroupId_idx`(`checkoutGroupId`),
    INDEX `Order_updatedAt_idx`(`updatedAt`),
    INDEX `Order_status_idx`(`status`),
    INDEX `Order_payment_idx`(`payment`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorReview` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorReview_orderId_key`(`orderId`),
    INDEX `DistributorReview_distributorId_createdAt_idx`(`distributorId`, `createdAt`),
    INDEX `DistributorReview_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Category_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `image` TEXT NULL,
    `categoryId` VARCHAR(191) NULL,

    INDEX `SubCategory_categoryId_idx`(`categoryId`),
    UNIQUE INDEX `SubCategory_categoryId_name_key`(`categoryId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Color` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nepaliName` VARCHAR(191) NULL DEFAULT '',

    UNIQUE INDEX `Color_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Review` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL DEFAULT '',
    `comment` TEXT NOT NULL,
    `likes` JSON NOT NULL,
    `dislikes` JSON NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT true,
    `date` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShippingConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `sameDistrictFee` DOUBLE NOT NULL DEFAULT 50,
    `differentDistrictFee` DOUBLE NOT NULL DEFAULT 120,
    `sameProvinceFee` DOUBLE NOT NULL DEFAULT 120,
    `differentProvinceFee` DOUBLE NOT NULL DEFAULT 120,
    `sameProvinceDoorToDoorFee` DOUBLE NOT NULL DEFAULT 120,
    `sameProvinceDoorToHubFee` DOUBLE NOT NULL DEFAULT 120,
    `differentProvinceDoorToDoorFee` DOUBLE NOT NULL DEFAULT 120,
    `differentProvinceDoorToHubFee` DOUBLE NOT NULL DEFAULT 120,
    `routeOverrides` JSON NOT NULL,
    `splitShipmentFee` DOUBLE NOT NULL DEFAULT 200,
    `splitShipmentDoorToDoorFee` DOUBLE NOT NULL DEFAULT 200,
    `splitShipmentDoorToHubFee` DOUBLE NOT NULL DEFAULT 200,
    `freeShippingMin` DOUBLE NULL DEFAULT 0,
    `ncmReturnSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    `ncmExchangeSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    `distributorReturnSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    `distributorExchangeSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    `customerReturnChargeRate` DOUBLE NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformFeatureConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `loyaltyEnabled` BOOLEAN NOT NULL DEFAULT false,
    `marketingCardsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `lettersEnabled` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerLevel` (
    `id` VARCHAR(191) NOT NULL,
    `levelNumber` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉',
    `color` VARCHAR(191) NOT NULL DEFAULT '#CD7F32',
    `minSpend` DOUBLE NOT NULL DEFAULT 0,
    `minOrders` INTEGER NOT NULL DEFAULT 0,
    `rewardType` VARCHAR(191) NOT NULL DEFAULT 'CUSTOM',
    `rewardValue` DOUBLE NULL DEFAULT 0,
    `rewardTitle` VARCHAR(191) NOT NULL DEFAULT 'Welcome Reward',
    `rewardDescription` TEXT NULL,
    `rewardOrderLimit` INTEGER NOT NULL DEFAULT 3,
    `freeShipping` BOOLEAN NOT NULL DEFAULT false,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `giftAmount` DOUBLE NOT NULL DEFAULT 0,
    `giftDescription` VARCHAR(191) NULL DEFAULT '',
    `letterIncluded` BOOLEAN NOT NULL DEFAULT false,
    `customPerk` VARCHAR(191) NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerLevel_levelNumber_key`(`levelNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoyaltyTierConfig` (
    `id` VARCHAR(191) NOT NULL,
    `tierName` VARCHAR(191) NOT NULL,
    `triggerType` VARCHAR(191) NOT NULL DEFAULT 'ORDER_VALUE',
    `minSpendThreshold` DOUBLE NOT NULL DEFAULT 0,
    `giftTargetValue` DOUBLE NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LoyaltyTierConfig_tierName_key`(`tierName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GiftCatalog` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `priceValue` DOUBLE NOT NULL DEFAULT 0,
    `category` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GiftCatalog_sku_key`(`sku`),
    INDEX `GiftCatalog_isActive_category_idx`(`isActive`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerGiftInventory` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `giftId` VARCHAR(191) NOT NULL,
    `quantityAvailable` INTEGER NOT NULL DEFAULT 0,
    `quantityReserved` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ManufacturerGiftInventory_manufacturerId_status_idx`(`manufacturerId`, `status`),
    INDEX `ManufacturerGiftInventory_giftId_status_idx`(`giftId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GiftMovementLog` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `giftId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `movementType` VARCHAR(191) NOT NULL DEFAULT 'ALLOCATED',
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `uncostedQuantity` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GiftMovementLog_manufacturerId_createdAt_idx`(`manufacturerId`, `createdAt`),
    INDEX `GiftMovementLog_giftId_createdAt_idx`(`giftId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorGiftInventory` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `giftId` VARCHAR(191) NOT NULL,
    `quantitySent` INTEGER NOT NULL DEFAULT 0,
    `quantityAvailable` INTEGER NOT NULL DEFAULT 0,
    `quantityReserved` INTEGER NOT NULL DEFAULT 0,
    `receivedQuantity` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DistributorGiftInventory_distributorId_status_idx`(`distributorId`, `status`),
    INDEX `DistributorGiftInventory_giftId_status_idx`(`giftId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorGiftMovementLog` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `giftId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `movementType` VARCHAR(191) NOT NULL DEFAULT 'ALLOCATED',
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DistributorGiftMovementLog_distributorId_createdAt_idx`(`distributorId`, `createdAt`),
    INDEX `DistributorGiftMovementLog_giftId_createdAt_idx`(`giftId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GiftRewardEntitlement` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(32) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `rewardValue` DOUBLE NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `checkoutGroupId` VARCHAR(191) NULL,
    `marketingBenefitRedemptionId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `giftId` VARCHAR(191) NULL,
    `distributorGiftInventoryId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedAt` DATETIME(3) NULL,
    `fulfilledAt` DATETIME(3) NULL,

    UNIQUE INDEX `GiftRewardEntitlement_sourceKey_key`(`sourceKey`),
    UNIQUE INDEX `GiftRewardEntitlement_marketingBenefitRedemptionId_key`(`marketingBenefitRedemptionId`),
    UNIQUE INDEX `GiftRewardEntitlement_orderId_key`(`orderId`),
    INDEX `GiftRewardEntitlement_customerId_status_createdAt_idx`(`customerId`, `status`, `createdAt`),
    INDEX `GiftRewardEntitlement_checkoutGroupId_status_idx`(`checkoutGroupId`, `status`),
    INDEX `GiftRewardEntitlement_giftId_idx`(`giftId`),
    INDEX `GiftRewardEntitlement_distributorGiftInventoryId_idx`(`distributorGiftInventoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerLetterImage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL DEFAULT 'Letter / Handwritten Note',
    `notes` TEXT NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpecialOffer` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(191) NULL DEFAULT 'Exclusive festive deals and limited-time discounts',
    `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER',
    `bannerImage` VARCHAR(191) NULL DEFAULT '',
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `discount` DOUBLE NULL DEFAULT 0,
    `productIds` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLog` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `variantLabel` VARCHAR(191) NULL DEFAULT '',
    `previousQty` INTEGER NOT NULL,
    `newQty` INTEGER NOT NULL,
    `changeQty` INTEGER NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `orderId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL DEFAULT 'admin',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InboundShipment` (
    `id` VARCHAR(191) NOT NULL,
    `batchNumber` VARCHAR(191) NOT NULL,
    `supplierName` VARCHAR(191) NOT NULL DEFAULT '',
    `invoiceNumber` VARCHAR(191) NULL DEFAULT '',
    `carrier` VARCHAR(191) NOT NULL DEFAULT 'Local Freight',
    `shipmentDate` DATETIME(3) NOT NULL,
    `totalFreightCost` DOUBLE NOT NULL DEFAULT 0,
    `customsOrTaxes` DOUBLE NOT NULL DEFAULT 0,
    `totalItemsCost` DOUBLE NOT NULL DEFAULT 0,
    `totalLandedCost` DOUBLE NOT NULL DEFAULT 0,
    `paidFromAccountId` VARCHAR(191) NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `payableAmount` DOUBLE NOT NULL DEFAULT 0,
    `payableId` VARCHAR(191) NULL,
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'PAID',
    `notes` TEXT NULL,
    `items` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InboundShipment_batchNumber_key`(`batchNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonthlyExpense` (
    `id` VARCHAR(191) NOT NULL,
    `yearMonth` VARCHAR(191) NOT NULL,
    `marketingSpend` DOUBLE NOT NULL DEFAULT 0,
    `officeRent` DOUBLE NOT NULL DEFAULT 0,
    `utilities` DOUBLE NOT NULL DEFAULT 0,
    `salaries` DOUBLE NOT NULL DEFAULT 0,
    `softwareTools` DOUBLE NOT NULL DEFAULT 0,
    `packagingCostPerUnit` DOUBLE NOT NULL DEFAULT 20,
    `miscExpenses` DOUBLE NOT NULL DEFAULT 0,
    `projectedMonthlyUnits` INTEGER NOT NULL DEFAULT 300,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MonthlyExpense_yearMonth_key`(`yearMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Admin` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `displayName` VARCHAR(160) NOT NULL DEFAULT '',
    `firstName` VARCHAR(80) NULL,
    `lastName` VARCHAR(80) NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL DEFAULT '',
    `phone` VARCHAR(191) NULL DEFAULT '9846008536',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Admin_accountId_key`(`accountId`),
    UNIQUE INDEX `Admin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinancialAccount` (
    `id` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `accountType` VARCHAR(191) NOT NULL DEFAULT 'BANK',
    `accountNumber` VARCHAR(191) NULL DEFAULT '',
    `bankName` VARCHAR(191) NULL DEFAULT '',
    `currentBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `reservedBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NPR',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `accountingAccountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FinancialAccount_accountName_key`(`accountName`),
    INDEX `FinancialAccount_accountingAccountId_idx`(`accountingAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `externalPaymentReference` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `amount` DECIMAL(20, 2) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `fromAccountId` VARCHAR(191) NULL,
    `toAccountId` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL,
    `partyName` VARCHAR(191) NULL DEFAULT '',
    `invoiceNumber` VARCHAR(191) NULL DEFAULT '',
    `referenceId` VARCHAR(191) NULL DEFAULT '',
    `description` TEXT NULL,
    `receiptUrl` VARCHAR(191) NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CashTransaction_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CashTransaction_date_idx`(`date`),
    INDEX `CashTransaction_category_idx`(`category`),
    INDEX `CashTransaction_type_idx`(`type`),
    INDEX `CashTransaction_referenceId_idx`(`referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinancialPayout` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(32) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `financialAccountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `settlementAmount` DECIMAL(20, 2) NOT NULL,
    `adjustmentType` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `adjustmentAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(24) NOT NULL DEFAULT 'INITIATED',
    `externalPaymentReference` VARCHAR(191) NULL,
    `bankEvidenceReference` VARCHAR(191) NULL,
    `initiatedByAccountId` VARCHAR(191) NULL,
    `confirmedByAccountId` VARCHAR(191) NULL,
    `failedByAccountId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `failureReason` TEXT NULL,
    `initiatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FinancialPayout_idempotencyKey_key`(`idempotencyKey`),
    INDEX `FinancialPayout_targetType_targetId_status_idx`(`targetType`, `targetId`, `status`),
    INDEX `FinancialPayout_financialAccountId_status_idx`(`financialAccountId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FixedAsset` (
    `id` VARCHAR(191) NOT NULL,
    `assetName` VARCHAR(191) NOT NULL,
    `assetTag` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `vendorName` VARCHAR(191) NULL DEFAULT '',
    `invoiceNumber` VARCHAR(191) NULL DEFAULT '',
    `purchaseDate` DATETIME(3) NOT NULL,
    `purchaseCost` DOUBLE NOT NULL,
    `salvageValue` DOUBLE NOT NULL DEFAULT 0,
    `usefulLifeMonths` INTEGER NOT NULL DEFAULT 60,
    `depreciationMethod` VARCHAR(191) NOT NULL DEFAULT 'WRITTEN_DOWN_VALUE_SLAB',
    `depreciationRate` DOUBLE NOT NULL DEFAULT 25,
    `accumulatedDepreciation` DOUBLE NOT NULL DEFAULT 0,
    `currentBookValue` DOUBLE NOT NULL,
    `paidFromAccountId` VARCHAR(191) NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `payableAmount` DOUBLE NOT NULL DEFAULT 0,
    `payableId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `damageNotes` TEXT NULL,
    `disposalDate` DATETIME(3) NULL,
    `disposalAmount` DOUBLE NULL DEFAULT 0,
    `scrapLossAmount` DOUBLE NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FixedAsset_assetTag_key`(`assetTag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartnerEquity` (
    `id` VARCHAR(191) NOT NULL,
    `partnerName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL DEFAULT '',
    `role` VARCHAR(191) NOT NULL DEFAULT 'PARTNER',
    `shareCount` DOUBLE NOT NULL DEFAULT 0,
    `sharePrice` DOUBLE NOT NULL DEFAULT 100,
    `ownershipPercentage` DOUBLE NOT NULL,
    `initialCapital` DOUBLE NOT NULL DEFAULT 0,
    `currentCapital` DOUBLE NOT NULL DEFAULT 0,
    `totalDrawings` DOUBLE NOT NULL DEFAULT 0,
    `totalDistributionsReceived` DOUBLE NOT NULL DEFAULT 0,
    `isPrimaryPartner` BOOLEAN NOT NULL DEFAULT false,
    `investmentHistory` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PartnerEquity_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyValuation` (
    `id` VARCHAR(191) NOT NULL,
    `roundName` VARCHAR(191) NOT NULL,
    `effectiveDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `preMoneyValuation` DOUBLE NOT NULL DEFAULT 0,
    `investmentAmount` DOUBLE NOT NULL DEFAULT 0,
    `postMoneyValuation` DOUBLE NOT NULL DEFAULT 0,
    `totalPreShares` DOUBLE NOT NULL DEFAULT 0,
    `newSharesIssued` DOUBLE NOT NULL DEFAULT 0,
    `totalPostShares` DOUBLE NOT NULL DEFAULT 0,
    `sharePrice` DOUBLE NOT NULL DEFAULT 100,
    `valuationMethod` VARCHAR(191) NOT NULL DEFAULT 'EQUITY_ROUND',
    `leadInvestor` VARCHAR(191) NULL DEFAULT '',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShareTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `transactionType` VARCHAR(191) NOT NULL,
    `fromPartnerId` VARCHAR(191) NULL,
    `fromPartnerName` VARCHAR(191) NULL DEFAULT '',
    `toPartnerId` VARCHAR(191) NULL,
    `toPartnerName` VARCHAR(191) NULL DEFAULT '',
    `shareCount` DOUBLE NOT NULL,
    `sharePrice` DOUBLE NOT NULL DEFAULT 100,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `equityPercentageTransferred` DOUBLE NOT NULL DEFAULT 0,
    `depositAccountId` VARCHAR(191) NULL,
    `settlementType` VARCHAR(191) NOT NULL DEFAULT 'COMPANY_TREASURY',
    `valuationRoundId` VARCHAR(191) NULL DEFAULT '',
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfitDistribution` (
    `id` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `fiscalYear` VARCHAR(191) NOT NULL,
    `grossRevenue` DOUBLE NOT NULL DEFAULT 0,
    `netProfit` DOUBLE NOT NULL DEFAULT 0,
    `retainedEarningsPercentage` DOUBLE NOT NULL DEFAULT 20,
    `retainedAmount` DOUBLE NOT NULL DEFAULT 0,
    `distributableAmount` DOUBLE NOT NULL DEFAULT 0,
    `partnerBreakdown` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'APPROVED',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvestorLiability` (
    `id` VARCHAR(191) NOT NULL,
    `investorName` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NULL DEFAULT '',
    `contactEmail` VARCHAR(191) NULL DEFAULT '',
    `type` VARCHAR(191) NOT NULL,
    `loanType` VARCHAR(191) NULL DEFAULT 'TERM_LOAN',
    `principalAmount` DOUBLE NOT NULL,
    `principalPaid` DOUBLE NOT NULL DEFAULT 0,
    `interestPaid` DOUBLE NOT NULL DEFAULT 0,
    `totalInterestPayable` DOUBLE NOT NULL DEFAULT 0,
    `amountRepaid` DOUBLE NOT NULL DEFAULT 0,
    `outstandingBalance` DOUBLE NOT NULL,
    `interestRate` DOUBLE NOT NULL DEFAULT 0,
    `loanTermMonths` INTEGER NULL DEFAULT 12,
    `monthlyInstallment` DOUBLE NULL DEFAULT 0,
    `equityGrantedPercentage` DOUBLE NULL DEFAULT 0,
    `disbursementAccountId` VARCHAR(191) NULL DEFAULT '',
    `loanSchedule` JSON NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `maturityDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerReturn` (
    `id` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NULL,
    `requestHash` CHAR(64) NULL,
    `orderId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `deliveryRoute` VARCHAR(32) NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NULL DEFAULT '',
    `returnDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `items` JSON NOT NULL,
    `totalRefundAmount` DOUBLE NOT NULL DEFAULT 0,
    `vatRefunded` DOUBLE NOT NULL DEFAULT 0,
    `refundMethod` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `refundStatus` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `inventoryAction` VARCHAR(191) NOT NULL DEFAULT 'RESTOCKED',
    `reason` TEXT NOT NULL,
    `notes` TEXT NULL,
    `lifecycleStatus` VARCHAR(191) NOT NULL DEFAULT 'LEGACY_PROCESSED',
    `adminReviewerId` VARCHAR(191) NULL,
    `adminNotes` TEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `originalNcmOrderId` INTEGER NULL,
    `ncmReturnOrderId` INTEGER NULL,
    `ncmDeliveryCharge` DOUBLE NULL,
    `ncmChargeSource` VARCHAR(32) NULL,
    `ncmChargePayer` VARCHAR(16) NOT NULL DEFAULT 'MERCHANT',
    `logisticsSettlementAmount` DOUBLE NULL,
    `ncmSubmissionAttemptedAt` DATETIME(3) NULL,
    `ncmSubmissionError` TEXT NULL,
    `returnPickupStatus` VARCHAR(64) NULL,
    `returnPickupCompletedAt` DATETIME(3) NULL,
    `manufacturerReceivedAt` DATETIME(3) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `inspectionResult` VARCHAR(64) NULL,
    `inspectionEvidenceUrl` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `accountingJournalEntryId` VARCHAR(191) NULL,
    `taxCreditNoteNumber` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `refundPolicySnapshot` JSON NULL,
    `approvedRefundAmount` DECIMAL(20, 2) NULL,

    UNIQUE INDEX `CustomerReturn_requestKey_key`(`requestKey`),
    INDEX `CustomerReturn_lifecycleStatus_createdAt_idx`(`lifecycleStatus`, `createdAt`),
    INDEX `CustomerReturn_orderId_lifecycleStatus_idx`(`orderId`, `lifecycleStatus`),
    INDEX `CustomerReturn_distributorId_lifecycleStatus_idx`(`distributorId`, `lifecycleStatus`),
    INDEX `CustomerReturn_refundStatus_returnDate_idx`(`refundStatus`, `returnDate`),
    INDEX `CustomerReturn_distributorId_refundStatus_returnDate_idx`(`distributorId`, `refundStatus`, `returnDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderExchangeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NULL DEFAULT '',
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `settlementDistributorId` VARCHAR(191) NULL,
    `deliveryRoute` VARCHAR(32) NULL,
    `manufacturerName` VARCHAR(191) NULL,
    `cardId` VARCHAR(191) NULL,
    `reasonCode` VARCHAR(64) NOT NULL,
    `reasonDetails` TEXT NULL,
    `items` JSON NOT NULL,
    `replacementItems` JSON NULL,
    `exchangeType` VARCHAR(32) NOT NULL DEFAULT 'VARIANT_SWAP',
    `warrantyClaim` BOOLEAN NOT NULL DEFAULT false,
    `warrantyReason` VARCHAR(100) NULL,
    `originalTotalValue` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `replacementTotalValue` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `priceDifference` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `priceDifferenceSettlement` VARCHAR(32) NOT NULL DEFAULT 'NOT_APPLICABLE',
    `priceDifferenceCodAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `exchangeJournalEntryId` VARCHAR(191) NULL,
    `scrapJournalEntryId` VARCHAR(191) NULL,
    `taxCreditNoteNumber` VARCHAR(128) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `decisionActorId` VARCHAR(191) NULL,
    `decisionReason` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `ncmReturnOrderId` INTEGER NULL,
    `ncmReplacementOrderId` INTEGER NULL,
    `ncmReturnCharge` DOUBLE NULL,
    `ncmReplacementCharge` DOUBLE NULL,
    `ncmTotalCharge` DOUBLE NULL,
    `ncmChargePayer` VARCHAR(16) NOT NULL DEFAULT 'MERCHANT',
    `logisticsSettlementAmount` DOUBLE NULL,
    `replacementStockReservedAt` DATETIME(3) NULL,
    `replacementStockReleasedAt` DATETIME(3) NULL,
    `replacementStockConsumedAt` DATETIME(3) NULL,
    `ncmSubmissionAttemptedAt` DATETIME(3) NULL,
    `ncmSubmissionError` TEXT NULL,
    `returnPickupStatus` VARCHAR(64) NULL,
    `returnPickupCompletedAt` DATETIME(3) NULL,
    `replacementStatus` VARCHAR(64) NULL,
    `replacementDeliveredAt` DATETIME(3) NULL,
    `manufacturerReceivedAt` DATETIME(3) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `inspectionResult` VARCHAR(64) NULL,
    `inspectionNotes` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OrderExchangeRequest_requestKey_key`(`requestKey`),
    UNIQUE INDEX `OrderExchangeRequest_ncmReturnOrderId_key`(`ncmReturnOrderId`),
    UNIQUE INDEX `OrderExchangeRequest_ncmReplacementOrderId_key`(`ncmReplacementOrderId`),
    INDEX `OrderExchangeRequest_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `OrderExchangeRequest_orderId_status_idx`(`orderId`, `status`),
    INDEX `OrderExchangeRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `OrderExchangeRequest_cardId_status_idx`(`cardId`, `status`),
    INDEX `OrderExchangeRequest_distributorId_status_idx`(`distributorId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderExchangeEvent` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeRequestId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `fromStatus` VARCHAR(64) NULL,
    `toStatus` VARCHAR(64) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(32) NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OrderExchangeEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `OrderExchangeEvent_exchangeRequestId_occurredAt_idx`(`exchangeRequestId`, `occurredAt`),
    INDEX `OrderExchangeEvent_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerReturnEvent` (
    `id` VARCHAR(191) NOT NULL,
    `customerReturnId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `fromStatus` VARCHAR(64) NULL,
    `toStatus` VARCHAR(64) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(32) NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CustomerReturnEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CustomerReturnEvent_customerReturnId_occurredAt_idx`(`customerReturnId`, `occurredAt`),
    INDEX `CustomerReturnEvent_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnExchangeNcmAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `customerReturnId` VARCHAR(191) NULL,
    `exchangeRequestId` VARCHAR(191) NULL,
    `operation` VARCHAR(64) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `requestUrl` VARCHAR(191) NOT NULL,
    `requestJson` JSON NULL,
    `responseJson` JSON NULL,
    `httpStatus` INTEGER NULL,
    `result` VARCHAR(32) NOT NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ReturnExchangeNcmAttempt_idempotencyKey_key`(`idempotencyKey`),
    INDEX `RtnExNcmAttempt_return_op_num_idx`(`customerReturnId`, `operation`, `attemptNumber`),
    INDEX `RtnExNcmAttempt_exchange_op_num_idx`(`exchangeRequestId`, `operation`, `attemptNumber`),
    INDEX `ReturnExchangeNcmAttempt_result_startedAt_idx`(`result`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierReturn` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentBatchId` VARCHAR(191) NULL,
    `supplierName` VARCHAR(191) NOT NULL,
    `returnDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `items` JSON NOT NULL,
    `totalDebitAmount` DOUBLE NOT NULL DEFAULT 0,
    `vatReversal` DOUBLE NOT NULL DEFAULT 0,
    `settlementType` VARCHAR(191) NOT NULL DEFAULT 'CREDIT_NOTE_OFFSET_PAYABLE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `reason` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxConfiguration` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `fiscalYear` VARCHAR(191) NOT NULL DEFAULT '2082/2083',
    `vatRate` DOUBLE NOT NULL DEFAULT 13.0,
    `corporateTaxRate` DOUBLE NOT NULL DEFAULT 25.0,
    `taxSlabs` JSON NOT NULL,
    `autoDeductAdvanceTax` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VatRateVersion` (
    `id` VARCHAR(191) NOT NULL,
    `vatRate` DECIMAL(5, 2) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VatRateVersion_status_effectiveFrom_effectiveUntil_idx`(`status`, `effectiveFrom`, `effectiveUntil`),
    UNIQUE INDEX `VatRateVersion_effectiveFrom_key`(`effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxFilingRecord` (
    `id` VARCHAR(191) NOT NULL,
    `periodType` VARCHAR(191) NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `taxableSales` DOUBLE NOT NULL DEFAULT 0,
    `outputVat` DOUBLE NOT NULL DEFAULT 0,
    `taxablePurchases` DOUBLE NOT NULL DEFAULT 0,
    `inputVat` DOUBLE NOT NULL DEFAULT 0,
    `netVatPayable` DOUBLE NOT NULL DEFAULT 0,
    `grossRevenue` DOUBLE NOT NULL DEFAULT 0,
    `totalDeductions` DOUBLE NOT NULL DEFAULT 0,
    `depreciationDeduction` DOUBLE NOT NULL DEFAULT 0,
    `taxableIncome` DOUBLE NOT NULL DEFAULT 0,
    `calculatedTax` DOUBLE NOT NULL DEFAULT 0,
    `taxPaid` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `filedDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountPayable` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `payeeName` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'OPERATING_EXPENSE',
    `referenceType` VARCHAR(191) NULL DEFAULT 'MANUAL',
    `referenceId` VARCHAR(191) NULL DEFAULT '',
    `totalAmount` DECIMAL(20, 2) NOT NULL,
    `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `remainingBalance` DECIMAL(20, 2) NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `invoiceNumber` VARCHAR(191) NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'MEDIUM',
    `notes` TEXT NULL,
    `settlementHistory` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AccountPayable_status_idx`(`status`),
    INDEX `AccountPayable_dueDate_idx`(`dueDate`),
    INDEX `AccountPayable_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountReceivable` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `payerName` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER_RECEIVABLE',
    `referenceType` VARCHAR(191) NULL DEFAULT 'MANUAL',
    `referenceId` VARCHAR(191) NULL DEFAULT '',
    `totalAmount` DECIMAL(20, 2) NOT NULL,
    `receivedAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `remainingBalance` DECIMAL(20, 2) NOT NULL,
    `dueDate` DATETIME(3) NULL,
    `invoiceNumber` VARCHAR(191) NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `notes` TEXT NULL,
    `collectionHistory` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AccountReceivable_status_idx`(`status`),
    INDEX `AccountReceivable_dueDate_idx`(`dueDate`),
    INDEX `AccountReceivable_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `accountCode` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `accountType` VARCHAR(191) NOT NULL,
    `normalBalance` VARCHAR(191) NOT NULL,
    `parentAccountId` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `isSystemAccount` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `currentBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Account_accountCode_key`(`accountCode`),
    INDEX `Account_accountType_idx`(`accountType`),
    INDEX `Account_parentAccountId_idx`(`parentAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiscalYear` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `isClosed` BOOLEAN NOT NULL DEFAULT false,
    `closedAt` DATETIME(3) NULL,
    `closedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FiscalYear_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `fiscalYearId` VARCHAR(191) NOT NULL,
    `periodName` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountingPeriod_fiscalYearId_periodName_key`(`fiscalYearId`, `periodName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalEntry` (
    `id` VARCHAR(191) NOT NULL,
    `journalNumber` VARCHAR(191) NOT NULL,
    `transactionDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fiscalYearId` VARCHAR(191) NULL,
    `accountingPeriodId` VARCHAR(191) NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `referenceNumber` VARCHAR(191) NULL DEFAULT '',
    `description` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `reversedEntryId` VARCHAR(191) NULL,
    `reversalReason` TEXT NULL,
    `accountingEventId` VARCHAR(191) NULL,
    `totalDebit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `totalCredit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NULL DEFAULT 'system',
    `postedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JournalEntry_journalNumber_key`(`journalNumber`),
    UNIQUE INDEX `JournalEntry_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `JournalEntry_accountingEventId_key`(`accountingEventId`),
    INDEX `JournalEntry_transactionDate_idx`(`transactionDate`),
    INDEX `JournalEntry_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `JournalEntry_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalSequence` (
    `fiscalYear` INTEGER NOT NULL,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`fiscalYear`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalLine` (
    `id` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `accountingPartyId` VARCHAR(191) NULL,
    `debit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `description` TEXT NULL,
    `customerId` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL DEFAULT '',
    `supplierId` VARCHAR(191) NULL,
    `supplierName` VARCHAR(191) NULL DEFAULT '',
    `productId` VARCHAR(191) NULL,
    `assetId` VARCHAR(191) NULL,
    `costCenter` VARCHAR(191) NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JournalLine_journalEntryId_idx`(`journalEntryId`),
    INDEX `JournalLine_accountId_idx`(`accountId`),
    INDEX `JournalLine_customerId_idx`(`customerId`),
    INDEX `JournalLine_supplierId_idx`(`supplierId`),
    INDEX `JournalLine_accountingPartyId_createdAt_idx`(`accountingPartyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingParty` (
    `id` VARCHAR(191) NOT NULL,
    `partyType` VARCHAR(40) NOT NULL,
    `sourceEntityId` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(255) NULL,
    `displayName` VARCHAR(255) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NPR',
    `status` VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AccountingParty_partyType_status_idx`(`partyType`, `status`),
    INDEX `AccountingParty_displayName_idx`(`displayName`),
    UNIQUE INDEX `AccountingParty_partyType_sourceEntityId_key`(`partyType`, `sourceEntityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingAccountMapping` (
    `id` VARCHAR(191) NOT NULL,
    `mappingKey` VARCHAR(96) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountingAccountMapping_mappingKey_key`(`mappingKey`),
    INDEX `AccountingAccountMapping_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingEvent` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `sourceVersion` INTEGER NOT NULL DEFAULT 1,
    `eventType` VARCHAR(64) NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `payload` JSON NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `nextAttemptAt` DATETIME(3) NULL,
    `claimedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountingEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `AccountingEvent_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AcctEvent_source_event_status_retry_created_idx`(`sourceType`, `eventType`, `status`, `nextAttemptAt`, `createdAt`),
    INDEX `AccountingEvent_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `AccountingEvent_effectiveAt_idx`(`effectiveAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingDocument` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `documentType` VARCHAR(32) NOT NULL,
    `documentNumber` VARCHAR(64) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(16) NOT NULL,
    `sourceType` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `issueDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NPR',
    `originalAmount` DECIMAL(20, 2) NOT NULL,
    `allocatedAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `remainingAmount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountingDocument_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `AccountingDocument_documentNumber_key`(`documentNumber`),
    INDEX `AccountingDocument_partyId_side_status_idx`(`partyId`, `side`, `status`),
    INDEX `AccountingDocument_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `AccountingDocument_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `allocatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NULL,

    UNIQUE INDEX `AccountingAllocation_idempotencyKey_key`(`idempotencyKey`),
    INDEX `AccountingAllocation_documentId_allocatedAt_idx`(`documentId`, `allocatedAt`),
    INDEX `AccountingAllocation_journalEntryId_idx`(`journalEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierCreditApplication` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `creditDocumentId` VARCHAR(191) NOT NULL,
    `billDocumentId` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `appliedByAccountId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SupplierCreditApplication_idempotencyKey_key`(`idempotencyKey`),
    INDEX `SupplierCreditApplication_creditDocumentId_appliedAt_idx`(`creditDocumentId`, `appliedAt`),
    INDEX `SupplierCreditApplication_billDocumentId_appliedAt_idx`(`billDocumentId`, `appliedAt`),
    INDEX `SupplierCreditApplication_journalEntryId_idx`(`journalEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Manufacturer` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL DEFAULT '',
    `phone` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `ncmPickupBranch` VARCHAR(191) NULL DEFAULT '',
    `pickupBranchStatus` VARCHAR(191) NULL DEFAULT 'UNVERIFIED',
    `pickupBranchVerifiedAt` DATETIME(3) NULL,
    `pickupAddress` TEXT NULL,
    `pickupContactName` VARCHAR(191) NULL DEFAULT '',
    `pickupContactPhone` VARCHAR(191) NULL DEFAULT '',
    `pickupWindow` VARCHAR(191) NULL DEFAULT '',
    `returnInstructions` TEXT NULL,
    `address` TEXT NULL,
    `qualityRating` DOUBLE NOT NULL DEFAULT 5.0,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `contractStatus` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `distributorApplicationStatus` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `contractDocUrl` TEXT NULL,
    `contractStartDate` DATETIME(3) NULL,
    `contractExpiryDate` DATETIME(3) NULL,
    `agreementNotes` TEXT NULL,
    `totalOrdersFulfilled` INTEGER NOT NULL DEFAULT 0,
    `onTimeCount` INTEGER NOT NULL DEFAULT 0,
    `defectCount` INTEGER NOT NULL DEFAULT 0,
    `rejectionCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Manufacturer_accountId_key`(`accountId`),
    UNIQUE INDEX `Manufacturer_email_key`(`email`),
    INDEX `Manufacturer_city_idx`(`city`),
    INDEX `Manufacturer_isActive_isAvailable_idx`(`isActive`, `isAvailable`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Distributor` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(120) NULL,
    `province` VARCHAR(120) NULL,
    `district` VARCHAR(120) NULL,
    `qualityRating` DOUBLE NOT NULL DEFAULT 0,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `street` VARCHAR(191) NULL,
    `landmark` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `ncmPickupBranch` VARCHAR(191) NULL DEFAULT '',
    `pickupBranchStatus` VARCHAR(191) NULL DEFAULT 'UNVERIFIED',
    `pickupBranchVerifiedAt` DATETIME(3) NULL,
    `pickupAddress` TEXT NULL,
    `pickupContactName` VARCHAR(191) NULL DEFAULT '',
    `pickupContactPhone` VARCHAR(191) NULL DEFAULT '',
    `pickupWindow` VARCHAR(191) NULL DEFAULT '',
    `returnInstructions` TEXT NULL,
    `contractStartDate` DATETIME(3) NULL,
    `contractExpiryDate` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Distributor_accountId_key`(`accountId`),
    INDEX `Distributor_status_isActive_idx`(`status`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryOtpChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `activeOrderKey` VARCHAR(191) NULL,
    `notificationId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `collectionAmount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `requestIp` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryOtpChallenge_activeOrderKey_key`(`activeOrderKey`),
    UNIQUE INDEX `DeliveryOtpChallenge_notificationId_key`(`notificationId`),
    UNIQUE INDEX `DeliveryOtpChallenge_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DeliveryOtpChallenge_orderId_status_createdAt_idx`(`orderId`, `status`, `createdAt`),
    INDEX `DeliveryOtpChallenge_distributorId_status_createdAt_idx`(`distributorId`, `status`, `createdAt`),
    INDEX `DeliveryOtpChallenge_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorRemittanceBatch` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `financialAccountId` VARCHAR(191) NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reference` VARCHAR(191) NULL,
    `evidenceUrl` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `recordedByAccountId` VARCHAR(191) NULL,
    `reviewedByAccountId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorRemittanceBatch_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistributorRemittanceBatch_distributorId_status_receivedAt_idx`(`distributorId`, `status`, `receivedAt`),
    INDEX `DistributorRemittanceBatch_financialAccountId_receivedAt_idx`(`financialAccountId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorCashEvent` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `customerReturnId` VARCHAR(191) NULL,
    `orderExchangeRequestId` VARCHAR(191) NULL,
    `remittanceBatchId` VARCHAR(191) NULL,
    `accountingDocumentId` VARCHAR(191) NULL,
    `eventType` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `paymentMethod` VARCHAR(32) NULL,
    `externalReference` VARCHAR(191) NULL,
    `evidenceUrl` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedByAccountId` VARCHAR(191) NULL,
    `verifiedByAccountId` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `cashTransactionId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorCashEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistributorCashEvent_distributor_event_status_time_idx`(`distributorId`, `eventType`, `status`, `occurredAt`),
    INDEX `DistributorCashEvent_orderId_eventType_status_idx`(`orderId`, `eventType`, `status`),
    INDEX `DistributorCashEvent_customerReturnId_eventType_status_idx`(`customerReturnId`, `eventType`, `status`),
    INDEX `DistributorCashEvent_orderExchangeRequestId_eventType_status_idx`(`orderExchangeRequestId`, `eventType`, `status`),
    INDEX `DistributorCashEvent_remittanceBatchId_idx`(`remittanceBatchId`),
    INDEX `DistributorCashEvent_accountingDocumentId_status_idx`(`accountingDocumentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorSettlementOffset` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `approvedByAccountId` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DistributorSettlementOffset_journalEntryId_key`(`journalEntryId`),
    UNIQUE INDEX `DistributorSettlementOffset_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistributorSettlementOffset_distributorId_approvedAt_idx`(`distributorId`, `approvedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorLocation` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DistributorLocation_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `DistributorLocation_distributorId_isActive_idx`(`distributorId`, `isActive`),
    UNIQUE INDEX `DistributorLocation_distributorId_province_district_key`(`distributorId`, `province`, `district`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorDeliveryChargeNegotiation` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `deliveryCharge` DECIMAL(20, 2) NOT NULL,
    `returnCharge` DECIMAL(20, 2) NOT NULL,
    `commissionRate` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `bonusRate` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `incentiveRate` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13,
    `vatInclusive` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `proposedByRole` VARCHAR(32) NOT NULL,
    `proposedByAccountId` VARCHAR(191) NULL,
    `reviewedByAccountId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `effectiveFrom` DATETIME(3) NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DistDelChargeNeg_dist_status_from_idx`(`distributorId`, `status`, `effectiveFrom`),
    INDEX `DistributorDeliveryChargeNegotiation_productId_status_idx`(`productId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorServiceEarning` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `serviceType` VARCHAR(24) NOT NULL DEFAULT 'DELIVERY',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `rateCardId` VARCHAR(191) NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `deliveryCharge` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `incentiveAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `commissionAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `otherCharges` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatInvoiceVerified` BOOLEAN NOT NULL DEFAULT false,
    `payableAmount` DECIMAL(20, 2) NOT NULL,
    `accountingDocumentId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DistributorServiceEarning_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `DistributorServiceEarning_accountingDocumentId_key`(`accountingDocumentId`),
    INDEX `DistributorServiceEarning_distributorId_effectiveAt_idx`(`distributorId`, `effectiveAt`),
    INDEX `DistributorServiceEarning_orderId_serviceType_idx`(`orderId`, `serviceType`),
    INDEX `DistributorServiceEarning_assignmentId_serviceType_idx`(`assignmentId`, `serviceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorBonusPlan` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `periodType` VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
    `metric` VARCHAR(32) NOT NULL DEFAULT 'DELIVERED_ORDERS',
    `tiers` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DistributorBonusPlan_distributorId_status_effectiveFrom_idx`(`distributorId`, `status`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorBonusEarning` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `eligibleDeliveryCount` INTEGER NOT NULL,
    `bonusAmount` DECIMAL(20, 2) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `accountingDocumentId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DistributorBonusEarning_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `DistributorBonusEarning_accountingDocumentId_key`(`accountingDocumentId`),
    INDEX `DistributorBonusEarning_distributorId_periodEnd_idx`(`distributorId`, `periodEnd`),
    UNIQUE INDEX `DistributorBonusEarning_distributorId_periodStart_key`(`distributorId`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorSettlementRequest` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `externalPaymentReference` VARCHAR(191) NULL,
    `grossEarnings` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `incentives` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `bonuses` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `discountsApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `chargesApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `netPayable` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `adminNotes` TEXT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `financialAccountId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorSettlementRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistSettleReq_dist_status_reqAt_idx`(`distributorId`, `status`, `requestedAt`),
    INDEX `DistributorSettlementRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventorySku` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `size` VARCHAR(120) NOT NULL,
    `color` VARCHAR(120) NOT NULL,
    `sizeKey` VARCHAR(120) NOT NULL,
    `colorKey` VARCHAR(120) NOT NULL,
    `skuCode` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventorySku_skuCode_key`(`skuCode`),
    INDEX `InventorySku_productId_isActive_idx`(`productId`, `isActive`),
    UNIQUE INDEX `InventorySku_productId_sizeKey_colorKey_key`(`productId`, `sizeKey`, `colorKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryLocation` (
    `id` VARCHAR(191) NOT NULL,
    `locationKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `inventoryOwner` VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryLocation_locationKey_key`(`locationKey`),
    INDEX `InventoryLocation_kind_isActive_idx`(`kind`, `isActive`),
    INDEX `InventoryLocation_manufacturerId_kind_idx`(`manufacturerId`, `kind`),
    INDEX `InventoryLocation_distributorId_kind_idx`(`distributorId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryBalance` (
    `id` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `quantityOnHand` INTEGER NOT NULL DEFAULT 0,
    `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `InventoryBalance_inventorySkuId_idx`(`inventorySkuId`),
    UNIQUE INDEX `InventoryBalance_locationId_inventorySkuId_key`(`locationId`, `inventorySkuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryLedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `sourceLocationId` VARCHAR(191) NULL,
    `destinationLocationId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `movementType` VARCHAR(191) NOT NULL,
    `inventoryOwner` VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    `referenceType` VARCHAR(64) NULL,
    `referenceId` VARCHAR(191) NULL,
    `productionCostLayerId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(64) NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InventoryLedgerEntry_idempotencyKey_key`(`idempotencyKey`),
    INDEX `InventoryLedgerEntry_inventorySkuId_createdAt_idx`(`inventorySkuId`, `createdAt`),
    INDEX `InventoryLedgerEntry_sourceLocationId_createdAt_idx`(`sourceLocationId`, `createdAt`),
    INDEX `InventoryLedgerEntry_destinationLocationId_createdAt_idx`(`destinationLocationId`, `createdAt`),
    INDEX `InventoryLedgerEntry_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `sourceLocationId` VARCHAR(191) NOT NULL,
    `destinationLocationId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL',
    `requestedByAccountId` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedByAccountId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `adminNote` TEXT NULL,
    `availabilityPassed` BOOLEAN NOT NULL DEFAULT false,
    `qualityPassed` BOOLEAN NOT NULL DEFAULT false,
    `colorPassed` BOOLEAN NOT NULL DEFAULT false,
    `sizePassed` BOOLEAN NOT NULL DEFAULT false,
    `packagingPassed` BOOLEAN NOT NULL DEFAULT false,
    `preparedByAccountId` VARCHAR(191) NULL,
    `preparedAt` DATETIME(3) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockTransfer_manufacturerId_status_requestedAt_idx`(`manufacturerId`, `status`, `requestedAt`),
    INDEX `StockTransfer_distributorId_status_requestedAt_idx`(`distributorId`, `status`, `requestedAt`),
    INDEX `StockTransfer_status_requestedAt_idx`(`status`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferLine` (
    `id` VARCHAR(191) NOT NULL,
    `stockTransferId` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `requestedQuantity` INTEGER NOT NULL,
    `approvedQuantity` INTEGER NULL,
    `dispatchedQuantity` INTEGER NOT NULL DEFAULT 0,
    `reservedShipmentQuantity` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockTransferLine_inventorySkuId_idx`(`inventorySkuId`),
    UNIQUE INDEX `StockTransferLine_stockTransferId_inventorySkuId_key`(`stockTransferId`, `inventorySkuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferShipment` (
    `id` VARCHAR(191) NOT NULL,
    `stockTransferId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PREPARING',
    `bookingMode` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    `bookingIdempotencyKey` VARCHAR(191) NULL,
    `bookingRequestHash` VARCHAR(64) NULL,
    `deliveryPartner` VARCHAR(191) NULL,
    `trackingNumber` VARCHAR(191) NULL,
    `externalReference` VARCHAR(191) NULL,
    `ncmOrderId` VARCHAR(64) NULL,
    `freightCharge` DECIMAL(20, 2) NULL,
    `freightSettlementStatus` VARCHAR(64) NOT NULL DEFAULT 'PENDING_ADMIN_SETTLEMENT',
    `freightPaidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `packageWeight` DECIMAL(8, 3) NULL,
    `packageType` VARCHAR(64) NULL,
    `productType` VARCHAR(120) NULL,
    `productDescription` VARCHAR(300) NULL,
    `packageDimensions` VARCHAR(120) NULL,
    `isFragile` BOOLEAN NOT NULL DEFAULT false,
    `deliveryInstruction` VARCHAR(500) NULL,
    `packagingNotes` VARCHAR(500) NULL,
    `ncmStatus` VARCHAR(191) NULL,
    `ncmStatusHistory` JSON NULL,
    `ncmPaymentStatus` VARCHAR(64) NULL,
    `ncmLastSyncedAt` DATETIME(3) NULL,
    `ncmLastEventAt` DATETIME(3) NULL,
    `ncmReturnStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUESTED',
    `ncmReturnReason` TEXT NULL,
    `ncmReturnRequestedAt` DATETIME(3) NULL,
    `bookedAt` DATETIME(3) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockTransferShipment_bookingIdempotencyKey_key`(`bookingIdempotencyKey`),
    UNIQUE INDEX `StockTransferShipment_ncmOrderId_key`(`ncmOrderId`),
    INDEX `StockTransferShipment_stockTransferId_status_idx`(`stockTransferId`, `status`),
    INDEX `StockTransferShipment_trackingNumber_idx`(`trackingNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferShipmentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `occurredAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockTransferShipmentEvent_eventKey_key`(`eventKey`),
    INDEX `StockTransferShipmentEvent_shipmentId_occurredAt_idx`(`shipmentId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferShipmentLine` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `stockTransferLineId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `uncostedQuantity` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockTransferShipmentLine_stockTransferLineId_idx`(`stockTransferLineId`),
    UNIQUE INDEX `StockTransferShipmentLine_shipmentId_stockTransferLineId_key`(`shipmentId`, `stockTransferLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferShipmentLineCostLayer` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentLineId` VARCHAR(191) NOT NULL,
    `costLayerId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RESERVED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockTransferShipmentLineCostLayer_costLayerId_status_idx`(`costLayerId`, `status`),
    UNIQUE INDEX `STShipLineCostLayer_line_layer_key`(`shipmentLineId`, `costLayerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `requestHash` VARCHAR(64) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CONFIRMED',
    `receivedBy` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockTransferReceipt_idempotencyKey_key`(`idempotencyKey`),
    INDEX `StockTransferReceipt_shipmentId_receivedAt_idx`(`shipmentId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferReceiptLine` (
    `id` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NOT NULL,
    `shipmentLineId` VARCHAR(191) NOT NULL,
    `goodQuantity` INTEGER NOT NULL DEFAULT 0,
    `damagedQuantity` INTEGER NOT NULL DEFAULT 0,
    `missingQuantity` INTEGER NOT NULL DEFAULT 0,
    `damageType` VARCHAR(120) NULL,
    `evidence` JSON NULL,
    `note` TEXT NULL,

    INDEX `StockTransferReceiptLine_shipmentLineId_idx`(`shipmentLineId`),
    UNIQUE INDEX `StockTransferReceiptLine_receiptId_shipmentLineId_key`(`receiptId`, `shipmentLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryDiscrepancy` (
    `id` VARCHAR(191) NOT NULL,
    `stockTransferId` VARCHAR(191) NULL,
    `shipmentId` VARCHAR(191) NULL,
    `receiptId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `inventoryLocationId` VARCHAR(191) NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `discrepancyType` VARCHAR(191) NOT NULL,
    `custodyStage` VARCHAR(64) NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `reportedBy` VARCHAR(191) NULL,
    `reportedByRole` VARCHAR(64) NULL,
    `evidence` JSON NULL,
    `details` TEXT NULL,
    `financialResponsibleParty` VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    `idempotencyKey` VARCHAR(191) NULL,
    `responsiblePartyRole` VARCHAR(64) NULL,
    `responsiblePartyId` VARCHAR(191) NULL,
    `platformLossAmount` DECIMAL(20, 2) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryDiscrepancy_idempotencyKey_key`(`idempotencyKey`),
    INDEX `InventoryDiscrepancy_stockTransferId_status_createdAt_idx`(`stockTransferId`, `status`, `createdAt`),
    INDEX `InventoryDiscrepancy_distributorId_status_createdAt_idx`(`distributorId`, `status`, `createdAt`),
    INDEX `InventoryDiscrepancy_inventoryLocationId_status_idx`(`inventoryLocationId`, `status`),
    INDEX `InventoryDiscrepancy_shipmentId_status_idx`(`shipmentId`, `status`),
    INDEX `InventoryDiscrepancy_receiptId_idx`(`receiptId`),
    INDEX `InventoryDiscrepancy_inventorySkuId_discrepancyType_idx`(`inventorySkuId`, `discrepancyType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingPartner` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `email` VARCHAR(255) NULL,
    `passwordHash` VARCHAR(255) NULL,
    `contactPhone` VARCHAR(32) NULL,
    `website` VARCHAR(255) NULL,
    `address` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketingPartner_accountId_key`(`accountId`),
    UNIQUE INDEX `MarketingPartner_code_key`(`code`),
    UNIQUE INDEX `MarketingPartner_email_key`(`email`),
    INDEX `MarketingPartner_status_idx`(`status`),
    INDEX `MarketingPartner_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `marketingPartnerId` VARCHAR(191) NULL,
    `isOwnStore` BOOLEAN NOT NULL DEFAULT false,
    `maxScansPerCustomer` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `targetScopeType` VARCHAR(191) NOT NULL DEFAULT 'NATIONWIDE',
    `targetProvince` VARCHAR(120) NULL,
    `targetDistrict` VARCHAR(120) NULL,
    `benefitConfig` JSON NOT NULL,
    `requestedQuantity` INTEGER NOT NULL DEFAULT 0,
    `generatedQuantity` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `cardExpiresAt` DATETIME(3) NULL,
    `targetCategories` JSON NOT NULL,
    `minOrderValue` DOUBLE NOT NULL DEFAULT 0,
    `cpaRate` DOUBLE NOT NULL DEFAULT 0,
    `adMediaType` VARCHAR(191) NULL DEFAULT 'NONE',
    `adMediaUrl` TEXT NULL,
    `adHeadline` VARCHAR(255) NULL,
    `adDescription` TEXT NULL,
    `adExternalLink` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingCampaign_marketingPartnerId_status_idx`(`marketingPartnerId`, `status`),
    INDEX `MktCampaign_scope_province_district_idx`(`targetScopeType`, `targetProvince`, `targetDistrict`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardBatch` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `batchCode` VARCHAR(64) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'GENERATED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketingCardBatch_batchCode_key`(`batchCode`),
    INDEX `MarketingCardBatch_campaignId_status_idx`(`campaignId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCard` (
    `id` VARCHAR(191) NOT NULL,
    `cardCode` VARCHAR(64) NOT NULL,
    `qrTokenHash` CHAR(64) NOT NULL,
    `partnerId` VARCHAR(191) NULL,
    `assignedPartnerId` VARCHAR(191) NULL,
    `assignedOrganization` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `campaignId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `assignedManufacturerId` VARCHAR(191) NULL,
    `assignedDistributorId` VARCHAR(191) NULL,
    `hasBenefit` BOOLEAN NOT NULL DEFAULT false,
    `benefitId` VARCHAR(191) NULL,
    `exchangeLockRequestId` VARCHAR(191) NULL,
    `physicalStatus` VARCHAR(191) NOT NULL DEFAULT 'GENERATED',
    `assignedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `reservedAt` DATETIME(3) NULL,
    `attachedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketingCard_cardCode_key`(`cardCode`),
    UNIQUE INDEX `MarketingCard_qrTokenHash_key`(`qrTokenHash`),
    INDEX `MarketingCard_campaignId_physicalStatus_idx`(`campaignId`, `physicalStatus`),
    INDEX `MarketingCard_partnerId_campaignId_physicalStatus_idx`(`partnerId`, `campaignId`, `physicalStatus`),
    INDEX `MarketingCard_assignedManufacturerId_physicalStatus_idx`(`assignedManufacturerId`, `physicalStatus`),
    INDEX `MarketingCard_assignedDistributorId_physicalStatus_idx`(`assignedDistributorId`, `physicalStatus`),
    INDEX `MarketingCard_batchId_physicalStatus_idx`(`batchId`, `physicalStatus`),
    INDEX `MarketingCard_benefitId_idx`(`benefitId`),
    INDEX `MarketingCard_exchangeLockRequestId_idx`(`exchangeLockRequestId`),
    INDEX `MarketingCard_assignedPartnerId_physicalStatus_idx`(`assignedPartnerId`, `physicalStatus`),
    INDEX `MarketingCard_assignedOrganization_physicalStatus_idx`(`assignedOrganization`, `physicalStatus`),
    INDEX `MarketingCard_campaignId_isPublic_physicalStatus_idx`(`campaignId`, `isPublic`, `physicalStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `assignedBy` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'ASSIGNED',
    `confirmedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,

    INDEX `MarketingCardAssignment_manufacturerId_status_idx`(`manufacturerId`, `status`),
    INDEX `MarketingCardAssignment_distributorId_status_idx`(`distributorId`, `status`),
    INDEX `MarketingCardAssignment_cardId_assignedAt_idx`(`cardId`, `assignedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `confirmedBy` VARCHAR(191) NOT NULL,
    `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,

    UNIQUE INDEX `MarketingCardReceipt_assignmentId_key`(`assignmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardOrder` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `attachedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MarketingCardOrder_cardId_key`(`cardId`),
    UNIQUE INDEX `MarketingCardOrder_orderId_key`(`orderId`),
    INDEX `MarketingCardOrder_manufacturerId_attachedAt_idx`(`manufacturerId`, `attachedAt`),
    INDEX `MarketingCardOrder_distributorId_attachedAt_idx`(`distributorId`, `attachedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardCustomer` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedOrganization` VARCHAR(191) NULL,
    `scanWeekIndex` INTEGER NOT NULL DEFAULT 0,
    `activatedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'LINKED',
    `inStoreOtp` VARCHAR(6) NULL,
    `otpExpiresAt` DATETIME(3) NULL,
    `lastRedeemedLocation` VARCHAR(255) NULL,
    `scannedProvince` VARCHAR(120) NULL,
    `scannedDistrict` VARCHAR(120) NULL,

    INDEX `MarketingCardCustomer_customerId_status_idx`(`customerId`, `status`),
    INDEX `MarketingCardCustomer_customerId_scanWeekIndex_idx`(`customerId`, `scanWeekIndex`),
    INDEX `MCC_customer_week_org_idx`(`customerId`, `scanWeekIndex`, `assignedOrganization`),
    INDEX `MarketingCardCustomer_scannedProvince_scannedDistrict_idx`(`scannedProvince`, `scannedDistrict`),
    UNIQUE INDEX `MarketingCardCustomer_cardId_key`(`cardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingBenefit` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `benefitType` VARCHAR(191) NOT NULL DEFAULT 'CUSTOM',
    `value` DOUBLE NOT NULL DEFAULT 0,
    `maxDiscountAmount` DOUBLE NULL,
    `percentage` DOUBLE NOT NULL DEFAULT 0,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `assignedQuantity` INTEGER NOT NULL DEFAULT 0,
    `terms` TEXT NULL,
    `startsAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',

    INDEX `MarketingBenefit_campaignId_status_idx`(`campaignId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingBenefitRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `benefitId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REDEEMED',
    `claimedAt` DATETIME(3) NULL,
    `redeemedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketingBenefitRedemption_customerId_status_idx`(`customerId`, `status`),
    INDEX `MarketingBenefitRedemption_benefitId_redeemedAt_idx`(`benefitId`, `redeemedAt`),
    UNIQUE INDEX `MarketingBenefitRedemption_cardId_benefitId_key`(`cardId`, `benefitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardEvent` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NULL,
    `referenceId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketingCardEvent_cardId_createdAt_idx`(`cardId`, `createdAt`),
    INDEX `MarketingCardEvent_eventType_createdAt_idx`(`eventType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingPartnerSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `totalRedemptions` INTEGER NOT NULL DEFAULT 0,
    `cpaRate` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `paidAt` DATETIME(3) NULL,
    `referenceNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingPartnerSettlement_partnerId_paymentStatus_idx`(`partnerId`, `paymentStatus`),
    INDEX `MarketingPartnerSettlement_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationProduct` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `listingStatus` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `activeTermsVersion` INTEGER NULL,
    `pendingTermsVersion` INTEGER NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CollaborationProduct_productId_key`(`productId`),
    INDEX `CollaborationProduct_partnerId_listingStatus_idx`(`partnerId`, `listingStatus`),
    INDEX `CollaborationProduct_listingStatus_publishedAt_idx`(`listingStatus`, `publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationTermsVersion` (
    `id` VARCHAR(191) NOT NULL,
    `collaborationProductId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `proposedByRole` VARCHAR(24) NOT NULL,
    `proposedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_PARTNER',
    `fixedFeePerUnit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `retailPrice` DECIMAL(20, 2) NOT NULL,
    `discountPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'VAT_EXCLUSIVE',
    `notes` TEXT NULL,
    `respondedByRole` VARCHAR(24) NULL,
    `respondedById` VARCHAR(191) NULL,
    `proposedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollaborationTermsVersion_collaborationProductId_status_idx`(`collaborationProductId`, `status`),
    UNIQUE INDEX `CollaborationTermsVersion_collaborationProductId_version_key`(`collaborationProductId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationSale` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderItemIndex` INTEGER NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `collaborationProductId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `termsVersion` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `quantityReturned` INTEGER NOT NULL DEFAULT 0,
    `quantityInvoiced` INTEGER NOT NULL DEFAULT 0,
    `quantityCredited` INTEGER NOT NULL DEFAULT 0,
    `size` VARCHAR(64) NOT NULL DEFAULT '',
    `color` VARCHAR(100) NOT NULL DEFAULT '',
    `unitSellingPrice` DECIMAL(20, 2) NOT NULL,
    `unitDiscount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `partnerFeePerUnit` DECIMAL(20, 2) NOT NULL,
    `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'VAT_EXCLUSIVE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_DELIVERY',
    `deliveredAt` DATETIME(3) NULL,
    `accruedAt` DATETIME(3) NULL,
    `lastReturnAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CollaborationSale_partnerId_status_deliveredAt_idx`(`partnerId`, `status`, `deliveredAt`),
    INDEX `CollaborationSale_collaborationProductId_status_idx`(`collaborationProductId`, `status`),
    UNIQUE INDEX `CollaborationSale_orderId_orderItemIndex_key`(`orderId`, `orderItemIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationFeeInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(64) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `totalUnits` INTEGER NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `accountingDocumentId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CollaborationFeeInvoice_invoiceNumber_key`(`invoiceNumber`),
    UNIQUE INDEX `CollaborationFeeInvoice_accountingDocumentId_key`(`accountingDocumentId`),
    INDEX `CollaborationFeeInvoice_partnerId_issuedAt_idx`(`partnerId`, `issuedAt`),
    UNIQUE INDEX `CollaborationFeeInvoice_partnerId_periodStart_key`(`partnerId`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationFeeInvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `entryType` VARCHAR(191) NOT NULL DEFAULT 'FEE',
    `quantity` INTEGER NOT NULL,
    `unitFee` DECIMAL(20, 2) NOT NULL,
    `netAmount` DECIMAL(20, 2) NOT NULL,
    `vatAmount` DECIMAL(20, 2) NOT NULL,
    `totalAmount` DECIMAL(20, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollaborationFeeInvoiceLine_saleId_createdAt_idx`(`saleId`, `createdAt`),
    UNIQUE INDEX `CollaborationFeeInvoiceLine_invoiceId_saleId_entryType_key`(`invoiceId`, `saleId`, `entryType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NcmBranch` (
    `id` VARCHAR(191) NOT NULL,
    `ncmPk` INTEGER NOT NULL,
    `code` VARCHAR(40) NULL,
    `name` VARCHAR(120) NOT NULL,
    `branchType` VARCHAR(80) NULL,
    `geocode` VARCHAR(120) NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(40) NULL,
    `phone2` VARCHAR(80) NULL,
    `provinceName` VARCHAR(120) NULL,
    `districtName` VARCHAR(120) NULL,
    `coveredAreas` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSyncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NcmBranch_ncmPk_key`(`ncmPk`),
    UNIQUE INDEX `NcmBranch_name_key`(`name`),
    INDEX `NcmBranch_isActive_districtName_idx`(`isActive`, `districtName`),
    INDEX `NcmBranch_isActive_provinceName_idx`(`isActive`, `provinceName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerLocation` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ManufacturerLocation_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `ManufacturerLocation_manufacturerId_isActive_idx`(`manufacturerId`, `isActive`),
    UNIQUE INDEX `ManufacturerLocation_manufacturerId_province_district_key`(`manufacturerId`, `province`, `district`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LocationProductDiscount` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `discountPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LocationProductDiscount_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `LocationProductDiscount_productId_isActive_idx`(`productId`, `isActive`),
    UNIQUE INDEX `LocationProductDiscount_productId_province_district_key`(`productId`, `province`, `district`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerInventory` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `reservedQty` INTEGER NOT NULL DEFAULT 0,
    `variantsStock` JSON NOT NULL,
    `proposedCostPrice` DOUBLE NULL,
    `agreedCostPrice` DOUBLE NULL,
    `priceStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `priceNote` TEXT NULL,
    `adminFeedback` TEXT NULL,
    `lastUpdated` DATETIME(3) NOT NULL,

    INDEX `ManufacturerInventory_productId_idx`(`productId`),
    INDEX `ManufacturerInventory_manufacturerId_idx`(`manufacturerId`),
    UNIQUE INDEX `ManufacturerInventory_manufacturerId_productId_key`(`manufacturerId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerProductionRequest` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_MANUFACTURER_QUOTE',
    `proposedUnitCogs` DECIMAL(20, 2) NULL,
    `minimumOrderQuantity` INTEGER NOT NULL,
    `proposedDeliveryCost` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'EXEMPT',
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13,
    `vatInvoiceReference` VARCHAR(120) NULL,
    `approvedUnitCogs` DECIMAL(20, 2) NULL,
    `approvedMinimumOrderQuantity` INTEGER NULL,
    `approvedDeliveryCost` DECIMAL(20, 2) NULL,
    `approvedVatTreatment` VARCHAR(24) NOT NULL DEFAULT 'EXEMPT',
    `approvedVatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13,
    `approvedVatInvoiceReference` VARCHAR(120) NULL,
    `approvedVatInvoiceVerified` BOOLEAN NOT NULL DEFAULT false,
    `costTermsVersion` INTEGER NOT NULL DEFAULT 1,
    `fabricType` VARCHAR(120) NULL,
    `gsm` DECIMAL(8, 2) NULL,
    `targetCompletionDate` DATETIME(3) NULL,
    `batchPlan` JSON NULL,
    `preProductionChecklist` JSON NULL,
    `preProductionCheckedAt` DATETIME(3) NULL,
    `postProductionChecklist` JSON NULL,
    `postProductionCheckedAt` DATETIME(3) NULL,
    `manufacturerNote` TEXT NULL,
    `adminNote` TEXT NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `productionReviewDecision` VARCHAR(16) NULL,
    `productionReviewedBy` VARCHAR(191) NULL,
    `productionReviewedAt` DATETIME(3) NULL,
    `productionReviewNote` TEXT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MfgProdReq_manuf_status_reqAt_idx`(`manufacturerId`, `status`, `requestedAt`),
    INDEX `ManufacturerProductionRequest_productId_status_idx`(`productId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerProductionRequestLine` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `size` VARCHAR(120) NOT NULL,
    `color` VARCHAR(120) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `actualQuantity` INTEGER NULL,
    `damagedQuantity` INTEGER NOT NULL DEFAULT 0,

    INDEX `ManufacturerProductionRequestLine_requestId_idx`(`requestId`),
    UNIQUE INDEX `ManufacturerProductionRequestLine_requestId_size_color_key`(`requestId`, `size`, `color`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerSettlementRequest` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `requestType` VARCHAR(191) NOT NULL DEFAULT 'PRODUCTION',
    `amount` DECIMAL(20, 2) NOT NULL,
    `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `financialAccountId` VARCHAR(191) NULL,
    `externalPaymentReference` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ManufacturerSettlementRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `MfgSettlementReq_mfg_status_reqAt_idx`(`manufacturerId`, `status`, `requestedAt`),
    INDEX `ManufacturerSettlementRequest_requestType_status_idx`(`requestType`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerInventoryCostLayer` (
    `id` VARCHAR(191) NOT NULL,
    `productionRequestId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NULL,
    `size` VARCHAR(120) NOT NULL,
    `color` VARCHAR(120) NOT NULL,
    `producedQuantity` INTEGER NOT NULL,
    `availableQuantity` INTEGER NOT NULL,
    `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
    `consumedQuantity` INTEGER NOT NULL DEFAULT 0,
    `unitCogs` DECIMAL(30, 14) NOT NULL,
    `unitVatAmount` DECIMAL(30, 14) NOT NULL DEFAULT 0,
    `manufacturerPayableRecognizedAtProduction` BOOLEAN NOT NULL DEFAULT false,
    `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'EXEMPT',
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13,
    `vatInvoiceVerified` BOOLEAN NOT NULL DEFAULT false,
    `unitDeliveryCost` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MfgInvCostLayer_mfg_prod_variant_created_idx`(`manufacturerId`, `productId`, `size`, `color`, `createdAt`),
    UNIQUE INDEX `MfgInvCostLayer_req_size_color_key`(`productionRequestId`, `size`, `color`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerInventoryCostAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderItemIndex` INTEGER NOT NULL,
    `costLayerId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `returnedQuantity` INTEGER NOT NULL DEFAULT 0,
    `state` VARCHAR(191) NOT NULL DEFAULT 'RESERVED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ManufacturerInventoryCostAllocation_costLayerId_state_idx`(`costLayerId`, `state`),
    INDEX `ManufacturerInventoryCostAllocation_orderId_state_idx`(`orderId`, `state`),
    UNIQUE INDEX `MfgInvCostAlloc_order_item_layer_key`(`orderId`, `orderItemIndex`, `costLayerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManufacturerInventoryMovement` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `variantLabel` VARCHAR(191) NOT NULL,
    `previousQty` INTEGER NOT NULL,
    `newQty` INTEGER NOT NULL,
    `changeQty` INTEGER NOT NULL,
    `movementType` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NOT NULL DEFAULT 'MANUFACTURER',
    `source` VARCHAR(191) NOT NULL DEFAULT 'MANUFACTURER_PORTAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ManInvMove_manufacturer_product_created_idx`(`manufacturerId`, `productId`, `createdAt`),
    INDEX `ManInvMove_product_created_idx`(`productId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `deliveryType` VARCHAR(191) NOT NULL DEFAULT 'SELF_DELIVERY',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acceptedAt` DATETIME(3) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `onTheWayAt` DATETIME(3) NULL,
    `manufacturingAt` DATETIME(3) NULL,
    `qualityCheckAt` DATETIME(3) NULL,
    `packedAt` DATETIME(3) NULL,
    `readyAt` DATETIME(3) NULL,
    `pickedUpAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `rejectionReason` VARCHAR(191) NULL,

    UNIQUE INDEX `OrderAssignment_orderId_key`(`orderId`),
    INDEX `OrderAssignment_orderId_idx`(`orderId`),
    INDEX `OrderAssignment_manufacturerId_idx`(`manufacturerId`),
    INDEX `OrderAssignment_distributorId_idx`(`distributorId`),
    INDEX `OrderAssignment_status_idx`(`status`),
    INDEX `OrdAssign_type_dist_status_time_idx`(`deliveryType`, `distributorId`, `status`, `assignedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryOrder` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'READY_TO_DELIVER',
    `deliveryType` VARCHAR(191) NOT NULL DEFAULT 'Door2Door',
    `packageVersion` INTEGER NOT NULL DEFAULT 1,
    `packageWeight` DOUBLE NOT NULL DEFAULT 1,
    `packageDescription` TEXT NULL,
    `originBranchName` VARCHAR(191) NOT NULL,
    `destinationBranchName` VARCHAR(191) NOT NULL,
    `itemAmount` DOUBLE NOT NULL DEFAULT 0,
    `customerDeliveryCharge` DOUBLE NOT NULL DEFAULT 0,
    `ncmDeliveryCharge` DOUBLE NULL,
    `codAmount` DOUBLE NOT NULL DEFAULT 0,
    `ncmOrderId` INTEGER NULL,
    `vendorReference` VARCHAR(191) NOT NULL,
    `ncmStatus` VARCHAR(191) NULL,
    `ncmPaymentStatus` VARCHAR(191) NULL,
    `ncmReconciliationRequired` BOOLEAN NOT NULL DEFAULT false,
    `ncmReconciliationReason` TEXT NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `nextSyncAt` DATETIME(3) NULL,
    `syncFailureCount` INTEGER NOT NULL DEFAULT 0,
    `lastSyncError` TEXT NULL,
    `readyAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ncmCreatedAt` DATETIME(3) NULL,
    `pickedUpAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryOrder_orderId_key`(`orderId`),
    UNIQUE INDEX `DeliveryOrder_ncmOrderId_key`(`ncmOrderId`),
    UNIQUE INDEX `DeliveryOrder_vendorReference_key`(`vendorReference`),
    INDEX `DeliveryOrder_state_idx`(`state`),
    INDEX `DeliveryOrder_ncmReconciliationRequired_createdAt_idx`(`ncmReconciliationRequired`, `createdAt`),
    INDEX `DeliveryOrder_createdAt_state_idx`(`createdAt`, `state`),
    INDEX `DeliveryOrder_manufacturerId_state_idx`(`manufacturerId`, `state`),
    INDEX `DeliveryOrder_distributorId_state_idx`(`distributorId`, `state`),
    INDEX `DeliveryOrder_nextSyncAt_idx`(`nextSyncAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryEvent` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryOrderId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `fromState` VARCHAR(191) NULL,
    `toState` VARCHAR(191) NULL,
    `ncmStatus` VARCHAR(191) NULL,
    `payloadJson` JSON NULL,
    `actorId` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idempotencyKey` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `DeliveryEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DeliveryEvent_deliveryOrderId_occurredAt_idx`(`deliveryOrderId`, `occurredAt`),
    INDEX `DeliveryEvent_orderId_occurredAt_idx`(`orderId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryComment` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryOrderId` VARCHAR(191) NULL,
    `ncmOrderId` INTEGER NOT NULL,
    `comments` TEXT NOT NULL,
    `addedBy` VARCHAR(191) NULL,
    `addedAt` DATETIME(3) NULL,
    `payloadJson` JSON NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeliveryComment_eventKey_key`(`eventKey`),
    INDEX `DeliveryComment_deliveryOrderId_createdAt_idx`(`deliveryOrderId`, `createdAt`),
    INDEX `DeliveryComment_ncmOrderId_createdAt_idx`(`ncmOrderId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NcmRequestAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryOrderId` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `requestUrl` VARCHAR(191) NOT NULL,
    `requestJson` JSON NULL,
    `responseJson` JSON NULL,
    `httpStatus` INTEGER NULL,
    `result` VARCHAR(191) NOT NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `nextRetryAt` DATETIME(3) NULL,

    UNIQUE INDEX `NcmRequestAttempt_idempotencyKey_key`(`idempotencyKey`),
    INDEX `NcmRequestAttempt_deliveryOrderId_operation_idx`(`deliveryOrderId`, `operation`),
    INDEX `NcmRequestAttempt_result_nextRetryAt_idx`(`result`, `nextRetryAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NcmWebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `orderIds` JSON NULL,
    `status` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NULL,
    `payloadJson` JSON NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `processingStatus` VARCHAR(191) NOT NULL DEFAULT 'RECEIVED',
    `processingError` TEXT NULL,

    UNIQUE INDEX `NcmWebhookEvent_eventKey_key`(`eventKey`),
    INDEX `NcmWebhookEvent_orderId_idx`(`orderId`),
    INDEX `NcmWebhookEvent_processingStatus_receivedAt_idx`(`processingStatus`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryReturn` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryOrderId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'RETURN_REQUESTED',
    `returnReason` VARCHAR(191) NOT NULL,
    `ncmReturnComment` TEXT NULL,
    `ncmReturnRequestedAt` DATETIME(3) NULL,
    `trackingReference` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `inspectionResult` VARCHAR(191) NULL,
    `restockDecision` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryReturn_deliveryOrderId_key`(`deliveryOrderId`),
    INDEX `DeliveryReturn_manufacturerId_state_idx`(`manufacturerId`, `state`),
    INDEX `DeliveryReturn_distributorId_state_idx`(`distributorId`, `state`),
    INDEX `DeliveryReturn_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryFinancialSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryOrderId` VARCHAR(191) NOT NULL,
    `ncmOrderId` INTEGER NULL,
    `codExpected` DOUBLE NOT NULL DEFAULT 0,
    `codCollected` DOUBLE NOT NULL DEFAULT 0,
    `deliveryFeeExpected` DOUBLE NOT NULL DEFAULT 0,
    `deliveryFeeActual` DOUBLE NOT NULL DEFAULT 0,
    `otherAdjustments` DOUBLE NOT NULL DEFAULT 0,
    `manufacturerPayable` DOUBLE NOT NULL DEFAULT 0,
    `platformReceivable` DOUBLE NOT NULL DEFAULT 0,
    `ncmTicketId` INTEGER NULL,
    `settlementState` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `settledAt` DATETIME(3) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `varianceReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryFinancialSettlement_deliveryOrderId_key`(`deliveryOrderId`),
    INDEX `DeliveryFinancialSettlement_settlementState_idx`(`settlementState`),
    INDEX `DeliveryFinancialSettlement_ncmOrderId_idx`(`ncmOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NcmSupportTicket` (
    `ncmTicketId` INTEGER NOT NULL,
    `ticketType` VARCHAR(80) NOT NULL DEFAULT 'UNKNOWN',
    `message` TEXT NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    `addedOn` DATETIME(3) NULL,
    `closedOn` DATETIME(3) NULL,
    `branch` VARCHAR(200) NULL,
    `attachment` TEXT NULL,
    `vendorId` VARCHAR(64) NULL,
    `vendorName` VARCHAR(200) NULL,
    `assignedToId` VARCHAR(64) NULL,
    `assignedToName` VARCHAR(200) NULL,
    `closedById` VARCHAR(64) NULL,
    `closedByName` VARCHAR(200) NULL,
    `latestComment` TEXT NULL,
    `latestCommentAt` DATETIME(3) NULL,
    `latestResponse` TEXT NULL,
    `latestResponseAt` DATETIME(3) NULL,
    `lastActivityAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedByAccountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NcmSupportTicket_status_lastActivityAt_idx`(`status`, `lastActivityAt`),
    INDEX `NcmSupportTicket_addedOn_idx`(`addedOn`),
    PRIMARY KEY (`ncmTicketId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OperatingExpense` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `isVatBill` BOOLEAN NOT NULL DEFAULT false,
    `vatAmount` DOUBLE NOT NULL DEFAULT 0,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paymentMethod` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'PAID',
    `financialAccountId` VARCHAR(191) NULL,
    `payableId` VARCHAR(191) NULL,
    `vendorName` VARCHAR(191) NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OperatingExpense_category_idx`(`category`),
    INDEX `OperatingExpense_date_idx`(`date`),
    INDEX `OperatingExpense_isVatBill_idx`(`isVatBill`),
    INDEX `OperatingExpense_paymentStatus_idx`(`paymentStatus`),
    INDEX `OperatingExpense_financialAccountId_idx`(`financialAccountId`),
    INDEX `OperatingExpense_payableId_idx`(`payableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DirectIncome` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `toAccountId` VARCHAR(191) NOT NULL,
    `payerName` VARCHAR(191) NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DirectIncome_category_idx`(`category`),
    INDEX `DirectIncome_date_idx`(`date`),
    INDEX `DirectIncome_toAccountId_idx`(`toAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinancialCategory` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(191) NULL DEFAULT '#6366f1',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FinancialCategory_code_key`(`code`),
    INDEX `FinancialCategory_type_isActive_idx`(`type`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LocationMapping` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(4) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `province` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LocationMapping_code_key`(`code`),
    INDEX `LocationMapping_type_idx`(`type`),
    INDEX `LocationMapping_name_idx`(`name`),
    INDEX `LocationMapping_province_idx`(`province`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementReversion` (
    `id` VARCHAR(191) NOT NULL,
    `reversionType` VARCHAR(48) NOT NULL,
    `originalRecordId` VARCHAR(191) NOT NULL,
    `cashTransactionId` VARCHAR(191) NULL,
    `reversalTransactionId` VARCHAR(191) NULL,
    `originalAmount` DOUBLE NOT NULL,
    `offsetAmount` DOUBLE NOT NULL DEFAULT 0,
    `partyName` VARCHAR(255) NULL,
    `accountId` VARCHAR(191) NULL,
    `accountName` VARCHAR(255) NULL,
    `priorStatus` VARCHAR(32) NOT NULL,
    `restoredStatus` VARCHAR(32) NOT NULL,
    `priorPaidAmount` DOUBLE NOT NULL DEFAULT 0,
    `priorRemainingBalance` DOUBLE NOT NULL DEFAULT 0,
    `revertedByAdminId` VARCHAR(191) NULL,
    `revertedByEmail` VARCHAR(255) NULL,
    `revertReason` TEXT NOT NULL,
    `revertedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SettlementReversion_reversionType_originalRecordId_idx`(`reversionType`, `originalRecordId`),
    INDEX `SettlementReversion_revertedAt_idx`(`revertedAt`),
    INDEX `SettlementReversion_revertedByAdminId_idx`(`revertedByAdminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourierOutboxJob` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(32) NOT NULL DEFAULT 'NCM',
    `orderId` VARCHAR(191) NULL,
    `transferId` VARCHAR(191) NULL,
    `jobType` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lastError` TEXT NULL,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourierOutboxJob_provider_status_nextAttemptAt_idx`(`provider`, `status`, `nextAttemptAt`),
    INDEX `CourierOutboxJob_orderId_idx`(`orderId`),
    INDEX `CourierOutboxJob_transferId_idx`(`transferId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalPolicyRule` (
    `id` VARCHAR(191) NOT NULL,
    `module` VARCHAR(64) NOT NULL,
    `ruleName` VARCHAR(191) NOT NULL,
    `conditions` JSON NOT NULL,
    `action` VARCHAR(32) NOT NULL DEFAULT 'AUTO_APPROVE',
    `priority` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApprovalPolicyRule_module_isActive_priority_idx`(`module`, `isActive`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShippingRateCache` (
    `id` VARCHAR(191) NOT NULL,
    `originDistrict` VARCHAR(64) NOT NULL,
    `destDistrict` VARCHAR(64) NOT NULL,
    `weightKg` DOUBLE NOT NULL DEFAULT 1.0,
    `rateNPR` DOUBLE NOT NULL,
    `provider` VARCHAR(32) NOT NULL DEFAULT 'NCM',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShippingRateCache_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `ShippingRateCache_provider_originDistrict_destDistrict_weigh_key`(`provider`, `originDistrict`, `destDistrict`, `weightKg`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RolePermissionMapping` ADD CONSTRAINT `RolePermissionMapping_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermissionMapping` ADD CONSTRAINT `RolePermissionMapping_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthAccountRoleMapping` ADD CONSTRAINT `AuthAccountRoleMapping_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthAccountRoleMapping` ADD CONSTRAINT `AuthAccountRoleMapping_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtpChallenge` ADD CONSTRAINT `OtpChallenge_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminTwoFactorChallenge` ADD CONSTRAINT `AdminTwoFactorChallenge_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminTwoFactorChallenge` ADD CONSTRAINT `AdminTwoFactorChallenge_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthAuditLog` ADD CONSTRAINT `AuthAuditLog_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessManagementAuditLog` ADD CONSTRAINT `AccessManagementAuditLog_actorAccountId_fkey` FOREIGN KEY (`actorAccountId`) REFERENCES `AuthAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessManagementAuditLog` ADD CONSTRAINT `AccessManagementAuditLog_targetAccountId_fkey` FOREIGN KEY (`targetAccountId`) REFERENCES `AuthAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationAttempt` ADD CONSTRAINT `NotificationAttempt_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationEvent` ADD CONSTRAINT `NotificationEvent_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationOutbox` ADD CONSTRAINT `NotificationOutbox_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoryLetter` ADD CONSTRAINT `StoryLetter_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `Story`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterTemplateVersion` ADD CONSTRAINT `LetterTemplateVersion_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `LetterTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryAssignment` ADD CONSTRAINT `CustomerStoryAssignment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryAssignment` ADD CONSTRAINT `CustomerStoryAssignment_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `Story`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_customerStoryAssignmentId_fkey` FOREIGN KEY (`customerStoryAssignmentId`) REFERENCES `CustomerStoryAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `Story`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_storyLetterId_fkey` FOREIGN KEY (`storyLetterId`) REFERENCES `StoryLetter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `LetterTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_templateVersionId_fkey` FOREIGN KEY (`templateVersionId`) REFERENCES `LetterTemplateVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComboBundle` ADD CONSTRAINT `ComboBundle_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComboBundleProduct` ADD CONSTRAINT `ComboBundleProduct_comboBundleId_fkey` FOREIGN KEY (`comboBundleId`) REFERENCES `ComboBundle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComboBundleProduct` ADD CONSTRAINT `ComboBundleProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_assignedGiftId_fkey` FOREIGN KEY (`assignedGiftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_assignedGiftInventoryId_fkey` FOREIGN KEY (`assignedGiftInventoryId`) REFERENCES `ManufacturerGiftInventory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_assignedDistributorGiftInventoryId_fkey` FOREIGN KEY (`assignedDistributorGiftInventoryId`) REFERENCES `DistributorGiftInventory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorReview` ADD CONSTRAINT `DistributorReview_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorReview` ADD CONSTRAINT `DistributorReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorReview` ADD CONSTRAINT `DistributorReview_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubCategory` ADD CONSTRAINT `SubCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerGiftInventory` ADD CONSTRAINT `ManufacturerGiftInventory_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerGiftInventory` ADD CONSTRAINT `ManufacturerGiftInventory_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftMovementLog` ADD CONSTRAINT `GiftMovementLog_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftMovementLog` ADD CONSTRAINT `GiftMovementLog_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorGiftInventory` ADD CONSTRAINT `DistributorGiftInventory_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorGiftInventory` ADD CONSTRAINT `DistributorGiftInventory_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorGiftMovementLog` ADD CONSTRAINT `DistributorGiftMovementLog_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorGiftMovementLog` ADD CONSTRAINT `DistributorGiftMovementLog_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftRewardEntitlement` ADD CONSTRAINT `GiftRewardEntitlement_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftRewardEntitlement` ADD CONSTRAINT `GiftRewardEntitlement_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftRewardEntitlement` ADD CONSTRAINT `GiftRewardEntitlement_marketingBenefitRedemptionId_fkey` FOREIGN KEY (`marketingBenefitRedemptionId`) REFERENCES `MarketingBenefitRedemption`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftRewardEntitlement` ADD CONSTRAINT `GiftRewardEntitlement_giftId_fkey` FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiftRewardEntitlement` ADD CONSTRAINT `GiftRewardEntitlement_distributorGiftInventoryId_fkey` FOREIGN KEY (`distributorGiftInventoryId`) REFERENCES `DistributorGiftInventory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Admin` ADD CONSTRAINT `Admin_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialAccount` ADD CONSTRAINT `FinancialAccount_accountingAccountId_fkey` FOREIGN KEY (`accountingAccountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashTransaction` ADD CONSTRAINT `CashTransaction_fromAccountId_fkey` FOREIGN KEY (`fromAccountId`) REFERENCES `FinancialAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashTransaction` ADD CONSTRAINT `CashTransaction_toAccountId_fkey` FOREIGN KEY (`toAccountId`) REFERENCES `FinancialAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialPayout` ADD CONSTRAINT `FinancialPayout_financialAccountId_fkey` FOREIGN KEY (`financialAccountId`) REFERENCES `FinancialAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderExchangeRequest` ADD CONSTRAINT `OrderExchangeRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderExchangeRequest` ADD CONSTRAINT `OrderExchangeRequest_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderExchangeRequest` ADD CONSTRAINT `OrderExchangeRequest_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderExchangeRequest` ADD CONSTRAINT `OrderExchangeRequest_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderExchangeEvent` ADD CONSTRAINT `OrderExchangeEvent_exchangeRequestId_fkey` FOREIGN KEY (`exchangeRequestId`) REFERENCES `OrderExchangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerReturnEvent` ADD CONSTRAINT `CustomerReturnEvent_customerReturnId_fkey` FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnExchangeNcmAttempt` ADD CONSTRAINT `ReturnExchangeNcmAttempt_customerReturnId_fkey` FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnExchangeNcmAttempt` ADD CONSTRAINT `ReturnExchangeNcmAttempt_exchangeRequestId_fkey` FOREIGN KEY (`exchangeRequestId`) REFERENCES `OrderExchangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_parentAccountId_fkey` FOREIGN KEY (`parentAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountingPeriod` ADD CONSTRAINT `AccountingPeriod_fiscalYearId_fkey` FOREIGN KEY (`fiscalYearId`) REFERENCES `FiscalYear`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_accountingEventId_fkey` FOREIGN KEY (`accountingEventId`) REFERENCES `AccountingEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_accountingPartyId_fkey` FOREIGN KEY (`accountingPartyId`) REFERENCES `AccountingParty`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountingAccountMapping` ADD CONSTRAINT `AccountingAccountMapping_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountingDocument` ADD CONSTRAINT `AccountingDocument_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `AccountingParty`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountingAllocation` ADD CONSTRAINT `AccountingAllocation_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `AccountingDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_creditDocumentId_fkey` FOREIGN KEY (`creditDocumentId`) REFERENCES `AccountingDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_billDocumentId_fkey` FOREIGN KEY (`billDocumentId`) REFERENCES `AccountingDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierCreditApplication` ADD CONSTRAINT `SupplierCreditApplication_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Manufacturer` ADD CONSTRAINT `Manufacturer_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Distributor` ADD CONSTRAINT `Distributor_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryOtpChallenge` ADD CONSTRAINT `DeliveryOtpChallenge_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryOtpChallenge` ADD CONSTRAINT `DeliveryOtpChallenge_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryOtpChallenge` ADD CONSTRAINT `DeliveryOtpChallenge_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorRemittanceBatch` ADD CONSTRAINT `DistributorRemittanceBatch_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorRemittanceBatch` ADD CONSTRAINT `DistributorRemittanceBatch_financialAccountId_fkey` FOREIGN KEY (`financialAccountId`) REFERENCES `FinancialAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCashEvent` ADD CONSTRAINT `DistributorCashEvent_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCashEvent` ADD CONSTRAINT `DistributorCashEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCashEvent` ADD CONSTRAINT `DistributorCashEvent_customerReturnId_fkey` FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCashEvent` ADD CONSTRAINT `DistributorCashEvent_orderExchangeRequestId_fkey` FOREIGN KEY (`orderExchangeRequestId`) REFERENCES `OrderExchangeRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCashEvent` ADD CONSTRAINT `DistributorCashEvent_remittanceBatchId_fkey` FOREIGN KEY (`remittanceBatchId`) REFERENCES `DistributorRemittanceBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCashEvent` ADD CONSTRAINT `DistributorCashEvent_accountingDocumentId_fkey` FOREIGN KEY (`accountingDocumentId`) REFERENCES `AccountingDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorSettlementOffset` ADD CONSTRAINT `DistributorSettlementOffset_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorSettlementOffset` ADD CONSTRAINT `DistributorSettlementOffset_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorLocation` ADD CONSTRAINT `DistributorLocation_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorDeliveryChargeNegotiation` ADD CONSTRAINT `DistributorDeliveryChargeNegotiation_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorDeliveryChargeNegotiation` ADD CONSTRAINT `DistributorDeliveryChargeNegotiation_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorServiceEarning` ADD CONSTRAINT `DistributorServiceEarning_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorBonusPlan` ADD CONSTRAINT `DistributorBonusPlan_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorBonusEarning` ADD CONSTRAINT `DistributorBonusEarning_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorBonusEarning` ADD CONSTRAINT `DistributorBonusEarning_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `DistributorBonusPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorSettlementRequest` ADD CONSTRAINT `DistributorSettlementRequest_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventorySku` ADD CONSTRAINT `InventorySku_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLocation` ADD CONSTRAINT `InventoryLocation_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLocation` ADD CONSTRAINT `InventoryLocation_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryBalance` ADD CONSTRAINT `InventoryBalance_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryBalance` ADD CONSTRAINT `InventoryBalance_inventorySkuId_fkey` FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLedgerEntry` ADD CONSTRAINT `InventoryLedgerEntry_inventorySkuId_fkey` FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLedgerEntry` ADD CONSTRAINT `InventoryLedgerEntry_sourceLocationId_fkey` FOREIGN KEY (`sourceLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLedgerEntry` ADD CONSTRAINT `InventoryLedgerEntry_destinationLocationId_fkey` FOREIGN KEY (`destinationLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLedgerEntry` ADD CONSTRAINT `InventoryLedgerEntry_productionCostLayerId_fkey` FOREIGN KEY (`productionCostLayerId`) REFERENCES `ManufacturerInventoryCostLayer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_sourceLocationId_fkey` FOREIGN KEY (`sourceLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_destinationLocationId_fkey` FOREIGN KEY (`destinationLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferLine` ADD CONSTRAINT `StockTransferLine_stockTransferId_fkey` FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferLine` ADD CONSTRAINT `StockTransferLine_inventorySkuId_fkey` FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferShipment` ADD CONSTRAINT `StockTransferShipment_stockTransferId_fkey` FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferShipmentEvent` ADD CONSTRAINT `StockTransferShipmentEvent_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferShipmentLine` ADD CONSTRAINT `StockTransferShipmentLine_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferShipmentLine` ADD CONSTRAINT `StockTransferShipmentLine_stockTransferLineId_fkey` FOREIGN KEY (`stockTransferLineId`) REFERENCES `StockTransferLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferShipmentLineCostLayer` ADD CONSTRAINT `StockTransferShipmentLineCostLayer_shipmentLineId_fkey` FOREIGN KEY (`shipmentLineId`) REFERENCES `StockTransferShipmentLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferShipmentLineCostLayer` ADD CONSTRAINT `StockTransferShipmentLineCostLayer_costLayerId_fkey` FOREIGN KEY (`costLayerId`) REFERENCES `ManufacturerInventoryCostLayer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferReceipt` ADD CONSTRAINT `StockTransferReceipt_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferReceiptLine` ADD CONSTRAINT `StockTransferReceiptLine_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `StockTransferReceipt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferReceiptLine` ADD CONSTRAINT `StockTransferReceiptLine_shipmentLineId_fkey` FOREIGN KEY (`shipmentLineId`) REFERENCES `StockTransferShipmentLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryDiscrepancy` ADD CONSTRAINT `InventoryDiscrepancy_stockTransferId_fkey` FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryDiscrepancy` ADD CONSTRAINT `InventoryDiscrepancy_shipmentId_fkey` FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryDiscrepancy` ADD CONSTRAINT `InventoryDiscrepancy_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `StockTransferReceipt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryDiscrepancy` ADD CONSTRAINT `InventoryDiscrepancy_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryDiscrepancy` ADD CONSTRAINT `InventoryDiscrepancy_inventoryLocationId_fkey` FOREIGN KEY (`inventoryLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryDiscrepancy` ADD CONSTRAINT `InventoryDiscrepancy_inventorySkuId_fkey` FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPartner` ADD CONSTRAINT `MarketingPartner_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCampaign` ADD CONSTRAINT `MarketingCampaign_marketingPartnerId_fkey` FOREIGN KEY (`marketingPartnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardBatch` ADD CONSTRAINT `MarketingCardBatch_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_assignedPartnerId_fkey` FOREIGN KEY (`assignedPartnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `MarketingCardBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_benefitId_fkey` FOREIGN KEY (`benefitId`) REFERENCES `MarketingBenefit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_assignedManufacturerId_fkey` FOREIGN KEY (`assignedManufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_assignedDistributorId_fkey` FOREIGN KEY (`assignedDistributorId`) REFERENCES `Distributor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardAssignment` ADD CONSTRAINT `MarketingCardAssignment_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardAssignment` ADD CONSTRAINT `MarketingCardAssignment_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardAssignment` ADD CONSTRAINT `MarketingCardAssignment_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardReceipt` ADD CONSTRAINT `MarketingCardReceipt_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `MarketingCardAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardCustomer` ADD CONSTRAINT `MarketingCardCustomer_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardCustomer` ADD CONSTRAINT `MarketingCardCustomer_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefit` ADD CONSTRAINT `MarketingBenefit_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefitRedemption` ADD CONSTRAINT `MarketingBenefitRedemption_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefitRedemption` ADD CONSTRAINT `MarketingBenefitRedemption_benefitId_fkey` FOREIGN KEY (`benefitId`) REFERENCES `MarketingBenefit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefitRedemption` ADD CONSTRAINT `MarketingBenefitRedemption_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardEvent` ADD CONSTRAINT `MarketingCardEvent_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPartnerSettlement` ADD CONSTRAINT `MarketingPartnerSettlement_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPartnerSettlement` ADD CONSTRAINT `MarketingPartnerSettlement_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationProduct` ADD CONSTRAINT `CollaborationProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationProduct` ADD CONSTRAINT `CollaborationProduct_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationTermsVersion` ADD CONSTRAINT `CollaborationTermsVersion_collaborationProductId_fkey` FOREIGN KEY (`collaborationProductId`) REFERENCES `CollaborationProduct`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_collaborationProductId_fkey` FOREIGN KEY (`collaborationProductId`) REFERENCES `CollaborationProduct`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_collaborationProductId_termsVersion_fkey` FOREIGN KEY (`collaborationProductId`, `termsVersion`) REFERENCES `CollaborationTermsVersion`(`collaborationProductId`, `version`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationFeeInvoice` ADD CONSTRAINT `CollaborationFeeInvoice_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationFeeInvoiceLine` ADD CONSTRAINT `CollaborationFeeInvoiceLine_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `CollaborationFeeInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationFeeInvoiceLine` ADD CONSTRAINT `CollaborationFeeInvoiceLine_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `CollaborationSale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerLocation` ADD CONSTRAINT `ManufacturerLocation_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LocationProductDiscount` ADD CONSTRAINT `LocationProductDiscount_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventory` ADD CONSTRAINT `ManufacturerInventory_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerProductionRequest` ADD CONSTRAINT `ManufacturerProductionRequest_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerProductionRequest` ADD CONSTRAINT `ManufacturerProductionRequest_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerProductionRequestLine` ADD CONSTRAINT `ManufacturerProductionRequestLine_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ManufacturerProductionRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerSettlementRequest` ADD CONSTRAINT `ManufacturerSettlementRequest_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventoryCostLayer` ADD CONSTRAINT `ManufacturerInventoryCostLayer_productionRequestId_fkey` FOREIGN KEY (`productionRequestId`) REFERENCES `ManufacturerProductionRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventoryCostLayer` ADD CONSTRAINT `ManufacturerInventoryCostLayer_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventoryCostLayer` ADD CONSTRAINT `ManufacturerInventoryCostLayer_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventoryCostLayer` ADD CONSTRAINT `ManufacturerInventoryCostLayer_inventorySkuId_fkey` FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventoryCostAllocation` ADD CONSTRAINT `ManufacturerInventoryCostAllocation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManufacturerInventoryCostAllocation` ADD CONSTRAINT `ManufacturerInventoryCostAllocation_costLayerId_fkey` FOREIGN KEY (`costLayerId`) REFERENCES `ManufacturerInventoryCostLayer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAssignment` ADD CONSTRAINT `OrderAssignment_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAssignment` ADD CONSTRAINT `OrderAssignment_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryOrder` ADD CONSTRAINT `DeliveryOrder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryEvent` ADD CONSTRAINT `DeliveryEvent_deliveryOrderId_fkey` FOREIGN KEY (`deliveryOrderId`) REFERENCES `DeliveryOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
