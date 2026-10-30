import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Masukkan email yang benar.").max(254),
  password: z
    .string()
    .min(8, "Kata sandi minimal 8 karakter.")
    .refine((value) => new TextEncoder().encode(value).length <= 72, {
      message: "Kata sandi maksimal 72 byte.",
    }),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const initialAdminSchema = loginSchema.extend({
  password: loginSchema.shape.password
    .refine((value) => value.length >= 12, "Kata sandi awal minimal 12 karakter.")
    .refine(
      (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value),
      "Kata sandi awal harus memuat huruf besar, huruf kecil, angka, dan simbol.",
    )
    .refine(
      (value) => !/REPLACE_WITH|PLACEHOLDER|EXAMPLE|CHANGEME|PASSWORD123/i.test(value),
      "Ganti placeholder kata sandi dengan secret yang kuat.",
    ),
});
