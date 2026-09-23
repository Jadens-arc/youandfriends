-- Task `043`: song metadata. Additive and nullable — every existing song reads as before: no
-- artist of its own (the project's is shown) and no notes.
ALTER TABLE "songs" ADD COLUMN "artist" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "notes" text;