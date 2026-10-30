export function assertTrustedOrigin(origin: string | null, appOrigin: string): void {
  if (origin === null || origin !== new URL(appOrigin).origin) {
    throw new Error("Asal permintaan tidak diizinkan.");
  }
}
