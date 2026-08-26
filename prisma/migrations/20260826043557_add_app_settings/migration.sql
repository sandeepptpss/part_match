-- CreateTable
CREATE TABLE `AppSettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `requireYear` BOOLEAN NOT NULL DEFAULT true,
    `requireAllFields` BOOLEAN NOT NULL DEFAULT true,
    `logNoResults` BOOLEAN NOT NULL DEFAULT true,
    `includeUniversal` BOOLEAN NOT NULL DEFAULT true,
    `redirectOnSearch` BOOLEAN NOT NULL DEFAULT false,
    `resultsUrl` VARCHAR(191) NOT NULL DEFAULT '/pages/find-your-part',
    `persistSelection` BOOLEAN NOT NULL DEFAULT true,
    `enableGarage` BOOLEAN NOT NULL DEFAULT true,
    `showFitmentChecker` BOOLEAN NOT NULL DEFAULT true,
    `themeExtensionConfirmed` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `AppSettings_shop_key`(`shop`),
    INDEX `AppSettings_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
