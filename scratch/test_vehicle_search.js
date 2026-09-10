import { default as prisma } from "../app/db.server.js";

async function run() {
  console.log("=== TESTING VEHICLE SEARCH IN DATABASE ===");

  // Get a sample shop
  const sample = await prisma.fitmentRecord.findFirst({
    include: { products: true },
  });

  if (!sample) {
    console.log("No fitment records found in DB to test against.");
    process.exit(0);
  }

  const shop = sample.shop;
  console.log(`Using shop: ${shop}`);
  console.log(`Sample record: Year=${sample.year}, Make=${sample.make}, Model=${sample.model}, Trim=${sample.trim}`);

  const testQueries = [
    sample.make, // e.g. "Tata"
    sample.year, // e.g. "2025"
    `${sample.year} ${sample.make}`, // e.g. "2025 Tata"
    `${sample.make} ${sample.model}`, // e.g. "Tata Nova"
    `${sample.year} ${sample.make} ${sample.model}`, // e.g. "2025 Tata Nova"
    `${sample.model} ${sample.make}`, // reverse order
  ];

  for (const query of testQueries) {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const searchFilter =
      tokens.length > 0
        ? {
            AND: tokens.map((token) => ({
              OR: [
                { productTitle: { contains: token } },
                { shopifyHandle: { contains: token } },
                { fitment: { year: { contains: token } } },
                { fitment: { make: { contains: token } } },
                { fitment: { model: { contains: token } } },
                { fitment: { trim: { contains: token } } },
              ],
            })),
          }
        : {};

    const where = {
      fitment: { shop },
      ...searchFilter,
    };

    const count = await prisma.fitmentProduct.count({ where });
    console.log(`Query "${query}": Found ${count} matching products in DB.`);
    if (count === 0 && sample.products.length > 0) {
      console.error(`FAIL: Query "${query}" returned 0 results!`);
      process.exit(1);
    }
  }

  console.log("ALL DB VEHICLE SEARCH QUERIES PASSED!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error during test:", err);
  process.exit(1);
});
