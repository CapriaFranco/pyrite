-- Spec 027: the quotation carries its pair (base/quote).
-- Every existing row is a dollar quotation against the peso, so the pair is filled with that and
-- nothing else changes: buy, sell and date stay as they are.

--> statement-breakpoint
ALTER TABLE "rates_daily" ADD COLUMN "base" text;
--> statement-breakpoint
ALTER TABLE "rates_daily" ADD COLUMN "quote" text;
--> statement-breakpoint
UPDATE "rates_daily" SET "base" = 'USD', "quote" = 'ARS';
--> statement-breakpoint
ALTER TABLE "rates_daily" ALTER COLUMN "base" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "rates_daily" ALTER COLUMN "quote" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "rates_daily" DROP CONSTRAINT "rates_daily_type_date_key";
--> statement-breakpoint
ALTER TABLE "rates_daily" ADD CONSTRAINT "rates_daily_type_pair_date_key" UNIQUE("type","base","quote","date");
--> statement-breakpoint
ALTER TABLE "rates_daily" ADD CONSTRAINT "rates_daily_base_currencies_code_fk" FOREIGN KEY ("base") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rates_daily" ADD CONSTRAINT "rates_daily_quote_currencies_code_fk" FOREIGN KEY ("quote") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;

-- Custom SQL migration file, put your code below! --