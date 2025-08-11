import crypto from "crypto";
import { betterAuth } from "better-auth";
import { admin, organization } from "better-auth/plugins";
import pg from "pg";
import { PostgresDialect } from "kysely";

const { Pool } = pg;

export const auth = betterAuth({
  baseURL: process.env.AUTH_URL || "",
  secret: process.env.AUTH_SECRET || "",
  trustedOrigins: process.env.AUTH_TRUSTED_ORIGINS?.split(",") || [],

  database: {
    type: "postgres",
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.POSTGRES_CONNECTION_STRING || "",
      }),
    }),
  },

  emailAndPassword: {
    enabled: process.env.AUTH_METHOD_EMAIL_AND_PASSWORD === "true",
  },

  advanced: {
    useSecureCookies: process.env.AUTH_USE_SECURE_COOKIES !== "false",
    generateId: (_options) => crypto.randomUUID(),
    crossSubDomainCookies: {
      enabled: true,
      domain: process.env.DOMAIN,
    },
  },

  plugins: [
    ...(process.env.AUTH_PLUGIN_ADMIN === "true" ? [admin()] : []),
    ...(process.env.AUTH_PLUGIN_ORGANIZATION === "true"
      ? [organization()]
      : []),
  ],
});
