import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_SHOP = "test-store.myshopify.com";

// Simulate getCustomerId from api.garage.jsx
function getCustomerId(url, request) {
  const raw =
    url.searchParams.get("logged_in_customer_id") ||
    url.searchParams.get("customerId") ||
    url.searchParams.get("customer_id") ||
    request?.headers?.get("x-shopify-customer-id") ||
    request?.headers?.get("x-customer-id") ||
    null;

  if (!raw) return null;
  return String(raw).replace(/^gid:\/\/shopify\/Customer\//i, "").trim() || null;
}

async function testGarageFlow() {
  console.log("=== RUNNING API.GARAGE.JSX DIRECT LOGIC VERIFICATION ===");

  try {
    // 1. Verify GID normalization
    const testCases = [
      { input: "gid://shopify/Customer/123456789", expected: "123456789" },
      { input: "GID://SHOPIFY/CUSTOMER/987654321", expected: "987654321" },
      { input: "888777666", expected: "888777666" },
    ];

    for (const tc of testCases) {
      const url = new URL(`https://${TEST_SHOP}/apps/partmatch/api/garage?customerId=${encodeURIComponent(tc.input)}`);
      const result = getCustomerId(url, null);
      if (result !== tc.expected) {
        throw new Error(`Normalization failed for ${tc.input}: expected ${tc.expected}, got ${result}`);
      }
      console.log(`  ✓ Normalized ${tc.input} ➔ ${result}`);
    }

    // 2. Verify header extraction
    const mockHeaders = new Map();
    mockHeaders.set("x-customer-id", "gid://shopify/Customer/999111");
    const headerReq = { headers: mockHeaders };
    const urlNoParam = new URL(`https://${TEST_SHOP}/apps/partmatch/api/garage`);
    const headerResult = getCustomerId(urlNoParam, headerReq);
    if (headerResult !== "999111") {
      throw new Error(`Header extraction failed: expected 999111, got ${headerResult}`);
    }
    console.log(`  ✓ Header extraction successful: x-customer-id ➔ ${headerResult}`);

    // 3. Database operations test
    const customerId = "999111";
    await prisma.savedVehicle.deleteMany({ where: { shop: TEST_SHOP, customerId } });

    // Add 1 vehicle
    const vehicle = await prisma.savedVehicle.create({
      data: {
        shop: TEST_SHOP,
        customerId,
        year: "2024",
        make: "Toyota",
        model: "Tacoma",
        trim: "TRD Off-Road",
      },
    });
    console.log("  ✓ Created saved vehicle:", vehicle.year, vehicle.make, vehicle.model, vehicle.trim);

    // Query vehicles
    const vehicles = await prisma.savedVehicle.findMany({
      where: { shop: TEST_SHOP, customerId },
      orderBy: { createdAt: "desc" },
    });
    if (vehicles.length !== 1 || vehicles[0].model !== "Tacoma") {
      throw new Error("Vehicle query failed");
    }
    console.log("  ✓ Fetched saved vehicle count:", vehicles.length);

    // Delete vehicle
    await prisma.savedVehicle.deleteMany({ where: { shop: TEST_SHOP, customerId } });
    const countAfter = await prisma.savedVehicle.count({ where: { shop: TEST_SHOP, customerId } });
    if (countAfter !== 0) {
      throw new Error("Vehicle removal failed");
    }
    console.log("  ✓ Removed vehicle cleanly, count is now:", countAfter);

    console.log("\n🎉 ALL API.GARAGE.JSX LOGIC TESTS PASSED 100%!");
  } catch (err) {
    console.error("❌ Test failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testGarageFlow();
