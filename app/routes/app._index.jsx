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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const res = await Promise.all([
      prisma.fitmentRecord?.count({ where: { shop } }) ?? 0,
      prisma.fitmentProduct?.count({ where: { fitment: { shop } } }) ?? 0,
      prisma.universalProduct?.count({ where: { shop } }) ?? 0,
      prisma.searchLog?.count({
        where: { shop, createdAt: { gte: startOfMonth } },
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
    {
      label: "Fitment Records",
      value: stats.fitmentCount,
      href: "/app/fitment",
      color: "#008060",
      bgGradient: "linear-gradient(135deg, #008060 0%, #005e46 100%)",
      iconBg: "#ecfdf5",
      iconColor: "#047857",
      icon: <CarIcon />,
    },
    {
      label: "Product Mappings",
      value: stats.productMappingCount,
      href: "/app/products",
      color: "#2563eb",
      bgGradient: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
      iconBg: "#eff6ff",
      iconColor: "#1d4ed8",
      icon: <LinkIcon />,
    },
    {
      label: "Universal Products",
      value: stats.universalCount,
      href: "/app/products/universal",
      color: "#7c3aed",
      bgGradient: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
      iconBg: "#f5f3ff",
      iconColor: "#6d28d9",
      icon: <BoxIcon />,
    },
    {
      label: "Searches This Month",
      value: stats.monthSearches,
      href: "/app/analytics",
      color: "#ea580c",
      bgGradient: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
      iconBg: "#fff7ed",
      iconColor: "#c2410c",
      icon: <SearchIcon />,
    },
    {
      label: "No-Result Opportunity",
      value: stats.noResultSearches,
      href: "/app/analytics",
      color: "#dc2626",
      bgGradient: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
      iconBg: "#fef2f2",
      iconColor: "#b91c1c",
      icon: <AlertIcon />,
    },
  ];

  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1240px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      
      {/* Executive Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", borderRadius: "16px", padding: "32px", color: "#ffffff", marginBottom: "28px", boxShadow: "0 10px 25px -5px rgba(15, 23, 42, 0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h1 style={{ margin: 0, fontSize: "26px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                PartMatch Auto Fitment Center
              </h1>
              <span style={{ background: "rgba(16, 185, 129, 0.2)", border: "1px solid rgba(16, 185, 129, 0.4)", color: "#34d399", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34d399" }} />
                Active & Live
              </span>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
              Connected Store: <strong style={{ color: "#ffffff" }}>{shop}</strong>
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
                borderRadius: "14px",
                padding: "22px 20px",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.03)",
                transition: "all 0.2s ease",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                height: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ height: "4px", width: "100%", position: "absolute", top: 0, left: 0, background: c.bgGradient }} />
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {c.label}
                  </span>
                  <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: c.iconBg, color: c.iconColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {c.icon}
                  </div>
                </div>
                <div style={{ fontSize: "32px", fontWeight: "800", color: "#0f172a", letterSpacing: "-1px" }}>
                  {c.value.toLocaleString()}
                </div>
              </div>
              <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "4px", color: c.color, fontSize: "13px", fontWeight: "700" }}>
                <span>Manage</span> <span>→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Two Column Data Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "28px", marginBottom: "32px" }}>
        
        {/* Top Searched Vehicles Card */}
        <div style={cardContainer}>
          <div style={cardHeaderStyle}>
            <div>
              <h3 style={cardTitleStyle}>Top Searched Vehicles</h3>
              <p style={cardSubtitleStyle}>Most queried Year/Make/Model combinations</p>
            </div>
            <Link to="/app/analytics" style={{ fontSize: "13px", color: "#2563eb", fontWeight: "700", textDecoration: "none" }}>
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
                  <tr key={i} style={{ borderBottom: "1px solid #f8fafc", transition: "background 0.15s ease" }}>
                    <td style={{ ...tableTdStyle, width: "45px" }}>
                      <span
                        style={{
                          background: i === 0 ? "#fef3c7" : i === 1 ? "#f1f5f9" : i === 2 ? "#ffedd5" : "#f1f5f9",
                          color: i === 0 ? "#b45309" : i === 1 ? "#475569" : i === 2 ? "#c2410c" : "#64748b",
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          fontWeight: "800",
                        }}
                      >
                        #{i + 1}
                      </span>
                    </td>
                    <td style={{ ...tableTdStyle, fontWeight: "700", color: "#0f172a" }}>
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

        {/* Live Search Activity Card */}
        <div style={cardContainer}>
          <div style={cardHeaderStyle}>
            <div>
              <h3 style={cardTitleStyle}>Live Search Activity</h3>
              <p style={cardSubtitleStyle}>Real-time storefront vehicle queries</p>
            </div>
            <Link to="/app/analytics" style={{ fontSize: "13px", color: "#2563eb", fontWeight: "700", textDecoration: "none" }}>
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
                    <td style={{ ...tableTdStyle, fontWeight: "700", color: "#0f172a" }}>
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
      <div style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #e6f4ea 100%)", border: "1px solid #b7e1cd", borderRadius: "16px", padding: "28px 32px", boxShadow: "0 4px 16px rgba(0, 128, 96, 0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#005e46" }}>
            Quick Setup Checklist — 4 Easy Steps
          </h3>
          <span style={{ fontSize: "12px", background: "#dcfce7", color: "#15803d", padding: "3px 10px", borderRadius: "12px", fontWeight: "700" }}>
            Setup Recommended
          </span>
        </div>
        <p style={{ margin: "0 0 20px", color: "#137333", fontSize: "14px" }}>
          Follow these quick steps to ensure your vehicle fitment widget is live on your store.
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
              <span style={{ color: "#64748b", fontSize: "12px" }}>Customize Theme App Block</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

// Icons
function CarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.6C1.4 11 1 11.8 1 12.6V16c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
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
  borderRadius: "16px",
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
  fontWeight: "800",
  color: "#0f172a",
  letterSpacing: "-0.3px",
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
  borderRadius: "10px",
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
  borderRadius: "12px",
  padding: "16px",
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
