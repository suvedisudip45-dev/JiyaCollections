UPDATE `Product`
SET `published` = false, `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` IN (
    SELECT `productId`
    FROM `CollaborationProduct`
);

UPDATE `CollaborationProduct`
SET `listingStatus` = 'ENDED', `updatedAt` = CURRENT_TIMESTAMP(3);

UPDATE `ComboBundle`
SET `status` = 'INACTIVE', `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `id` IN (
    SELECT DISTINCT `comboBundleId`
    FROM `ComboBundleProduct`
    WHERE `productId` IN (
        SELECT `productId`
        FROM `CollaborationProduct`
    )
);

UPDATE `Permission`
SET `isActive` = false, `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` IN (
    'partner:collaboration_read',
    'partner:collaboration_terms_manage',
    'collaboration:admin_manage',
    'collaboration:admin_reports_read',
    'manufacturer:collaboration_read'
);
