CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`initial_balance` integer DEFAULT 0 NOT NULL,
	`current_balance` integer DEFAULT 0 NOT NULL,
	`icon` text,
	`color` text,
	`institution` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_type_idx` ON `accounts` (`type`);--> statement-breakpoint
CREATE INDEX `accounts_archived_idx` ON `accounts` (`is_archived`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`name` text,
	`amount` integer NOT NULL,
	`period` text DEFAULT 'monthly' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`rollover_enabled` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budgets_category_idx` ON `budgets` (`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'pricetag-outline' NOT NULL,
	`color` text DEFAULT '#8B8CFF' NOT NULL,
	`parent_id` text,
	`type` text DEFAULT 'expense' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `categories_type_idx` ON `categories` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_parent_idx` ON `categories` (`name`,`parent_id`);--> statement-breakpoint
CREATE TABLE `dashboard_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`width` text DEFAULT 'full' NOT NULL,
	`height` text DEFAULT 'medium' NOT NULL,
	`configuration` text DEFAULT '{}' NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchant_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_aliases_pattern_idx` ON `merchant_aliases` (`pattern`);--> statement-breakpoint
CREATE TABLE `recurring_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant` text NOT NULL,
	`description` text,
	`amount` integer NOT NULL,
	`type` text DEFAULT 'expense' NOT NULL,
	`category_id` text,
	`account_id` text NOT NULL,
	`transfer_account_id` text,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`next_date` text NOT NULL,
	`end_date` text,
	`last_posted_date` text,
	`is_active` integer DEFAULT true NOT NULL,
	`auto_post` integer DEFAULT true NOT NULL,
	`is_paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recurring_next_date_idx` ON `recurring_transactions` (`next_date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#8B8CFF' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_idx` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_transaction_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `transaction_tags_tag_idx` ON `transaction_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`merchant` text,
	`description` text,
	`date` text NOT NULL,
	`notes` text,
	`reference` text,
	`is_transfer` integer DEFAULT false NOT NULL,
	`transfer_account_id` text,
	`is_recurring` integer DEFAULT false NOT NULL,
	`recurring_id` text,
	`fingerprint` text,
	`is_reviewed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_type_idx` ON `transactions` (`type`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant`);--> statement-breakpoint
CREATE INDEX `transactions_fingerprint_idx` ON `transactions` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_account_idx` ON `transactions` (`transfer_account_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'INR' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
