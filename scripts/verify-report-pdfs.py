from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
for name in ["balance", "profit", "combined", "ledger", "diagnostic"]:
    path = root / "output" / "pdf" / f"qa-{name}.pdf"
    reader = PdfReader(path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "PT Zee Komunikasi Indonesia" in text
    assert "DATA UJI SINTETIS" in text
    assert "2039" in text
    assert "JRN-" in text
    assert "Halaman" in text and "WIB" in text
    assert "Rp " in text
    for index, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        assert "PT Zee Komunikasi Indonesia" in page_text, "Tidak boleh ada halaman kosong akibat footer"
        assert f"Halaman {index + 1} / {len(reader.pages)}" in page_text
        assert "WIB" in page_text
    if name == "diagnostic":
        assert "BUKAN LAPORAN FINAL" in text
    if name in ["balance", "combined"]:
        assert "PJM-" in text and "CIC-" in text and "PIU-" in text and "BYC-" in text and "UTG-" in text and "BYS-" in text
    assert all(float(page.mediabox.width) > 500 for page in reader.pages)
    print(f"PASS {path.name}: {len(reader.pages)} halaman; perusahaan/periode/nomor/footer terbaca")
precision = "\n".join(page.extract_text() or "" for page in PdfReader(root / "tmp/pdfs/precision.pdf").pages)
assert "99.999.999.999.999.999.999" in precision
print("PASS PDF presisi 20 digit tanpa pembulatan")
