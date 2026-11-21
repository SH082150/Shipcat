import * as core from "../../../core/index.ts";
import type { AdvancedModelEntry, Provider } from "../../../core/types.ts";
import type { GatewayStatus } from "../../shared/ipc.ts";
import { ServiceError } from "./errors.ts";

type Handle = { readonly port: number; close(): Promise<void> };

export class GatewayService {
  private handle: Handle | null = null;
  private state: GatewayStatus = { running: false };
  private readonly listeners = new Set<(status: GatewayStatus) => void>();

  onStatus(listener: (status: GatewayStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): GatewayStatus {
    return this.state;
  }

  private emit(next: GatewayStatus): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  async start(profileIdOrName: string, home?: string): Promise<GatewayStatus> {
    const io = home === undefined ? undefined : { home };
    if (this.handle) await this.stop();

    const profile = core.profiles.get(profileIdOrName, io);
    if (profile.mode !== "advanced") {
      throw new ServiceError("CONFLICT", "只有「网关路由」模式的档案才能开启本地网关。");
    }

    const gate = core.check.gate(profileIdOrName, io);
    if (!gate.ok) {
      throw new ServiceError(
        "GATE_FAILED",
        "档案与 Claude Desktop 的配置不一致，请先同步后再试。",
        gate.diffs,
      );
    }

    const entries = profile.inferenceModels as readonly AdvancedModelEntry[];
    const resolveProvider = (providerId: string): Provider | null => {
      try {
        return core.providers.getById(providerId, io);
      } catch {
        return null;
      }
    };

    try {
      const customHeaders = core.claudeBlock.readCustomHeaders(profile.claude);
      const handle = await core.gateway.startGateway({
        port: profile.port,
        token: profile.gatewayToken,
        entries,
        resolveProvider,
        ...(customHeaders === undefined ? {} : { customHeaders }),
      });
      this.handle = handle as Handle;
      this.emit({ running: true, profileId: profileIdOrName, port: handle.port });
      return this.state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("gateway start failed", error);
      this.handle = null;
      this.emit({ running: false, profileId: profileIdOrName, error: message });
      throw new ServiceError(
        "GATEWAY_START_FAILED",
        "网关启动失败。请检查端口是否被占用，或稍后重试。",
      );
    }
  }

  async stop(): Promise<GatewayStatus> {
    if (this.handle) {
      const handle = this.handle;
      this.handle = null;
      try {
        await handle.close();
      } catch {
        // 关闭失败也视为已停止，避免卡住 UI。
      }
    }
    this.emit({ running: false });
    return this.state;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}

