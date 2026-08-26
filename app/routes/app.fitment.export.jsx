import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

// GET /app/fitment/export  → download CSV
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);
  if (!limits.csvImportExport) {
    return new Response(
      `CSV Export requires the Growth Professional plan or above. Your current plan is ${limits.label}. Upgrade at /app/plans.`,
      { status: 403, headers: { "Content-Type": "text/plain" } },
    );
  }

  const records = await prisma.fitmentRecord?.findMany({
    where: { shop },
    include: { products: true },
    orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
  });

  const rows = ["year,make,model,product_handle,product_title"];

  records.forEach((r) => {
    if (r.products.length === 0) {
      rows.push(`${r.year},${csvEsc(r.make)},${csvEsc(r.model)},,`);
    } else {
      r.products.forEach((p) => {
        rows.push(
          `${r.year},${csvEsc(r.make)},${csvEsc(r.model)},${csvEsc(p.shopifyHandle)},${csvEsc(p.productTitle)}`
        );
      });
    }
  });

  const csv = rows.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="fitment-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function csvEsc(val) {
  if (!val) return "";
  const str = String(val);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}
