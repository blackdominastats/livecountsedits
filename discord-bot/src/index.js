require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Events
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token.");
  process.exit(1);
}

const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT || 8787);
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
  if (req.method !== "POST" || !["/snapshot", "/milestone"].includes(req.url)) {
    return sendJson(res, 404, { error: "Not found" });
  }

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 2_000_000) req.destroy();
  });
  req.on("end", async () => {
    let incoming;
    try { incoming = JSON.parse(body || "{}"); }
    catch { return sendJson(res, 400, { error: "Invalid JSON" }); }

    if (req.url === "/milestone") {
      try {
        if (!Array.isArray(incoming.embeds) || incoming.embeds.length === 0) {
          return sendJson(res, 400, { error: "Milestone payload must include an embed" });
        }
        const targetId = process.env.DISCORD_CHANNEL_ID;
        if (!targetId) return sendJson(res, 500, { error: "Missing DISCORD_CHANNEL_ID in discord-bot/.env" });
        if (!client.isReady()) return sendJson(res, 503, { error: "Discord bot is not ready yet" });
        const target = await client.channels.fetch(targetId);
        if (!target || !target.isTextBased() || typeof target.send !== "function") {
          return sendJson(res, 400, { error: "DISCORD_CHANNEL_ID is not a text channel the bot can access" });
        }
        const message = {
          content: typeof incoming.content === "string" ? incoming.content : undefined,
          embeds: incoming.embeds.slice(0, 10).map(embed => EmbedBuilder.from(embed))
        };
        const graphChannel = snapshot.channels.find(c => c.id && c.id === String(incoming.channelId || ""));
        if (graphChannel && graphChannel.history.length > 1) {
          message.components = [graphButton(graphChannel.id, false)];
        }
        await target.send(message);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        console.error("Could not send milestone notification:", error);
        return sendJson(res, 500, { error: error.message || "Could not send milestone notification" });
      }
    }

    try {
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
          image: String(channel.image || ""),
          history: Array.isArray(channel.history) ? channel.history.slice(-300).map(Number).filter(Number.isFinite) : []
        })).filter(channel => Number.isFinite(channel.count) && channel.count >= 0),
        milestones: incoming.milestones
      };
      saveSnapshot();
      return sendJson(res, 200, { ok: true, channels: snapshot.channels.length, receivedAt: snapshot.receivedAt });
    } catch (error) {
      console.error("Could not process snapshot:", error);
      return sendJson(res, 400, { error: "Invalid snapshot format" });
    }
  });
});

function graphUrl(history, title) {
  const values = Array.isArray(history) ? history.slice(-250).map(Number).filter(Number.isFinite) : [];
  if (values.length < 2) return null;
  const config = {type:"line",data:{labels:values.map((_,i)=>i+1),datasets:[{label:"Subscribers",data:values,borderColor:"#f0a0a0",backgroundColor:"rgba(240,160,160,.12)",borderWidth:2,pointRadius:0,fill:false,tension:.18}]},options:{title:{display:true,text:title,color:"#fff"},legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{ticks:{fontColor:"#ddd"},gridLines:{color:"rgba(255,255,255,.12)"}}]},plugins:{datalabels:{display:false}}}};
  return "https://quickchart.io/chart?width=900&height=420&backgroundColor=%231b1b1b&format=png&c="+encodeURIComponent(JSON.stringify(config));
}
function graphButton(channelId, shown) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId((shown ? "graphhide:" : "graphshow:") + channelId)
    .setLabel(shown ? "Hide Subscriber Graph" : "View Subscriber Graph")
    .setEmoji(shown ? "📉" : "📈")
    .setStyle(ButtonStyle.Primary));
}

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


function parseSubscriberCount(input) {
  const cleaned = String(input || "").trim().replace(/,/g, "").replace(/\s+/g, "");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return NaN;
  const multipliers = { k: 1e3, m: 1e6, b: 1e9 };
  const value = Number(match[1]) * (multipliers[(match[2] || "").toLowerCase()] || 1);
  return Number.isSafeInteger(Math.round(value)) ? Math.round(value) : NaN;
}

