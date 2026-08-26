-- CreateTable
CREATE TABLE `SavedVehicle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(100) NOT NULL,
    `customerId` VARCHAR(100) NOT NULL,
    `year` VARCHAR(50) NOT NULL,
    `make` VARCHAR(100) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SavedVehicle_shop_customerId_idx`(`shop`, `customerId`),
    UNIQUE INDEX `SavedVehicle_shop_customerId_year_make_model_key`(`shop`, `customerId`, `year`, `make`, `model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
