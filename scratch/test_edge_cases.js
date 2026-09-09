import fs from 'fs';

console.log('=== TESTING REAL-WORLD EDGE CASES ===\n');

// 1. Namespaced ACES XML
const namespacedXml = `
<aces:ACES xmlns:aces="http://www.autocare.org/aces" version="3.2">
  <aces:Header>
    <aces:Company>Enterprise Auto Feeds</aces:Company>
  </aces:Header>
  <aces:App action="A" id="1">
    <aces:BaseVehicleYear>2025</aces:BaseVehicleYear>
    <aces:MakeName>Ford</aces:MakeName>
    <aces:ModelName>F-150</aces:ModelName>
    <aces:SubModelName>Lariat</aces:SubModelName>
    <aces:PartNumber>FO-F150-LARIAT</aces:PartNumber>
  </aces:App>
</aces:ACES>
`;

function testXmlWithNamespaces(rawInput) {
  const appRegex = /<(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)>/gi;
  const matches = rawInput.match(appRegex) || [];
  if (matches.length === 0) return { error: 'No matches found', count: 0 };

  const records = [];
  for (const block of matches) {
    const getXmlTag = (...tags) => {
      for (const tag of tags) {
        const match = block.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]+)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i'));
        if (match && match[1]?.trim()) return match[1].trim();
      }
      return '';
    };

    const year = getXmlTag('Year', 'BaseVehicleYear', 'ModelYear', 'FromYear', 'YearID');
    const make = getXmlTag('Make', 'MakeName', 'Brand', 'Manufacturer');
    const model = getXmlTag('Model', 'ModelName', 'VehicleModel');
    const trim = getXmlTag('SubModel', 'SubModelName', 'EngineBase', 'Trim');
    const part = getXmlTag('Part', 'PartNumber', 'ItemNumber', 'SKU');
    records.push({ year, make, model, trim, part });
  }

  return { count: records.length, records };
}

const nsRes = testXmlWithNamespaces(namespacedXml);
console.log('Namespaced XML test result:', nsRes);
if (nsRes.count === 1 && nsRes.records[0].make === 'Ford') {
  console.log('✓ Namespaced XML parsed successfully!');
} else {
  console.error('✕ Namespaced XML failed!');
}

// 2. Semicolon-delimited CSV test
const semiCsv = `year;make;model;trim;product_handle
2024;BMW;M3;Competition;bmw-m3-exhaust
2025;Audi;RS5;Base;audi-rs5-intake`;

function testCsvDelimiter(input) {
  const lines = input.trim().split(/\r?\n/).filter(l => l.trim());
  const firstLine = lines[0];
  let delimiter = ",";
  if (!firstLine.includes(",") && firstLine.includes(";")) delimiter = ";";
  else if (!firstLine.includes(",") && firstLine.includes("\t")) delimiter = "\t";

  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/["']/g, ""));
  const yearIdx = headers.findIndex(h => ["year", "yearid", "modelyear"].includes(h));
  const makeIdx = headers.findIndex(h => ["make", "makename"].includes(h));
  const modelIdx = headers.findIndex(h => ["model", "modelname"].includes(h));

  const parsedRows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ""));
    parsedRows.push({
      year: cols[yearIdx],
      make: cols[makeIdx],
      model: cols[modelIdx]
    });
  }
  return { delimiter, headers, parsedRows };
}

const semiRes = testCsvDelimiter(semiCsv);
console.log('Semicolon CSV test result:', semiRes);
if (semiRes.delimiter === ';' && semiRes.parsedRows.length === 2 && semiRes.parsedRows[0].make === 'BMW') {
  console.log('✓ Semicolon CSV parsed successfully!');
} else {
  console.error('✕ Semicolon CSV failed!');
}
