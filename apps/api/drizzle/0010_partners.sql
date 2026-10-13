CREATE TYPE "public"."partner_kind" AS ENUM('airline', 'distributor');--> statement-breakpoint
CREATE TABLE "partner_members" (
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_members_partner_id_user_id_pk" PRIMARY KEY("partner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "partner_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_routes_distinct_ck" CHECK ("partner_routes"."origin" <> "partner_routes"."destination")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" "partner_kind" NOT NULL,
	"phone" varchar(16) NOT NULL,
	"requested_airlines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authorised_airlines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_routes" ADD CONSTRAINT "partner_routes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_routes" ADD CONSTRAINT "partner_routes_origin_airports_code_fk" FOREIGN KEY ("origin") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_routes" ADD CONSTRAINT "partner_routes_destination_airports_code_fk" FOREIGN KEY ("destination") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_members_user_uq" ON "partner_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_routes_uq" ON "partner_routes" USING btree ("partner_id","origin","destination");--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status");