"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { loginAction } from "@/app/login/actions";
import { loginSchema, type LoginInput } from "@/lib/auth/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  function submit(values: LoginInput) {
    setError(null);
    startTransition(async () => {
      const result = await loginAction(values);
      if (result) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email admin</Label>
        <Input id="email" type="email" autoComplete="username" autoCapitalize="none" placeholder="Email akun Anda"
          disabled={pending} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")} />
        {errors.email && <p id="email-error" className="text-sm text-destructive">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Kata sandi</Label>
        <Input id="password" type="password" autoComplete="current-password" placeholder="Masukkan kata sandi"
          disabled={pending} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")} />
        {errors.password && <p id="password-error" className="text-sm text-destructive">{errors.password.message}</p>}
      </div>
      {error && <p role="alert" aria-live="polite" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <Button loading={pending} type="submit" className="h-12 w-full" disabled={pending}>
        {pending ? "Memeriksa akses…" : "Masuk ke aplikasi"}
        {!pending && <ArrowRight className="size-4" aria-hidden="true" />}
      </Button>
    </form>
  );
}
