export type Config = Readonly<{
  host: string;
  port: number;
  mongodbUri: string;
  mongodbDatabase: string;
  credentialsKey: Buffer;
  adminZaloId: string | undefined;
  adminZaloPhone: string | undefined;
  adminEmail: string | undefined;
}>;

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseCredentialsKey(): Buffer {
  const key = Buffer.from(process.env.ZALO_CREDENTIALS_KEY ?? "", "base64");
  if (key.length !== 32) {
    throw new Error("ZALO_CREDENTIALS_KEY phải là khóa 32 byte mã hóa base64; xem README để tạo khóa.");
  }
  return key;
}

export function parseConfig(): Config {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? "3400"),
    mongodbUri: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017",
    mongodbDatabase: process.env.MONGODB_DATABASE ?? "zalo_bot",
    credentialsKey: parseCredentialsKey(),
    adminZaloId: optionalEnv("ADMIN_ZALO_ID"),
    adminZaloPhone: optionalEnv("ADMIN_ZALO_PHONE"),
    adminEmail: optionalEnv("ADMIN_EMAIL")?.toLowerCase(),
  };
}
