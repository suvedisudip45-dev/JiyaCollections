INSERT INTO `Permission` (`id`, `code`, `description`, `isActive`, `createdAt`, `updatedAt`)
SELECT UUID(), 'manufacturer:inventory_read', 'Read manufacturer inventory.', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
    SELECT 1 FROM `Permission` WHERE `code` = 'manufacturer:inventory_read'
);

INSERT INTO `RolePermissionMapping` (`id`, `roleId`, `permissionId`, `createdAt`)
SELECT UUID(), roles.`id`, permissions.`id`, CURRENT_TIMESTAMP(3)
FROM `Role` roles
JOIN `Permission` permissions ON permissions.`code` = 'manufacturer:inventory_read'
WHERE roles.`code` = 'MANUFACTURER'
ON DUPLICATE KEY UPDATE `permissionId` = VALUES(`permissionId`);
