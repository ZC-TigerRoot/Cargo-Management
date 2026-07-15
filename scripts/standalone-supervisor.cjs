const { spawn } = require("node:child_process");
const path = require("node:path");

process.title = "node";

const appDir = __dirname;
const envFile = process.env.APP_ENV_FILE || path.join(appDir, ".env");
const serverFile = path.join(appDir, "server.js");

const child = spawn(
  process.execPath,
  [`--env-file=${envFile}`, serverFile],
  {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      PORT: process.env.PORT || "3000",
    },
    stdio: "inherit",
  },
);

let stopping = false;

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error("Failed to start the standalone server:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (!stopping && signal) {
    console.error(`Standalone server exited after ${signal}`);
  }
  process.exit(code ?? (signal ? 1 : 0));
});
