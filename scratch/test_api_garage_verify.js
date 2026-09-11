import { PrismaClient } from "@prisma/client";
import { loader, action } from "../app/routes/api.garage.jsx";

const prisma = new PrismaClient();
const TEST_SHOP = "test-store.myshopify.com";

async function runGarageVerification() {
  console.log("=== VERIFYING API.GARAGE.JSX FUNCTIONALITY & INTEGRITY ===");

  try {
    // 1. Ensure test shop has Growth plan to allow garageSync
    await prisma.shopPlan.upsert({
      where: { shop: TEST_SHOP },
      update: { plan: "growth" },
      create: { shop: TEST_SHOP, plan: "growth" },
    });

    const testCustId = "555123456";
    await prisma.savedVehicle.deleteMany({ where: { shop: TEST_SHOP, customerId: testCustId } });

    // 2. Test ACTION: ADD VEHICLE with JSON body containing customerId
    console.log("\n[TEST 1] Testing ACTION (add vehicle)...");
    const addRequest = new Request(`https://${TEST_SHOP}/apps/partmatch/api/garage?shop=${TEST_SHOP}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "add",
        customerId: "gid://shopify/Customer/" + testCustId,
        year: "2023",
        make: "Ford",
        model: "F-150",
        trim: "Raptor",
      }),
    });

    const addResponse = await action({ request: addRequest });
    const addData = await addResponse.json();
    console.log("  Add response status:", addResponse.status);
    console.log("  Add response data:", addData);

    if (addResponse.status !== 200 || !addData.loggedIn || addData.vehicles.length === 0) {
      throw new Error("Failed to add vehicle to garage via action");
    }
    console.log("  ✓ TEST 1 PASSED: Vehicle added successfully with GID normalization.");

    // 3. Test LOADER: FETCH VEHICLES with x-customer-id header
    console.log("\n[TEST 2] Testing LOADER (fetch vehicles via header)...");
    const loadRequest = new Request(`https://${TEST_SHOP}/apps/partmatch/api/garage?shop=${TEST_SHOP}`, {
      method: "GET",
      headers: { "x-customer-id": testCustId },
    });

    const loadResponse = await loader({ request: loadRequest });
    const loadData = await loadResponse.json();
    console.log("  Load response status:", loadResponse.status);
    console.log("  Load response data:", loadData);

    if (loadResponse.status !== 200 || !loadData.loggedIn || loadData.vehicles.length !== 1) {
      throw new Error("Failed to load vehicle from garage via loader");
    }
    console.log("  ✓ TEST 2 PASSED: Vehicle loaded successfully with customer ID header.");

    // 4. Test ACTION: REMOVE VEHICLE
    console.log("\n[TEST 3] Testing ACTION (remove vehicle)...");
    const removeRequest = new Request(`https://${TEST_SHOP}/apps/partmatch/api/garage?shop=${TEST_SHOP}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "remove",
        customerId: testCustId,
        year: "2023",
        make: "Ford",
        model: "F-150",
      }),
    });

    const removeResponse = await action({ request: removeRequest });
    const removeData = await removeResponse.json();
    console.log("  Remove response status:", removeResponse.status);
    console.log("  Remove response data:", removeData);

    if (removeResponse.status !== 200 || removeData.vehicles.length !== 0) {
      throw new Error("Failed to remove vehicle from garage via action");
    }
    console.log("  ✓ TEST 3 PASSED: Vehicle removed successfully.");

    // Cleanup
    await prisma.savedVehicle.deleteMany({ where: { shop: TEST_SHOP, customerId: testCustId } });
    console.log("\n🎉 ALL API.GARAGE.JSX TESTS PASSED 100% CLEANLY!");
  } catch (err) {
    console.error("\n❌ GARAGE TEST FAILED:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runGarageVerification();
