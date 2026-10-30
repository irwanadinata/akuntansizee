import PDFDocument from "pdfkit";
import { create,type Font } from "fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPANY_NAME,ReportError,type ReportType } from "./validation";
import { displayDate,displayTime } from "../accounting/dates";
import { formatRupiah } from "../accounting/money";
import type { FinancialReport } from "./engine";
import type { ReportSection } from "./calculation";
import type { ledgerReport } from "../ledger/report";
let fontData:Buffer|undefined,font:Font|undefined;
function embeddedFont(){if(!fontData){fontData=readFileSync(join(process.cwd(),"assets/fonts/DejaVuSans.ttf"));const parsed=create(fontData);if(!("hasGlyphForCodePoint"in parsed))throw new ReportError("Font PDF tidak tersedia.");font=parsed;}return{data:fontData,font:font!};}
function validateText(value:unknown){
  const {font}=embeddedFont();const text=typeof value==="string"?value:JSON.stringify(value);
  for(const char of text){const code=char.codePointAt(0)!;if(code>=32&&!font.hasGlyphForCodePoint(code))throw new ReportError("Ada karakter yang belum didukung font PDF. Gunakan Cetak dengan font browser agar nama/uraian tidak diganti diam-diam.");}
}
type Cell={text:string;width:number;align?:"left"|"right";money?:boolean};
type PdfOptions={testNotice?:boolean};
function document(title:string,metadata:string[],generatedAt:string,landscape=false,testNotice=false){
  const doc=new PDFDocument({size:"A4",layout:landscape?"landscape":"portrait",margins:{top:108,bottom:48,left:42,right:42},bufferPages:true,autoFirstPage:false,info:{Title:title,Author:COMPANY_NAME,Subject:metadata.join(" | "),CreationDate:new Date(generatedAt)}});
  const chunks:Buffer[]=[];const finished=new Promise<Buffer>((resolve,reject)=>{doc.on("data",chunk=>chunks.push(Buffer.from(chunk)));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
  doc.registerFont("Body",embeddedFont().data);
  const width=()=>doc.page.width-84;
  doc.on("pageAdded",()=>{doc.font("Body").fontSize(10).fillColor("#11635b").text(COMPANY_NAME,42,28,{lineBreak:false});doc.fontSize(16).fillColor("#132e37").text(title,42,46,{lineBreak:false});doc.fontSize(8).fillColor("#52636b").text(metadata.join(" | "),42,70,{width:width(),lineBreak:false});if(testNotice)doc.fillColor("#b42318").text("DATA UJI SINTETIS - BUKAN DATA KEUANGAN PERUSAHAAN",42,86,{lineBreak:false});doc.moveTo(42,99).lineTo(doc.page.width-42,99).strokeColor("#cddbd8").stroke();doc.y=108;doc.x=42;});
  doc.addPage();
  function ensure(height:number){if(doc.y+height>doc.page.height-54){doc.addPage();return true;}return false;}
  function paragraph(text:string,color="#52636b"){doc.font("Body").fontSize(9).fillColor(color).text(text,{width:width(),paragraphGap:5});doc.moveDown(0.5);}
  function heading(text:string){ensure(40);doc.moveDown(0.4).font("Body").fontSize(12).fillColor("#11635b").text(text);doc.moveDown(0.4);}
  function row(cells:Cell[],bold=false,size=9,repeatHeader?:Cell[]){
    const actual=cells.map(cell=>{let fontSize=size;doc.font(bold?"Helvetica-Bold":"Body").fontSize(fontSize);if(cell.money){while(fontSize>7&&doc.widthOfString(cell.text)>cell.width-8){fontSize-=0.25;doc.fontSize(fontSize);}}const height=doc.heightOfString(cell.text,{width:cell.width-8,lineGap:1});return{...cell,fontSize,height};});
    const height=Math.max(18,...actual.map(cell=>cell.height+8));if(ensure(height)&&repeatHeader)row(repeatHeader,true,8);const top=doc.y;let x=42;
    if(bold)doc.rect(42,top,width(),height).fill("#edf5f3");
    for(const cell of actual){doc.font(bold?"Helvetica-Bold":"Body").fontSize(cell.fontSize).fillColor(cell.money&&cell.text.includes("-")?"#a72c24":"#243c44").text(cell.text,x+4,top+4,{width:cell.width-8,align:cell.align??"left",lineGap:1});x+=cell.width;}
    doc.y=top+height;doc.x=42;doc.moveTo(42,doc.y).lineTo(42+width(),doc.y).strokeColor("#e3ebe9").stroke();
  }
  function amount(label:string,value:string,bold=false){row([{text:label,width:width()-170},{text:formatRupiah(value),width:170,align:"right",money:true}],bold,10);}
  function finish(){const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.font("Body").fontSize(7).fillColor("#52636b").text("Dihasilkan "+displayTime(new Date(generatedAt)),42,doc.page.height-31,{lineBreak:false});doc.text("Halaman "+(i+1)+" / "+range.count,doc.page.width-140,doc.page.height-31,{width:98,align:"right",lineBreak:false});doc.page.margins.bottom=bottom;}doc.end();return finished;}
  return{doc,width,heading,paragraph,row,amount,finish};
}
export async function renderFinancialPdf(report:FinancialReport,type:ReportType,options:PdfOptions={}){
  validateText([report.diagnostics.warnings,...[...report.balance.assets,...report.balance.liabilities,...report.balance.equity,...report.income.revenue,...report.income.cogs,...report.income.expenses,...report.income.otherResults,...report.income.taxes].flatMap(section=>section.rows.filter(row=>!report.filter.hideZero||row.amount!=="0").map(row=>row.name)),...report.sources.map(source=>[source.journalNumber,source.businessNumber,source.parentNumber])]);
  const title=type==="balance"?"Neraca":type==="profit"?"Laba Rugi":"Laporan Keuangan";
  const pdf=document(title,["Tahun "+report.year.year+" ("+(report.year.status==="OPEN"?"Terbuka":"Terkunci")+")",displayDate(report.filter.from)+" - "+displayDate(report.filter.to)],report.generatedAt,false,options.testNotice);
  if(report.diagnostics.warnings.length){pdf.heading("PERLU DIPERIKSA - BUKAN LAPORAN FINAL");for(const warning of report.diagnostics.warnings)pdf.paragraph(warning,"#a72c24");}
  else pdf.paragraph("Pemeriksaan neraca, debit/kredit dan rincian kontrol sesuai pada snapshot ini.");
  function sections(values:ReportSection[]){for(const section of values){const rows=section.rows.filter(row=>!report.filter.hideZero||row.amount!=="0");if(!rows.length&&report.filter.hideZero)continue;pdf.heading(section.label);for(const row of rows)pdf.amount(row.code+"  "+row.name+(row.contra?" (pengurang)":""),row.amount);pdf.amount("Subtotal "+section.label,section.total,true);}}
  if(type!=="profit"){
    pdf.heading("Neraca per "+displayDate(report.filter.to));pdf.paragraph("Saldo kumulatif dari seluruh jurnal terposting sampai tanggal laporan, termasuk tahun sebelumnya.");
    sections(report.balance.assets);pdf.amount("TOTAL ASET",report.balance.totalAssets,true);
    sections(report.balance.liabilities);pdf.amount("TOTAL KEWAJIBAN",report.balance.totalLiabilities,true);
    sections(report.balance.equity);pdf.amount("Sisa hasil usaha sebelum "+report.year.year+" (belum ditutup)",report.balance.priorUnclosed);pdf.amount("Hasil usaha tahun berjalan sampai tanggal laporan",report.balance.currentProfit);pdf.amount("TOTAL EKUITAS",report.balance.totalEquity,true);
    pdf.amount("KEWAJIBAN + EKUITAS",report.balance.liabilitiesAndEquity,true);pdf.amount("SELISIH NERACA",report.balance.difference,true);
  }
  if(type!=="balance"){
    if(type==="combined")pdf.doc.addPage();pdf.heading("Laba Rugi "+displayDate(report.filter.from)+" - "+displayDate(report.filter.to));
    sections(report.income.revenue);pdf.amount("PENDAPATAN NETO",report.income.totalRevenue,true);sections(report.income.cogs);pdf.amount("TOTAL HPP",report.income.totalCogs,true);pdf.amount("LABA KOTOR",report.income.grossProfit,true);
    sections(report.income.expenses);sections(report.income.otherResults);pdf.amount("LABA SEBELUM PAJAK",report.income.beforeTax,true);sections(report.income.taxes);pdf.amount("LABA BERSIH",report.income.netProfit,true);
  }
  pdf.doc.addPage();pdf.heading("Pemeriksaan saldo kontrol");for(const control of report.diagnostics.reconciliations){pdf.amount(control.name+" - buku besar",control.control);pdf.amount("Rincian subledger",control.detail);pdf.amount("Selisih "+control.code,control.difference,true);}pdf.amount("Total debit jurnal kumulatif",report.diagnostics.trialDebit);pdf.amount("Total kredit jurnal kumulatif",report.diagnostics.trialCredit);pdf.amount("Selisih debit/kredit",report.diagnostics.trialDifference,true);
  pdf.doc.addPage();pdf.heading("Jurnal sumber tersimpan");pdf.paragraph(report.sourceScope==="cumulative"?"Seluruh jurnal terposting dari awal pembukuan sampai tanggal Neraca. Nomor bisnis asal/pembayaran/pembalik dibaca dari database.":"Jurnal terposting dalam rentang Laba Rugi. Nomor berikut dibaca dari database.");
  if(!report.sources.length)pdf.paragraph("Belum ada jurnal terposting dalam cakupan ini.");
  const sourceHeader:Cell[]=[{text:"Tanggal",width:64},{text:"Nomor jurnal",width:157},{text:"Nomor bisnis / asal",width:155},{text:"Debit / Kredit",width:pdf.width()-376,align:"right"}];
  if(report.sources.length)pdf.row(sourceHeader,true,8);
  for(const source of report.sources)pdf.row([{text:displayDate(source.date),width:64},{text:source.journalNumber,width:157},{text:[source.businessNumber,source.parentNumber].filter(Boolean).join("\n")||"Jurnal manual",width:155},{text:formatRupiah(source.debit)+"\n"+formatRupiah(source.credit),width:pdf.width()-376,align:"right",money:true}],false,8,sourceHeader);
  return pdf.finish();
}
export async function renderLedgerPdf(report:Awaited<ReturnType<typeof ledgerReport>>,filter:{from:string;to:string;yearLabel:string},options:PdfOptions={}){
  validateText([report.account.code,report.account.name,...report.rows.map(row=>[row.journalNumber,row.businessNumber,row.parentNumber])]);const generatedAt=new Date().toISOString();const pdf=document("Buku Besar",[filter.yearLabel,displayDate(filter.from)+" - "+displayDate(filter.to)],generatedAt,true,options.testNotice);
  pdf.heading(report.account.code+" - "+report.account.name);pdf.paragraph("Saldo normal "+(report.account.normalBalance==="DEBIT"?"Debit":"Kredit")+(report.account.isContra?"; kontra akun":"")+". Urutan tanggal, waktu posting, UUID jurnal dan nomor baris.");pdf.amount("Saldo awal sebelum periode",report.opening,true);
  const ledgerHeader:Cell[]=[{text:"Tanggal",width:68},{text:"Nomor jurnal / bisnis / asal",width:248},{text:"Debit",width:145,align:"right"},{text:"Kredit",width:145,align:"right"},{text:"Saldo berjalan",width:pdf.width()-606,align:"right"}];
  pdf.row(ledgerHeader,true,8);
  for(const row of report.rows)pdf.row([{text:displayDate(row.date),width:68},{text:[row.journalNumber,row.businessNumber,row.parentNumber].filter(Boolean).join("\n"),width:248},{text:formatRupiah(row.debit),width:145,align:"right",money:true},{text:formatRupiah(row.credit),width:145,align:"right",money:true},{text:formatRupiah(row.balance),width:pdf.width()-606,align:"right",money:true}],false,8.5,ledgerHeader);
  pdf.amount("Total debit periode",report.debit);pdf.amount("Total kredit periode",report.credit);pdf.amount("Saldo akhir",report.closing,true);return pdf.finish();
}
