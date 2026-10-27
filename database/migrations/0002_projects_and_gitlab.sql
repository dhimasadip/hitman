CREATE TYPE "public"."project_role" AS ENUM('project_admin', 'editor', 'executor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "gitlab_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gitlab_instance_url" text NOT NULL,
	"auth_mode" text NOT NULL,
	"credential_secret_ref" text NOT NULL,
	"status" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"gitlab_connection_id" uuid NOT NULL,
	"external_project_id" text NOT NULL,
	"namespace_path" text NOT NULL,
	"repository_name" text NOT NULL,
	"repository_url" text NOT NULL,
	"default_branch" text,
	"openapi_file_path" text,
	"webhook_status" text NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_memberships_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_team_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gitlab_connections" ADD CONSTRAINT "gitlab_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_connections" ADD CONSTRAINT "gitlab_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_repositories" ADD CONSTRAINT "gitlab_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_repositories" ADD CONSTRAINT "gitlab_repositories_gitlab_connection_id_gitlab_connections_id_fk" FOREIGN KEY ("gitlab_connection_id") REFERENCES "public"."gitlab_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gitlab_connections_org_idx" ON "gitlab_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_connections_mock_org_unique" ON "gitlab_connections" USING btree ("organization_id") WHERE "gitlab_connections"."auth_mode" = 'mock';--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_repositories_project_unique" ON "gitlab_repositories" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_repositories_connection_external_unique" ON "gitlab_repositories" USING btree ("gitlab_connection_id","external_project_id");--> statement-breakpoint
CREATE INDEX "gitlab_repositories_connection_idx" ON "gitlab_repositories" USING btree ("gitlab_connection_id");--> statement-breakpoint
CREATE INDEX "project_memberships_user_idx" ON "project_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_memberships_project_role_idx" ON "project_memberships" USING btree ("project_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_unique" ON "projects" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "projects_org_status_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "projects_owner_team_idx" ON "projects" USING btree ("owner_team_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;