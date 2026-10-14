CREATE TABLE "search_stats" (
	"day" date NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"with_results" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "search_stats_day_origin_destination_pk" PRIMARY KEY("day","origin","destination")
);
