import { Capacitor } from "@capacitor/core";

export type Platform = "web" | "ios" | "android";

export function getPlatform(): Platform {
  const p = Capacitor.getPlatform();
  if (p === "ios") return "ios";
  if (p === "android") return "android";
  return "web";
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
