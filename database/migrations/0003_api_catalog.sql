CREATE TYPE "public"."api_spec_source_kind" AS ENUM('upload', 'repository', 'url');--> statement-breakpoint
CREATE TYPE "public"."api_spec_validation_status" AS ENUM('valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."body_kind" AS ENUM('none', 'json', 'text', 'urlencoded', 'multipart', 'binary');--> statement-breakpoint
CREATE TYPE "public"."execution_scope" AS ENUM('development_only', 'environment_policy');--> statement-breakpoint
CREATE TYPE "public"."request_lifecycle" AS ENUM('draft', 'ready', 'archived');--> statement-breakpoint
CREATE TABLE "api_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"api_specification_id" uuid NOT NULL,
	"api_specification_version_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"method" text NOT NULL,
	"path_template" text NOT NULL,
	"summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operation_document" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_request_id" uuid NOT NULL,
	"api_request_version_id" uuid,
	"gitlab_repository_id" uuid NOT NULL,
	"branch_name" text,
	"commit_sha" text,
	"merge_request_iid" text,
	"source_file_path" text,
	"source_start_line" integer,
	"source_end_line" integer,
	"source_status" text NOT NULL,
	"match_method" text NOT NULL,
	"confidence" numeric,
	"last_verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_source_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_request_id" uuid NOT NULL,
	"api_request_version_id" uuid,
	"source_kind" text NOT NULL,
	"observed_state" text NOT NULL,
	"verification_status" text NOT NULL,
	"repository_id" uuid,
	"repository_path" text,
	"branch_name" text,
	"commit_sha" text,
	"merge_request_iid" text,
	"source_start_line" integer,
	"source_end_line" integer,
	"match_method" text NOT NULL,
	"confidence" numeric,
	"observed_by_user_id" uuid,
	"observed_by_device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_request_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query_params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_kind" "body_kind" NOT NULL,
	"body_json" jsonb,
	"body_text" text,
	"body_object_key" text,
	"body_content_type" text,
	"body_encoding" text,
	"request_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_summary" text,
	"source_observation_at_creation" text DEFAULT 'unknown' NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"collection_id" uuid,
	"folder_id" uuid,
	"api_operation_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"request_lifecycle" "request_lifecycle" DEFAULT 'draft' NOT NULL,
	"execution_scope" "execution_scope" DEFAULT 'environment_policy' NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_specification_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_specification_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_kind" "api_spec_source_kind" NOT NULL,
	"source_ref" text,
	"source_commit_sha" text,
	"spec_version" text,
	"document" jsonb NOT NULL,
	"raw_document_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"validation_status" "api_spec_validation_status" NOT NULL,
	"validation_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_specifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"current_version_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"parent_folder_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_api_specification_id_api_specifications_id_fk" FOREIGN KEY ("api_specification_id") REFERENCES "public"."api_specifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_operations" ADD CONSTRAINT "api_operations_api_specification_version_id_api_specification_versions_id_fk" FOREIGN KEY ("api_specification_version_id") REFERENCES "public"."api_specification_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_links" ADD CONSTRAINT "api_request_source_links_api_request_id_api_requests_id_fk" FOREIGN KEY ("api_request_id") REFERENCES "public"."api_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_links" ADD CONSTRAINT "api_request_source_links_api_request_version_id_api_request_versions_id_fk" FOREIGN KEY ("api_request_version_id") REFERENCES "public"."api_request_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_links" ADD CONSTRAINT "api_request_source_links_gitlab_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("gitlab_repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_links" ADD CONSTRAINT "api_request_source_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_observations" ADD CONSTRAINT "api_request_source_observations_api_request_id_api_requests_id_fk" FOREIGN KEY ("api_request_id") REFERENCES "public"."api_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_observations" ADD CONSTRAINT "api_request_source_observations_api_request_version_id_api_request_versions_id_fk" FOREIGN KEY ("api_request_version_id") REFERENCES "public"."api_request_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_observations" ADD CONSTRAINT "api_request_source_observations_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_source_observations" ADD CONSTRAINT "api_request_source_observations_observed_by_user_id_users_id_fk" FOREIGN KEY ("observed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_versions" ADD CONSTRAINT "api_request_versions_api_request_id_api_requests_id_fk" FOREIGN KEY ("api_request_id") REFERENCES "public"."api_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_versions" ADD CONSTRAINT "api_request_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_folder_id_collection_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."collection_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_api_operation_id_api_operations_id_fk" FOREIGN KEY ("api_operation_id") REFERENCES "public"."api_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_current_version_id_api_request_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."api_request_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_requests" ADD CONSTRAINT "api_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_specification_versions" ADD CONSTRAINT "api_specification_versions_api_specification_id_api_specifications_id_fk" FOREIGN KEY ("api_specification_id") REFERENCES "public"."api_specifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_specification_versions" ADD CONSTRAINT "api_specification_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_specifications" ADD CONSTRAINT "api_specifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_specifications" ADD CONSTRAINT "api_specifications_current_version_id_api_specification_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."api_specification_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_specifications" ADD CONSTRAINT "api_specifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_folders" ADD CONSTRAINT "collection_folders_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_folders" ADD CONSTRAINT "collection_folders_parent_folder_id_collection_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."collection_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_operations_version_key_unique" ON "api_operations" USING btree ("api_specification_version_id","operation_key");--> statement-breakpoint
CREATE INDEX "api_operations_project_method_path_idx" ON "api_operations" USING btree ("project_id","method","path_template");--> statement-breakpoint
CREATE INDEX "api_operations_spec_version_idx" ON "api_operations" USING btree ("api_specification_version_id");--> statement-breakpoint
CREATE INDEX "api_request_source_links_request_idx" ON "api_request_source_links" USING btree ("api_request_id");--> statement-breakpoint
CREATE INDEX "api_request_source_links_repo_commit_idx" ON "api_request_source_links" USING btree ("gitlab_repository_id","commit_sha");--> statement-breakpoint
CREATE INDEX "api_request_source_observations_request_idx" ON "api_request_source_observations" USING btree ("api_request_id","created_at");--> statement-breakpoint
CREATE INDEX "api_request_source_observations_repo_commit_idx" ON "api_request_source_observations" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "api_request_versions_number_unique" ON "api_request_versions" USING btree ("api_request_id","version_number");--> statement-breakpoint
CREATE INDEX "api_request_versions_request_idx" ON "api_request_versions" USING btree ("api_request_id","created_at");--> statement-breakpoint
CREATE INDEX "api_requests_project_lifecycle_idx" ON "api_requests" USING btree ("project_id","request_lifecycle");--> statement-breakpoint
CREATE INDEX "api_requests_project_collection_idx" ON "api_requests" USING btree ("project_id","collection_id");--> statement-breakpoint
CREATE INDEX "api_requests_operation_idx" ON "api_requests" USING btree ("api_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_specification_versions_number_unique" ON "api_specification_versions" USING btree ("api_specification_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "api_specification_versions_content_unique" ON "api_specification_versions" USING btree ("api_specification_id","content_hash");--> statement-breakpoint
CREATE INDEX "api_specification_versions_spec_idx" ON "api_specification_versions" USING btree ("api_specification_id","created_at");--> statement-breakpoint
CREATE INDEX "api_specifications_project_idx" ON "api_specifications" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "collection_folders_collection_parent_idx" ON "collection_folders" USING btree ("collection_id","parent_folder_id");--> statement-breakpoint
CREATE INDEX "collections_project_sort_idx" ON "collections" USING btree ("project_id","sort_order");