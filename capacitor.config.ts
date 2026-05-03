import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.nathannam.obd2logger",
  appName: "OBD2 Logger",
  webDir: "dist",
  ios: {
    contentInset: "always",
    // Without this, iOS's safe-area gap above the WebView shows through as
    // white, which is jarring next to the dark UI. Matches --bg in styles.css.
    backgroundColor: "#0e0f12",
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
