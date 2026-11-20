/**
 * 用户自定义身份：显示名称与头像。
 *
 * 未设置时：用户名为空（由 app.ts 回退到本机用户名），头像为空占位。
 * 设置后：侧边栏账户按钮、账户菜单、设置预览与概览问候语都使用这里的值。
 *
 * 仅存 localStorage，属于界面偏好；接入 core 后可替换为正式配置。
 */

export const USERNAME_STORAGE_KEY = "claudeharbor.username";
export const AVATAR_STORAGE_KEY = "claudeharbor.avatar";

export interface UserIdentity {
  /** 自定义用户名；空串表示未设置。 */
  readonly name: string;
  /** 头像 data URL；空串表示未设置。 */
  readonly avatar: string;
}

const EMPTY_IDENTITY: UserIdentity = { name: "", avatar: "" };

export function readUserIdentity(): UserIdentity {
  try {
    const name = globalThis.localStorage?.getItem(USERNAME_STORAGE_KEY)?.trim() ?? "";
    const avatar = globalThis.localStorage?.getItem(AVATAR_STORAGE_KEY) ?? "";
    return {
      name,
      avatar: avatar.startsWith("data:image/") ? avatar : "",
    };
  } catch {
    return EMPTY_IDENTITY;
  }
}

export function persistUserName(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      globalThis.localStorage?.setItem(USERNAME_STORAGE_KEY, trimmed);
    } else {
      globalThis.localStorage?.removeItem(USERNAME_STORAGE_KEY);
    }
  } catch {
    // 隐私模式下写入失败时保持内存状态即可。
  }
}

export function persistUserAvatar(avatar: string): void {
  try {
    if (avatar.length > 0) {
      globalThis.localStorage?.setItem(AVATAR_STORAGE_KEY, avatar);
    } else {
      globalThis.localStorage?.removeItem(AVATAR_STORAGE_KEY);
    }
  } catch {
    // 图片过大或隐私模式时忽略，界面仍显示本次选择。
  }
}
