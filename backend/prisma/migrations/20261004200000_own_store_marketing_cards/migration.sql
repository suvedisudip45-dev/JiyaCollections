-- Allow campaigns and cards that belong to the in-house store rather than a marketing partner.
ALTER TABLE `MarketingCampaign`
    MODIFY `marketingPartnerId` VARCHAR(191) NULL,
    ADD COLUMN `isOwnStore` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `MarketingCard`
    MODIFY `partnerId` VARCHAR(191) NULL,
    ADD COLUMN `assignedPartnerId` VARCHAR(191) NULL,
    ADD COLUMN `assignedOrganization` VARCHAR(191) NULL,
    ADD INDEX `MarketingCard_assignedPartnerId_physicalStatus_idx` (`assignedPartnerId`, `physicalStatus`),
    ADD INDEX `MarketingCard_assignedOrganization_physicalStatus_idx` (`assignedOrganization`, `physicalStatus`),
    ADD CONSTRAINT `MarketingCard_assignedPartnerId_fkey`
        FOREIGN KEY (`assignedPartnerId`) REFERENCES `MarketingPartner` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MarketingCardCustomer`
    ADD COLUMN `scannedAt` DATETIME(3) NULL,
    ADD COLUMN `assignedOrganization` VARCHAR(191) NULL,
    ADD COLUMN `scanWeekIndex` INTEGER NULL;

UPDATE `MarketingCardCustomer` AS customerCard
JOIN `MarketingCard` AS card ON card.`id` = customerCard.`cardId`
LEFT JOIN `MarketingPartner` AS partner ON partner.`id` = card.`partnerId`
LEFT JOIN `MarketingCampaign` AS campaign ON campaign.`id` = card.`campaignId`
LEFT JOIN `MarketingPartner` AS campaignPartner ON campaignPartner.`id` = campaign.`marketingPartnerId`
SET customerCard.`scannedAt` = customerCard.`linkedAt`,
    customerCard.`assignedOrganization` = COALESCE(card.`assignedOrganization`, partner.`name`, campaignPartner.`name`),
    customerCard.`scanWeekIndex` = FLOOR(
        (TO_DAYS(DATE_ADD(customerCard.`linkedAt`, INTERVAL 345 MINUTE)) - TO_DAYS('1970-01-05')) / 7
    );

ALTER TABLE `MarketingCardCustomer`
    MODIFY COLUMN `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY COLUMN `scanWeekIndex` INTEGER NOT NULL DEFAULT 0,
    ADD INDEX `MarketingCardCustomer_customerId_scanWeekIndex_idx` (`customerId`, `scanWeekIndex`),
    ADD INDEX `MCC_customer_week_org_idx`
        (`customerId`, `scanWeekIndex`, `assignedOrganization`);

ALTER TABLE `MarketingBenefitRedemption`
    MODIFY COLUMN `redeemedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `claimedAt` DATETIME(3) NULL;
