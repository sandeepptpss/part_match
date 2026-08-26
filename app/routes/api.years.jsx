const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/years (proxied storefront request)
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;

  try {
    const years = await prisma.fitmentRecord?.findMany({
      where: { shop },
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "desc" },
    });

    return json({ years: years.map((r) => r.year) });
  } catch (err) {
    console.error("[api/years]", err);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
