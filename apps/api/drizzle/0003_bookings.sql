CREATE TYPE "public"."flight_booking_status" AS ENUM('pending_payment', 'payment_failed', 'ticketing', 'confirmed', 'ticketing_failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('requires_payment', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TABLE "booking_passengers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"first_name" varchar(60) NOT NULL,
	"last_name" varchar(60) NOT NULL,
	"ticket_number" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "flight_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(8) NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"price_lock_id" uuid NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"status" "flight_booking_status" DEFAULT 'pending_payment' NOT NULL,
	"adults" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"contact_email" varchar(254) NOT NULL,
	"contact_phone" varchar(16),
	"snapshot" jsonb NOT NULL,
	"airline_order_ref" varchar(64),
	"pnr" varchar(12),
	"ticketed_at" timestamp with time zone,
	"ticketing_attempts" integer DEFAULT 0 NOT NULL,
	"next_ticketing_check_at" timestamp with time zone,
	"failure_reason" text,
	"seats_held" boolean DEFAULT true NOT NULL,
	"payment_due_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" varchar(16),
	"refund_due_minor" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(24) NOT NULL,
	"reference_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_intent_id" varchar(128) NOT NULL,
	"status" "payment_status" DEFAULT 'requires_payment' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_minor" > 0 AND "payments"."refunded_minor" >= 0 AND "payments"."refunded_minor" <= "payments"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "price_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"adults" integer NOT NULL,
	"fare_per_adult_minor" integer NOT NULL,
	"taxes_per_adult_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_locks_total_ck" CHECK ("price_locks"."total_minor" = "price_locks"."fare_per_adult_minor" * "price_locks"."adults")
);
--> statement-breakpoint
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_booking_id_flight_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."flight_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_offer_id_flight_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."flight_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_bookings" ADD CONSTRAINT "flight_bookings_price_lock_id_price_locks_id_fk" FOREIGN KEY ("price_lock_id") REFERENCES "public"."price_locks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_locks" ADD CONSTRAINT "price_locks_offer_id_flight_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."flight_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_locks" ADD CONSTRAINT "price_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passengers_position_uq" ON "booking_passengers" USING btree ("booking_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_reference_uq" ON "flight_bookings" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_lock_uq" ON "flight_bookings" USING btree ("price_lock_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idempotency_uq" ON "flight_bookings" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bookings_user_idx" ON "flight_bookings" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "flight_bookings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_uq" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_intent_uq" ON "payments" USING btree ("provider","provider_intent_id");--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" USING btree ("purpose","reference_id");--> statement-breakpoint
CREATE INDEX "price_locks_user_idx" ON "price_locks" USING btree ("user_id");