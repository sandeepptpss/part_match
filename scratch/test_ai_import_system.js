/**
 * Verification Test Suite for AI Vehicle Fitment Import System
 */

import prisma from "../app/db.server.js";
import { normalizeVehicleRecord, expandYearRange, normalizeMake, normalizeModel } from "../app/services/vehicle-normalizer.server.js";
import { extractFitmentFromDocument } from "../app/services/catalog-extractor.server.js";
import { createImportJob, stageRecords, commitStagedItems, rollbackImportJob, getImportJobHistory } from "../app/services/import-engine.server.js";
import { PLAN_TIERS, planLimits } from "../app/plans.config.js";

console.log("================================================================");
console.log("  AI VEHICLE FITMENT IMPORT SYSTEM - INTEGRATION VERIFICATION   ");
console.log("================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    if (details) console.log(`         └─ ${details}`);
    passed++;
  } else {
    console.error(`  ✕ FAIL: ${testName}`);
    if (details) console.error(`         └─ ${details}`);
    failed++;
  }
}

async function runTests() {
  const shop = "quickstart-749ac396.myshopify.com";

  // 1. Plan tiers check
  console.log("\n--- TEST GROUP 1: Plan Tiers Configuration ---");
  assert(PLAN_TIERS.enterprise.aiDocumentImport === true, "Enterprise has aiDocumentImport enabled");
  assert(PLAN_TIERS.starter.aiDocumentImport === false, "Starter does not have aiDocumentImport");
  assert(PLAN_TIERS.growth.importAuditHistory === true, "Growth has importAuditHistory enabled");
  assert(PLAN_TIERS.starter.backgroundBulkImport === true, "Starter has backgroundBulkImport enabled");

  // 2. Vehicle Normalization check
  console.log("\n--- TEST GROUP 2: Vehicle Normalization & Alias Mapping ---");
  const years = expandYearRange("2015-2018");
  assert(years.length === 4 && years.includes("2015") && years.includes("2018"), "Year range 2015-2018 expanded to 4 years", JSON.stringify(years));

  const shortYears = expandYearRange("2016-18");
  assert(shortYears.length === 3 && shortYears.includes("2017"), "Abbreviated year range 2016-18 expanded correctly", JSON.stringify(shortYears));

  const normMake1 = normalizeMake("chevy");
  assert(normMake1 === "Chevrolet", "Normalized 'chevy' -> 'Chevrolet'");

  const normMake2 = normalizeMake("vw");
  assert(normMake2 === "Volkswagen", "Normalized 'vw' -> 'Volkswagen'");

  const normModel = normalizeModel("f 150");
  assert(normModel === "F-150", "Normalized 'f 150' -> 'F-150'");

  const fullRecord = normalizeVehicleRecord({
    year: "2020-2022",
    make: "chevy",
    model: "silverado1500",
    trim: "5.3",
  });
  assert(fullRecord.length === 3, "Full record expansion created 3 year entries");
  assert(fullRecord[0].make === "Chevrolet", "Normalized make is Chevrolet");
  assert(fullRecord[0].model === "Silverado 1500", "Normalized model is Silverado 1500");
  assert(fullRecord[0].trim === "5.3L", "Normalized trim is 5.3L");
  assert(fullRecord[0].canonicalVehicleId.startsWith("CANONICAL-2020-CHEVROLET-SILVERADO-1500"), "Generated valid Canonical Vehicle ID");

  // 3. AI Document / Catalog Extraction
  console.log("\n--- TEST GROUP 3: AI Document & Catalog Extractor ---");
  const sampleSupplierText = `
    SUPPLIER BRAKE CATALOG 2024
    Item: Heavy-Duty Front Brake Pad Set
    Fits 2018-2021 Ford F-150 with 3.5L V6 EcoBoost engine. Part SKU: BP-F150-HD
    Fits 2020-2022 Chevrolet Silverado 1500 LT. Part SKU: BP-SILV-HD
  `;
  const extractionResult = await extractFitmentFromDocument(sampleSupplierText);
  assert(extractionResult.records.length > 0, "Extracted fitments from unstructured supplier text", `Extracted ${extractionResult.records.length} records`);

  // 4. Staging Queue & Conflict Detection
  console.log("\n--- TEST GROUP 4: Staging Queue, Conflict Detection & Batch Commit ---");
  const job = await createImportJob({
    shop,
    fileName: "supplier_catalog_test.pdf",
    fileType: "PDF_CATALOG",
  });
  assert(job && job.id > 0, `Created ImportJob with ID ${job.id}`);

  // Stage records with deliberate test records (one normal, one low confidence)
  const testItems = [
    {
      year: "2023",
      make: "Toyota",
      model: "Tacoma",
      trim: "TRD Pro",
      partNumber: "TAC-SKID-2023",
      confidence: 95,
      reason: "High confidence supplier fitment",
    },
    {
      year: "2024",
      make: "Ford",
      model: "Ranger",
      trim: "Lariat",
      partNumber: "RNG-LIFT-2024",
      confidence: 60, // should trigger conflict/warning badge
      reason: "Uncertain sub-model compatibility",
    },
  ];

  const stageResult = await stageRecords({
    jobId: job.id,
    shop,
    records: testItems,
    source: "PDF_AI",
  });
  assert(stageResult.staged === 2, `Staged 2 items successfully`);
  assert(stageResult.conflicts >= 1, `Conflict detection flagged low-confidence or ambiguous record`);

  // Verify staged records in DB
  const stagedInDb = await prisma.stagedFitment.findMany({ where: { importJobId: job.id } });
  assert(stagedInDb.length === 2, "StagedFitment rows exist in database with correct foreign key");

  // Commit staged items
  const commitResult = await commitStagedItems({
    shop,
    jobId: job.id,
  });
  assert(commitResult.committedCount >= 1, `Committed ${commitResult.committedCount} items into master fitment table`);

  // Verify master fitment record was created with source and importJobId
  const masterRecord = await prisma.fitmentRecord.findFirst({
    where: { shop, make: "Toyota", model: "Tacoma", importJobId: job.id },
  });
  assert(masterRecord != null, "Master FitmentRecord successfully created with importJobId tagging");

  // 5. Audit History & Rollback Check
  console.log("\n--- TEST GROUP 5: Audit History & Rollback Engine ---");
  const history = await getImportJobHistory(shop, 5);
  assert(history.length > 0 && history[0].id === job.id, "ImportJob history contains newly completed job");

  const rollbackResult = await rollbackImportJob({
    shop,
    jobId: job.id,
  });
  assert(rollbackResult.success === true, "Rollback executed cleanly without error");

  const masterAfterRollback = await prisma.fitmentRecord.findFirst({
    where: { id: masterRecord.id },
  });
  assert(masterAfterRollback === null, "Rollback cleanly removed records created by this import job");

  const jobAfterRollback = await prisma.importJob.findUnique({ where: { id: job.id } });
  assert(jobAfterRollback.status === "ROLLED_BACK", "ImportJob status transitioned to ROLLED_BACK");

  console.log("\n================================================================");
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("================================================================\n");

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
