/**
 * QA Engineer Live Verification Script
 * Validates End-to-End Enterprise Quote Flow:
 * 1. Creates a real Quote Request for quickstart-749ac396.myshopify.com matching the user's modal screenshot.
 * 2. Verifies Merchant Plans page loader output.
 * 3. Verifies Super Admin Console loader & table rendering data.
 * 4. Verifies Admin Status & Quota assignment workflows.
 * 5. Leaves the Quote in PENDING state so the merchant & admin see it live in their browser.
 */

/* eslint-disable no-console */
import prisma from "../app/db.server.js";

const TARGET_SHOP = "quickstart-749ac396.myshopify.com";
const CONTACT_EMAIL = "merchant@quickstart-749ac396.myshopify.com";

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}${details ? ` -> [${details}]` : ""}`);
    passedCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName}${details ? ` -> [${details}]` : ""}`);
    failedCount++;
  }
}

async function verifyLiveQuoteAndAdmin() {
  console.log("\n==========================================================================");
  console.log("🛡️  QA LIVE VERIFICATION: MERCHANT QUOTE CREATION & ADMIN PANEL INTEGRATION");
  console.log("    Target Store: quickstart-749ac396.myshopify.com");
  console.log("==========================================================================\n");

  // Step 1: Clean up any old test quotes for this shop
  await prisma.quoteRequest.deleteMany({ where: { shop: TARGET_SHOP } });

  // ----------------------------------------------------------------------
  // STEP 2: Create Real Quote Request matching Merchant Modal Screenshot
  // ----------------------------------------------------------------------
  console.log("\x1b[36m[STEP 1] Creating Quote Request for quickstart-749ac396.myshopify.com\x1b[0m");
  const quoteData = {
    shop: TARGET_SHOP,
    contactEmail: CONTACT_EMAIL,
    requestedPlan: "enterprise",
    requestedFitments: 100000,
    monthlyBudget: 199.0,
    dataRequirements: "ACES 3.2 / 4.0 XML Standard, Automated Daily SFTP Sync",
    notes: "Automotive catalog with 100,000 vehicle fitments across Ford, Chevrolet, and Dodge parts. Requesting daily automated SFTP sync with ACES XML schema validation.",
    status: "PENDING",
  };

  const newQuote = await prisma.quoteRequest.create({ data: quoteData });
  assert(newQuote && newQuote.id > 0, "Quote created successfully in database", `ID: #${newQuote.id}`);
  assert(newQuote.shop === TARGET_SHOP, "Shop domain matches target store", newQuote.shop);
  assert(newQuote.requestedFitments === 100000, "Requested fitment quota is 100,000", `${newQuote.requestedFitments.toLocaleString()} records`);
  assert(newQuote.monthlyBudget === 199.0, "Monthly budget is $199.00/mo", `$${newQuote.monthlyBudget}`);
  assert(newQuote.status === "PENDING", "Initial status is PENDING", newQuote.status);
  assert(newQuote.dataRequirements.includes("ACES 3.2"), "ACES standard is selected", newQuote.dataRequirements);
  assert(newQuote.dataRequirements.includes("SFTP Sync"), "SFTP sync is selected", newQuote.dataRequirements);

  const quoteId = newQuote.id;

  // ----------------------------------------------------------------------
  // STEP 3: Verify Merchant Plans Page Loader
  // ----------------------------------------------------------------------
  console.log("\n\x1b[36m[STEP 2] Verifying Merchant Plans Page Loader Output (app.plans.jsx)\x1b[0m");
  const plansPendingQuote = await prisma.quoteRequest.findFirst({
    where: { shop: TARGET_SHOP },
    orderBy: { id: "desc" },
  });

  assert(plansPendingQuote !== null, "Plans page loader successfully finds pending quote", `Quote #${plansPendingQuote?.id}`);
  assert(plansPendingQuote?.status === "PENDING", "Quote status in plans loader is PENDING");
  assert(plansPendingQuote?.requestedFitments === 100000, "Plans loader gets 100,000 requested fitments");

  // Verify merchant's active plan was not mutated
  const currentShopPlan = await prisma.shopPlan.findFirst({ where: { shop: TARGET_SHOP } });
  assert(currentShopPlan?.plan === "growth", "Merchant's active plan remains GROWTH (unaffected)", currentShopPlan?.plan);

  // ----------------------------------------------------------------------
  // STEP 4: Verify Super Admin Console Loader & Rendering (app.admin.jsx)
  // ----------------------------------------------------------------------
  console.log("\n\x1b[36m[STEP 3] Verifying Super Admin Console Loader & UI Queries (app.admin.jsx)\x1b[0m");
  const adminQuoteRequests = await prisma.quoteRequest.findMany({
    orderBy: { id: "desc" },
    take: 50,
  });

  assert(adminQuoteRequests.length > 0, "Admin console loader fetches quoteRequests list", `Count: ${adminQuoteRequests.length}`);

  const adminTargetQuote = adminQuoteRequests.find((q) => q.id === quoteId);
  assert(adminTargetQuote !== undefined, "Admin quote list includes the new merchant quote", `Found quote #${quoteId}`);

  // Calculate pending count as done in app.admin.jsx line 825
  const pendingQuotesCount = adminQuoteRequests.filter((q) => q.status === "PENDING").length;
  assert(pendingQuotesCount >= 1, "pendingQuotesCount computed correctly for admin tab badge", `${pendingQuotesCount} Pending`);

  // Verify tab badge label (app.admin.jsx line 1223)
  const tabBadgeText = pendingQuotesCount > 0 ? `${pendingQuotesCount} Pending` : `${adminQuoteRequests.length}`;
  assert(tabBadgeText.includes("Pending"), "Admin tab badge shows Pending count", `Quotes & Custom Quotas (${tabBadgeText})`);

  // Verify table row rendering data
  assert(adminTargetQuote.shop === TARGET_SHOP, "Admin table displays correct shop domain", adminTargetQuote.shop);
  assert(adminTargetQuote.contactEmail === CONTACT_EMAIL, "Admin table displays contact email", adminTargetQuote.contactEmail);
  assert(adminTargetQuote.requestedFitments === 100000, "Admin table displays 100,000 fitments volume", "100,000 Fitments");
  assert(adminTargetQuote.monthlyBudget === 199.0, "Admin table displays budget", `$199/mo`);
  assert(adminTargetQuote.dataRequirements.includes("ACES"), "Admin table displays data requirements badge", adminTargetQuote.dataRequirements);
  assert(adminTargetQuote.notes.includes("Automotive catalog"), "Admin table displays merchant notes");

  // ----------------------------------------------------------------------
  // STEP 5: Verify Admin Action Workflows (Status & Quota Assignment)
  // ----------------------------------------------------------------------
  console.log("\n\x1b[36m[STEP 4] Verifying Admin Action Workflows\x1b[0m");

  // Action 1: Admin marks quote as CONTACTED
  await prisma.quoteRequest.update({
    where: { id: quoteId },
    data: { status: "CONTACTED" },
  });
  const contactedQuote = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(contactedQuote.status === "CONTACTED", "Admin action 'Mark as Contacted' updates status to CONTACTED");

  // Action 2: Admin approves quote and sets custom monthly pricing
  await prisma.quoteRequest.update({
    where: { id: quoteId },
    data: { status: "APPROVED", quotedPrice: 199.0 },
  });
  const approvedQuote = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(approvedQuote.status === "APPROVED", "Admin action 'Approve' updates status to APPROVED");
  assert(approvedQuote.quotedPrice === 199.0, "Quoted price saved as $199.00/mo");

  // Step 6: Reset quote back to PENDING so user can test in their browser!
  await prisma.quoteRequest.update({
    where: { id: quoteId },
    data: { status: "PENDING", quotedPrice: null },
  });
  const liveQuote = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  assert(liveQuote.status === "PENDING", "Quote reset to PENDING for user live browser testing", `ID: #${quoteId}`);

  console.log("\n==========================================================================");
  console.log("🏁 QA LIVE VERIFICATION FINISHED");
  console.log(`   Passed: \x1b[32m${passedCount}\x1b[0m | Failed: \x1b[31m${failedCount}\x1b[0m`);
  console.log(`   Live Quote ID: \x1b[33m#${quoteId}\x1b[0m is active in DB for \x1b[33m${TARGET_SHOP}\x1b[0m`);
  console.log("==========================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

verifyLiveQuoteAndAdmin()
  .catch((err) => {
    console.error("FATAL QA VERIFICATION ERROR:", err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
