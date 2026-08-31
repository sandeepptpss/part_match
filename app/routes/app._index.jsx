const json = (data, init) => Response.json(data, init);
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let fitmentCount = 0;
  let productMappingCount = 0;
  let universalCount = 0;
  let monthSearches = 0;
  let noResultSearches = 0;
  let recentSearches = [];
  let topVehicles = [];

  try {
    const res = await Promise.all([
      prisma.fitmentRecord?.count({ where: { shop } }) ?? 0,
      prisma.fitmentProduct?.count({ where: { fitment: { shop } } }) ?? 0,
      prisma.universalProduct?.count({ where: { shop } }) ?? 0,
      prisma.searchLog?.count({
        where: { shop, createdAt: { gte: new Date(new Date().setDate(1)) } },
      }) ?? 0,
      prisma.searchLog?.count({ where: { shop, hasResults: false } }) ?? 0,
      prisma.searchLog?.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { year: true, make: true, model: true, hasResults: true, createdAt: true },
      }) ?? [],
      prisma.searchLog?.groupBy({
        by: ["year", "make", "model"],
        where: { shop },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }) ?? [],
    ]);
    [
      fitmentCount,
      productMappingCount,
      universalCount,
      monthSearches,
      noResultSearches,
      recentSearches,
      topVehicles,
    ] = res;
  } catch (err) {
    console.error("[Dashboard loader error]", err);
  }

  return json({
    shop,
    stats: { fitmentCount, productMappingCount, universalCount, monthSearches, noResultSearches },
    recentSearches,
    topVehicles,
  });
};

