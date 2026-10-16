CREATE TABLE `shared_expense_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`share` integer NOT NULL,
	`input_value` integer
);
--> statement-breakpoint
CREATE INDEX `shared_expense_participants_expense_idx` ON `shared_expense_participants` (`expense_id`);--> statement-breakpoint
CREATE INDEX `shared_expense_participants_person_idx` ON `shared_expense_participants` (`person_id`);--> statement-breakpoint
CREATE TABLE `shared_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`category_id` text,
	`account_id` text,
	`payer_person_id` text,
	`notes` text,
	`split_type` text DEFAULT 'equal' NOT NULL,
	`transaction_id` text,
	`lending_transaction_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_expenses_group_idx` ON `shared_expenses` (`group_id`);--> statement-breakpoint
CREATE INDEX `shared_expenses_date_idx` ON `shared_expenses` (`date`);--> statement-breakpoint
CREATE INDEX `shared_expenses_payer_idx` ON `shared_expenses` (`payer_person_id`);--> statement-breakpoint
CREATE TABLE `shared_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_group_members_group_idx` ON `shared_group_members` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shared_group_members_unique_idx` ON `shared_group_members` (`group_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `shared_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'people-outline' NOT NULL,
	`color` text DEFAULT '#8B8CFF' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_groups_archived_idx` ON `shared_groups` (`is_archived`);--> statement-breakpoint
CREATE TABLE `shared_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`group_id` text,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text,
	`transaction_id` text,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_settlements_person_idx` ON `shared_settlements` (`person_id`);--> statement-breakpoint
CREATE INDEX `shared_settlements_date_idx` ON `shared_settlements` (`date`);