CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_name` text,
	`account_id` text NOT NULL,
	`default_category_id` text,
	`status` text DEFAULT 'staged' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`confirmed_rows` integer DEFAULT 0 NOT NULL,
	`skipped_rows` integer DEFAULT 0 NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`invalid_rows` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`committed_at` integer
);
--> statement-breakpoint
CREATE INDEX `import_batches_status_idx` ON `import_batches` (`status`);--> statement-breakpoint
CREATE TABLE `import_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`date` text,
	`amount` integer,
	`type` text DEFAULT 'expense' NOT NULL,
	`merchant` text,
	`description` text,
	`raw_description` text,
	`account_id` text,
	`category_id` text,
	`category_source` text,
	`suggested_category_id` text,
	`suggested_rule_name` text,
	`reference` text,
	`notes` text,
	`fingerprint` text,
	`duplicate_of` text,
	`errors` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_drafts_batch_idx` ON `import_drafts` (`batch_id`);--> statement-breakpoint
CREATE INDEX `import_drafts_status_idx` ON `import_drafts` (`status`);--> statement-breakpoint
ALTER TABLE `rules` ADD `mode` text DEFAULT 'apply' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `capture_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `import_batch_id` text;--> statement-breakpoint
CREATE INDEX `transactions_import_batch_idx` ON `transactions` (`import_batch_id`);