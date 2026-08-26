const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useNavigation, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const search = url.searchParams.get("q") || "";
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    shop,
    ...(search
      ? {
          OR: [
            { year: { contains: search } },
            { make: { contains: search } },
            { model: { contains: search } },
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.fitmentRecord?.findMany({
      where,
      orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
      skip,
      take: PAGE_SIZE,
      include: { _count: { select: { products: true } } },
    }),
    prisma.fitmentRecord?.count({ where }),
  ]);

  return json({ records, total, page, search, pageSize: PAGE_SIZE });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = parseInt(formData.get("id"), 10);
    await prisma.fitmentRecord?.deleteMany({ where: { id, shop } });
  }

  return json({ ok: true });
};

export default function FitmentIndex() {
  const { records, total, page, search, pageSize } = useLoaderData();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);
  const loading = navigation.state !== "idle";

  return (
    <div style={{ padding: "20px", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: "700", margin: 0 }}>Fitment Records</h1>
          <p style={{ color: "#6d7175", margin: "4px 0 0" }}>{total} total records</p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <a href="/app/fitment/add" style={btn("#008060")}>+ Add Record</a>
          <a href="/app/fitment/import" style={btn("#2c6ecb")}>↑ Import CSV</a>
          <a href="/app/fitment/export" style={btn("#6d7175")}>↓ Export CSV</a>
        </div>
      </div>

      {/* Search */}
      <Form method="get" style={{ marginBottom: "16px", display: "flex", gap: "10px" }}>
        <input
          name="q"
          defaultValue={search}
          placeholder="Search year, make, model…"
          style={inputStyle}
        />
        <button type="submit" style={btn("#008060")}>Search</button>
        {search && <a href="/app/fitment" style={btn("#6d7175")}>Clear</a>}
      </Form>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f6f6f7" }}>
            <tr>
              <th style={th}>Year</th>
              <th style={th}>Make</th>
              <th style={th}>Model</th>
              <th style={{ ...th, textAlign: "center" }}>Products</th>
              <th style={{ ...th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "#6d7175" }}>
                  No records found.{" "}
                  <a href="/app/fitment/add">Add your first fitment record →</a>
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #f1f2f3" }}>
                <td style={td}>{r.year}</td>
                <td style={td}>{r.make}</td>
                <td style={td}>{r.model}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  <a href={`/app/fitment/${r.id}/products`} style={{ color: "#2c6ecb", fontWeight: "600" }}>
                    {r._count.products}
                  </a>
                </td>
                <td style={{ ...td, textAlign: "right", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <a href={`/app/fitment/${r.id}/products`} style={btn("#2c6ecb", "sm")}>Products</a>
                  <Form method="post" style={{ display: "inline" }}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      style={btn("#c0392b", "sm")}
                      onClick={(e) => {
                        if (!confirm(`Delete ${r.year} ${r.make} ${r.model}?`)) e.preventDefault();
                      }}
                    >
                      Delete
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "8px", marginTop: "16px", justifyContent: "center" }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={`/app/fitment?page=${p}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
              style={{
                ...btn(p === page ? "#008060" : "#e1e3e5", "sm"),
                color: p === page ? "#fff" : "#333",
              }}
            >
              {p}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const btn = (bg, size) => ({
  display: "inline-block",
  background: bg,
  color: bg === "#e1e3e5" ? "#333" : "#fff",
  padding: size === "sm" ? "5px 12px" : "8px 16px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: size === "sm" ? "13px" : "14px",
  fontWeight: "500",
  border: "none",
  cursor: "pointer",
});

const inputStyle = {
  flex: 1,
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "14px",
};

const th = {
  padding: "12px 16px",
  textAlign: "left",
  fontSize: "13px",
  color: "#6d7175",
  fontWeight: "500",
};

const td = {
  padding: "12px 16px",
  fontSize: "14px",
};
