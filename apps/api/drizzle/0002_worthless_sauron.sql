CREATE TABLE "thermal_anomalies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"location" geography(Point,4326),
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"frp" double precision,
	"confidence" text,
	"brightness" double precision,
	"satellite" text,
	"instrument" text,
	"daynight" text,
	"source_type" text NOT NULL,
	"external_id" text,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thermal_anomalies_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE INDEX "idx_thermal_location" ON "thermal_anomalies" USING gist ("location");--> statement-breakpoint
CREATE INDEX "idx_thermal_time" ON "thermal_anomalies" USING btree ("detected_at");