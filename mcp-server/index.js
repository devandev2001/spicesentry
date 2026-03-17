// SpiceSentry MCP Server
// Exposes spice-inventory tools backed by MongoDB Atlas Data API (Stitch)
//
// Environment variables (passed via MCP config):
//   STITCH_API_KEY  – Atlas Data API key
//   ATLAS_BASE_URL  – Data API endpoint (default: https://data.mongodb-api.com/app/data-api/endpoint/data/v1)
//   ATLAS_CLUSTER   – cluster name (default: Cluster0)
//   ATLAS_DATABASE  – database name (default: spicesentry)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Atlas Data API helpers ──────────────────────────────────────────────
const API_KEY    = process.env.STITCH_API_KEY;
const BASE_URL   = process.env.ATLAS_BASE_URL   || "https://data.mongodb-api.com/app/data-api/endpoint/data/v1";
const CLUSTER    = process.env.ATLAS_CLUSTER     || "Cluster0";
const DATABASE   = process.env.ATLAS_DATABASE    || "spicesentry";

async function atlasRequest(action, body) {
  const url = `${BASE_URL}/action/${action}`;
  const payload = {
    dataSource: CLUSTER,
    database: DATABASE,
    ...body,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "api-key":       API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Atlas API ${action} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Shops & spice definitions (mirrors the front-end) ───────────────────
const SHOPS  = ["KVS Anachal", "20 Acre", "Kallar"];
const SPICES = [
  { id: "cardamom",    label: "Cardamom" },
  { id: "pepper",      label: "Pepper" },
  { id: "nutmeg",      label: "Nutmeg" },
  { id: "nutmeg_mace", label: "Nutmeg mace" },
  { id: "coffee",      label: "Coffee" },
  { id: "clove",       label: "Clove" },
];

const SPICE_IDS = SPICES.map(s => s.id);

// ── Create MCP server ───────────────────────────────────────────────────
const server = new McpServer({
  name: "spicesentry",
  version: "1.0.0",
});

// ── Tool 1: add-entry ───────────────────────────────────────────────────
server.tool(
  "add-entry",
  "Add a new spice purchase entry to the SpiceSentry database",
  {
    shop:  z.enum(SHOPS).describe("Shop / branch name"),
    type:  z.enum(SPICE_IDS).describe("Spice type id (e.g. cardamom, pepper)"),
    qty:   z.number().positive().describe("Quantity in Kg"),
    price: z.number().positive().describe("Price per Kg in ₹"),
  },
  async ({ shop, type, qty, price }) => {
    const now = new Date().toISOString();
    const doc = {
      shop,
      type,
      qty,
      price,
      totalValue: +(qty * price).toFixed(2),
      date: now,
      loadId: `load_${Date.now()}`,
      id: Date.now(),
    };

    const result = await atlasRequest("insertOne", {
      collection: "entries",
      document: doc,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: true, insertedId: result.insertedId, entry: doc },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Tool 2: get-entries ─────────────────────────────────────────────────
server.tool(
  "get-entries",
  "Retrieve spice purchase entries. Optionally filter by shop, spice type, or limit the number returned.",
  {
    shop:  z.enum(SHOPS).optional().describe("Filter by shop name"),
    type:  z.enum(SPICE_IDS).optional().describe("Filter by spice type"),
    limit: z.number().int().positive().default(50).describe("Max entries to return (default 50)"),
  },
  async ({ shop, type, limit }) => {
    const filter = {};
    if (shop) filter.shop = shop;
    if (type) filter.type = type;

    const result = await atlasRequest("find", {
      collection: "entries",
      filter,
      sort: { date: -1 },
      limit: limit ?? 50,
    });

    const docs = result.documents || [];
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ count: docs.length, entries: docs }, null, 2),
        },
      ],
    };
  }
);

// ── Tool 3: get-stats ───────────────────────────────────────────────────
server.tool(
  "get-stats",
  "Get aggregated statistics (total quantity, average price) per spice for a given shop. Optionally filter by a loadId.",
  {
    shop:   z.enum(SHOPS).describe("Shop to get stats for"),
    loadId: z.string().optional().describe("Filter by load ID (omit for all loads)"),
  },
  async ({ shop, loadId }) => {
    const matchStage = { $match: { shop } };
    if (loadId) matchStage.$match.loadId = loadId;

    const pipeline = [
      matchStage,
      {
        $group: {
          _id: "$type",
          totalQty:   { $sum: "$qty" },
          totalValue: { $sum: { $multiply: ["$qty", "$price"] } },
          entryCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          type: "$_id",
          totalQty:   1,
          totalValue: 1,
          entryCount: 1,
          avgPrice: {
            $cond: [
              { $gt: ["$totalQty", 0] },
              { $round: [{ $divide: ["$totalValue", "$totalQty"] }, 2] },
              0,
            ],
          },
        },
      },
      { $sort: { type: 1 } },
    ];

    const result = await atlasRequest("aggregate", {
      collection: "entries",
      pipeline,
    });

    const docs = result.documents || [];
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ shop, stats: docs }, null, 2),
        },
      ],
    };
  }
);

// ── Tool 4: dispatch-load ───────────────────────────────────────────────
server.tool(
  "dispatch-load",
  "Mark the current load for a shop as dispatched. Inserts a dispatch record with a timestamp so future entries start on a fresh load.",
  {
    shop: z.enum(SHOPS).describe("Shop whose load is being dispatched"),
  },
  async ({ shop }) => {
    const doc = {
      shop,
      dispatchedAt: new Date().toISOString(),
      newLoadId: `load_${Date.now()}`,
    };

    const result = await atlasRequest("insertOne", {
      collection: "dispatches",
      document: doc,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: true, insertedId: result.insertedId, dispatch: doc },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Tool 5: list-shops ──────────────────────────────────────────────────
server.tool(
  "list-shops",
  "List all available shop/branch names and spice types in SpiceSentry",
  {},
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ shops: SHOPS, spices: SPICES }, null, 2),
        },
      ],
    };
  }
);

// ── Resource: spice catalogue ───────────────────────────────────────────
server.resource(
  "spice-catalogue",
  "spicesentry://catalogue",
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify({ shops: SHOPS, spices: SPICES }, null, 2),
        mimeType: "application/json",
      },
    ],
  })
);

// ── Start ───────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SpiceSentry MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
