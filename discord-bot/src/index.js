require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token.");
  process.exit(1);
}

const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT || 8787);
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DATA_FILE = path.join(__dirname, "..", "data.json");
const ALLOWED_ORIGINS = new Set([
  "https://lcedit.com",
  "https://www.lcedit.com",
  "https://blackdominastats.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
]);

let snapshot = { receivedAt: 0, channels: [], milestones: {} };
try {
  if (fs.existsSync(DATA_FILE)) snapshot = { ...snapshot, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
} catch (error) {
  console.warn("Could not load previous local data:", error.message);
}

function saveSnapshot() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2)); }
  catch (error) { console.error("Could not save local data:", error.message); }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "POST" || !["/snapshot", "/milestone"].includes(req.url)) return sendJson(res, 404, { error: "Not found" });

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 2_000_000) req.destroy();
  });
  req.on("end", async () => {
    try {
      const incoming = JSON.parse(body || "{}");

      if (req.url === "/milestone") {
        if (!Array.isArray(incoming.embeds) || !incoming.embeds[0]) {
          return sendJson(res, 400, { error: "Missing milestone embed" });
        }
        if (!DISCORD_CHANNEL_ID) {
          return sendJson(res, 500, { error: "Set DISCORD_CHANNEL_ID in discord-bot/.env" });
        }
        const target = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (!target || !target.isTextBased() || typeof target.send !== "function") {
          return sendJson(res, 404, { error: "The configured Discord channel is unavailable or cannot receive messages" });
        }
        await target.send({
          content: incoming.content || undefined,
          embeds: [EmbedBuilder.from(incoming.embeds[0])]
        });
        return sendJson(res, 200, { ok: true });
      }

      if (!Array.isArray(incoming.channels) || typeof incoming.milestones !== "object" || !incoming.milestones) {
        return sendJson(res, 400, { error: "Invalid snapshot format" });
      }
      snapshot = {
        receivedAt: Date.now(),
        channels: incoming.channels.slice(0, 1000).map(channel => ({
          id: String(channel.id || ""),
          name: String(channel.name || "Unknown channel"),
          count: Number(channel.count),
          url: String(channel.url || channel.link || ""),
          image: String(channel.image || "")
        })).filter(channel => Number.isFinite(channel.count) && channel.count >= 0),
        milestones: incoming.milestones
      };
      saveSnapshot();
      return sendJson(res, 200, { ok: true, channels: snapshot.channels.length, receivedAt: snapshot.receivedAt });
    } catch (error) {
      console.error("Website bridge request failed:", error);
      return sendJson(res, 400, { error: error.message || "Invalid request" });
    }
  });
});

function fmt(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}
function fmtRate(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  return Math.round(value).toLocaleString("en-US");
}
function milestoneStep(count) {
  if (count < 1_000) return 1;
  if (count < 10_000) return 10;
  if (count < 100_000) return 100;
  if (count < 1_000_000) return 1_000;
  if (count < 10_000_000) return 10_000;
  if (count < 100_000_000) return 100_000;
  return 1_000_000;
}
function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "Unavailable";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(days + "d");
  if (hours) parts.push(hours + "h");
  if (minutes) parts.push(minutes + "m");
  if (!parts.length) parts.push(Math.max(0, total % 60) + "s");
  return parts.join(" ");
}

function buildAverageEmbed(channel, milestoneState) {
  const currentCount = Number(channel.count);
  const reached = Number(milestoneState.milestone);
  const previous = Number(milestoneState.previousMilestone || 0);
  const durationMs = Number(milestoneState.durationMs || 0);
  const change = reached - previous;
  const validRate = durationMs > 0 && change !== 0;
  const perMinute = validRate ? change / (durationMs / 60000) : NaN;
  const perHour = validRate ? change / (durationMs / 3600000) : NaN;
  const perDay = validRate ? change / (durationMs / 86400000) : NaN;

  const step = milestoneStep(currentCount);
  const nextMilestone = (Math.floor(currentCount / step) + 1) * step;
  const remaining = Math.max(0, nextMilestone - currentCount);
  const etaMs = Number.isFinite(perHour) && perHour > 0 ? (remaining / perHour) * 3600000 : NaN;
  const projectedDate = Number.isFinite(etaMs) && etaMs >= 0 ? new Date(Date.now() + etaMs) : null;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(channel.name + " — Milestone Statistics")
    .setDescription("Latest recorded milestone: **" + fmt(reached) + " subscribers**")
    .addFields(
      { name: "Average growth when reached", value:
        "**Per minute:** " + fmtRate(perMinute) + "\n" +
        "**Per hour:** " + fmtRate(perHour) + "\n" +
        "**Per day:** " + fmtRate(perDay), inline: false
      },
      { name: "Milestone interval", value:
        "From **" + fmt(previous) + "** to **" + fmt(reached) + "**\n" +
        "Elapsed time: **" + durationText(durationMs) + "**", inline: true
      },
      { name: "Current count", value: "**" + fmt(currentCount) + "**", inline: true },
      { name: "Next milestone", value: "**" + fmt(nextMilestone) + "** subscribers", inline: true },
      { name: "Projection", value: projectedDate
        ? "Estimated " + durationText(etaMs) + " from now\n<t:" + Math.floor(projectedDate.getTime() / 1000) + ":F>"
        : "Not available (the latest recorded growth rate is zero, negative, or missing).", inline: false
      }
    )
    .setFooter({ text: "LiveCountsEdits • Projection assumes the latest milestone rate continues" });

  if (channel.url) embed.setURL(channel.url);
  if (channel.image) embed.setThumbnail(channel.image);
  return embed;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, readyClient => {
  console.log("Discord bot online as " + readyClient.user.tag);
  console.log("Local website bridge listening on http://" + HOST + ":" + PORT + "/snapshot");
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "average") return;
  await interaction.deferReply();

  const query = interaction.options.getString("channel", true).trim().toLowerCase();
  const channel = snapshot.channels.find(item =>
    item.name.toLowerCase() === query || item.id.toLowerCase() === query
  ) || snapshot.channels.find(item => item.name.toLowerCase().includes(query));

  if (!channel) {
    return interaction.editReply("I can't find that channel in the latest LiveCountsEdits data. Open the Top 50 page and wait for it to sync.");
  }

  const state = snapshot.milestones[channel.id] || snapshot.milestones["name:" + channel.name];
  if (!state || !Number.isFinite(Number(state.milestone))) {
    return interaction.editReply("I don't have a recorded milestone for **" + channel.name + "** yet. Keep the Top 50 page open so milestone tracking can collect data.");
  }

  const embed = buildAverageEmbed(channel, state);
  const age = snapshot.receivedAt ? Date.now() - snapshot.receivedAt : Infinity;
  const staleNote = age > 120000 ? "\n⚠️ Data was last synced " + durationText(age) + " ago. Open LiveCountsEdits to refresh it." : "";
  return interaction.editReply({ embeds: [embed], content: staleNote || undefined });
});

server.listen(PORT, HOST, () => {});
client.login(token).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});

process.on("SIGINT", () => { server.close(); client.destroy(); process.exit(0); });
