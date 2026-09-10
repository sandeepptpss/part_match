import fs from "node:fs";

console.log("=== VERIFYING LIVE AUTO SEARCH FUNCTIONALITY ===");

const productsFile = fs.readFileSync("app/routes/app.products._index.jsx", "utf-8");
const fitmentFile = fs.readFileSync("app/routes/app.fitment._index.jsx", "utf-8");

const checks = [
  {
    name: "Products Directory: imports useRef & useEffect",
    pass: productsFile.includes("useRef") && productsFile.includes("useEffect"),
  },
  {
    name: "Products Directory: defines debounceTimerRef and inputRef",
    pass: productsFile.includes("debounceTimerRef") && productsFile.includes("inputRef"),
  },
  {
    name: "Products Directory: has handleSearchChange with debounce timeout",
    pass: productsFile.includes("handleSearchChange") && productsFile.includes("setTimeout"),
  },
  {
    name: "Products Directory: binds value={searchTerm} and onChange={handleSearchChange}",
    pass: productsFile.includes("value={searchTerm}") && productsFile.includes("onChange={handleSearchChange}"),
  },
  {
    name: "Products Directory: has clear button ✕ inside search input",
    pass: productsFile.includes("onClick={handleClearSearch}") && productsFile.includes("title=\"Clear search\""),
  },
  {
    name: "Products Directory: loader includes trim in OR search clauses",
    pass: productsFile.includes("{ fitment: { trim: { contains: search } } }"),
  },
  {
    name: "Fitment Catalog: imports useRef",
    pass: fitmentFile.includes("useRef"),
  },
  {
    name: "Fitment Catalog: has handleSearchChange with debounce timeout",
    pass: fitmentFile.includes("handleSearchChange") && fitmentFile.includes("setTimeout"),
  },
  {
    name: "Fitment Catalog: binds value={searchTerm} and onChange={handleSearchChange}",
    pass: fitmentFile.includes("value={searchTerm}") && fitmentFile.includes("onChange={handleSearchChange}"),
  },
  {
    name: "Fitment Catalog: has clear button ✕ inside search input",
    pass: fitmentFile.includes("onClick={handleClearSearch}") && fitmentFile.includes("title=\"Clear search\""),
  },
];

let allPassed = true;
checks.forEach((c) => {
  if (c.pass) {
    console.log(`  ✓ PASS: ${c.name}`);
  } else {
    console.log(`  ✗ FAIL: ${c.name}`);
    allPassed = false;
  }
});

if (allPassed) {
  console.log("\nALL LIVE SEARCH CHECKS PASSED SUCCESSFULLY!");
  process.exit(0);
} else {
  console.error("\nSOME CHECKS FAILED!");
  process.exit(1);
}
