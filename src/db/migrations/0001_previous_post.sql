CREATE TABLE `account_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'wallet-outline' NOT NULL,
	`color` text DEFAULT '#8B8CFF' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_collapsed` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `debt_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`debt_id` text NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text,
	`transaction_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `debt_payments_debt_idx` ON `debt_payments` (`debt_id`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`direction` text NOT NULL,
	`principal` integer NOT NULL,
	`remaining` integer NOT NULL,
	`date` text NOT NULL,
	`due_date` text,
	`account_id` text,
	`transaction_id` text,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `debts_person_idx` ON `debts` (`person_id`);--> statement-breakpoint
CREATE INDEX `debts_status_idx` ON `debts` (`status`);--> statement-breakpoint
CREATE TABLE `goal_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text,
	`transaction_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goal_contributions_goal_idx` ON `goal_contributions` (`goal_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_amount` integer NOT NULL,
	`initial_amount` integer DEFAULT 0 NOT NULL,
	`target_date` text,
	`linked_account_id` text,
	`category_id` text,
	`icon` text DEFAULT 'flag-outline' NOT NULL,
	`color` text DEFAULT '#8B8CFF' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goals_archived_idx` ON `goals` (`is_archived`);--> statement-breakpoint
CREATE TABLE `installments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`merchant` text,
	`purchase_amount` integer NOT NULL,
	`installment_amount` integer NOT NULL,
	`total_count` integer NOT NULL,
	`posted_count` integer DEFAULT 0 NOT NULL,
	`start_date` text NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `installments_active_idx` ON `installments` (`is_active`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`match_type` text DEFAULT 'all' NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_enabled_idx` ON `rules` (`is_enabled`);--> statement-breakpoint
CREATE TABLE `saved_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`uri` text NOT NULL,
	`kind` text DEFAULT 'image' NOT NULL,
	`name` text,
	`size` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transaction_attachments_txn_idx` ON `transaction_attachments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text DEFAULT 'expense' NOT NULL,
	`category_id` text,
	`account_id` text,
	`transfer_account_id` text,
	`merchant` text,
	`description` text,
	`icon` text DEFAULT 'flash-outline' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `group_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `include_in_net_worth` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `include_in_total_balance` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `include_in_cash_flow` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `visible_on_dashboard` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `hidden_from_transaction_creation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `credit_limit` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `statement_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `payment_due_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `minimum_payment` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `interest_rate` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `investment_type` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `cost_basis` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_valuation_date` text;--> statement-breakpoint
CREATE INDEX `accounts_group_idx` ON `accounts` (`group_id`);--> statement-breakpoint
ALTER TABLE `recurring_transactions` ADD `is_subscription` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_transactions` ADD `reminder_days_before` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `installment_id` text;