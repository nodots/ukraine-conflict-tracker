CREATE TABLE "control_areas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"as_of_date" date NOT NULL,
	"faction" text NOT NULL,
	"geom" geography(MultiPolygon,4326),
	"area_sq_km" double precision,
	"source_type" text NOT NULL,
	"source_url" text,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_control_area" UNIQUE("as_of_date","faction","source_type")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"location" geography(Point,4326),
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"admin_area" text,
	"actor" text,
	"target" text,
	"fatalities" integer,
	"severity" numeric DEFAULT '0.3' NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text,
	"source_url" text,
	"confidence" numeric DEFAULT '0.5' NOT NULL,
	"description" text,
	"raw_payload" jsonb,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "events_confidence_range" CHECK ("events"."confidence" >= 0 AND "events"."confidence" <= 1),
	CONSTRAINT "events_severity_range" CHECK ("events"."severity" >= 0 AND "events"."severity" <= 1)
);
--> statement-breakpoint
CREATE TABLE "frontlines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"as_of_date" date NOT NULL,
	"geom" geography(LineString,4326),
	"source_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_frontline" UNIQUE("as_of_date","source_type")
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"message" text,
	"records_seen" integer DEFAULT 0,
	"records_inserted" integer DEFAULT 0,
	"records_skipped" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_control_areas_geom" ON "control_areas" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "idx_control_areas_date" ON "control_areas" USING btree ("as_of_date");--> statement-breakpoint
CREATE INDEX "idx_events_location" ON "events" USING gist ("location");--> statement-breakpoint
CREATE INDEX "idx_events_type_time" ON "events" USING btree ("event_type","event_time");--> statement-breakpoint
CREATE INDEX "idx_events_time" ON "events" USING btree ("event_time");--> statement-breakpoint
CREATE INDEX "idx_frontlines_geom" ON "frontlines" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "idx_frontlines_date" ON "frontlines" USING btree ("as_of_date");