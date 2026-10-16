import { initDatabase } from '@/db/client';
import { Platform } from 'react-native';
import { postDueInstallments } from '@/services/installments.service';
import { postDueRecurring } from '@/services/recurring.service';
import { syncReminderNotifications } from '@/services/notifications.service';
import { seedDefaultCategories } from '@/services/categories.service';
import { seedDefaultMerchantAliases } from '@/services/merchant.service';
import { isDatabaseEmpty, migrateDashboardLayout, ensureSafeToSpendWidget, ensureCategoryMonthlyWidget, seedDefaultDashboardWidgets, seedDemoData } from '@/services/seed.service';
import { hydrateSettings, useSettingsStore } from '@/stores/settings.store';
import { useBootstrapStore } from '@/stores/bootstrap.store';

/**
 * Application bootstrap, run once before the UI renders data:
 *   1. open SQLite + apply migrations + create analytics views
 *   2. load persisted settings into the store
 *   3. ensure system rows exist (categories, aliases, dashboard)
 *   4. post due recurring payments and installments
 *   5. in development, seed 6 months of demo data into an empty database
 */

export interface BootstrapResult {
  databaseReady: boolean;
  seeded: boolean;
  postedRecurring: number;
  postedInstallments: number;
}

const BOOTSTRAP_TIMEOUT_MS = 30_000;

let bootstrapPromise: Promise<BootstrapResult> | null = null;

export function bootstrapApp(): Promise<BootstrapResult> {
  if (!bootstrapPromise) {
    bootstrapPromise = withTimeout(runBootstrap(), BOOTSTRAP_TIMEOUT_MS).catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}

/** Never leave the user staring at a splash screen without an explanation. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Opening the local database timed out. Please reload the app.'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function runBootstrap(): Promise<BootstrapResult> {
  const started = Date.now();
  const stage = (label: string) => console.log(`[boot] ${label} ${Date.now() - started}ms`);

  await initDatabase();
  stage('database ready');
  await hydrateSettings();
  stage('settings hydrated');

  // System rows are idempotent — safe on every launch.
  await seedDefaultCategories();
  await seedDefaultMerchantAliases();
  await seedDefaultDashboardWidgets();
  stage('system data ensured');

  let seeded = false;
  // Development builds and the browser preview auto-seed an empty database so
  // the app is immediately explorable. Settings → Data can wipe or reload it.
  if (__DEV__ || Platform.OS === 'web') {
    const empty = await isDatabaseEmpty();
    if (empty) {
      await seedDemoData();
      seeded = true;
      stage('demo data seeded');
      // Demo data implies a ready-to-explore app: skip the first-run wizard and
      // land on the dashboard. Release builds keep the real onboarding flow.
      const settings = useSettingsStore.getState();
      if (!settings.general.onboarded) {
        settings.update('general', { onboarded: true, userName: settings.general.userName || 'You' });
        stage('demo mode: onboarding marked complete');
      }
    }
  }

  // Scheduled postings run at launch so the ledger stays current without a
  // background service.
  const recurring = await postDueRecurring();
  const installments = await postDueInstallments();
  stage('schedules posted');

  // Mirror the reminder engine into real OS notifications (local only).
  void syncReminderNotifications()
    .then((result) => {
      if (result.scheduled > 0) stage(`scheduled ${result.scheduled} notifications`);
    })
    .catch(() => undefined);

  // One-time layout tidy-up for databases seeded before the spacing pass.
  const tidied = await migrateDashboardLayout();
  if (tidied) stage('dashboard layout tidied up');

  // Add the Safe-to-Spend flagship card for dashboards created before it.
  const addedSafeToSpend = await ensureSafeToSpendWidget();
  if (addedSafeToSpend) stage('safe-to-spend widget added');

  // Add the month-on-month Category Trends card for existing dashboards.
  const addedCategoryTrends = await ensureCategoryMonthlyWidget();
  if (addedCategoryTrends) stage('category trends widget added');

  // Hand the "we posted things for you" facts to the UI so it can say so.
  useBootstrapStore.getState().setResult({
    seeded,
    postedRecurring: recurring.posted,
    recurringTotal: recurring.postedAmount,
    postedInstallments: installments.posted,
  });

  console.log(`[boot] complete in ${Date.now() - started}ms`);

  return {
    databaseReady: true,
    seeded,
    postedRecurring: recurring.posted,
    postedInstallments: installments.posted,
  };
}
