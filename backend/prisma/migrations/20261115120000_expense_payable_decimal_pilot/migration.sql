CREATE TABLE IF NOT EXISTS `AccountingDecimalConversionEvidence` (
    `migrationKey` VARCHAR(64) NOT NULL,
    `tableName` VARCHAR(64) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `fieldName` VARCHAR(64) NOT NULL,
    `originalValue` VARCHAR(128) NOT NULL,
    `convertedValue` DECIMAL(20, 2) NOT NULL,
    `drift` DECIMAL(65, 30) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`migrationKey`, `tableName`, `recordId`, `fieldName`),
    INDEX `AccountingDecimalConversionEvidence_table_field_idx` (`tableName`, `fieldName`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `AccountingDecimalJsonConversionEvidence` (
    `migrationKey` VARCHAR(64) NOT NULL,
    `sourceRecordId` VARCHAR(191) NOT NULL,
    `originalItems` JSON NOT NULL,
    `convertedItems` JSON NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`migrationKey`, `sourceRecordId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'OperatingExpense', converted.`id`, 'amount',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`amount` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`amount` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `OperatingExpense`
) AS converted;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'OperatingExpense', converted.`id`, 'vatAmount',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`vatAmount` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`vatAmount` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `OperatingExpense`
) AS converted;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'SupplierReturn', converted.`id`, 'totalDebitAmount',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`totalDebitAmount` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`totalDebitAmount` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `SupplierReturn`
) AS converted;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'SupplierReturn', converted.`id`, 'vatReversal',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`vatReversal` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`vatReversal` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `SupplierReturn`
) AS converted;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'SettlementReversion', converted.`id`, 'originalAmount',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`originalAmount` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`originalAmount` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `SettlementReversion`
) AS converted;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'SettlementReversion', converted.`id`, 'priorPaidAmount',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`priorPaidAmount` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`priorPaidAmount` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `SettlementReversion`
) AS converted;

INSERT INTO `AccountingDecimalConversionEvidence`
    (`migrationKey`, `tableName`, `recordId`, `fieldName`, `originalValue`, `convertedValue`, `drift`)
SELECT 'P4.2-2026-11-15-v1', 'SettlementReversion', converted.`id`, 'priorRemainingBalance',
       converted.`originalValue`, converted.`convertedValue`,
       CAST(converted.`convertedValue` - CAST(converted.`originalValue` AS DECIMAL(65, 30)) AS DECIMAL(65, 30))
FROM (
    SELECT `id`, CAST(`priorRemainingBalance` AS CHAR) AS `originalValue`,
           CAST(
               SIGN(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) *
               (
                   FLOOR(ABS(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) * 100) +
                   CASE
                       WHEN ABS(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) * 100) > 0.5 THEN 1
                       WHEN ABS(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) * 100
                            - FLOOR(ABS(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) * 100) = 0.5
                            AND MOD(FLOOR(ABS(CAST(CAST(`priorRemainingBalance` AS CHAR) AS DECIMAL(65, 30))) * 100), 2) = 1 THEN 1
                       ELSE 0
                   END
               ) / 100 AS DECIMAL(20, 2)
           ) AS `convertedValue`
    FROM `SettlementReversion`
) AS converted;

CREATE TEMPORARY TABLE `_p42_supplier_return_items` AS
WITH expanded AS (
    SELECT sr.`id`, jt.`itemIndex`, jt.`item`
    FROM `SupplierReturn` sr
    JOIN JSON_TABLE(sr.`items`, '$[*]' COLUMNS (
        `itemIndex` FOR ORDINALITY,
        `item` JSON PATH '$'
    )) AS jt
),
unit_converted AS (
    SELECT `id`, `itemIndex`,
           CASE
               WHEN JSON_TYPE(JSON_EXTRACT(`item`, '$.unitCostPrice')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
               THEN JSON_SET(
                   `item`,
                   '$.unitCostPrice',
                   JSON_UNQUOTE(JSON_EXTRACT(`item`, '$.unitCostPrice'))
               )
               ELSE `item`
           END AS `item`
    FROM expanded
),
items_converted AS (
    SELECT `id`, `itemIndex`,
           CASE
               WHEN JSON_TYPE(JSON_EXTRACT(`item`, '$.totalDebitCost')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
               THEN JSON_SET(
                   `item`,
                   '$.totalDebitCost',
                   JSON_UNQUOTE(JSON_EXTRACT(`item`, '$.totalDebitCost'))
               )
               ELSE `item`
           END AS `convertedItem`
    FROM unit_converted
),
ordered_items AS (
    SELECT `id`, `itemIndex`, `convertedItem`
    FROM items_converted
    ORDER BY `id`, `itemIndex`
)
SELECT `id`,
       JSON_ARRAYAGG(`convertedItem`) AS `convertedItems`
FROM ordered_items
GROUP BY `id`;

INSERT INTO `AccountingDecimalJsonConversionEvidence`
    (`migrationKey`, `sourceRecordId`, `originalItems`, `convertedItems`)
SELECT 'P4.2-2026-11-15-v1', sr.`id`, sr.`items`, staged.`convertedItems`
FROM `SupplierReturn` sr
JOIN `_p42_supplier_return_items` staged ON staged.`id` = sr.`id`;

UPDATE `SupplierReturn` sr
JOIN `_p42_supplier_return_items` staged ON staged.`id` = sr.`id`
SET sr.`items` = staged.`convertedItems`;

DROP TEMPORARY TABLE `_p42_supplier_return_items`;

ALTER TABLE `OperatingExpense`
    ADD COLUMN `amountP42` DECIMAL(20, 2) NULL,
    ADD COLUMN `vatAmountP42` DECIMAL(20, 2) NULL,
    ADD COLUMN `paidAmountP42` DECIMAL(20, 2) NULL,
    ADD COLUMN `payableAmountP42` DECIMAL(20, 2) NULL;

UPDATE `OperatingExpense` oe
JOIN `AccountingDecimalConversionEvidence` amountEvidence
  ON amountEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND amountEvidence.`tableName` = 'OperatingExpense'
 AND amountEvidence.`recordId` = oe.`id`
 AND amountEvidence.`fieldName` = 'amount'
JOIN `AccountingDecimalConversionEvidence` vatEvidence
  ON vatEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND vatEvidence.`tableName` = 'OperatingExpense'
 AND vatEvidence.`recordId` = oe.`id`
 AND vatEvidence.`fieldName` = 'vatAmount'
SET oe.`amountP42` = amountEvidence.`convertedValue`,
    oe.`vatAmountP42` = vatEvidence.`convertedValue`;

UPDATE `OperatingExpense` oe
LEFT JOIN `AccountPayable` ap ON ap.`id` = oe.`payableId`
SET oe.`paidAmountP42` = CASE UPPER(oe.`paymentStatus`)
        WHEN 'PAID' THEN oe.`amountP42`
        WHEN 'PAYABLE' THEN 0
        WHEN 'UNPAID' THEN 0
        WHEN 'PARTIALLY_PAID' THEN
            CASE WHEN ap.`id` IS NOT NULL AND ap.`totalAmount` <= oe.`amountP42`
                THEN oe.`amountP42` - ap.`totalAmount`
                ELSE NULL
            END
        ELSE NULL
    END,
    oe.`payableAmountP42` = CASE UPPER(oe.`paymentStatus`)
        WHEN 'PAID' THEN 0
        WHEN 'PAYABLE' THEN oe.`amountP42`
        WHEN 'UNPAID' THEN oe.`amountP42`
        WHEN 'PARTIALLY_PAID' THEN
            CASE WHEN ap.`id` IS NOT NULL AND ap.`totalAmount` <= oe.`amountP42`
                THEN ap.`totalAmount`
                ELSE NULL
            END
        ELSE NULL
    END;

ALTER TABLE `OperatingExpense`
    DROP COLUMN `amount`,
    DROP COLUMN `vatAmount`,
    CHANGE COLUMN `amountP42` `amount` DECIMAL(20, 2) NOT NULL,
    CHANGE COLUMN `vatAmountP42` `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    CHANGE COLUMN `paidAmountP42` `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    CHANGE COLUMN `payableAmountP42` `payableAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT `OperatingExpense_paid_payable_split_chk`
    CHECK (
        `paidAmount` >= 0
        AND `payableAmount` >= 0
        AND `paidAmount` + `payableAmount` = `amount`
    ) ENFORCED;

ALTER TABLE `SupplierReturn`
    ADD COLUMN `totalDebitAmountP42` DECIMAL(20, 2) NULL,
    ADD COLUMN `vatReversalP42` DECIMAL(20, 2) NULL;

UPDATE `SupplierReturn` sr
JOIN `AccountingDecimalConversionEvidence` debitEvidence
  ON debitEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND debitEvidence.`tableName` = 'SupplierReturn'
 AND debitEvidence.`recordId` = sr.`id`
 AND debitEvidence.`fieldName` = 'totalDebitAmount'
JOIN `AccountingDecimalConversionEvidence` vatEvidence
  ON vatEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND vatEvidence.`tableName` = 'SupplierReturn'
 AND vatEvidence.`recordId` = sr.`id`
 AND vatEvidence.`fieldName` = 'vatReversal'
SET sr.`totalDebitAmountP42` = debitEvidence.`convertedValue`,
    sr.`vatReversalP42` = vatEvidence.`convertedValue`;

ALTER TABLE `SupplierReturn`
    DROP COLUMN `totalDebitAmount`,
    DROP COLUMN `vatReversal`,
    CHANGE COLUMN `totalDebitAmountP42` `totalDebitAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    CHANGE COLUMN `vatReversalP42` `vatReversal` DECIMAL(20, 2) NOT NULL DEFAULT 0;

ALTER TABLE `SettlementReversion`
    ADD COLUMN `originalAmountP42` DECIMAL(20, 2) NULL,
    ADD COLUMN `priorPaidAmountP42` DECIMAL(20, 2) NULL,
    ADD COLUMN `priorRemainingBalanceP42` DECIMAL(20, 2) NULL;

UPDATE `SettlementReversion` sr
JOIN `AccountingDecimalConversionEvidence` originalEvidence
  ON originalEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND originalEvidence.`tableName` = 'SettlementReversion'
 AND originalEvidence.`recordId` = sr.`id`
 AND originalEvidence.`fieldName` = 'originalAmount'
JOIN `AccountingDecimalConversionEvidence` paidEvidence
  ON paidEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND paidEvidence.`tableName` = 'SettlementReversion'
 AND paidEvidence.`recordId` = sr.`id`
 AND paidEvidence.`fieldName` = 'priorPaidAmount'
JOIN `AccountingDecimalConversionEvidence` remainingEvidence
  ON remainingEvidence.`migrationKey` = 'P4.2-2026-11-15-v1'
 AND remainingEvidence.`tableName` = 'SettlementReversion'
 AND remainingEvidence.`recordId` = sr.`id`
 AND remainingEvidence.`fieldName` = 'priorRemainingBalance'
SET sr.`originalAmountP42` = originalEvidence.`convertedValue`,
    sr.`priorPaidAmountP42` = paidEvidence.`convertedValue`,
    sr.`priorRemainingBalanceP42` = remainingEvidence.`convertedValue`;

ALTER TABLE `SettlementReversion`
    DROP COLUMN `originalAmount`,
    DROP COLUMN `priorPaidAmount`,
    DROP COLUMN `priorRemainingBalance`,
    CHANGE COLUMN `originalAmountP42` `originalAmount` DECIMAL(20, 2) NOT NULL,
    CHANGE COLUMN `priorPaidAmountP42` `priorPaidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    CHANGE COLUMN `priorRemainingBalanceP42` `priorRemainingBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0;

ALTER TABLE `AccountPayable`
    ADD COLUMN `creditAppliedAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0;

UPDATE `AccountPayable` ap
LEFT JOIN (
    SELECT bill.`sourceId`, SUM(application.`amount`) AS `creditAmount`
    FROM `SupplierCreditApplication` application
    JOIN `AccountingDocument` bill ON bill.`id` = application.`billDocumentId`
    WHERE bill.`sourceType` = 'OPERATING_EXPENSE'
    GROUP BY bill.`sourceId`
) supplierCredits ON supplierCredits.`sourceId` = ap.`referenceId`
LEFT JOIN (
    SELECT bill.`sourceId`, SUM(application.`amount`) AS `creditAmount`
    FROM `SupplierReturnCreditApplication` application
    JOIN `AccountingDocument` bill ON bill.`id` = application.`billDocumentId`
    WHERE bill.`sourceType` = 'OPERATING_EXPENSE'
    GROUP BY bill.`sourceId`
) returnCredits ON returnCredits.`sourceId` = ap.`referenceId`
SET ap.`creditAppliedAmount` = COALESCE(supplierCredits.`creditAmount`, 0)
                               + COALESCE(returnCredits.`creditAmount`, 0)
WHERE ap.`referenceType` = 'EXPENSE'
  AND ap.`category` = 'OPERATING_EXPENSE';
