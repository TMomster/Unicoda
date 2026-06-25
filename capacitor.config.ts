import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.unicoda.mobile",
  appName: "UnicodaMobile",
  webDir: "runpack",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
  },
};

export default config;
