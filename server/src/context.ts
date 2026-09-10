import { PixalateClient } from "./pixalate/client.js";
import { PixalateCtvClient } from "./pixalate/ctvClient.js";
import { PixalateClientLike, PixalateCtvClientLike } from "./pixalate/types.js";
import { config } from "./config.js";

export interface IngestionConfig {
  enabled: boolean;
  apiKey: string;
  maxBatch: number;
  ratePerMinute: number;
}

export interface AppContext {
  client: PixalateClientLike;
  ctvClient: PixalateCtvClientLike;
  apiKeyConfigured: boolean;
  ingestion: IngestionConfig;
}

let singletonContext: AppContext | null = null;

export function createContext(overrides: Partial<AppContext> = {}): AppContext {
  const client = overrides.client ?? new PixalateClient();
  const ctvClient = overrides.ctvClient ?? new PixalateCtvClient();
  return {
    client,
    ctvClient,
    apiKeyConfigured:
      overrides.apiKeyConfigured ?? (client instanceof PixalateClient ? client.isConfigured : config.PIXALATE_API_KEY.length > 0),
    ingestion: {
      enabled: overrides.ingestion?.enabled ?? config.INGESTION_API_KEY.length > 0,
      apiKey: overrides.ingestion?.apiKey ?? config.INGESTION_API_KEY,
      maxBatch: overrides.ingestion?.maxBatch ?? config.INGESTION_MAX_BATCH,
      ratePerMinute: overrides.ingestion?.ratePerMinute ?? config.INGESTION_RATE_PER_MINUTE,
    },
  };
}

export function getContext(): AppContext {
  if (!singletonContext) singletonContext = createContext();
  return singletonContext;
}

/** For tests: inject a mock context. */
export function setContext(context: AppContext): void {
  singletonContext = context;
}