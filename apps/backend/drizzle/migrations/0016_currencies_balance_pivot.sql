-- Spec 026: currencies catalog and balances as a pivot of (currency, flow).
-- Order matters: create, convert, and only then remove. Nothing is dropped before its data has
-- been copied to the new shape.

--> statement-breakpoint
CREATE TYPE "public"."wallet_type" AS ENUM('cash', 'digital');
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The catalog is system data: seeded here, never written by the API.
INSERT INTO "currencies" ("code", "name", "symbol", "decimals", "is_active", "position") VALUES
	('ARS', 'Peso argentino', '$', 2, true, 1),
	('USD', 'Dolar', 'US$', 2, true, 2),
	('EUR', 'Euro', 'EUR', 2, true, 3);

--> statement-breakpoint
-- balances: from the four-key enum to the pivot. The new table is filled from the old one before
-- the old one is dropped, so every amount survives.
CREATE TABLE "balances_new" (
	"currency_code" text NOT NULL,
	"wallet_type" "wallet_type" NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balances_currency_code_wallet_type_pk" PRIMARY KEY("currency_code","wallet_type")
);
--> statement-breakpoint
INSERT INTO "balances_new" ("currency_code", "wallet_type", "amount", "updated_at")
SELECT
	CASE "key"::text
		WHEN 'cash_ars' THEN 'ARS'
		WHEN 'digital_ars' THEN 'ARS'
		WHEN 'cash_usd' THEN 'USD'
		WHEN 'digital_usd' THEN 'USD'
	END,
	CASE "key"::text
		WHEN 'cash_ars' THEN 'cash'
		WHEN 'digital_ars' THEN 'digital'
		WHEN 'cash_usd' THEN 'cash'
		WHEN 'digital_usd' THEN 'digital'
	END::"wallet_type",
	"amount",
	"updated_at"
FROM "balances";
--> statement-breakpoint
DROP TABLE "balances";
--> statement-breakpoint
ALTER TABLE "balances_new" RENAME TO "balances";
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- movements: the balance source becomes currency + flow, copied from the old enum column.
ALTER TABLE "movements" ADD COLUMN "currency_code" text;
--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "wallet_type" "wallet_type";
--> statement-breakpoint
UPDATE "movements" SET
	"currency_code" = CASE "balance_source"::text
		WHEN 'cash_ars' THEN 'ARS'
		WHEN 'digital_ars' THEN 'ARS'
		WHEN 'cash_usd' THEN 'USD'
		WHEN 'digital_usd' THEN 'USD'
	END,
	"wallet_type" = CASE "balance_source"::text
		WHEN 'cash_ars' THEN 'cash'
		WHEN 'digital_ars' THEN 'digital'
		WHEN 'cash_usd' THEN 'cash'
		WHEN 'digital_usd' THEN 'digital'
	END::"wallet_type";
--> statement-breakpoint
ALTER TABLE "movements" ALTER COLUMN "currency_code" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "movements" ALTER COLUMN "wallet_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "movements" DROP COLUMN "balance_source";
--> statement-breakpoint
-- The two currencies of a movement stop being an enum and become catalog codes.
ALTER TABLE "movements" ALTER COLUMN "amount_currency" TYPE text USING "amount_currency"::text;
--> statement-breakpoint
ALTER TABLE "movements" ALTER COLUMN "paid_currency" TYPE text USING "paid_currency"::text;
--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_amount_currency_currencies_code_fk" FOREIGN KEY ("amount_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_paid_currency_currencies_code_fk" FOREIGN KEY ("paid_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- Tasks: the same currency concept, converted with their defaults preserved.
ALTER TABLE "task_payments" ALTER COLUMN "price_currency" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "task_payments" ALTER COLUMN "price_currency" TYPE text USING "price_currency"::text;
--> statement-breakpoint
ALTER TABLE "task_payments" ALTER COLUMN "price_currency" SET DEFAULT 'ARS';
--> statement-breakpoint
ALTER TABLE "task_payments" ADD CONSTRAINT "task_payments_price_currency_currencies_code_fk" FOREIGN KEY ("price_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_price_tiers" ALTER COLUMN "currency" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "task_price_tiers" ALTER COLUMN "currency" TYPE text USING "currency"::text;
--> statement-breakpoint
ALTER TABLE "task_price_tiers" ALTER COLUMN "currency" SET DEFAULT 'ARS';
--> statement-breakpoint
ALTER TABLE "task_price_tiers" ADD CONSTRAINT "task_price_tiers_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_expectations" ALTER COLUMN "currency" TYPE text USING "currency"::text;
--> statement-breakpoint
ALTER TABLE "task_expectations" ADD CONSTRAINT "task_expectations_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- Only now, with every value copied, the old enums go: the currency is a catalog code everywhere.
DROP TYPE "public"."balance_key";
--> statement-breakpoint
DROP TYPE "public"."currency";

-- Custom SQL migration file, put your code below! --