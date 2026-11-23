import { createHmac, randomUUID } from "node:crypto";
import { servePublic } from "./static.ts";

const SWITCHBOT_BASE = "https://api.switch-bot.com/v1.1";

const SWITCHBOT_TOKEN =
  Bun.env.SWITCHBOT_TOKEN ?? "";

const SWITCHBOT_SECRET =
  Bun.env.SWITCHBOT_SECRET ?? "";

// Назва, яку ми щойно дали кондиціонеру в SwitchBot
const TARGET_DEVICE_NAME =
  Bun.env.SWITCHBOT_DEVICE_NAME ?? "TCL Office AC";

let cachedDeviceId: string | null = null;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function err(message: string, status = 400): Response {
  return json(
    {
      ok: false,
      error: message,
    },
    status,
  );
}

async function readBody(
  req: Request,
): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function switchBotHeaders(): Record<string, string> {
  if (!SWITCHBOT_TOKEN || !SWITCHBOT_SECRET) {
    throw new Error(
      "SWITCHBOT_TOKEN or SWITCHBOT_SECRET is not configured",
    );
  }

  const t = Date.now().toString();
  const nonce = randomUUID();

  const stringToSign =
    SWITCHBOT_TOKEN + t + nonce;

  const sign = createHmac(
    "sha256",
    SWITCHBOT_SECRET,
  )
    .update(stringToSign)
    .digest("base64");

  return {
    Authorization: SWITCHBOT_TOKEN,
    sign,
    nonce,
    t,
    "Content-Type":
      "application/json; charset=utf8",
  };
}

async function switchBotRequest(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const response = await fetch(
    `${SWITCHBOT_BASE}${path}`,
    {
      ...options,
      headers: {
        ...switchBotHeaders(),
        ...(options.headers ?? {}),
      },
    },
  );

  const raw = await response.text();

  let data: any;

  try {
    data = JSON.parse(raw);
  } catch {
    data = {
      raw,
    };
  }

  if (!response.ok) {
    throw new Error(
      `SwitchBot HTTP ${response.status}: ${raw}`,
    );
  }

  if (
    typeof data?.statusCode === "number" &&
    data.statusCode !== 100
  ) {
    throw new Error(
      `SwitchBot API ${data.statusCode}: ${
        data.message ?? "Unknown error"
      }`,
    );
  }

  return data;
}

async function getInfraredRemotes(): Promise<any[]> {
  const data = await switchBotRequest(
    "/devices",
  );

  return (
    data?.body?.infraredRemoteList ?? []
  );
}

async function findAcDevice(): Promise<any> {
  const devices =
    await getInfraredRemotes();

  const device = devices.find(
    (item: any) =>
      String(item?.deviceName ?? "")
        .trim()
        .toLowerCase() ===
      TARGET_DEVICE_NAME
        .trim()
        .toLowerCase(),
  );

  if (!device) {
    throw new Error(
      `SwitchBot infrared device "${TARGET_DEVICE_NAME}" not found`,
    );
  }

  cachedDeviceId =
    String(device.deviceId);

  return device;
}

async function getAcDeviceId(): Promise<string> {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  const device =
    await findAcDevice();

  return String(device.deviceId);
}

async function sendAcCommand(
  command: string,
  parameter = "default",
): Promise<any> {
  const deviceId =
    await getAcDeviceId();

  return switchBotRequest(
    `/devices/${encodeURIComponent(
      deviceId,
    )}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        command,
        parameter,
        commandType: "command",
      }),
    },
  );
}

export function createServer() {
  return Bun.serve({
    hostname: "0.0.0.0",
    port: Number(
      Bun.env.PORT ?? 3100,
    ),

    routes: {
      "/": () =>
        servePublic("index.html") ??
        json({
          ok: true,
          service: "tcl-control",
          backend: "SwitchBot",
        }),

      "/styles.css": () =>
        servePublic("styles.css") ??
        err("not found", 404),

      "/app.js": () =>
        servePublic("app.js") ??
        err("not found", 404),

      "/health": {
        GET: () =>
          json({
            ok: true,
            service: "tcl-control",
            backend: "SwitchBot",
          }),
      },

      "/api/devices": {
        GET: async () => {
          try {
            const devices =
              await getInfraredRemotes();

            return json({
              ok: true,
              data: devices,
            });
          } catch (e) {
            return err(
              e instanceof Error
                ? e.message
                : String(e),
              500,
            );
          }
        },
      },

      "/api/ac/status": {
        GET: async () => {
          try {
            const device =
              await findAcDevice();

            return json({
              ok: true,
              data: {
                deviceId:
                  device.deviceId,
                deviceName:
                  device.deviceName,
                remoteType:
                  device.remoteType,
                hubDeviceId:
                  device.hubDeviceId,

                // IR-кондиціонер не передає
                // фактичний стан назад у SwitchBot
                state:
                  "IR remote ready",

                configuredTemperature:
                  23,
                configuredMode:
                  "heat",
                configuredFan:
                  "auto",
              },
            });
          } catch (e) {
            console.error(
              "SWITCHBOT STATUS ERROR:",
              e,
            );

            return err(
              e instanceof Error
                ? e.message
                : String(e),
              500,
            );
          }
        },
      },

      "/api/ac/power": {
        POST: async (req) => {
          try {
            const body =
              await readBody(req);

            if (
              typeof body.on !==
              "boolean"
            ) {
              return err(
                'Expected { "on": true|false }',
              );
            }

            const command =
              body.on
                ? "turnOn"
                : "turnOff";

            const result =
              await sendAcCommand(
                command,
              );

            return json({
              ok: true,
              on: body.on,
              command,
              result,
            });
          } catch (e) {
            console.error(
              "SWITCHBOT POWER ERROR:",
              e,
            );

            return err(
              e instanceof Error
                ? e.message
                : String(e),
              500,
            );
          }
        },
      },

      "/api/ac/temperature": {
        POST: async (req) => {
          try {
            const body =
              await readBody(req);

            const temperature =
              typeof body.value ===
              "number"
                ? body.value
                : 23;

            if (
              temperature < 16 ||
              temperature > 30
            ) {
              return err(
                "Temperature must be between 16 and 30°C",
              );
            }

            // SwitchBot Air Conditioner:
            // mode 5 = HEAT
            // fan 1 = AUTO
            // power = ON
            const parameter =
              `${temperature},5,1,on`;

            const result =
              await sendAcCommand(
                "setAll",
                parameter,
              );

            return json({
              ok: true,
              temperature,
              mode: "heat",
              fan: "auto",
              result,
            });
          } catch (e) {
            console.error(
              "SWITCHBOT TEMPERATURE ERROR:",
              e,
            );

            return err(
              e instanceof Error
                ? e.message
                : String(e),
              500,
            );
          }
        },
      },
    },

    fetch(req) {
      const url =
        new URL(req.url);

      const asset =
        servePublic(
          url.pathname.slice(1),
        );

      if (asset) {
        return asset;
      }

      return json(
        {
          ok: false,
          error: "not found",
          routes: [
            "GET /health",
            "GET /api/devices",
            "GET /api/ac/status",
            "POST /api/ac/power",
            "POST /api/ac/temperature",
          ],
        },
        404,
      );
    },
  });
}
