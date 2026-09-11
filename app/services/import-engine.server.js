/**
 * Staging, Conflict Detection, and Batch Processing Import Engine
 * 
 * Manages import lifecycles:
 * 1. Creates background/audited ImportJob records.
 * 2. Normalizes input and stages records into StagedFitment with conflict detection.
 * 3. Commits merchant-approved staged records to master FitmentRecord / FitmentProduct tables.
 * 4. Supports 1-click historical rollback without affecting previous records.
 */

import prisma from "../db.server.js";
import { normalizeVehicleRecord } from "./vehicle-normalizer.server.js";
import { getShopPlan, planLimits } from "../plans.server.js";

/**
 * Creates a new ImportJob record.
 */
export async function createImportJob({ shop, fileName, fileType = "CSV", totalRows = 0 }) {
  return await prisma.importJob.create({
    data: {
      shop,
      fileName,
      fileType,
      status: "PROCESSING",
      totalRows,
      processedRows: 0,
    },
  });
}

/**
 * Stages incoming records into StagedFitment, normalizing vehicles and detecting conflicts.
 */
export async function stageRecords({ jobId, shop, records, source = "CSV" }) {
  if (!records || records.length === 0) return { staged: 0, conflicts: 0 };

  const stagedData = [];
  let conflictCount = 0;

  // Cache existing universal products to detect universal vs. specific vehicle conflicts
  const universalProducts = await prisma.universalProduct.findMany({
    where: { shop },
    select: { shopifyHandle: true },
  });
  const universalHandles = new Set(universalProducts.map((u) => u.shopifyHandle.toLowerCase()));

  for (const raw of records) {
    const rawYear = String(raw.year || "").trim();
    const rawMake = String(raw.make || "").trim();
    const rawModel = String(raw.model || "").trim();
    const rawTrim = String(raw.trim || "").trim();
    const partNumber = String(raw.partNumber || raw.handle || raw.sku || "").trim();
    const shopifyProductId = raw.shopifyProductId || null;
    const shopifyVariantId = raw.shopifyVariantId || "";
    const productTitle = raw.productTitle || "";
    const confidence = raw.confidence != null ? raw.confidence : 100;
    const reason = raw.reason || raw.extractionReason || "";

    if (!rawYear || !rawMake || !rawModel) continue;

    // Run vehicle normalizer
    const normalizedVehicles = normalizeVehicleRecord({
      year: rawYear,
      make: rawMake,
      model: rawModel,
      trim: rawTrim,
    });

    for (const v of normalizedVehicles) {
      let hasConflict = false;
      const conflictReasons = [];

      // Conflict Check 1: Is this product marked Universal?
      const handleLower = (partNumber || raw.shopifyHandle || "").toLowerCase();
      if (handleLower && universalHandles.has(handleLower)) {
        hasConflict = true;
        conflictReasons.push("Product is already configured as Universal Fit (fits all vehicles).");
      }

      // Conflict Check 2: Low confidence match warning
      if (confidence < 75) {
        hasConflict = true;
        conflictReasons.push(`Low AI extraction confidence (${confidence}%). Vehicle specifications should be verified.`);
      }

      if (hasConflict) conflictCount++;

      stagedData.push({
        importJobId: jobId,
        shop,
        year: v.year,
        make: v.make,
        model: v.model,
        trim: v.trim,
        canonicalVehicleId: v.canonicalVehicleId,
        normalizedMake: v.make,
        normalizedModel: v.model,
        partNumber: partNumber,
        shopifyProductId: shopifyProductId,
        shopifyVariantId: shopifyVariantId,
        shopifyHandle: raw.shopifyHandle || partNumber,
        productTitle: productTitle || partNumber,
        confidence,
        source,
        status: hasConflict ? "CONFLICT" : "PENDING",
        hasConflict,
        conflictReason: conflictReasons.join(" | ") || null,
        extractionReason: reason || null,
        rawRecord: JSON.stringify(raw),
      });
    }
  }

  // Batch insert into StagedFitment in chunks of 250 records
  const chunkSize = 250;
  for (let i = 0; i < stagedData.length; i += chunkSize) {
    const chunk = stagedData.slice(i, i + chunkSize);
    await prisma.stagedFitment.createMany({ data: chunk });
  }

  // Update ImportJob status and metrics
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "STAGED",
      totalRows: stagedData.length,
      processedRows: stagedData.length,
      stagedCount: stagedData.length,
      conflictCount,
    },
  });

  return { staged: stagedData.length, conflicts: conflictCount };
}

/**
 * Commits approved staged records into the master FitmentRecord & FitmentProduct tables.
 */
