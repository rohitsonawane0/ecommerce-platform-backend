/**
 * Migration entrypoint for product-service.
 *
 * Built as its own webpack bundle (`nest build product-service-migrations`) and
 * shipped in the same image as the app, so the Helm pre-upgrade Job can apply
 * migrations inside the cluster — the runtime image has no ts-node and no
 * TypeScript sources, which is why the `pnpm mig:run:product` CLI cannot be used
 * there.
 *
 * The DataSource is imported rather than reconstructed: it already reads
 * PRODUCT_DB_* from process.env and holds the explicit `migrations` array.
 */
import dataSource from './data-source';

async function run() {
  await dataSource.initialize();
  const applied = await dataSource.runMigrations();
  console.log(
    applied.length
      ? `applied ${applied.length}: ${applied.map((m) => m.name).join(', ')}`
      : 'no pending migrations',
  );
  await dataSource.destroy();
}

run().catch((err) => {
  console.error(err);
  // Non-zero exit fails the Job, which aborts the helm upgrade before the
  // Deployment rolls. The previous version keeps serving.
  process.exit(1);
});
