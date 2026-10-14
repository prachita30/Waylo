ALTER TABLE "flight_offers" ADD COLUMN "admin_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flight_offers" ADD COLUMN "admin_hold_reason" text;