import { useState } from "react";
const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useNavigation, useActionData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // eslint-disable-next-line no-undef
  const adminEmail = process.env.ADMIN_EMAIL || "sandeepptpss@gmail.com";
  // eslint-disable-next-line no-undef
  const adminStore = process.env.ADMIN_STORE_NAME || "quickstart-749ac396";
  const sessionEmail = session.email || adminEmail;
  const isAdmin =
    shop.includes(adminStore) ||
    shop.includes("quickstart-749ac396") ||
    sessionEmail.includes("sandeepptpss") ||
    sessionEmail === adminEmail;

  const settings = await prisma.widgetSettings?.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });

  return json({ settings, isAdmin });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const data = {
    heading: formData.get("heading")?.toString() || "Find Your Part",
    subheading: formData.get("subheading")?.toString() || "Search by Application",
    yearLabel: formData.get("yearLabel")?.toString() || "Year",
    makeLabel: formData.get("makeLabel")?.toString() || "Make",
    modelLabel: formData.get("modelLabel")?.toString() || "Model",
    searchButtonText: formData.get("searchButtonText")?.toString() || "Search",
    clearButtonText: formData.get("clearButtonText")?.toString() || "Clear",
    primaryColor: formData.get("primaryColor")?.toString() || "#008060",
    textColor: formData.get("textColor")?.toString() || "#ffffff",
    backgroundColor: formData.get("backgroundColor")?.toString() || "#f4f6f8",
    borderRadius: parseInt(formData.get("borderRadius") || "4", 10),
    layout: formData.get("layout")?.toString() || "horizontal",
    showHeading: formData.get("showHeading") === "on",
    showSubheading: formData.get("showSubheading") === "on",
  };

  await prisma.widgetSettings?.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });

  return json({ saved: true });
};

