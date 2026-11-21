import * as core from "../../../core/index.ts";
import type { AdvancedModelEntry, HarborProfile, StandardModelEntry } from "../../../core/types.ts";
import type {
  GatewayAuthScheme,
  ModelEntry,
  ModelInput,
  ProfileCreateInput,
  ProfileDetail,
  ProfileMode,
  ProfileSummary,
  ProfileUpdateInput,
} from "../../shared/ipc.ts";
import { ServiceError } from "./errors.ts";
import type { ServiceOptions } from "./providers.ts";

function opts(options: ServiceOptions): { home?: string } | undefined {
  return options.home === undefined ? undefined : { home: options.home };
}

function providerNameMap(options: ServiceOptions): Map<string, string> {
  const io = opts(options);
  return new Map(core.providers.list(io).map((entry) => [entry.id, entry.name]));
}

function mapModels(profile: HarborProfile, names: Map<string, string>): ModelEntry[] {
  return profile.inferenceModels.map((model) => {
    const raw = model as unknown as Record<string, unknown>;
    const provider = typeof raw.provider === "string" ? raw.provider : undefined;
    return {
      name: model.name,
      ...(raw.labelOverride === undefined ? {} : { labelOverride: String(raw.labelOverride) }),
      ...(raw.supports1m === undefined ? {} : { supports1m: Boolean(raw.supports1m) }),
      ...(raw.prefer1m === undefined ? {} : { prefer1m: Boolean(raw.prefer1m) }),
      ...(raw.anthropicFamilyTier === undefined ? {} : { anthropicFamilyTier: String(raw.anthropicFamilyTier) }),
      ...(raw.isFamilyDefault === undefined ? {} : { isFamilyDefault: Boolean(raw.isFamilyDefault) }),
      ...(raw.behavesAs === undefined ? {} : { behavesAs: String(raw.behavesAs) }),
      ...(raw.maxEffort === undefined ? {} : { maxEffort: String(raw.maxEffort) }),
      ...(provider === undefined ? {} : { provider, providerName: names.get(provider) }),
      ...(raw.upstreamModel === undefined ? {} : { upstreamModel: String(raw.upstreamModel) }),
    };
  });
}

function summaryOf(id: string, name: string, profile: HarborProfile, applied: boolean): ProfileSummary {
  return {
    id,
    name,
    mode: profile.mode as ProfileMode,
    applied,
    modelCount: profile.inferenceModels.length,
    ...(profile.mode === "advanced" ? { port: profile.port } : {}),
  };
}

function resolveMeta(idOrName: string, options: ServiceOptions): { id: string; name: string } {
  const io = opts(options);
  const meta = core.profiles.meta(io);
  const entry =
    meta.entries.find((item) => item.id === idOrName) ??
    meta.entries.find((item) => item.name === idOrName);
  if (!entry) throw new ServiceError("NOT_FOUND", "找不到这个档案，它可能已被删除。");
  return entry;
}

export function listProfiles(options: ServiceOptions = {}): ProfileSummary[] {
  const io = opts(options);
  const meta = core.profiles.meta(io);
  return core.profiles.detailList(io).map((entry) => {
    const profile = core.profiles.get(entry.id, io);
    return summaryOf(entry.id, entry.name, profile, meta.appliedId === entry.id);
  });
}

export function getProfile(idOrName: string, options: ServiceOptions = {}): ProfileDetail {
  const io = opts(options);
  const entry = resolveMeta(idOrName, options);
  const profile = core.profiles.get(entry.id, io);
  const meta = core.profiles.meta(io);
  const base = summaryOf(entry.id, entry.name, profile, meta.appliedId === entry.id);
  return {
    ...base,
    ...(profile.mode === "advanced"
      ? { gatewayToken: profile.gatewayToken, gatewayAuthScheme: profile.gatewayAuthScheme as GatewayAuthScheme }
      : {}),
    models: mapModels(profile, providerNameMap(options)),
    ...(profile.claude === undefined ? {} : { claude: profile.claude as Record<string, unknown> }),
  };
}

