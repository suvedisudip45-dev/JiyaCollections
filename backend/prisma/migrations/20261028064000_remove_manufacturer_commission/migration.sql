ALTER TABLE `Manufacturer`
    DROP COLUMN `proposedCommissionRate`,
    DROP COLUMN `agreedCommissionRate`,
    DROP COLUMN `commissionStatus`,
    DROP COLUMN `commissionLastProposedBy`,
    DROP COLUMN `commissionFinalizedAt`,
    DROP COLUMN `commissionLockUntil`,
    DROP COLUMN `commissionHistory`,
    DROP COLUMN `commissionNote`,
    DROP COLUMN `adminCommissionFeedback`;

DELETE FROM `Permission`
WHERE `code` IN ('manufacturer:commission_propose', 'manufacturer:admin_commission_update');
