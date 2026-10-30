"""Read-only verification of the authorized COA workbook and source JSON."""
from collections import defaultdict
from pathlib import Path
import hashlib
import json
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parent.parent
source_path = root / "prisma/coa-source.json"
excel_path = root / "referensi/COA.xlsx"
source = json.loads(source_path.read_text(encoding="utf-8-sig"))
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
sheets = {}
formula_count = 0
with zipfile.ZipFile(excel_path) as archive:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", ns)]
    for sheet in workbook.findall("s:sheets/s:sheet", ns):
        rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = rels[rid]
        path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
        data = ET.fromstring(archive.read(path))
        cells = {}
        for cell in data.findall(".//s:sheetData/s:row/s:c", ns):
            formula_count += cell.find("s:f", ns) is not None
            if cell.attrib.get("t") == "inlineStr":
                value = "".join(cell.find("s:is", ns).itertext())
            else:
                value = cell.findtext("s:v", default="", namespaces=ns)
                if cell.attrib.get("t") == "s":
                    value = strings[int(value)]
            cells[cell.attrib["r"]] = value
        sheets[sheet.attrib["name"]] = cells
assert set(sheets) == {"Sheet1", "Sheet2", "Sheet3"}
assert not any(value for name, cells in sheets.items() if name != "Sheet1" for value in cells.values())
assert formula_count == 0
cells = sheets["Sheet1"]
assert [cells.get(f"{c}1") for c in "ABCDE"] == ["Number", "Name", "Type", "Details", "Balance"]
expected = [{"sourceRow": r, "sourceCode": cells.get(f"A{r}", ""), "name": cells.get(f"B{r}", ""),
             "sourceType": cells.get(f"C{r}", ""), "details": cells.get(f"D{r}", "")} for r in range(2, 93)]
assert source == expected and len(source) == 91
assert all(isinstance(row["sourceCode"], str) for row in source)
assert all(cells.get(f"E{r}", "") == "" for r in range(2, 93))
assert {address for address, value in cells.items() if value} == (
    {f"{c}{r}" for r in range(2, 93) for c in "ABCD"} | {f"{c}1" for c in "ABCDE"})
groups = defaultdict(list)
for row in source:
    assert re.fullmatch(r"\d{4}\.\d+", row["sourceCode"])
    groups[row["sourceCode"]].append({"row": row["sourceRow"], "name": row["name"]})
duplicates = {code: rows for code, rows in groups.items() if len(rows) > 1}
assert {code: len(rows) for code, rows in duplicates.items()} == {"1122.1": 2, "1130.1": 2}
print(json.dumps({"excelAccounts": 91, "jsonAccounts": 91, "exactMatches": 91, "distinctSourceCodes": len(groups),
                  "duplicates": duplicates, "emptyBalances": 91, "formulaCount": formula_count,
                  "sourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
                  "excelSha256": hashlib.sha256(excel_path.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2))

