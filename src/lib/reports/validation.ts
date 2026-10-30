import { z } from "zod";
import { businessDate } from "../journal/validation";
export class ReportError extends Error {}
export const reportTypes=["balance","profit","combined"] as const;
export type ReportType=typeof reportTypes[number];
export const reportFilters=z.object({year:z.coerce.number().int().min(1900).max(2199),from:businessDate,to:businessDate,hideZero:z.boolean().default(true)}).strict()
  .refine(value=>value.from<=value.to,{message:"Tanggal awal melebihi tanggal akhir."})
  .refine(value=>value.from.slice(0,4)===String(value.year)&&value.to.slice(0,4)===String(value.year),{message:"Rentang tanggal harus berada dalam tahun buku yang dipilih."});
export type ReportFilters=z.infer<typeof reportFilters>;
export const COMPANY_NAME="PT Zee Komunikasi Indonesia";
export const MAX_PDF_SOURCES=5000;
