CREATE TABLE "platform_schema_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"baseline_version" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_schema_state_singleton" CHECK ("platform_schema_state"."id")
);
