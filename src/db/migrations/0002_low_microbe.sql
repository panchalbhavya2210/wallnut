ALTER TABLE `recurring_transactions` ADD `anchor_day` integer;--> statement-breakpoint
UPDATE `recurring_transactions` SET `anchor_day` = CAST(strftime('%d', `next_date`) AS integer) WHERE `anchor_day` IS NULL;
