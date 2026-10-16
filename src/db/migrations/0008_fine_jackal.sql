CREATE TABLE `shared_expense_items` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_expense_items_expense_idx` ON `shared_expense_items` (`expense_id`);--> statement-breakpoint
-- Backfill: every existing shared expense becomes a single-item record.
INSERT INTO `shared_expense_items` ("id", "expense_id", "name", "amount", "sort_order")
SELECT 'shi_' || lower(hex(randomblob(9))), "id", "title", "amount", 0 FROM `shared_expenses`;