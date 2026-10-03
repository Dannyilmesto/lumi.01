import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const command = process.argv[2];
if (!["dev", "start"].includes(command)) {
  throw new Error("Use this script with the Next.js dev or start command.");
}

const port = 3001;
const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", (error) => {
    reject(
      error.code === "EADDRINUSE"
        ? new Error(
            `Port ${port} is already in use. Stop its current process and try again.`,
            {
              cause: error,
            },
          )
        : error,
    );
  });
  server.listen(port, resolve);
});
await new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [nextBin, command, "--port", String(port)],
  {
    stdio: "inherit",
  },
);
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});

process.exitCode = result.code ?? (result.signal ? 1 : 0);
