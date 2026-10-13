CREATE TYPE "public"."ride_participant_status" AS ENUM('joined', 'payment_due', 'confirmed', 'left', 'removed', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ride_group_status" AS ENUM('forming', 'locked', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."split_method" AS ENUM('equal_per_seat', 'distance_weighted');--> statement-breakpoint
CREATE TYPE "public"."vehicle_class" AS ENUM('sedan', 'suv', 'van');--> statement-breakpoint
CREATE TABLE "ride_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"pickup_zone_id" uuid NOT NULL,
	"status" "ride_group_status" DEFAULT 'forming' NOT NULL,
	"vehicle_class" "vehicle_class" NOT NULL,
	"seat_capacity" integer NOT NULL,
	"luggage_capacity" integer NOT NULL,
	"seats_taken" integer DEFAULT 0 NOT NULL,
	"luggage_taken" integer DEFAULT 0 NOT NULL,
	"parties" integer DEFAULT 0 NOT NULL,
	"split_method" "split_method" DEFAULT 'equal_per_seat' NOT NULL,
	"planned_pickup_at" timestamp with time zone NOT NULL,
	"lock_at" timestamp with time zone NOT NULL,
	"route" jsonb NOT NULL,
	"route_distance_meters" integer NOT NULL,
	"route_duration_seconds" integer NOT NULL,
	"fare" jsonb NOT NULL,
	"vehicle_fare_minor" integer NOT NULL,
	"platform_subsidy_minor" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"locked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_groups_capacity_ck" CHECK ("ride_groups"."seats_taken" <= "ride_groups"."seat_capacity" and "ride_groups"."luggage_taken" <= "ride_groups"."luggage_capacity" and "ride_groups"."seats_taken" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ride_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "ride_participant_status" DEFAULT 'joined' NOT NULL,
	"seats" integer NOT NULL,
	"luggage_units" integer NOT NULL,
	"solo_ok" boolean DEFAULT false NOT NULL,
	"dropoff_order" integer NOT NULL,
	"wait_minutes" integer DEFAULT 0 NOT NULL,
	"detour_minutes" integer DEFAULT 0 NOT NULL,
	"estimated_dropoff_at" timestamp with time zone NOT NULL,
	"max_total_minor" integer NOT NULL,
	"fare_share_minor" integer NOT NULL,
	"platform_fee_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"current_total_minor" integer NOT NULL,
	"final_total_minor" integer,
	"solo_total_minor" integer NOT NULL,
	"cancellation_fee_minor" integer,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "participants_price_ck" CHECK ("ride_participants"."current_total_minor" <= "ride_participants"."max_total_minor")
);
--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_pickup_zone_id_pickup_zones_id_fk" FOREIGN KEY ("pickup_zone_id") REFERENCES "public"."pickup_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_participants" ADD CONSTRAINT "ride_participants_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_participants" ADD CONSTRAINT "ride_participants_request_id_ride_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ride_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_participants" ADD CONSTRAINT "ride_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ride_groups_pool_idx" ON "ride_groups" USING btree ("airport_code","pickup_zone_id","status","planned_pickup_at");--> statement-breakpoint
CREATE INDEX "ride_groups_lock_idx" ON "ride_groups" USING btree ("status","lock_at");--> statement-breakpoint
CREATE INDEX "participants_group_idx" ON "ride_participants" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "participants_user_idx" ON "ride_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_active_request_uq" ON "ride_participants" USING btree ("request_id") WHERE "ride_participants"."status" in ('joined', 'payment_due', 'confirmed');