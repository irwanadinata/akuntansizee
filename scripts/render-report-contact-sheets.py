from pathlib import Path
import subprocess
from PIL import Image, ImageDraw
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
poppler = Path(r"C:\Users\irwan\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe")
target = root / "tmp/pdfs/rendered"
target.mkdir(parents=True, exist_ok=True)
for name in ["balance", "profit", "combined", "ledger", "diagnostic"]:
    subprocess.run([str(poppler), "-r", "100", "-png", str(root / f"output/pdf/qa-{name}.pdf"), str(target / name)], check=True, capture_output=True)
    count = len(PdfReader(root / f"output/pdf/qa-{name}.pdf").pages)
    pages = [target / f"{name}-{index:0{len(str(count))}d}.png" for index in range(1, count + 1)]
    for offset in range(0, len(pages), 4):
        canvas = Image.new("RGB", (860, 1250), "#dce4e6")
        draw = ImageDraw.Draw(canvas)
        for index, page in enumerate(pages[offset:offset + 4]):
            image = Image.open(page).convert("RGB")
            image.thumbnail((410, 580))
            x, y = (index % 2) * 430 + 10, (index // 2) * 625 + 25
            canvas.paste(image, (x, y))
            draw.text((x, y - 17), page.name, fill="black")
        canvas.save(target / f"contact-{name}-{offset // 4 + 1}.png")
print("Rendered all QA PDF pages and contact sheets under tmp/pdfs/rendered")
