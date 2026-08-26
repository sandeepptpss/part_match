-- CreateTable
CREATE TABLE `ShopPlan` (
    `shop` VARCHAR(191) NOT NULL,
    `plan` VARCHAR(191) NOT NULL DEFAULT 'free',
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'monthly',
    `subscriptionId` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`shop`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