export default function Dashboard() {
  const { shop, stats, recentSearches, topVehicles } = useLoaderData();

  const cards = [
    { label: "Fitment Records", value: stats.fitmentCount, href: "/app/fitment", color: "#008060", bgGradient: "linear-gradient(135deg, #008060 0%, #005e46 100%)", icon: "" },
    { label: "Product Mappings", value: stats.productMappingCount, href: "/app/products", color: "#2c6ecb", bgGradient: "linear-gradient(135deg, #2c6ecb 0%, #1e4f94 100%)", icon: "" },
    { label: "Universal Products", value: stats.universalCount, href: "/app/products/universal", color: "#6d5bd0", bgGradient: "linear-gradient(135deg, #6d5bd0 0%, #4f3ea3 100%)", icon: "" },
    { label: "Searches This Month", value: stats.monthSearches, href: "/app/analytics", color: "#e67e22", bgGradient: "linear-gradient(135deg, #e67e22 0%, #b85e10 100%)", icon: "" },
    { label: "No-Result Opportunity", value: stats.noResultSearches, href: "/app/analytics", color: "#c0392b", bgGradient: "linear-gradient(135deg, #c0392b 0%, #8e2519 100%)", icon: "" },
  ];

  return (
    <div style={{ padding: "28px 24px", maxWidth: "1240px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      {/* Executive Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", borderRadius: "14px", padding: "28px 32px", color: "#ffffff", marginBottom: "28px", boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h1 style={{ margin: 0, fontSize: "26px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                PartMatch Auto Fitment Center
              </h1>
              <span style={{ background: "rgba(16, 185, 129, 0.2)", border: "1px solid rgba(16, 185, 129, 0.4)", color: "#34d399", padding: "3px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "600" }}>
                Active & Live
              </span>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
              Connected Store: <strong style={{ color: "#cbd5e1" }}>{shop}</strong>
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Link to="/app/fitment/add" style={primaryActionBtn}>
              <span>+ Add Fitment</span>
            </Link>
            <Link to="/app/fitment/import" style={secondaryActionBtn}>
              <span>↑ Import CSV</span>
            </Link>
            <Link to="/app/widget" style={secondaryActionBtn}>
              <span>Widget Editor</span>
            </Link>
            <Link to="/app/analytics" style={secondaryActionBtn}>
              <span>Analytics</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "18px", marginBottom: "32px" }}>
        {cards.map((c) => (
          <Link key={c.label} to={c.href} style={{ textDecoration: "none" }}>
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "22px 20px",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.03)",
                transition: "all 0.2s ease-in-out",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ height: "4px", width: "100%", position: "absolute", top: 0, left: 0, background: c.bgGradient }} />
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {c.label}
                  </span>
                  {c.icon ? <span style={{ fontSize: "20px" }}>{c.icon}</span> : null}
                </div>
                <div style={{ fontSize: "34px", fontWeight: "800", color: "#0f172a", letterSpacing: "-1px" }}>
                  {c.value.toLocaleString()}
                </div>
              </div>
              <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "4px", color: c.color, fontSize: "13px", fontWeight: "600" }}>
                <span>Manage</span> <span>→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Two Column Section */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "24px", marginBottom: "32px" }}>
        {/* Top Searched Vehicles Card */}
        <div style={cardContainer}>
          <div style={cardHeaderStyle}>
            <div>
              <h3 style={cardTitleStyle}>Top Searched Vehicles</h3>
              <p style={cardSubtitleStyle}>Most queried Year/Make/Model combinations</p>
            </div>
            <Link to="/app/analytics" style={{ fontSize: "13px", color: "#2563eb", fontWeight: "600", textDecoration: "none" }}>
              View Report →
            </Link>
          </div>

          {topVehicles.length === 0 ? (
            <div style={emptyStateStyle}>
              <span>No vehicle search history recorded yet.</span>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                  <th style={tableThStyle}>Rank</th>
                  <th style={tableThStyle}>Vehicle Specification</th>
                  <th style={{ ...tableThStyle, textAlign: "right" }}>Total Searches</th>
                </tr>
              </thead>
              <tbody>
                {topVehicles.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                    <td style={{ ...tableTdStyle, width: "40px", fontWeight: "700", color: "#64748b" }}>#{i + 1}</td>
                    <td style={{ ...tableTdStyle, fontWeight: "600", color: "#1e293b" }}>
                      {v.year} {v.make} {v.model}
                    </td>
                    <td style={{ ...tableTdStyle, textAlign: "right" }}>
                      <span style={{ background: "#f1f5f9", color: "#334155", padding: "4px 10px", borderRadius: "12px", fontWeight: "700", fontSize: "13px" }}>
                        {v._count.id} searches
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Searches Card */}
        <div style={cardContainer}>
          <div style={cardHeaderStyle}>
            <div>
              <h3 style={cardTitleStyle}>Live Search Activity</h3>
              <p style={cardSubtitleStyle}>Real-time storefront vehicle queries</p>
            </div>
            <Link to="/app/analytics" style={{ fontSize: "13px", color: "#2563eb", fontWeight: "600", textDecoration: "none" }}>
              View Log →
            </Link>
          </div>

          {recentSearches.length === 0 ? (
            <div style={emptyStateStyle}>
              <span>Storefront search events will appear here live.</span>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                  <th style={tableThStyle}>Vehicle</th>
                  <th style={{ ...tableThStyle, textAlign: "center" }}>Status</th>
                  <th style={{ ...tableThStyle, textAlign: "right" }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentSearches.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                    <td style={{ ...tableTdStyle, fontWeight: "600", color: "#1e293b" }}>
                      {s.year} {s.make} {s.model}
                    </td>
                    <td style={{ ...tableTdStyle, textAlign: "center" }}>
                      <span
                        style={{
                          background: s.hasResults ? "#ecfdf5" : "#fef2f2",
                          border: `1px solid ${s.hasResults ? "#a7f3d0" : "#fecaca"}`,
                          color: s.hasResults ? "#047857" : "#b91c1c",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "700",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {s.hasResults ? "✓ Matched" : "No Product"}
                      </span>
                    </td>
                    <td style={{ ...tableTdStyle, textAlign: "right", color: "#64748b", fontSize: "13px" }}>
                      {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Getting Started / Quick Launch Guide */}
      {stats.fitmentCount === 0 && (
        <div style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #e6f4ea 100%)", border: "1px solid #b7e1cd", borderRadius: "14px", padding: "28px 32px", boxShadow: "0 4px 16px rgba(0, 128, 96, 0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#005e46" }}>
              Quick Launch Checklist — 4 Easy Steps
            </h3>
          </div>
          <p style={{ margin: "0 0 20px", color: "#137333", fontSize: "14px" }}>
            Follow these steps to enable vehicle search on your Shopify storefront.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            <Link to="/app/fitment/add" style={guideStepStyle}>
              <div style={stepNumStyle}>1</div>
              <div>
                <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", marginBottom: "2px" }}>Add Fitment Record</strong>
                <span style={{ color: "#64748b", fontSize: "12px" }}>Create Year/Make/Model records</span>
              </div>
            </Link>

            <Link to="/app/fitment/import" style={guideStepStyle}>
              <div style={stepNumStyle}>2</div>
              <div>
                <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", marginBottom: "2px" }}>Bulk Import CSV</strong>
                <span style={{ color: "#64748b", fontSize: "12px" }}>Upload thousands of fitments</span>
              </div>
            </Link>

            <Link to="/app/products" style={guideStepStyle}>
              <div style={stepNumStyle}>3</div>
              <div>
                <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", marginBottom: "2px" }}>Map Store Products</strong>
                <span style={{ color: "#64748b", fontSize: "12px" }}>Assign parts to vehicles</span>
              </div>
            </Link>

            <Link to="/app/widget" style={guideStepStyle}>
              <div style={stepNumStyle}>4</div>
              <div>
                <strong style={{ display: "block", color: "#0f172a", fontSize: "14px", marginBottom: "2px" }}>Publish Search Widget</strong>
                <span style={{ color: "#64748b", fontSize: "12px" }}>Add Theme App Extension</span>
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// Styling Tokens
const primaryActionBtn = {
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
  boxShadow: "0 2px 6px rgba(0, 128, 96, 0.3)",
};

const secondaryActionBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  background: "rgba(255, 255, 255, 0.1)",
  color: "#ffffff",
  border: "1px solid rgba(255, 255, 255, 0.2)",
  padding: "10px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "600",
  backdropFilter: "blur(4px)",
};

const cardContainer = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const cardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "20px",
};

const cardTitleStyle = {
  margin: "0 0 4px",
  fontSize: "17px",
  fontWeight: "700",
  color: "#0f172a",
};

const cardSubtitleStyle = {
  margin: 0,
  fontSize: "13px",
  color: "#64748b",
};

const emptyStateStyle = {
  padding: "36px 16px",
  textAlign: "center",
  color: "#64748b",
  fontSize: "14px",
  background: "#f8fafc",
  borderRadius: "8px",
  border: "1px dashed #cbd5e1",
};

const tableThStyle = {
  padding: "10px 8px",
  textAlign: "left",
  fontSize: "12px",
  color: "#64748b",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tableTdStyle = {
  padding: "14px 8px",
  fontSize: "14px",
};

const guideStepStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  background: "#ffffff",
  border: "1px solid #b7e1cd",
  borderRadius: "10px",
  padding: "14px 16px",
  textDecoration: "none",
  boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
};

const stepNumStyle = {
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  background: "#008060",
  color: "#ffffff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: "800",
  fontSize: "13px",
  flexShrink: 0,
};
