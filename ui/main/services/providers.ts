import * as core from "../../../core/index.ts";
import type { Provider } from "../../../core/types.ts";
import type { ProviderDetail, ProviderInput, ProviderPatch, ProviderSummary } from "../../shared/ipc.ts";
import { ServiceError } from "./errors.ts";

export interface ServiceOptions {
  readonly home?: string;
}

function opts(options: ServiceOptions): { home?: string } | undefined {
  return options.home === undefined ? undefined : { home: options.home };
}

function summary(id: string, name: string, provider: Provider): ProviderSummary {
  return {
    id,
    name,
    baseUrl: provider.inferenceGatewayBaseUrl,
    scheme: provider.inferenceGatewayAuthScheme,
  };
}

export function listProviders(options: ServiceOptions = {}): ProviderSummary[] {
  const io = opts(options);
  return core.providers.list(io).map((entry) => {
    const provider = core.providers.getById(entry.id, io);
    return summary(entry.id, entry.name, provider);
  });
}

export function getProvider(id: string, options: ServiceOptions = {}): ProviderDetail {
  const io = opts(options);
  const entry = core.providers.list(io).find((item) => item.id === id);
  if (!entry) throw new ServiceError("NOT_FOUND", `供应商（UUID：${id}）不存在`);
  const provider = core.providers.getById(entry.id, io);
  return { ...summary(entry.id, entry.name, provider), apiKey: provider.inferenceGatewayApiKey };
}

export function createProvider(input: ProviderInput, options: ServiceOptions = {}): ProviderSummary {
  const io = opts(options);
  const entry = core.providers.add(
    {
      name: input.name,
      inferenceGatewayBaseUrl: input.baseUrl,
      inferenceGatewayApiKey: input.apiKey,
      inferenceGatewayAuthScheme: input.scheme,
    },
    io,
  );
  return getProvider(entry.id, options);
}

export function updateProvider(id: string, patch: ProviderPatch, options: ServiceOptions = {}): ProviderSummary {
  const io = opts(options);
  const entry = core.providers.update(
    id,
    {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.baseUrl === undefined ? {} : { inferenceGatewayBaseUrl: patch.baseUrl }),
      ...(patch.apiKey === undefined ? {} : { inferenceGatewayApiKey: patch.apiKey }),
      ...(patch.scheme === undefined ? {} : { inferenceGatewayAuthScheme: patch.scheme }),
    },
    io,
  );
  return getProvider(entry.id, options);
}

export function removeProvider(id: string, options: ServiceOptions = {}): void {
  core.providers.remove(id, opts(options));
}
