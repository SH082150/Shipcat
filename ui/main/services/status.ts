import * as core from "../../../core/index.ts";
import type { OverviewData, ProfileSummary, StatusData } from "../../shared/ipc.ts";
import { listProviders } from "./providers.ts";
import type { ServiceOptions } from "./providers.ts";
import type { GatewayService } from "./gateway.ts";

function opts(options: ServiceOptions): { home?: string } | undefined {
  return options.home === undefined ? undefined : { home: options.home };
}

function summaryOf(id: string, name: string, options: ServiceOptions): ProfileSummary {
  const io = opts(options);
  const profile = core.profiles.get(id, io);
  return {
    id,
    name,
    mode: profile.mode,
    applied: core.profiles.meta(io).appliedId === id,
    modelCount: profile.inferenceModels.length,
    ...(profile.mode === "advanced" ? { port: profile.port } : {}),
  };
}

export function getStatus(options: ServiceOptions = {}): StatusData {
  const io = opts(options);
  const local = core.lifecycle.getStatus(options.home === undefined ? {} : { home: options.home });
  return {
    appliedId: local.appliedId,
    claudeAppliedId: local.claudeAppliedId,
    profiles: local.profiles.map((entry) => ({
      ...summaryOf(entry.id, entry.name, options),
      modelCount: core.profiles.get(entry.id, io).inferenceModels.length,
    })),
    providers: listProviders(options),
  };
}

export function getOverview(gateway: GatewayService, options: ServiceOptions = {}): OverviewData {
  const io = opts(options);
  const meta = core.profiles.meta(io);
  let activeProfile: ProfileSummary | null = null;
  if (meta.appliedId) {
    const entry = meta.entries.find((item) => item.id === meta.appliedId);
    if (entry) activeProfile = summaryOf(entry.id, entry.name, options);
  }
  return { activeProfile, gateway: gateway.status() };
}
