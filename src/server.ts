import { envFileExists, loadConfig, yamlPath } from "./config.js";
import { createApp } from "./app.js";
import { log } from "./log.js";
import { ImaplaneService, startSweeps } from "./service.js";

export async function startServer(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (!envFileExists() && !yamlPath(process.cwd())) {
      console.error("No config found. Run: npx imaplane init   (or copy .env.example / imaplane.yaml.example)");
    }
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    log.warn("binding off loopback; keep BRIDGE_TOKEN strong", { host: config.host });
  }

  const service = new ImaplaneService(config);
  service.start();
  const stopSweeps = startSweeps(service, config);

  const app = createApp(service, config);
  const server = app.listen(config.port, config.host, () => {
    log.info("listening", {
      host: config.host,
      port: config.port,
      base: `http://${config.host}:${config.port}/v1`,
      accounts: config.accounts.map((a) => a.name),
      send: config.sendEnabled,
      sweeps: config.sweeps.enabled,
    });
  });

  function shutdown(signal: string) {
    log.info("shutdown", { signal });
    stopSweeps();
    server.close(() => {
      void service.stop().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 8_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