export default function WidgetSettings() {
  const { settings, isAdmin } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  // Live preview interactive state
  const [formState, setFormState] = useState({
    heading: settings.heading || "Find Your Part",
    subheading: settings.subheading || "Search by Application",
    yearLabel: settings.yearLabel || "Year",
    makeLabel: settings.makeLabel || "Make",
    modelLabel: settings.modelLabel || "Model",
    searchButtonText: settings.searchButtonText || "Search",
    clearButtonText: settings.clearButtonText || "Clear",
    primaryColor: settings.primaryColor || "#008060",
    textColor: settings.textColor || "#ffffff",
    backgroundColor: settings.backgroundColor || "#f8fafc",
    borderRadius: settings.borderRadius ?? 6,
    layout: settings.layout || "horizontal",
    showHeading: settings.showHeading ?? true,
    showSubheading: settings.showSubheading ?? true,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormState((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const s = formState;

  return (
    <div style={{ padding: "28px 24px", maxWidth: "1240px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: "800", margin: "0 0 6px", color: "#0f172a", letterSpacing: "-0.5px" }}>Storefront Search Widget Editor</h1>
        <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
          Customize the appearance, labels, colors, and layout of the vehicle fitment search widget on your storefront.
        </p>
      </div>

      {/* Quick Navigation Sub-Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "28px", background: "#f8fafc", padding: "6px", borderRadius: "12px", border: "1px solid #e2e8f0", width: "fit-content", flexWrap: "wrap" }}>
        <Link to="/app/settings" style={{ background: "transparent", color: "#64748b", padding: "8px 16px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "600" }}>
          ⚙️ Store Settings
        </Link>
        <Link to="/app/widget" style={{ background: "#ffffff", color: "#008060", border: "1px solid #cbd5e1", padding: "8px 16px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "700", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          🎨 Widget Editor
        </Link>
        <Link to="/app/plans" style={{ background: "transparent", color: "#64748b", padding: "8px 16px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "600" }}>
          💳 Plans & Pricing
        </Link>
      </div>

      {actionData?.saved && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "14px 18px", borderRadius: "10px", marginBottom: "24px", fontWeight: "600", fontSize: "14px" }}>
          ✓ Widget customization settings saved successfully!
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: "32px", alignItems: "start" }}>
        {/* Settings Form */}
        <Form method="post">
          <div style={sectionCard}>
            <h3 style={secHead}>Text & Labels</h3>
            {renderField("Heading Title", "heading", s.heading, handleChange)}
            {renderField("Subheading Text", "subheading", s.subheading, handleChange)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              {renderField("Year Label", "yearLabel", s.yearLabel, handleChange)}
              {renderField("Make Label", "makeLabel", s.makeLabel, handleChange)}
              {renderField("Model Label", "modelLabel", s.modelLabel, handleChange)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {renderField("Search Button Label", "searchButtonText", s.searchButtonText, handleChange)}
              {renderField("Clear Button Label", "clearButtonText", s.clearButtonText, handleChange)}
            </div>
          </div>

          <div style={sectionCard}>
            <h3 style={secHead}>Styling & Layout</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "16px" }}>
              <div>
                <label style={lbl}>Button Fill Color</label>
                <input type="color" name="primaryColor" value={s.primaryColor} onChange={handleChange} style={colorInput} />
              </div>
              <div>
                <label style={lbl}>Button Text Color</label>
                <input type="color" name="textColor" value={s.textColor} onChange={handleChange} style={colorInput} />
              </div>
              <div>
                <label style={lbl}>Container Background</label>
                <input type="color" name="backgroundColor" value={s.backgroundColor} onChange={handleChange} style={colorInput} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "12px" }}>
              <div>
                <label style={lbl}>Corner Radius (px)</label>
                <input type="number" name="borderRadius" value={s.borderRadius} onChange={handleChange} min="0" max="24" style={inp} />
              </div>
              <div>
                <label style={lbl}>Form Layout Style</label>
                <select name="layout" value={s.layout} onChange={handleChange} style={inp}>
                  <option value="horizontal">Horizontal Row</option>
                  <option value="stacked">Stacked Vertical</option>
                </select>
              </div>
            </div>
          </div>

          <div style={sectionCard}>
            <h3 style={secHead}>Element Visibility</h3>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" name="showHeading" checked={s.showHeading} onChange={handleChange} style={{ width: "16px", height: "16px" }} />
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>Show heading title</span>
            </label>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" name="showSubheading" checked={s.showSubheading} onChange={handleChange} style={{ width: "16px", height: "16px" }} />
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>Show subheading text</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={saveBtnStyle}
          >
            {saving ? "Saving Changes…" : "Save Widget Settings"}
          </button>
        </Form>

        {/* Sticky Live Preview */}
        <div style={{ position: "sticky", top: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "17px", fontWeight: "800", margin: 0, color: "#0f172a" }}>Storefront Live Preview</h3>
            <span style={{ fontSize: "12px", background: "#e2e8f0", color: "#475569", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
              Realtime State
            </span>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "16px", padding: "28px", boxShadow: "0 8px 24px rgba(0, 0, 0, 0.06)" }}>
            <div style={{ background: s.backgroundColor, borderRadius: `${s.borderRadius}px`, padding: "28px 24px", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
              {s.showHeading && (
                <div style={{ textAlign: "center", fontWeight: "800", fontSize: "20px", color: "#0f172a", marginBottom: "4px" }}>{s.heading}</div>
              )}
              {s.showSubheading && (
                <div style={{ textAlign: "center", color: "#64748b", fontSize: "14px", marginBottom: "20px" }}>{s.subheading}</div>
              )}
              <div style={{ display: "flex", flexDirection: s.layout === "stacked" ? "column" : "row", gap: "10px" }}>
                {[s.yearLabel, s.makeLabel, s.modelLabel].map((lbl) => (
                  <select key={lbl} disabled style={{ flex: 1, padding: "10px 14px", borderRadius: `${s.borderRadius}px`, border: "1px solid #cbd5e1", fontSize: "14px", background: "#ffffff", color: "#64748b" }}>
                    <option>{lbl}</option>
                  </select>
                ))}
                <button style={{ background: s.primaryColor, color: s.textColor, border: "none", padding: "10px 22px", borderRadius: `${s.borderRadius}px`, fontWeight: "700", fontSize: "14px", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}>
                  {s.searchButtonText}
                </button>
                <button style={{ background: "#ffffff", color: "#475569", border: "1px solid #cbd5e1", padding: "10px 16px", borderRadius: `${s.borderRadius}px`, fontWeight: "600", fontSize: "14px", cursor: "pointer" }}>
                  {s.clearButtonText}
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "20px", background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)", border: "1px solid #bae6fd", borderRadius: "14px", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: "#0369a1" }}>How to Embed on Storefront</h4>
            </div>
            <p style={{ fontSize: "13px", color: "#0c4a6e", margin: 0, lineHeight: "1.6" }}>
              In your Shopify Admin, navigate to <strong>Online Store → Themes → Customize</strong>. Click <strong>Add Block</strong> on your Homepage or Product Template, then select <strong>PartMatch Search Widget</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderField(label, name, value, onChange) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <label style={lbl}>{label}</label>
      <input name={name} value={value} onChange={onChange} style={inp} />
    </div>
  );
}

const sectionCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "24px",
  marginBottom: "20px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const secHead = { fontSize: "16px", fontWeight: "800", color: "#0f172a", margin: "0 0 16px" };
const lbl = { display: "block", fontSize: "13px", color: "#64748b", fontWeight: "700", marginBottom: "6px" };
const inp = { width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", outline: "none" };
const colorInput = { width: "100%", height: "42px", padding: "4px", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer", background: "#ffffff" };
const checkboxLabelStyle = { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "10px" };
const saveBtnStyle = {
  background: "#008060",
  color: "#ffffff",
  border: "none",
  padding: "12px 28px",
  borderRadius: "8px",
  fontSize: "15px",
  fontWeight: "700",
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(0, 128, 96, 0.3)",
};

