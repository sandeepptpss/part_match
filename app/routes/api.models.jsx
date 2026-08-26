const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/models?year=&make= (proxied storefront request)
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const make = url.searchParams.get("make");

  if (!year || !make) {
    return json({ error: "Missing year or make" }, { status: 400 });
  }

  try {
    const models = await prisma.fitmentRecord?.findMany({
      where: { shop, year, make },
      select: { model: true },
      distinct: ["model"],
      orderBy: { model: "asc" },
    });

    return json({ models: models.map((r) => r.model) });
  } catch (err) {
    console.error("[api/models]", err);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
