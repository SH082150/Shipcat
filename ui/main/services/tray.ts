/**
 * 菜单栏 / 托盘图标：常驻显示，点击恢复主窗口，菜单提供显示与退出。
 *
 * 图标路径由调用方传入，避免打包后相对路径受模块位置影响。
 */

import { Menu, Tray, nativeImage } from "electron";

export interface TrayOptions {
  /** 托盘图标 PNG 路径（建议 32px 源图）。 */
  readonly iconPath: string;
  /** 点击图标或“显示 Shipcat”时调用。 */
  readonly onShow: () => void;
  /** 点击“退出 Shipcat”时调用；调用方负责置退出标记并 app.quit()。 */
  readonly onQuit: () => void;
}

/** 创建常驻托盘；返回的 Tray 必须由调用方持有，避免被 GC。 */
export function createTray(options: TrayOptions): Tray {
  const size = process.platform === "darwin" ? 18 : 16;
  const source = nativeImage.createFromPath(options.iconPath);
  const icon = source.isEmpty() ? source : source.resize({ width: size, height: size });

  const tray = new Tray(icon);
  tray.setToolTip("Shipcat");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示 Shipcat", click: () => options.onShow() },
      { type: "separator" },
      { label: "退出 Shipcat", click: () => options.onQuit() },
    ]),
  );
  tray.on("click", () => options.onShow());
  return tray;
}
