CREATE TYPE "public"."document_type" AS ENUM('operator_permit', 'insurance', 'vehicle_registration', 'fitness_certificate', 'driving_licence', 'police_verification');--> statement-breakpoint
CREATE TYPE "public"."incident_category" AS ENUM('safety', 'accident', 'vehicle', 'passenger_conduct', 'driver_conduct', 'lost_item', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."operator_member_role" AS ENUM('owner', 'dispatcher', 'driver');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_window_ck" CHECK ("availability"."ends_at" > "availability"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" varchar(80) NOT NULL,
	"phone" varchar(16) NOT NULL,
	"licence_last4" varchar(4) NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"subject_type" varchar(16) NOT NULL,
	"subject_id" uuid NOT NULL,
	"doc_type" "document_type" NOT NULL,
	"file_name" varchar(80) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"expires_on" varchar(10),
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_members" (
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "operator_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_members_operator_id_user_id_pk" PRIMARY KEY("operator_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(16) NOT NULL,
	"airports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"commission_bps" integer DEFAULT 1500 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_trips" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"en_route_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_lat" double precision,
	"last_lng" double precision,
	"last_location_at" timestamp with time zone,
	"off_route" boolean DEFAULT false NOT NULL,
	"off_route_since" timestamp with time zone,
	"operator_earning_minor" integer,
	"commission_minor" integer
);
--> statement-breakpoint
CREATE TABLE "safety_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reporter_role" varchar(16) NOT NULL,
	"group_id" uuid,
	"operator_id" uuid,
	"category" "incident_category" NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"description" text NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_class" "vehicle_class" NOT NULL,
	"make_model" varchar(60) NOT NULL,
	"colour" varchar(30) NOT NULL,
	"registration" varchar(16) NOT NULL,
	"seats" integer NOT NULL,
	"luggage_units" integer NOT NULL,
	"wheelchair_accessible" boolean DEFAULT false NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ride_participants" ADD COLUMN "boarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_participants" ADD COLUMN "dropped_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_trips" ADD CONSTRAINT "ride_trips_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_trips" ADD CONSTRAINT "ride_trips_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_trips" ADD CONSTRAINT "ride_trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_trips" ADD CONSTRAINT "ride_trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_releases" ADD CONSTRAINT "trip_releases_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_releases" ADD CONSTRAINT "trip_releases_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_airport_time_idx" ON "availability" USING btree ("airport_code","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "drivers_operator_idx" ON "drivers" USING btree ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_uq" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_subject_idx" ON "operator_documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "documents_operator_idx" ON "operator_documents" USING btree ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_members_user_uq" ON "operator_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "operators_status_idx" ON "operators" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ride_trips_operator_idx" ON "ride_trips" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "ride_trips_driver_idx" ON "ride_trips" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "safety_incidents" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "vehicles_operator_idx" ON "vehicles" USING btree ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_registration_uq" ON "vehicles" USING btree ("registration");