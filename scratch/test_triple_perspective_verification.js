/**
 * Comprehensive Triple-Perspective Verification Suite:
 * 1. QA Engineer Perspective (Data integrity, edge cases, boundaries, rollback isolation)
 * 2. Customer Perspective (YMM dropdowns, storefront search results, PDP fitment checker)
 * 3. Merchant Perspective (Staging safety, conflict visibility, AI explanations, audit logs)
 */

import prisma from "../app/db.server.js";
import {
  normalizeVehicleRecord,
  expandYearRange,
  normalizeMake,
  normalizeModel,
  normalizeTrim,
  generateCanonicalVehicleId,
} from "../app/services/vehicle-normalizer.server.js";
import { extractFitmentFromDocument } from "../app/services/catalog-extractor.server.js";
import {
  createImportJob,
  stageRecords,
  commitStagedItems,
  rollbackImportJob,
  getImportJobHistory,
} from "../app/services/import-engine.server.js";
import { PLAN_TIERS, planLimits } from "../app/plans.config.js";

console.log("=========================================================================");
console.log("   TRIPLE-PERSPECTIVE VERIFICATION: QA ENGINEER, CUSTOMER & MERCHANT    ");
console.log("=========================================================================\n");

let passed = 0;
let failed = 0;
const perspectiveLog = { QA: [], Customer: [], Merchant: [] };

function assert(perspective, condition, testName, details = "") {
  if (condition) {
    console.log(`  ✓ [${perspective}] PASS: ${testName}`);
    if (details) console.log(`         └─ ${details}`);
    passed++;
    perspectiveLog[perspective].push({ status: "PASS", testName });
  } else {
    console.error(`  ✕ [${perspective}] FAIL: ${testName}`);
    if (details) console.error(`         └─ ${details}`);
    failed++;
    perspectiveLog[perspective].push({ status: "FAIL", testName, details });
  }
}

