import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createLabApp } from "./src/server/createApp";

dotenv.config();

const PORT = 3000;
const app = createLabApp({ port: PORT });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`=============================================================`);
    console.log(`   SurplusSync Copilot Lab Server listening on port ${PORT}`);
    console.log(`   Demo sessions: in-memory UUID (not production auth)`);
    console.log(`   Internal Live Client Preview Route: http://localhost:3000`);
    console.log(`=============================================================`);
  });
};

initServer().catch((err) => {
  console.error("Failed to boot full-stack laboratory server:", err);
});
