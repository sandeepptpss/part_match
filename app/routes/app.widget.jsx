const json = (data, init) => Response.json(data, init);
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.widgetSettings?.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });

  return json({ settings });
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
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  // Live preview state (use settings as default)
  const s = settings;

  return (
    <div style={{ padding: "20px", maxWidth: "1100px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "0 0 4px" }}>Search Widget</h1>
      <p style={{ color: "#6d7175", margin: "0 0 24px" }}>Customize how the search widget looks in your storefront.</p>

      {actionData?.saved && (
        <div style={{ background: "#d4edda", color: "#155724", padding: "12px 16px", borderRadius: "6px", marginBottom: "20px" }}>
          Widget settings saved!
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px" }}>
        {/* Settings Form */}
        <Form method="post">
          <div style={section}>
            <h3 style={secHead}>Text & Labels</h3>
            {field("Heading", "heading", s.heading)}
            {field("Subheading", "subheading", s.subheading)}
            {field("Year label", "yearLabel", s.yearLabel)}
            {field("Make label", "makeLabel", s.makeLabel)}
            {field("Model label", "modelLabel", s.modelLabel)}
            {field("Search button text", "searchButtonText", s.searchButtonText)}
            {field("Clear button text", "clearButtonText", s.clearButtonText)}
          </div>

          <div style={section}>
            <h3 style={secHead}>Appearance</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={lbl}>Button Color</label>
                <input type="color" name="primaryColor" defaultValue={s.primaryColor} style={colorInput} />
              </div>
              <div>
                <label style={lbl}>Button Text</label>
                <input type="color" name="textColor" defaultValue={s.textColor} style={colorInput} />
              </div>
              <div>
                <label style={lbl}>Background</label>
                <input type="color" name="backgroundColor" defaultValue={s.backgroundColor} style={colorInput} />
              </div>
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={lbl}>Border Radius (px)</label>
              <input type="number" name="borderRadius" defaultValue={s.borderRadius} min="0" max="20" style={inp} />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={lbl}>Layout</label>
              <select name="layout" defaultValue={s.layout} style={inp}>
                <option value="horizontal">Horizontal</option>
                <option value="stacked">Stacked</option>
              </select>
            </div>
          </div>

          <div style={section}>
            <h3 style={secHead}>Visibility</h3>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <input type="checkbox" name="showHeading" defaultChecked={s.showHeading} />
              <span style={{ fontSize: "14px" }}>Show heading</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="checkbox" name="showSubheading" defaultChecked={s.showSubheading} />
              <span style={{ fontSize: "14px" }}>Show subheading</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{ background: "#008060", color: "#fff", border: "none", padding: "10px 24px", borderRadius: "6px", fontSize: "14px", fontWeight: "500", cursor: "pointer" }}
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </Form>

        {/* Preview */}
        <div>
          <h3 style={{ fontSize: "15px", fontWeight: "600", margin: "0 0 12px" }}>Live Preview</h3>
          <div style={{ background: s.backgroundColor, borderRadius: `${s.borderRadius}px`, padding: "24px", border: "1px solid #e1e3e5" }}>
            {s.showHeading && (
              <div style={{ textAlign: "center", fontWeight: "700", fontSize: "18px", marginBottom: "4px" }}>{s.heading}</div>
            )}
            {s.showSubheading && (
              <div style={{ textAlign: "center", color: "#6d7175", fontSize: "14px", marginBottom: "16px" }}>{s.subheading}</div>
            )}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {[s.yearLabel, s.makeLabel, s.modelLabel].map((lbl) => (
                <select key={lbl} disabled style={{ flex: 1, padding: "8px 12px", borderRadius: `${s.borderRadius}px`, border: "1px solid #c9cccf", fontSize: "14px" }}>
                  <option>{lbl}</option>
                </select>
              ))}
              <button style={{ background: s.primaryColor, color: s.textColor, border: "none", padding: "8px 20px", borderRadius: `${s.borderRadius}px`, fontWeight: "500", cursor: "pointer" }}>
                {s.searchButtonText}
              </button>
              <button style={{ background: "#fff", color: "#333", border: "1px solid #c9cccf", padding: "8px 16px", borderRadius: `${s.borderRadius}px`, cursor: "pointer" }}>
                {s.clearButtonText}
              </button>
            </div>
          </div>

          <div style={{ marginTop: "16px", background: "#f0f7ff", border: "1px solid #b3d4f5", borderRadius: "6px", padding: "16px" }}>
            <h4 style={{ margin: "0 0 8px", fontSize: "14px" }}>Enable the Widget</h4>
            <p style={{ fontSize: "13px", color: "#333", margin: 0 }}>
              Go to your Shopify theme editor → Add Block → <strong>PartMatch Search Widget</strong>.
              The widget uses an App Block powered by the Theme App Extension.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function field(label, name, defaultValue) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={lbl}>{label}</label>
      <input name={name} defaultValue={defaultValue} style={inp} />
    </div>
  );
}

const section = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "16px", marginBottom: "16px" };
const secHead = { fontSize: "15px", fontWeight: "600", margin: "0 0 14px" };
const lbl = { display: "block", fontSize: "13px", color: "#6d7175", marginBottom: "4px" };
const inp = { width: "100%", padding: "7px 10px", border: "1px solid #c9cccf", borderRadius: "5px", fontSize: "14px", boxSizing: "border-box" };
const colorInput = { width: "100%", height: "36px", padding: "2px", border: "1px solid #c9cccf", borderRadius: "5px", cursor: "pointer" };