function buildPredictionEmbed(channel, milestoneState, targetCount) {
  const currentCount = Number(channel.count);
  const reached = Number(milestoneState.milestone);
  const previous = Number(milestoneState.previousMilestone || 0);
  const durationMs = Number(milestoneState.durationMs || 0);
  const change = reached - previous;
  const averagePerDay = durationMs > 0 ? change / (durationMs / 86400000) : NaN;
  const difference = targetCount - currentCount;
  let etaMs = NaN;

  if (difference === 0) etaMs = 0;
  else if (Number.isFinite(averagePerDay) && averagePerDay !== 0 && Math.sign(difference) === Math.sign(averagePerDay)) {
    etaMs = (difference / averagePerDay) * 86400000;
  }

  const validEta = Number.isFinite(etaMs) && etaMs >= 0;
  const projectedDate = validEta ? new Date(Date.now() + etaMs) : null;
  const averageText = Number.isFinite(averagePerDay)
    ? (averagePerDay > 0 ? "+" : "") + fmt(averagePerDay)
    : "Unavailable";
  const projectionText = projectedDate
    ? "<t:" + Math.floor(projectedDate.getTime() / 1000) + ":F> (<t:" + Math.floor(projectedDate.getTime() / 1000) + ":R>)"
    : "Cannot estimate with the current average growth direction.";

  const embed = new EmbedBuilder()
    .setColor(0x20B89A)
    .setTitle("▶️ YouTube Subscriber Count Prediction")
    .setDescription(
      "**" + channel.name + " Subscriber Count Prediction**\n\n" +
      "📊 **" + channel.name + "** currently has **" + fmt(currentCount) + " estimated** subscribers, and is averaging **" +
      averageText + " subscribers per day**.\n" +
      "🔮 **" + channel.name + "** is estimated to reach **" + fmt(targetCount) +
      "** subscribers on " + projectionText + "."
    )
    .setFooter({ text: "LiveCountsEdits • Prediction based on the latest recorded milestone average" });

  if (channel.url) embed.setURL(channel.url);
  if (channel.image) embed.setThumbnail(channel.image);
  return embed;
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
  if (interaction.isButton()) {
    const [action, channelId] = interaction.customId.split(":");
    if (!["graphshow", "graphhide"].includes(action)) return;
    const channel = snapshot.channels.find(c => c.id === channelId);
    if (!channel) return interaction.reply({ content: "Graph history is not available. Keep the Top 50 page open to sync history.", ephemeral: true });
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    if (action === "graphshow") {
      const url = graphUrl(channel.history, channel.name + " Subscriber History");
      if (!url) return interaction.reply({ content: "Not enough subscriber history has synced yet.", ephemeral: true });
      embed.setImage(url);
    } else embed.setImage(null);
    return interaction.update({ embeds: [embed], components: [graphButton(channelId, action === "graphshow")] });
  }
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "average" && interaction.commandName !== "predict") return;
  await interaction.deferReply();

  const isPrediction = interaction.commandName === "predict";
  const query = (isPrediction
    ? interaction.options.getString("channelname", true)
    : interaction.options.getString("channel", true)
  ).trim().toLowerCase();

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

  if (isPrediction) {
    const rawAmount = interaction.options.getString("amount", true);
    const targetCount = parseSubscriberCount(rawAmount);
    if (!Number.isSafeInteger(targetCount) || targetCount < 0) {
      return interaction.editReply("Please enter a valid subscriber amount, such as **109000000**, **109,000,000**, **109M**, or **850K**.");
    }
    const predictionEmbed = buildPredictionEmbed(channel, state, targetCount);
    const age = snapshot.receivedAt ? Date.now() - snapshot.receivedAt : Infinity;
    const staleNote = age > 120000 ? "⚠️ Data was last synced " + durationText(age) + " ago. Open LiveCountsEdits to refresh it." : "";
    return interaction.editReply({ embeds: [predictionEmbed], components: [graphButton(channel.id, false)], content: staleNote || undefined });
  }

  const embed = buildAverageEmbed(channel, state);
  const age = snapshot.receivedAt ? Date.now() - snapshot.receivedAt : Infinity;
  const staleNote = age > 120000 ? "\n⚠️ Data was last synced " + durationText(age) + " ago. Open LiveCountsEdits to refresh it." : "";
  return interaction.editReply({ embeds: [embed], components: [graphButton(channel.id, false)], content: staleNote || undefined });
});

server.listen(PORT, HOST, () => {});
client.login(token).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});

process.on("SIGINT", () => { server.close(); client.destroy(); process.exit(0); });
