CREATE TYPE "public"."cabin_class" AS ENUM('economy', 'premium_economy', 'business');--> statement-breakpoint
CREATE TYPE "public"."flight_status" AS ENUM('scheduled', 'delayed', 'cancelled', 'departed', 'landed');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'published', 'paused', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TABLE "airlines" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_sandbox" boolean DEFAULT false NOT NULL,
	"brand_color" varchar(7) DEFAULT '#2648E8' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"external_ref" varchar(128) NOT NULL,
	"partner_id" uuid,
	"cabin" "cabin_class" NOT NULL,
	"fare_minor" integer NOT NULL,
	"taxes_minor" integer DEFAULT 0 NOT NULL,
	"reference_fare_minor" integer,
	"reference_source" text,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"baggage_cabin_kg" integer DEFAULT 7 NOT NULL,
	"baggage_checked_kg" integer DEFAULT 0 NOT NULL,
	"refundable" boolean DEFAULT false NOT NULL,
	"change_fee_minor" integer,
	"cancel_fee_minor" integer,
	"fare_rules" text DEFAULT '' NOT NULL,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seats_available" integer,
	"inventory_cap" integer,
	"seats_sold" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"status" "offer_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_fare_ck" CHECK ("flight_offers"."fare_minor" > 0 AND "flight_offers"."taxes_minor" >= 0 AND "flight_offers"."taxes_minor" <= "flight_offers"."fare_minor"),
	CONSTRAINT "offers_sold_ck" CHECK ("flight_offers"."seats_sold" >= 0 AND ("flight_offers"."inventory_cap" IS NULL OR "flight_offers"."seats_sold" <= "flight_offers"."inventory_cap"))
);
--> statement-breakpoint
CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airline_code" varchar(3) NOT NULL,
	"flight_number" varchar(8) NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"status" "flight_status" DEFAULT 'scheduled' NOT NULL,
	"estimated_arrive_at" timestamp with time zone,
	"status_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flights_times_ck" CHECK ("flights"."arrive_at" > "flights"."depart_at")
);
--> statement-breakpoint
ALTER TABLE "flight_offers" ADD CONSTRAINT "flight_offers_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_airline_code_airlines_code_fk" FOREIGN KEY ("airline_code") REFERENCES "public"."airlines"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_origin_airports_code_fk" FOREIGN KEY ("origin") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_destination_airports_code_fk" FOREIGN KEY ("destination") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_source_ref_uq" ON "flight_offers" USING btree ("source","external_ref");--> statement-breakpoint
CREATE INDEX "offers_flight_idx" ON "flight_offers" USING btree ("flight_id");--> statement-breakpoint
CREATE INDEX "offers_status_valid_idx" ON "flight_offers" USING btree ("status","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "flights_operation_uq" ON "flights" USING btree ("airline_code","flight_number","depart_at");--> statement-breakpoint
CREATE INDEX "flights_route_idx" ON "flights" USING btree ("origin","destination","depart_at");