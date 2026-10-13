CREATE TYPE "public"."ride_request_status" AS ENUM('open', 'matched', 'cancelled', 'expired', 'no_match', 'completed');--> statement-breakpoint
CREATE TYPE "public"."vehicle_preference" AS ENUM('any', 'sedan', 'suv', 'van');--> statement-breakpoint
CREATE TABLE "pickup_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"terminal" varchar(8) NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"airport_code" varchar(3) NOT NULL,
	"pickup_zone_id" uuid NOT NULL,
	"flight_number" varchar(8),
	"flight_id" uuid,
	"flight_booking_id" uuid,
	"scheduled_arrival_at" timestamp with time zone NOT NULL,
	"expected_arrival_at" timestamp with time zone NOT NULL,
	"destination_place_id" varchar(128) NOT NULL,
	"destination_label" varchar(160) NOT NULL,
	"destination_area" varchar(80) NOT NULL,
	"destination_lat" double precision NOT NULL,
	"destination_lng" double precision NOT NULL,
	"direct_distance_meters" integer NOT NULL,
	"direct_duration_seconds" integer NOT NULL,
	"passengers" integer NOT NULL,
	"luggage_cabin" integer DEFAULT 0 NOT NULL,
	"luggage_medium" integer DEFAULT 0 NOT NULL,
	"luggage_large" integer DEFAULT 0 NOT NULL,
	"vehicle_preference" "vehicle_preference" DEFAULT 'any' NOT NULL,
	"max_wait_minutes" integer NOT NULL,
	"max_detour_minutes" integer NOT NULL,
	"wheelchair" boolean DEFAULT false NOT NULL,
	"notes" varchar(280),
	"status" "ride_request_status" DEFAULT 'open' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_requests_pax_ck" CHECK ("ride_requests"."passengers" between 1 and 6),
	CONSTRAINT "ride_requests_limits_ck" CHECK ("ride_requests"."max_wait_minutes" between 10 and 60 and "ride_requests"."max_detour_minutes" between 5 and 30),
	CONSTRAINT "ride_requests_luggage_ck" CHECK ("ride_requests"."luggage_cabin" >= 0 and "ride_requests"."luggage_medium" >= 0 and "ride_requests"."luggage_large" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pickup_zones" ADD CONSTRAINT "pickup_zones_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_zone_id_pickup_zones_id_fk" FOREIGN KEY ("pickup_zone_id") REFERENCES "public"."pickup_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_flight_booking_id_flight_bookings_id_fk" FOREIGN KEY ("flight_booking_id") REFERENCES "public"."flight_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickup_zones_airport_idx" ON "pickup_zones" USING btree ("airport_code");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_zones_name_uq" ON "pickup_zones" USING btree ("airport_code","name");--> statement-breakpoint
CREATE INDEX "ride_requests_pool_idx" ON "ride_requests" USING btree ("airport_code","status","expected_arrival_at");--> statement-breakpoint
CREATE INDEX "ride_requests_user_idx" ON "ride_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_requests_active_uq" ON "ride_requests" USING btree ("user_id","airport_code","scheduled_arrival_at") WHERE "ride_requests"."status" in ('open', 'matched');