CREATE TABLE `ai_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`feature` text NOT NULL,
	`response` text NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_cache_hash_idx` ON `ai_cache` (`request_hash`);