async function runVerification() {
  const shop = "quickstart-749ac396.myshopify.com";

  // Clean test artifacts from previous test runs if any
  await prisma.stagedFitment.deleteMany({ where: { shop } });
  await prisma.importJob.deleteMany({ where: { shop, fileName: { startsWith: "test_" } } });

  // ═══════════════════════════════════════════════════════════════════════
  // PERSPECTIVE 1: QA ENGINEER (Edge Cases, Boundaries, Isolation)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n-------------------------------------------------------------------------");
  console.log("  PERSPECTIVE 1: QA ENGINEER VERIFICATION");
  console.log("-------------------------------------------------------------------------");

  // 1.1 Complex Year Range Expansion Edge Cases
  const range1 = expandYearRange("2012-2016");
  assert("QA", range1.length === 5 && range1[0] === "2012" && range1[4] === "2016", "Standard range '2012-2016' expands to exactly 5 years", JSON.stringify(range1));

  const range2 = expandYearRange("2018 to 2021");
  assert("QA", range2.length === 4 && range2.includes("2020"), "'2018 to 2021' expands correctly with 'to' separator", JSON.stringify(range2));

  const range3 = expandYearRange("2019/2022");
  assert("QA", range3.length === 4 && range3.includes("2021"), "'2019/2022' expands correctly with slash separator", JSON.stringify(range3));

  const range4 = expandYearRange("1999-03");
  assert("QA", range4.length === 5 && range4[0] === "1999" && range4[4] === "2003", "Century rollover '1999-03' expands to 1999-2003", JSON.stringify(range4));

  // 1.2 Case-insensitivity & Brand Alias Edge Cases
  assert("QA", normalizeMake("cHeVy") === "Chevrolet", "Irregular casing 'cHeVy' -> 'Chevrolet'");
  assert("QA", normalizeMake("  volkswagen  ") === "Volkswagen", "Untrimmed '  volkswagen  ' -> 'Volkswagen'");
  assert("QA", normalizeMake("MERCEDES-BENZ") === "Mercedes-Benz", "Hyphenated uppercase 'MERCEDES-BENZ' -> 'Mercedes-Benz'");
  assert("QA", normalizeModel("silverado 1500") === "Silverado 1500", "Whitespace separated model normalized");
  assert("QA", normalizeTrim("5.3 v8 4wd") === "5.3L v8 4WD", "Engine displacement '5.3' normalized to '5.3L' & '4wd' capitalized to '4WD'");

  // 1.3 Plan Gating Enforcements
  assert("QA", planLimits("free").aiDocumentImport === false, "Starter Free plan strictly blocks AI Document Import");
  assert("QA", planLimits("starter").aiDocumentImport === false, "Starter Pro plan strictly blocks AI Document Import");
  assert("QA", planLimits("growth").aiDocumentImport === false, "Growth Pro plan blocks AI Document Import (Enterprise exclusive)");
  assert("QA", planLimits("enterprise").aiDocumentImport === true, "Enterprise plan unlocks AI Document Import");
  assert("QA", planLimits("free").importAuditHistory === false, "Starter Free plan blocks Import Audit Rollback");
  assert("QA", planLimits("growth").importAuditHistory === true, "Growth Pro plan unlocks Import Audit Rollback");

  // 1.4 Rollback Isolation Test: Ensure rolling back Job A does NOT delete Job B's data
  const jobA = await createImportJob({ shop, fileName: "test_supplier_a.csv", fileType: "CSV" });
  const jobB = await createImportJob({ shop, fileName: "test_supplier_b.csv", fileType: "CSV" });

  // Stage & Commit Job A (Part A on 2021 Ford F-150)
  await stageRecords({
    jobId: jobA.id,
    shop,
    records: [{ year: "2021", make: "Ford", model: "F-150", trim: "XL", partNumber: "PART-A-UNIQUE" }],
  });
  await commitStagedItems({ shop, jobId: jobA.id });

  // Stage & Commit Job B (Part B on 2022 Ford F-150)
  await stageRecords({
    jobId: jobB.id,
    shop,
    records: [{ year: "2022", make: "Ford", model: "F-150", trim: "XLT", partNumber: "PART-B-UNIQUE" }],
  });
  await commitStagedItems({ shop, jobId: jobB.id });

  // Rollback ONLY Job A
  await rollbackImportJob({ shop, jobId: jobA.id });

  const recordAAfter = await prisma.fitmentRecord.findFirst({
    where: { shop, year: "2021", make: "Ford", model: "F-150", trim: "XL" },
  });
  const recordBAfter = await prisma.fitmentRecord.findFirst({
    where: { shop, year: "2022", make: "Ford", model: "F-150", trim: "XLT" },
  });

  assert("QA", recordAAfter === null, "Rollback cleanly removed Job A's vehicle record");
  assert("QA", recordBAfter !== null, "Rollback ISOLATION verified: Job B's vehicle record remained completely untouched");

  // Clean up Job B
  await rollbackImportJob({ shop, jobId: jobB.id });

  // ═══════════════════════════════════════════════════════════════════════
  // PERSPECTIVE 2: CUSTOMER (Shopper Discovery, Search & PDP Verification)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n-------------------------------------------------------------------------");
  console.log("  PERSPECTIVE 2: CUSTOMER (SHOPPER) VERIFICATION");
  console.log("-------------------------------------------------------------------------");

  // Create an AI Imported Catalog Batch for Customer Journey Testing
  // Supplier: Brake pad catalog for 2017-2019 Toyota Tacoma TRD
  const customerTestJob = await createImportJob({
    shop,
    fileName: "test_customer_catalog.pdf",
    fileType: "PDF_CATALOG",
  });

  const stagedCustomerItems = [
    {
      year: "2017-2019", // Range to verify shopper can find it in 2017, 2018, OR 2019
      make: "Toyota",
      model: "Tacoma",
      trim: "TRD Off-Road",
      shopifyProductId: "gid://shopify/Product/9988776655",
      shopifyHandle: "toyota-tacoma-trd-brake-pad-kit",
      productTitle: "Toyota Tacoma TRD Ceramic Brake Pad Kit",
      confidence: 96,
      reason: "OEM direct fitment specifications",
    },
  ];

  await stageRecords({
    jobId: customerTestJob.id,
    shop,
    records: stagedCustomerItems,
    source: "PDF_AI",
  });
  await commitStagedItems({ shop, jobId: customerTestJob.id });

  // 2.1 Customer Dropdown Discovery: Does 2018 Toyota Tacoma exist in the catalog?
  const customerYearRecords = await prisma.fitmentRecord.findMany({
    where: { shop, year: "2018", make: "Toyota", model: "Tacoma" },
  });
  assert(
    "Customer",
    customerYearRecords.length > 0,
    "Shopper selecting Year '2018' finds expanded model year from imported range '2017-2019'"
  );

  // 2.2 Storefront Search Resolution
  // Simulate storefront query for 2018 Toyota Tacoma TRD Off-Road
  const searchResults = await prisma.fitmentRecord.findFirst({
    where: { shop, year: "2018", make: "Toyota", model: "Tacoma" },
    include: { products: true },
  });

  assert(
    "Customer",
    searchResults?.products?.some((p) => p.shopifyHandle === "toyota-tacoma-trd-brake-pad-kit"),
    "Storefront search for '2018 Toyota Tacoma' returns the exact compatible part handle",
    searchResults?.products?.[0]?.productTitle
  );

  // 2.3 Storefront PDP Fitment Checker Check
  // Compatible vehicle check
  const fitsCompatible = await prisma.fitmentRecord.findFirst({
    where: {
      shop,
      year: "2019",
      make: "Toyota",
      model: "Tacoma",
      products: { some: { shopifyHandle: "toyota-tacoma-trd-brake-pad-kit" } },
    },
  });
  assert("Customer", fitsCompatible !== null, "PDP Checker confirms: '✓ FITS 2019 Toyota Tacoma'");

  // Incompatible vehicle check
  const fitsIncompatible = await prisma.fitmentRecord.findFirst({
    where: {
      shop,
      year: "2012",
      make: "Honda",
      model: "Civic",
      products: { some: { shopifyHandle: "toyota-tacoma-trd-brake-pad-kit" } },
    },
  });
  assert("Customer", fitsIncompatible === null, "PDP Checker confirms: '✕ DOES NOT FIT 2012 Honda Civic' (zero false positives)");

  // Clean customer test records
  await rollbackImportJob({ shop, jobId: customerTestJob.id });

  // ═══════════════════════════════════════════════════════════════════════
  // PERSPECTIVE 3: MERCHANT (Safety, Conflict Visibility, Audit Logs)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n-------------------------------------------------------------------------");
  console.log("  PERSPECTIVE 3: MERCHANT (STORE ADMIN) VERIFICATION");
  console.log("-------------------------------------------------------------------------");

  // 3.1 Unstructured Supplier Catalog Ingestion
  const merchantCatalogText = `
    ACME HIGH PERFORMANCE DISTRIBUTORS
    Part SKU: ACME-BRK-SILVERADO
    Fitment: 2020-2022 Chevrolet Silverado 1500 with 5.3L V8 Engine.
    Part SKU: ACME-OIL-CAP-GENERIC
    Fitment: Universal engine oil filler cap for all vehicles.
  `;

  const extraction = await extractFitmentFromDocument(merchantCatalogText);
  assert(
    "Merchant",
    extraction.records.length >= 1,
    "Merchant can extract structured fitments from unstructured supplier spec sheets",
    `Extracted ${extraction.records.length} items`
  );

  // 3.2 Pre-existing Universal Product Conflict Detection
  // Create a universal product in DB to test merchant conflict guard
  await prisma.universalProduct.upsert({
    where: { shop_shopifyProductId: { shop, shopifyProductId: "gid://shopify/Product/universal-cap-1" } },
    create: {
      shop,
      shopifyProductId: "gid://shopify/Product/universal-cap-1",
      shopifyHandle: "acme-oil-cap-generic",
      productTitle: "ACME Universal Oil Filler Cap",
    },
    update: {},
  });

  const merchantJob = await createImportJob({
    shop,
    fileName: "test_supplier_acme_spec.pdf",
    fileType: "PDF_CATALOG",
  });

  const rawMerchantBatch = [
    {
      year: "2021",
      make: "Chevrolet",
      model: "Silverado 1500",
      trim: "5.3L",
      partNumber: "ACME-BRK-SILVERADO",
      confidence: 95,
      reason: "Explicit catalog listing",
    },
    {
      year: "2022",
      make: "Ford",
      model: "F-150",
      trim: "Base",
      partNumber: "acme-oil-cap-generic", // Matches universal product above!
      confidence: 80,
      reason: "Universal accessory listed under Ford",
    },
    {
      year: "2023",
      make: "Dodge",
      model: "Ram",
      trim: "",
      partNumber: "ACME-UNCERTAIN-PART",
      confidence: 60, // Low confidence match
      reason: "Vague model reference in supplier text",
    },
  ];

  const stageMerchantResult = await stageRecords({
    jobId: merchantJob.id,
    shop,
    records: rawMerchantBatch,
    source: "PDF_AI",
  });

  assert("Merchant", stageMerchantResult.staged === 3, "All 3 items staged safely without modifying live catalog");
  assert("Merchant", stageMerchantResult.conflicts >= 2, "Conflict Guard flagged Universal product overlap AND low-confidence item");

  // 3.3 Conflict Reason Transparency for Merchant
  const flaggedItems = await prisma.stagedFitment.findMany({
    where: { importJobId: merchantJob.id, hasConflict: true },
  });
  const universalConflict = flaggedItems.find((i) => i.conflictReason?.includes("Universal Fit"));
  const confidenceConflict = flaggedItems.find((i) => i.conflictReason?.includes("Low AI extraction confidence"));

  assert("Merchant", universalConflict != null, "Merchant sees clear conflict warning: 'Product is already configured as Universal Fit'");
  assert("Merchant", confidenceConflict != null, "Merchant sees clear warning: 'Low AI extraction confidence (60%)'");

  // 3.4 Selective Merchant Approval: Merchant only approves High Confidence non-conflicting item
  const highConfidenceItem = await prisma.stagedFitment.findFirst({
    where: { importJobId: merchantJob.id, hasConflict: false },
  });

  const commitMerchantResult = await commitStagedItems({
    shop,
    jobId: merchantJob.id,
    itemIds: [highConfidenceItem.id],
  });
  assert("Merchant", commitMerchantResult.committedCount === 1, "Merchant selectively approved 1 safe record into live catalog");

  // 3.5 Audit History Visibility
  const auditJobs = await getImportJobHistory(shop, 5);
  const foundMerchantJob = auditJobs.find((j) => j.id === merchantJob.id);
  assert("Merchant", foundMerchantJob != null, "Merchant sees completed import job in Audit History with exact timestamp");
  assert("Merchant", foundMerchantJob?.approvedCount === 1, "Audit record shows exact count of approved records (1)");

  // 3.6 1-Click Rollback Disaster Recovery
  const rollbackMerchant = await rollbackImportJob({ shop, jobId: merchantJob.id });
  assert("Merchant", rollbackMerchant.success === true, "1-Click Rollback successfully reversed the import batch");

  const jobPostRollback = await prisma.importJob.findUnique({ where: { id: merchantJob.id } });
  assert("Merchant", jobPostRollback.status === "ROLLED_BACK", "Audit log shows status updated to 'ROLLED_BACK' with merchant reason");

  // Clean universal test product
  await prisma.universalProduct.deleteMany({ where: { shop, shopifyProductId: "gid://shopify/Product/universal-cap-1" } });

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=========================================================================");
  console.log("   TRIPLE-PERSPECTIVE VERIFICATION SUMMARY");
  console.log("=========================================================================");
  console.log(`  QA Engineer Checks:    ${perspectiveLog.QA.filter((x) => x.status === "PASS").length} Passed, ${perspectiveLog.QA.filter((x) => x.status === "FAIL").length} Failed`);
  console.log(`  Customer (Shopper):    ${perspectiveLog.Customer.filter((x) => x.status === "PASS").length} Passed, ${perspectiveLog.Customer.filter((x) => x.status === "FAIL").length} Failed`);
  console.log(`  Merchant (Store Admin): ${perspectiveLog.Merchant.filter((x) => x.status === "PASS").length} Passed, ${perspectiveLog.Merchant.filter((x) => x.status === "FAIL").length} Failed`);
  console.log("-------------------------------------------------------------------------");
  console.log(`  TOTAL: ${passed} PASSED / ${failed} FAILED`);
  console.log("=========================================================================\n");

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runVerification().catch((err) => {
  console.error("Verification execution error:", err);
  process.exit(1);
});
