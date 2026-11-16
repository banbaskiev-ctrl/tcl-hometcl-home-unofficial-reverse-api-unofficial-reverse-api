import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AppConfig = {
  server: { port: number; host?: string };
  account: {
    username: string;
    password: string;
    countryCode: string;
  };
  auth: {
    loginUrl: string;
    cloudUrlsEndpoint: string;
    haAppId: string;
    clientId: string;
    sessionFile: string;
    refreshThreshold: number;
  };
  iot: {
    host: string;
    appId: string;
    deviceId: string;
    countryCode: string;
    timezone: string;
    region: string;
    cognitoHost: string;
    tempMin: number;
    tempMax: number;
    tempStep: number;
  };
};

const ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(ROOT, "config.json");
const EXAMPLE_CONFIG_PATH = join(ROOT, "config.example.json");

let cached: AppConfig | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing Railway variable: ${name}`);
  }

  return value.trim();
}

export function loadConfig(): AppConfig {
  if (cached) return cached;

  // Local config.json has priority.
  // In Railway we use config.example.json only as a technical template.
  const sourcePath = existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : EXAMPLE_CONFIG_PATH;

  if (!existsSync(sourcePath)) {
    throw new Error(
      `Neither config.json nor config.example.json found in ${ROOT}`
    );
  }

  const cfg = JSON.parse(
    readFileSync(sourcePath, "utf8")
  ) as AppConfig;

  // Railway networking
  const railwayPort = Number(process.env.PORT);

  if (Number.isFinite(railwayPort) && railwayPort > 0) {
    cfg.server.port = railwayPort;
  }

  cfg.server.host = "0.0.0.0";

  // Secrets/settings from Railway Variables
  cfg.account.username = requiredEnv("TCL_USERNAME");
  cfg.account.password = requiredEnv("TCL_PASSWORD");
  cfg.account.countryCode = requiredEnv("TCL_COUNTRY_CODE");

  cfg.iot.deviceId = requiredEnv("TCL_DEVICE_ID");

  // Optional overrides for later if TCL assigns another regional cloud.
  if (process.env.TCL_IOT_COUNTRY_CODE) {
    cfg.iot.countryCode = process.env.TCL_IOT_COUNTRY_CODE;
  }

  if (process.env.TCL_TIMEZONE) {
    cfg.iot.timezone = process.env.TCL_TIMEZONE;
  }

  if (process.env.TCL_IOT_REGION) {
    cfg.iot.region = process.env.TCL_IOT_REGION;
  }

  if (process.env.TCL_IOT_HOST) {
    cfg.iot.host = process.env.TCL_IOT_HOST;
  }

  if (process.env.TCL_COGNITO_HOST) {
    cfg.iot.cognitoHost = process.env.TCL_COGNITO_HOST;
  }

  cached = cfg;
  return cached;
}

export function resolvePath(relative: string): string {
  return join(ROOT, relative);
}