export async function commitStagedItems({ shop, jobId, itemIds = null, resolveProduct = null }) {
  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  let recordCount = Number.isFinite(limits.fitmentLimit)
    ? await prisma.fitmentRecord.count({ where: { shop } })
    : 0;
  let limitReached = false;

  const whereClause = {
    importJobId: jobId,
    shop,
    ...(itemIds && Array.isArray(itemIds) && itemIds.length > 0
      ? { id: { in: itemIds } }
      : { status: { in: ["PENDING", "APPROVED", "CONFLICT"] } }),
  };

  const stagedItems = await prisma.stagedFitment.findMany({ where: whereClause });

  let committedCount = 0;
  let skippedCount = 0;

  for (const item of stagedItems) {
    if (limitReached) {
      skippedCount++;
      continue;
    }

    try {
      const existingRecord = Number.isFinite(limits.fitmentLimit)
        ? await prisma.fitmentRecord.findUnique({
            where: {
              shop_year_make_model_trim: {
                shop,
                year: item.year,
                make: item.make,
                model: item.model,
                trim: item.trim || "",
              },
            },
          })
        : null;

      if (!existingRecord && Number.isFinite(limits.fitmentLimit) && recordCount >= limits.fitmentLimit) {
        limitReached = true;
        skippedCount++;
        continue;
      }

      // Upsert master FitmentRecord with source and importJobId
      const fitment = await prisma.fitmentRecord.upsert({
        where: {
          shop_year_make_model_trim: {
            shop,
            year: item.year,
            make: item.make,
            model: item.model,
            trim: item.trim || "",
          },
        },
        create: {
          shop,
          year: item.year,
          make: item.make,
          model: item.model,
          trim: item.trim || "",
          source: item.source || "IMPORT",
          importJobId: jobId,
        },
        update: {
          importJobId: jobId,
        },
      });

      if (!existingRecord) recordCount++;

      // Connect Product or SKU if available
      if (item.shopifyProductId) {
        await prisma.fitmentProduct.upsert({
          where: {
            fitmentId_shopifyProductId: {
              fitmentId: fitment.id,
              shopifyProductId: item.shopifyProductId,
            },
          },
          create: {
            fitmentId: fitment.id,
            shopifyProductId: item.shopifyProductId,
            shopifyVariantId: item.shopifyVariantId || "",
            shopifyHandle: item.shopifyHandle || "",
            productTitle: item.productTitle || "",
            confidence: item.confidence,
            source: item.source || "IMPORT",
            importJobId: jobId,
          },
          update: {
            shopifyHandle: item.shopifyHandle || undefined,
            productTitle: item.productTitle || undefined,
          },
        });
      } else if (item.partNumber) {
        let product = null;
        if (resolveProduct) {
          try {
            product = await resolveProduct(item.partNumber.toLowerCase());
          } catch (err) {
            console.warn("[import-engine] Error resolving product handle:", err);
          }
        }

        if (product && product.id) {
          await prisma.fitmentProduct.upsert({
            where: {
              fitmentId_shopifyProductId: {
                fitmentId: fitment.id,
                shopifyProductId: product.id,
              },
            },
            create: {
              fitmentId: fitment.id,
              shopifyProductId: product.id,
              shopifyHandle: product.handle || item.partNumber,
              productTitle: product.title || item.partNumber,
              confidence: item.confidence,
              source: item.source || "IMPORT",
              importJobId: jobId,
            },
            update: {},
          });
        } else {
          await prisma.fitmentSku.upsert({
            where: { fitmentId_sku: { fitmentId: fitment.id, sku: item.partNumber } },
            create: { fitmentId: fitment.id, sku: item.partNumber },
            update: {},
          });
        }
      }

      // Mark staged item committed
      await prisma.stagedFitment.update({
        where: { id: item.id },
        data: { status: "COMMITTED" },
      });

      committedCount++;
    } catch (err) {
      console.error("[import-engine] Error committing staged item:", item.id, err);
      skippedCount++;
    }
  }

  // Update ImportJob metrics
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      approvedCount: committedCount,
      summaryJson: JSON.stringify({ committedCount, skippedCount, limitReached }),
    },
  });

  return { committedCount, skippedCount, limitReached };
}

/**
 * Rolls back an ImportJob, deleting all fitment records created by this job.
 */
export async function rollbackImportJob({ shop, jobId }) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, shop },
  });

  if (!job) {
    throw new Error("Import job not found or unauthorized");
  }

  // Delete mapped products tagged with this importJobId
  const deletedProducts = await prisma.fitmentProduct.deleteMany({
    where: { importJobId: jobId },
  });

  // Delete fitment records created by this job that have no remaining products, collections, tags, or skus
  const records = await prisma.fitmentRecord.findMany({
    where: { shop, importJobId: jobId },
    include: {
      products: true,
      collections: true,
      tags: true,
      skus: true,
    },
  });

  let deletedRecordsCount = 0;
  for (const rec of records) {
    // If no collections, tags, or products from other jobs are mapped, safely remove
    if (rec.products.length === 0 && rec.collections.length === 0 && rec.tags.length === 0) {
      if (rec.skus.length > 0) {
        await prisma.fitmentSku.deleteMany({ where: { fitmentId: rec.id } });
      }
      await prisma.fitmentRecord.delete({ where: { id: rec.id } });
      deletedRecordsCount++;
    }
  }

  // Mark job as rolled back
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "ROLLED_BACK",
      errorMessage: `Rolled back by merchant. Deleted ${deletedProducts.count} mapped products and ${deletedRecordsCount} vehicle specifications.`,
    },
  });

  return {
    success: true,
    deletedProducts: deletedProducts.count,
    deletedRecords: deletedRecordsCount,
  };
}

/**
 * Fetches recent import history for audit logging.
 */
export async function getImportJobHistory(shop, limit = 15) {
  return await prisma.importJob.findMany({
    where: { shop },
    orderBy: { id: "desc" },
    take: limit,
  });
}
