import { createApiServer } from "./api.js";
import { loadConfigFromFile } from "./config.js";
import { FileUsageStore, MemoryUsageStore, type UsageStore } from "./costStore.js";
import { createProviderClient } from "./providers/factory.js";
import { HealthCache } from "./health.js";
import type { ProviderClient } from "./types.js";

function main(): void {
  const configPath = process.env.MODELHARBOR_CONFIG ?? "modelharbor.config.json";
  const port = Number(process.env.PORT ?? 4180);
  const usagePath = process.env.MODELHARBOR_USAGE_LOG;

  const config = loadConfigFromFile(configPath);
  const clients = new Map<string, ProviderClient>();
  for (const provider of config.providers) {
    clients.set(provider.id, createProviderClient(provider));
  }
  const healthCache = new HealthCache(config.providers, clients, config.healthCacheMs);
  const usageStore: UsageStore = usagePath ? new FileUsageStore(usagePath) : new MemoryUsageStore();

  const server = createApiServer({ config, clients, healthCache, usageStore });
  server.listen(port, () => {
    console.log(`modelharbor server listening on http://localhost:${port}`);
    console.log(`config: ${configPath} (${config.providers.length} provider(s))`);
    console.log(usagePath ? `usage log: ${usagePath}` : "usage log: in-memory (not persisted)");
  });
}

main();
