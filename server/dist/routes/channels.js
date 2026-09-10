import { Router } from "express";
import { getDb } from "../db/database.js";
import { audit } from "../services/auditLogger.js";
import { channelStats } from "../services/statistics.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export function channelsRouter(_context) {
    const router = Router();
    router.get("/", asyncHandler(async (_req, res) => {
        const channels = (await getDb()
            .prepare("SELECT id, name, description, is_active, created_at FROM channels ORDER BY name")
            .all());
        res.json({ channels });
    }));
    router.get("/stats", asyncHandler(async (_req, res) => {
        res.json({ channels: await channelStats(null) });
    }));
    router.post("/", asyncHandler(async (req, res) => {
        const { name, description } = req.body ?? {};
        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({ error: "Channel name is required." });
        }
        try {
            const info = await getDb()
                .prepare("INSERT INTO channels (name, description) VALUES (?, ?)")
                .run(name.trim(), description ?? null);
            await audit("channel.create", "channels", String(info.lastInsertRowid), { name: name.trim() });
            res.status(201).json({ id: Number(info.lastInsertRowid), name: name.trim(), description: description ?? null, is_active: 1 });
        }
        catch (err) {
            const message = err.message;
            if (message.includes("UNIQUE") || message.includes("duplicate key")) {
                return res.status(409).json({ error: `A channel named "${name.trim()}" already exists.` });
            }
            throw err;
        }
    }));
    router.patch("/:id", asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return res.status(400).json({ error: "Invalid channel id." });
        const { name, description, is_active } = req.body ?? {};
        const channel = (await getDb().prepare("SELECT * FROM channels WHERE id = ?").get(id));
        if (!channel)
            return res.status(404).json({ error: "Channel not found." });
        const nextName = typeof name === "string" && name.trim() ? name.trim() : channel.name;
        const nextDescription = description === undefined ? channel.description : description;
        const nextActive = is_active === undefined ? channel.is_active : (is_active ? 1 : 0);
        await getDb()
            .prepare("UPDATE channels SET name = ?, description = ?, is_active = ? WHERE id = ?")
            .run(nextName, nextDescription, nextActive, id);
        await audit("channel.update", "channels", String(id), { name: nextName, is_active: nextActive });
        res.json({ id, name: nextName, description: nextDescription, is_active: nextActive });
    }));
    router.delete("/:id", asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            return res.status(400).json({ error: "Invalid channel id." });
        const channel = (await getDb().prepare("SELECT * FROM channels WHERE id = ?").get(id));
        if (!channel)
            return res.status(404).json({ error: "Channel not found." });
        await getDb().prepare("UPDATE channels SET is_active = 0 WHERE id = ?").run(id);
        await audit("channel.deactivate", "channels", String(id), { name: channel.name });
        res.json({ ok: true, message: "Channel deactivated." });
    }));
    return router;
}
//# sourceMappingURL=channels.js.map