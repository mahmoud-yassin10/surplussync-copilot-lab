import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createLabApp } from "./src/server/createApp";
import { resolveServerPort } from "./src/server/resolveServerPort";

dotenv.config();

let port: number;
try {
  port = resolveServerPort();
} catch (error) {
  const message = error instanceof Error ? error.message : "Invalid PORT configuration";
  console.error(message);
  process.exit(1);
}

const app = createLabApp({ port });

const initServer = async () => {
  if (process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true") {
    const express = (await import("express")).default;
    app.use(express.static(path.resolve("dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`=============================================================`);
    console.log(`   SurplusSync Copilot Lab Server listening on port ${port}`);
    console.log(`   Demo sessions: in-memory UUID (not production auth)`);
    console.log(`   Internal Live Client Preview Route: http://localhost:${port}`);
    console.log(`=============================================================`);
  });
};

initServer().catch((err) => {
  console.error("Failed to boot full-stack laboratory server:", err);
});
