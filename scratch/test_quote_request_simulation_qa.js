/**
 * QA Engineer Simulation Test Suite
 * Feature: Enterprise Quote Request System for Shopify Merchants
 * Route: app/routes/app.plans.jsx & app/routes/app.admin.jsx
 * Database: MySQL / Prisma ORM
 */

/* eslint-disable no-console */
import prisma from "../app/db.server.js";

const TEST_SHOP = "qa-simulation-merchant.myshopify.com";
const TEST_EMAIL = "qa-engineer@autocatalog-test.com";

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}${details ? ` (${details})` : ""}`);
    passedCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName}${details ? ` (${details})` : ""}`);
    failedCount++;
  }
}

// Simulates the exact action logic in app/routes/app.plans.jsx
async function simulatePlansAction(shop, sessionEmail, formDataMap) {
  const intent = formDataMap.get("intent");

  if (intent === "submitQuoteRequest") {
    const quoteIdRaw = formDataMap.get("quoteId")?.toString()?.trim();
    const quoteId = quoteIdRaw && !isNaN(parseInt(quoteIdRaw, 10)) ? parseInt(quoteIdRaw, 10) : null;
    const requestedPlan = formDataMap.get("requestedPlan")?.toString() || "enterprise";
    const requestedFitments = parseInt(formDataMap.get("requestedFitments")?.toString() || "50000", 10) || 50000;
    const rawBudget = formDataMap.get("monthlyBudget")?.toString()?.trim();
    const monthlyBudget = rawBudget && !isNaN(parseFloat(rawBudget)) ? parseFloat(rawBudget) : null;
    const contactEmail = formDataMap.get("contactEmail")?.toString() || sessionEmail || "";
    const dataRequirements = formDataMap.get("dataRequirements")?.toString() || "";
    const notes = formDataMap.get("notes")?.toString() || "";

    try {
      let result;
      if (quoteId != null) {
        result = await prisma.quoteRequest.updateMany({
          where: { id: quoteId, shop },
          data: {
            contactEmail,
            requestedPlan,
            requestedFitments,
            monthlyBudget,
            dataRequirements,
            notes,
            status: "PENDING",
          },
        });
      } else {
        result = await prisma.quoteRequest.create({
          data: {
            shop,
            contactEmail,
            requestedPlan,
            requestedFitments,
            monthlyBudget,
            dataRequirements,
            notes,
            status: "PENDING",
          },
        });
      }

      return {
        success: true,
        data: {
          quoteSuccess: true,
          quoteMessage: `Your custom enterprise quote request for ${requestedFitments.toLocaleString("en-US")} vehicle fitments has been ${quoteId != null ? "updated" : "submitted"}! Your current active plan remains unaffected while our automotive catalog engineering team reviews your specifications.`,
          record: result,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Unable to submit quote request: ${err?.message || "Internal database error"}. Please try again.`,
      };
    }
  }

  return { success: false, error: "Unknown intent" };
}

// Simulates plans loader
async function simulatePlansLoader(shop) {
  const pendingQuote = await prisma.quoteRequest.findFirst({
    where: { shop },
    orderBy: { id: "desc" },
  });
  return { pendingQuote };
}

async function runQASuite() {
  console.log("\n=======================================================");
  console.log("🛠️  STARTING QA SIMULATION TEST SUITE: ENTERPRISE QUOTE");
  console.log("=======================================================\n");

  // Teardown any leftover test data first
  await prisma.quoteRequest.deleteMany({ where: { shop: TEST_SHOP } });

  // -----------------------------------------------------------
  // TEST GROUP 1: Database Singleton & Schema Validation
  // -----------------------------------------------------------
  console.log("\x1b[36m[TEST SUITE 1] Database Model & Schema Integrity\x1b[0m");
  assert(typeof prisma.quoteRequest !== "undefined", "prisma.quoteRequest is defined on db.server");
  assert(typeof prisma.quoteRequest.create === "function", "prisma.quoteRequest.create is an executable function");
  assert(typeof prisma.quoteRequest.updateMany === "function", "prisma.quoteRequest.updateMany is an executable function");
  assert(typeof prisma.quoteRequest.findFirst === "function", "prisma.quoteRequest.findFirst is an executable function");

  const initialCount = await prisma.quoteRequest.count({ where: { shop: TEST_SHOP } });
  assert(initialCount === 0, "Test shop has a clean slate before test execution");

  // -----------------------------------------------------------
  // TEST GROUP 2: Scenario A - Fresh Enterprise Quote Submission
  // -----------------------------------------------------------
  console.log("\n\x1b[36m[TEST SUITE 2] Scenario A: Merchant Submits Fresh Enterprise Quote Request\x1b[0m");
  const freshPayload = new Map([
    ["intent", "submitQuoteRequest"],
    ["quoteId", ""],
    ["requestedPlan", "enterprise"],
    ["requestedFitments", "250000"],
    ["monthlyBudget", "299.00"],
    ["contactEmail", TEST_EMAIL],
    ["dataRequirements", "ACES XML, PIES Standard, SFTP Daily Sync"],
    ["notes", "We have 250,000 automotive fitments across GM, Ford, and Honda. Need high-throughput batch sync."],
  ]);

  const freshRes = await simulatePlansAction(TEST_SHOP, "fallback@session.com", freshPayload);
  assert(freshRes.success === true, "Action executed successfully without throwing error");
  assert(freshRes.data?.quoteSuccess === true, "Action returned quoteSuccess: true");
  assert(freshRes.data?.quoteMessage.includes("250,000"), "Success message reflects requested volume 250,000");
  assert(freshRes.data?.quoteMessage.includes("unaffected"), "Success message guarantees merchant active plan is unaffected");

  const createdRecord = await prisma.quoteRequest.findFirst({ where: { shop: TEST_SHOP } });
  assert(createdRecord !== null, "Record persisted in MySQL database");
  assert(createdRecord.shop === TEST_SHOP, "Stored shop matches merchant domain", createdRecord.shop);
  assert(createdRecord.requestedFitments === 250000, "Stored fitments count matches", String(createdRecord.requestedFitments));
  assert(createdRecord.monthlyBudget === 299.0, "Stored budget matches", String(createdRecord.monthlyBudget));
  assert(createdRecord.contactEmail === TEST_EMAIL, "Stored contact email matches", createdRecord.contactEmail);
  assert(createdRecord.dataRequirements.includes("ACES XML"), "Stored dataRequirements matches", createdRecord.dataRequirements);
  assert(createdRecord.status === "PENDING", "Initial status defaults to PENDING", createdRecord.status);
  assert(createdRecord.createdAt instanceof Date, "createdAt is valid timestamp");

  const quoteId = createdRecord.id;

  // -----------------------------------------------------------
  // TEST GROUP 3: Scenario B - Loader Data Verification
  // -----------------------------------------------------------
  console.log("\n\x1b[36m[TEST SUITE 3] Scenario B: Plans Page Loader Renders Pending Quote Banner\x1b[0m");
  const loaderData = await simulatePlansLoader(TEST_SHOP);
  assert(loaderData.pendingQuote !== null, "Loader successfully retrieves pendingQuote");
  assert(loaderData.pendingQuote.id === quoteId, "Loader returns the exact quote ID", String(quoteId));
  assert(loaderData.pendingQuote.status === "PENDING", "Loader pendingQuote status is PENDING");
  assert(loaderData.pendingQuote.requestedFitments === 250000, "Loader pendingQuote has 250,000 fitments");

  // -----------------------------------------------------------
  // TEST GROUP 4: Scenario C - Merchant Updates Existing Quote
  // -----------------------------------------------------------
  console.log("\n\x1b[36m[TEST SUITE 4] Scenario C: Merchant Modifies Existing Quote Request\x1b[0m");
  const updatePayload = new Map([
    ["intent", "submitQuoteRequest"],
    ["quoteId", String(quoteId)],
    ["requestedPlan", "enterprise"],
    ["requestedFitments", "500000"],
    ["monthlyBudget", "499.50"],
    ["contactEmail", "updated-ops@autocatalog-test.com"],
    ["dataRequirements", "ACES XML, PIES Standard, SEMA Data Co-op, SFTP Daily Sync"],
    ["notes", "Increased catalog scale to 500k parts with SEMA Data Co-op inclusion."],
  ]);

  const updateRes = await simulatePlansAction(TEST_SHOP, "fallback@session.com", updatePayload);
  assert(updateRes.success === true, "Update action executed successfully");
  assert(updateRes.data?.quoteMessage.includes("updated"), "Success message indicates quote was 'updated'");
  assert(updateRes.data?.quoteMessage.includes("500,000"), "Success message reflects updated volume 500,000");

  const totalQuotes = await prisma.quoteRequest.count({ where: { shop: TEST_SHOP } });
  assert(totalQuotes === 1, "No duplicate quote created; exactly 1 quote remains for merchant");

  const updatedRecord = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(updatedRecord.requestedFitments === 500000, "Fitments updated to 500,000");
  assert(updatedRecord.monthlyBudget === 499.5, "Budget updated to 499.50");
  assert(updatedRecord.contactEmail === "updated-ops@autocatalog-test.com", "Contact email updated");
  assert(updatedRecord.dataRequirements.includes("SEMA"), "dataRequirements contains SEMA");
  assert(updatedRecord.status === "PENDING", "Status remains PENDING during merchant revision");

  // -----------------------------------------------------------
  // TEST GROUP 5: Scenario D - Edge Cases & Robustness
  // -----------------------------------------------------------
  console.log("\n\x1b[36m[TEST SUITE 5] Scenario D: Edge Cases, Null Budgets & Input Sanitization\x1b[0m");

  // Case D1: Blank monthly budget (merchant didn't specify a budget)
  const blankBudgetPayload = new Map([
    ["intent", "submitQuoteRequest"],
    ["quoteId", String(quoteId)],
    ["requestedPlan", "enterprise"],
    ["requestedFitments", "100000"],
    ["monthlyBudget", ""], // empty string
    ["contactEmail", TEST_EMAIL],
    ["dataRequirements", ""],
    ["notes", "Budget is open/flexible"],
  ]);
  const blankBudgetRes = await simulatePlansAction(TEST_SHOP, "", blankBudgetPayload);
  assert(blankBudgetRes.success === true, "Empty budget does not cause crash or NaN");
  const blankBudgetRecord = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(blankBudgetRecord.monthlyBudget === null, "Empty budget safely stored as null in DB");

  // Case D2: Non-numeric budget string ("Contact Us / Negotiable")
  const textBudgetPayload = new Map([
    ["intent", "submitQuoteRequest"],
    ["quoteId", String(quoteId)],
    ["requestedPlan", "enterprise"],
    ["requestedFitments", "100000"],
    ["monthlyBudget", "$ negotiable / flexible"],
    ["contactEmail", TEST_EMAIL],
    ["dataRequirements", ""],
    ["notes", ""],
  ]);
  const textBudgetRes = await simulatePlansAction(TEST_SHOP, "", textBudgetPayload);
  assert(textBudgetRes.success === true, "Non-numeric budget safely handled");
  const textBudgetRecord = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(textBudgetRecord.monthlyBudget === null, "Non-numeric budget safely parsed as null");

  // Case D3: Fallback email when contactEmail is empty in form
  const fallbackEmailPayload = new Map([
    ["intent", "submitQuoteRequest"],
    ["quoteId", String(quoteId)],
    ["requestedPlan", "enterprise"],
    ["requestedFitments", "75000"],
    ["monthlyBudget", "150"],
    ["contactEmail", ""], // empty
    ["dataRequirements", ""],
    ["notes", ""],
  ]);
  await simulatePlansAction(TEST_SHOP, "session-store-owner@example.com", fallbackEmailPayload);
  const fallbackEmailRecord = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(fallbackEmailRecord.contactEmail === "session-store-owner@example.com", "Fell back to session owner email when field is blank");

  // Case D4: Special characters, HTML entities, and multi-line notes
  const complexNotes = `Line 1: Need ACES 4.2 & PIES 7.2.\nLine 2: "Quoted in USD" <tags> & symbols: © 2026 🏎️ ⚙️.`;
  const complexPayload = new Map([
    ["intent", "submitQuoteRequest"],
    ["quoteId", String(quoteId)],
    ["requestedPlan", "enterprise"],
    ["requestedFitments", "1500000"], // 1.5 Million
    ["monthlyBudget", "850"],
    ["contactEmail", TEST_EMAIL],
    ["dataRequirements", "ACES XML, SFTP"],
    ["notes", complexNotes],
  ]);
  const complexRes = await simulatePlansAction(TEST_SHOP, "", complexPayload);
  assert(complexRes.success === true, "High-volume 1.5M fitments & complex multi-line unicode notes saved");
  const complexRecord = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(complexRecord.requestedFitments === 1500000, "1,500,000 fitments volume stored correctly");
  assert(complexRecord.notes === complexNotes, "Multi-line notes and emoji symbols preserved verbatim");

  // -----------------------------------------------------------
  // TEST GROUP 6: Scenario E - Admin Review & Approval Workflow
  // -----------------------------------------------------------
  console.log("\n\x1b[36m[TEST SUITE 6] Scenario E: Admin Review, Status Transition & Quoted Price\x1b[0m");

  // Admin approves quote and sets custom monthly pricing
  await prisma.quoteRequest.update({
    where: { id: quoteId },
    data: {
      status: "APPROVED",
      quotedPrice: 799.0,
    },
  });

  const adminReviewedRecord = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(adminReviewedRecord.status === "APPROVED", "Status successfully transitioned to APPROVED by Admin");
  assert(adminReviewedRecord.quotedPrice === 799.0, "Admin set quotedPrice to $799.00/mo");

  // -----------------------------------------------------------
  // TEST GROUP 7: Scenario F - Teardown & Database Sanitization
  // -----------------------------------------------------------
  console.log("\n\x1b[36m[TEST SUITE 7] Scenario F: Teardown & Clean-up\x1b[0m");
  const deleteRes = await prisma.quoteRequest.deleteMany({ where: { shop: TEST_SHOP } });
  assert(deleteRes.count >= 1, `Cleaned up test quote records (removed ${deleteRes.count} test row(s))`);
  const finalCount = await prisma.quoteRequest.count({ where: { shop: TEST_SHOP } });
  assert(finalCount === 0, "Database is completely clean with 0 orphaned test rows");

  console.log("\n=======================================================");
  console.log(`🏁 QA SIMULATION TEST RUN COMPLETE`);
  console.log(`   Passed: \x1b[32m${passedCount}\x1b[0m | Failed: \x1b[31m${failedCount}\x1b[0m`);
  console.log("=======================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runQASuite()
  .catch((err) => {
    console.error("FATAL QA TEST EXCEPTION:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