function modelInput(input: ModelInput): Record<string, unknown> {
  return {
    name: input.name,
    ...(input.labelOverride === undefined ? {} : { labelOverride: input.labelOverride }),
    ...(input.supports1m === undefined ? {} : { supports1m: input.supports1m }),
    ...(input.prefer1m === undefined ? {} : { prefer1m: input.prefer1m }),
    ...(input.anthropicFamilyTier === undefined ? {} : { anthropicFamilyTier: input.anthropicFamilyTier }),
    ...(input.isFamilyDefault === undefined ? {} : { isFamilyDefault: input.isFamilyDefault }),
    ...(input.behavesAs === undefined ? {} : { behavesAs: input.behavesAs }),
    ...(input.maxEffort === undefined ? {} : { maxEffort: input.maxEffort }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.upstreamModel === undefined ? {} : { upstreamModel: input.upstreamModel }),
  };
}

export function createProfile(input: ProfileCreateInput, options: ServiceOptions = {}): ProfileDetail {
  const io = opts(options);
  const created = core.profiles.create(
    {
      name: input.name,
      mode: input.mode,
      ...(input.port === undefined ? {} : { port: input.port }),
      ...(input.gatewayToken === undefined ? {} : { gatewayToken: input.gatewayToken }),
      ...(input.gatewayAuthScheme === undefined ? {} : { gatewayAuthScheme: input.gatewayAuthScheme }),
      inferenceModels: input.models.map((model) => modelInput(model) as never),
      ...(input.claude === undefined ? {} : { claude: input.claude as never }),
    },
    io,
  );
  return getProfile(created.id, options);
}

export function updateProfile(idOrName: string, patch: ProfileUpdateInput, options: ServiceOptions = {}): ProfileDetail {
  const io = opts(options);
  const entry = resolveMeta(idOrName, options);
  core.profiles.updateProfile(
    entry.id,
    {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.port === undefined ? {} : { port: patch.port }),
      ...(patch.gatewayToken === undefined ? {} : { gatewayToken: patch.gatewayToken }),
      ...(patch.gatewayAuthScheme === undefined ? {} : { gatewayAuthScheme: patch.gatewayAuthScheme }),
      ...(patch.claude === undefined ? {} : { claude: patch.claude }),
    },
    io,
  );
  return getProfile(entry.id, options);
}

export function removeProfile(idOrName: string, options: ServiceOptions = {}): void {
  core.profiles.remove(idOrName, opts(options));
}

export function addModel(idOrName: string, model: ModelInput, options: ServiceOptions = {}): ProfileDetail {
  const entry = resolveMeta(idOrName, options);
  core.profiles.addEntry(entry.id, modelInput(model) as never, opts(options));
  return getProfile(entry.id, options);
}

export function updateModel(
  idOrName: string,
  previousName: string,
  model: ModelInput,
  options: ServiceOptions = {},
): ProfileDetail {
  const entry = resolveMeta(idOrName, options);
  core.profiles.replaceEntry(entry.id, previousName, modelInput(model) as never, opts(options));
  return getProfile(entry.id, options);
}

export function removeModel(idOrName: string, modelName: string, options: ServiceOptions = {}): ProfileDetail {
  const entry = resolveMeta(idOrName, options);
  core.profiles.removeEntry(entry.id, { name: modelName } as never, opts(options));
  return getProfile(entry.id, options);
}

export interface ApplyResult {
  readonly profile: ProfileDetail;
  readonly actions: readonly string[];
  readonly renames: readonly { id: string; from: string; to: string }[];
}

export function applyProfile(idOrName: string, options: ServiceOptions = {}): ApplyResult {
  const result = core.lifecycle.activateProfile(idOrName, options.home === undefined ? {} : { home: options.home });
  return {
    profile: getProfile(result.entry.id, options),
    actions: result.actions,
    renames: result.renames,
  };
}

export type { AdvancedModelEntry, StandardModelEntry };
