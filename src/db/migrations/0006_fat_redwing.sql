CREATE TABLE `inbox_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_key` text NOT NULL,
	`snoozed_until` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_dismissals_unique_idx` ON `inbox_dismissals` (`kind`,`ref_key`);