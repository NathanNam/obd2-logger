import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.nathannam.obd2logger",
  appName: "OBD2 Logger",
  webDir: "dist",
  ios: {
    contentInset: "always",
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Scanning…",
        cancel: "Cancel",
        availableDevices: "Available devices",
        noDeviceFound: "No device found",
      },
    },
  },
};

export default config;
