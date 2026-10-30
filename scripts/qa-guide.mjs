import { createRequire } from "node:module";
import { mkdirSync,readFileSync } from "node:fs";
import { resolve,join } from "node:path";
const require=createRequire(import.meta.url),{chromium}=require(process.env.QA_PLAYWRIGHT_PATH||"playwright"),{marked}=require(process.env.QA_MARKED_PATH||"marked");
const directory=resolve(".npm-cache/final-qa-guide");mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
  const page=await browser.newPage();await page.setContent(`<html lang="id"><head><meta charset="utf-8"><style>@page{size:A4;margin:15mm}body{font:11pt/1.3 Arial,sans-serif;color:#172b3a}h1{font-size:18pt}h2{font-size:13pt;color:#087f78;margin-top:15pt}h2:not(:first-of-type){break-before:page}h3{font-size:11.5pt;margin-top:11pt}h1,h2,h3{break-after:avoid}p{margin:6pt 0}li{margin:3pt 0;break-inside:avoid}ol,ul{padding-left:20pt}code{font-size:10pt}</style></head><body>${marked.parse(readFileSync("docs/09-panduan-admin.md","utf8"))}</body></html>`);
  await page.pdf({path:join(directory,"guide-print.pdf"),format:"A4",printBackground:true});console.info("Panduan cetak untuk pemeriksaan jumlah halaman: "+join(directory,"guide-print.pdf"));
}finally{await browser.close();}
