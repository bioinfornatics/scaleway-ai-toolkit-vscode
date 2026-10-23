import { Elysia } from "elysia";

export const app = new Elysia().get("/health", () => ({ status: "ok" }));
// Bun runtime; no automatic listen. Review authentication before exposure.
