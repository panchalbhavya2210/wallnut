CREATE TABLE `shared_expense_payers` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`person_id` text,
	`amount` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_expense_payers_expense_idx` ON `shared_expense_payers` (`expense_id`);--> statement-breakpoint
CREATE INDEX `shared_expense_payers_person_idx` ON `shared_expense_payers` (`person_id`);--> statement-breakpoint
-- Backfill: every existing expense had exactly one payer.
INSERT INTO `shared_expense_payers` ("id", "expense_id", "person_id", "amount")
SELECT 'shp_' || lower(hex(randomblob(9))), "id", "payer_person_id", "amount" FROM `shared_expenses`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shared_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`from_person_id` text,
	`to_person_id` text,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text,
	`transaction_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	`person_id` text,
	`direction` text
);
--> statement-breakpoint
INSERT INTO `__new_shared_settlements`("id", "group_id", "from_person_id", "to_person_id", "amount", "date", "account_id", "transaction_id", "note", "created_at", "person_id", "direction") SELECT "id", "group_id", CASE WHEN "direction" = 'received' THEN "person_id" ELSE NULL END, CASE WHEN "direction" = 'paid' THEN "person_id" ELSE NULL END, "amount", "date", "account_id", "transaction_id", "note", "created_at", "person_id", "direction" FROM `shared_settlements`;--> statement-breakpoint
DROP TABLE `shared_settlements`;--> statement-breakpoint
ALTER TABLE `__new_shared_settlements` RENAME TO `shared_settlements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shared_settlements_from_idx` ON `shared_settlements` (`from_person_id`);--> statement-breakpoint
CREATE INDEX `shared_settlements_to_idx` ON `shared_settlements` (`to_person_id`);--> statement-breakpoint
CREATE INDEX `shared_settlements_date_idx` ON `shared_settlements` (`date`);