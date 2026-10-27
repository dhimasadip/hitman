import { parseArgs } from "node:util";
import { AuditService } from "../apps/server/src/modules/audit/audit-service.js";
import { ProvisioningService } from "../apps/server/src/modules/identity/provisioning-service.js";
import { SessionService } from "../apps/server/src/modules/identity/session-service.js";
import type { OrganizationRole, TeamRole } from "../packages/contracts/src/index.js";
import {
  displayNameSchema,
  emailSchema,
  organizationRoleSchema,
  slugSchema,
  teamRoleSchema,
  userStatusSchema,
} from "../packages/contracts/src/index.js";
import { createDatabase } from "../packages/database/src/index.js";

const HELP = `Hitman administrator CLI

Usage:
  pnpm admin bootstrap --org-name "Acme" --org-slug acme \\
    --email admin@example.com --display-name "Admin"
  pnpm admin add-member --org-slug acme --email user@example.com \\
    --display-name "User" --role member
  pnpm admin reset-password --email user@example.com
  pnpm admin set-status --email user@example.com --status disabled
  pnpm admin create-team --org-slug acme --name "Platform" --slug platform
  pnpm admin add-team-member --org-slug acme --team-slug platform \\
    --email user@example.com --role member

Passwords are read from environment variables, never command-line arguments:
  bootstrap/add-member (new user)  HITMAN_BOOTSTRAP_PASSWORD / HITMAN_USER_PASSWORD
  reset-password                   HITMAN_NEW_PASSWORD

Passwords are never printed. Run migrations before using this CLI.
`;

function requireOption(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

function parseEmail(value: string): string {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid email address");
  return parsed.data;
}

function parseDisplayName(value: string): string {
  const parsed = displayNameSchema.safeParse(value);
  if (!parsed.success) throw new Error("Display name must be 1–100 characters");
  return parsed.data;
}

function parseSlug(value: string): string {
  const parsed = slugSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Slug must be 2–63 lowercase letters/numbers/hyphens and start/end alphanumerically",
    );
  }
  return parsed.data;
}

function parseOrgRole(value: string | undefined): OrganizationRole {
  const parsed = organizationRoleSchema.safeParse(value ?? "member");
  if (!parsed.success) throw new Error("Role must be org_admin, member, or read_only");
  return parsed.data;
}

function parseTeamRole(value: string | undefined): TeamRole {
  const parsed = teamRoleSchema.safeParse(value ?? "member");
  if (!parsed.success) throw new Error("Team role must be team_admin, member, or viewer");
  return parsed.data;
}

function passwordFromEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "org-name": { type: "string" },
      "org-slug": { type: "string" },
      email: { type: "string" },
      "display-name": { type: "string" },
      role: { type: "string" },
      status: { type: "string" },
      name: { type: "string" },
      slug: { type: "string" },
      "team-slug": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const command = positionals[0];
  if (!command || command === "help" || values.help) {
    process.stdout.write(HELP);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const database = createDatabase({
    url: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true",
    maxConnections: 1,
    applicationName: "hitman-admin",
  });

  try {
    const services = new ProvisioningService(
      database.db,
      new AuditService(),
      new SessionService(database.db, { SESSION_TTL_SECONDS: 7 * 24 * 60 * 60 }),
    );

    switch (command) {
      case "bootstrap": {
        const result = await services.bootstrapOrganization({
          organizationName: requireOption(values, "org-name"),
          organizationSlug: parseSlug(requireOption(values, "org-slug")),
          email: parseEmail(requireOption(values, "email")),
          displayName: parseDisplayName(requireOption(values, "display-name")),
          password: passwordFromEnv("HITMAN_BOOTSTRAP_PASSWORD"),
        });
        process.stdout.write(
          `${JSON.stringify({ event: "organization_bootstrapped", ...result })}\n`,
        );
        return;
      }
      case "add-member": {
        const result = await services.addUserToOrganization({
          organizationSlug: parseSlug(requireOption(values, "org-slug")),
          email: parseEmail(requireOption(values, "email")),
          ...(typeof values["display-name"] === "string"
            ? { displayName: parseDisplayName(values["display-name"]) }
            : {}),
          role: parseOrgRole(typeof values.role === "string" ? values.role : undefined),
          ...(process.env.HITMAN_USER_PASSWORD
            ? { password: process.env.HITMAN_USER_PASSWORD }
            : {}),
        });
        process.stdout.write(`${JSON.stringify({ event: "member_added", ...result })}\n`);
        return;
      }
      case "reset-password": {
        const email = parseEmail(requireOption(values, "email"));
        await services.resetPassword(email, passwordFromEnv("HITMAN_NEW_PASSWORD"));
        process.stdout.write(`${JSON.stringify({ event: "password_reset", email })}\n`);
        return;
      }
      case "set-status": {
        const email = parseEmail(requireOption(values, "email"));
        const status = userStatusSchema.safeParse(requireOption(values, "status"));
        if (!status.success) {
          throw new Error("Status must be active, disabled, or pending");
        }
        await services.setUserStatus(email, status.data);
        process.stdout.write(
          `${JSON.stringify({ event: "user_status_changed", email, status: status.data })}\n`,
        );
        return;
      }
      case "create-team": {
        const result = await services.createTeam({
          organizationSlug: parseSlug(requireOption(values, "org-slug")),
          name: requireOption(values, "name"),
          slug: parseSlug(requireOption(values, "slug")),
        });
        process.stdout.write(`${JSON.stringify({ event: "team_created", ...result })}\n`);
        return;
      }
      case "add-team-member": {
        const result = await services.addTeamMember({
          organizationSlug: parseSlug(requireOption(values, "org-slug")),
          teamSlug: parseSlug(requireOption(values, "team-slug")),
          email: parseEmail(requireOption(values, "email")),
          role: parseTeamRole(typeof values.role === "string" ? values.role : undefined),
        });
        process.stdout.write(`${JSON.stringify({ event: "team_member_added", ...result })}\n`);
        return;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown administrator error";
  process.stderr.write(`hitman admin: ${message}\n`);
  if (process.env.HITMAN_ADMIN_DEBUG === "1" && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
