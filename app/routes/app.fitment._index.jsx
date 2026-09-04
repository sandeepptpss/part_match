import { useState, useEffect } from "react";
const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useFetcher, useSearchParams, Link, useNavigation } from "react-router";
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
      include: { _count: { select: { products: true, collections: true, tags: true, skus: true } } },
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
  const exportFetcher = useFetcher();
  const exporting = exportFetcher.state !== "idle";

  const handleExportCSV = () => {
    exportFetcher.load("/app/fitment/export");
  };

  useEffect(() => {
    if (exportFetcher.data) {
      if (exportFetcher.data.allowed && exportFetcher.data.csv) {
        const content = exportFetcher.data.csv;
        const finalContent = !content.startsWith("\uFEFF") ? "\uFEFF" + content : content;
        const blob = new Blob([finalContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = exportFetcher.data.filename || `fitment-export-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (exportFetcher.data.allowed === false && exportFetcher.data.message) {
        alert(exportFetcher.data.message);
      }
    }
  }, [exportFetcher.data]);

  return (
    <div style={{ padding: "28px 24px", maxWidth: "1240px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>Fitment Master Catalog</h1>
            <span style={{ background: "#f1f5f9", color: "#475569", padding: "2px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              {total.toLocaleString()} Records
            </span>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Manage vehicle fitment specifications (Year → Make → Model) and assigned catalog parts.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link to="/app/fitment/add" style={primaryBtn}>
            + Add Fitment Record
          </Link>
          <Link to="/app/fitment/import" style={secondaryBtn}>
            Import CSV
          </Link>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={exporting}
            style={{
              ...outlineBtn,
              cursor: exporting ? "wait" : "pointer",
              opacity: exporting ? 0.7 : 1,
            }}
          >
            {exporting ? "Downloading CSV…" : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Search & Filter Card */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
        <Form method="get" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              name="q"
              defaultValue={search}
              placeholder="Search by Year, Make, or Model (e.g. 2025 Ford F-150)…"
              style={searchInputStyle}
            />
          </div>
          <button type="submit" style={primaryBtn}>Search Catalog</button>
          {search && (
            <Link to="/app/fitment" style={outlineBtn}>
              ✕ Clear Search
            </Link>
          )}
        </Form>
      </div>

      {/* Main Records Table Card */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
            <tr>
              <th style={thStyle}>Year</th>
              <th style={thStyle}>Make</th>
              <th style={thStyle}>Model</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Search Results Mapping</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "48px 24px", textAlign: "center", color: "#64748b" }}>
                  <strong style={{ display: "block", color: "#1e293b", fontSize: "16px", marginBottom: "4px" }}>
                    No Fitment Records Found
                  </strong>
                  <span style={{ fontSize: "14px" }}>{search ? `No records matched "${search}".` : "Your catalog is currently empty."}</span>
                  <div style={{ marginTop: "16px" }}>
                    <Link to="/app/fitment/add" style={{ ...primaryBtn, display: "inline-flex" }}>
                      + Add First Fitment Record
                    </Link>
                  </div>
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9", transition: "background 0.15s" }}>
                <td style={{ ...tdStyle, fontWeight: "700", color: "#0f172a" }}>{r.year}</td>
                <td style={{ ...tdStyle, fontWeight: "600", color: "#334155" }}>{r.make}</td>
                <td style={{ ...tdStyle, fontWeight: "600", color: "#334155" }}>{r.model}</td>
                <td style={{ ...tdStyle, textAlign: "center" }}>
                  <Link
                    to={`/app/fitment/${r.id}/products`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      textDecoration: "none",
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        background: (r._count.products + r._count.collections + r._count.tags + r._count.skus) > 0 ? "#ecfdf5" : "#fff7ed",
                        border: `1px solid ${(r._count.products + r._count.collections + r._count.tags + r._count.skus) > 0 ? "#a7f3d0" : "#fed7aa"}`,
                        color: (r._count.products + r._count.collections + r._count.tags + r._count.skus) > 0 ? "#047857" : "#c2410c",
                        padding: "3px 10px",
                        borderRadius: "12px",
                        fontWeight: "700",
                        fontSize: "12px",
                      }}
                    >
                      {(r._count.products + r._count.collections + r._count.tags + r._count.skus) > 0
                        ? `✓ ${r._count.products} Product${r._count.products === 1 ? "" : "s"}`
                        : "0 Products (Hidden on Storefront)"}
                    </span>
                    {r._count.collections > 0 && (
                      <span
                        style={{
                          background: "#f3e8ff",
                          border: "1px solid #ddd6fe",
                          color: "#7c3aed",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontWeight: "700",
                          fontSize: "12px",
                        }}
                      >
                        {r._count.collections} Collection{r._count.collections === 1 ? "" : "s"}
                      </span>
                    )}
                    {r._count.tags > 0 && (
                      <span
                        style={{
                          background: "#ecfdf5",
                          border: "1px solid #a7f3d0",
                          color: "#059669",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontWeight: "700",
                          fontSize: "12px",
                        }}
                      >
                        {r._count.tags} Tag{r._count.tags === 1 ? "" : "s"}
                      </span>
                    )}
                    {r._count.skus > 0 && (
                      <span
                        style={{
                          background: "#fff1f2",
                          border: "1px solid #fecdd3",
                          color: "#e11d48",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontWeight: "700",
                          fontSize: "12px",
                        }}
                      >
                        {r._count.skus} SKU{r._count.skus === 1 ? "" : "s"}
                      </span>
                    )}
                  </Link>
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                    <Link to={`/app/fitment/${r.id}/products`} style={tableActionBtn("#2563eb", "#dbeafe")}>
                      Manage Mappings
                    </Link>
                    <DeleteFitmentForm id={r.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", justifyContent: "center", alignItems: "center" }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              to={`/app/fitment?page=${p}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: "700",
                background: p === page ? "#008060" : "#ffffff",
                color: p === page ? "#ffffff" : "#475569",
                border: `1px solid ${p === page ? "#008060" : "#cbd5e1"}`,
                boxShadow: p === page ? "0 2px 6px rgba(0, 128, 96, 0.3)" : "none",
              }}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const primaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "#008060",
  color: "#ffffff",
  padding: "10px 18px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "700",
  border: "none",
  cursor: "pointer",
  boxShadow: "0 2px 6px rgba(0, 128, 96, 0.25)",
};

const secondaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "#2563eb",
  color: "#ffffff",
  padding: "10px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "600",
  border: "none",
  boxShadow: "0 2px 6px rgba(37, 99, 235, 0.25)",
};

const outlineBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "#ffffff",
  color: "#475569",
  border: "1px solid #cbd5e1",
  padding: "10px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "600",
};

const searchInputStyle = {
  width: "100%",
  padding: "11px 16px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const thStyle = {
  padding: "14px 18px",
  textAlign: "left",
  fontSize: "12px",
  color: "#64748b",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle = {
  padding: "14px 18px",
  fontSize: "14px",
};

const tableActionBtn = (color, bg) => ({
  display: "inline-flex",
  alignItems: "center",
  background: bg,
  color: color,
  border: "none",
  padding: "6px 12px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: "700",
  cursor: "pointer",
});

function DeleteFitmentForm({ id }) {
  const fetcher = useFetcher();
  const deleting = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" style={{ display: "inline" }}>
      <input type="hidden" name="intent" value="delete" />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={deleting}
        style={{ ...tableActionBtn("#dc2626", "#fee2e2"), opacity: deleting ? 0.6 : 1 }}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
    </fetcher.Form>
  );
}
