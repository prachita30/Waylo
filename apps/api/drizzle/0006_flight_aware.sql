CREATE TYPE "public"."rider_readiness" AS ENUM('not_landed', 'landed', 'at_baggage', 'ready', 'at_pickup');--> statement-breakpoint
ALTER TABLE "ride_participants" ADD COLUMN "readiness" "rider_readiness" DEFAULT 'not_landed' NOT NULL;--> statement-breakpoint
ALTER TABLE "ride_participants" ADD COLUMN "readiness_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_participants" ADD COLUMN "removed_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "ride_requests" ADD COLUMN "closed_reason" varchar(40);