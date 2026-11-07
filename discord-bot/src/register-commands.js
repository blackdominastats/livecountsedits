require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in discord-bot/.env");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("average")
    .setDescription("Show a channel's latest milestone averages and next milestone projection")
    .addStringOption(option =>
      option.setName("channel")
        .setDescription("Channel name or channel ID, e.g. MrBeast")
        .setRequired(true)
        .setMaxLength(100)
    ),
  new SlashCommandBuilder()
    .setName("predict")
    .setDescription("Predict when a channel will reach a subscriber count")
    .addSubcommand(subcommand =>
      subcommand
        .setName("count")
        .setDescription("Predict when a channel reaches a target subscriber count")
        .addStringOption(option =>
          option.setName("channelname")
            .setDescription("YouTube channel name or channel ID")
            .setRequired(true)
            .setMaxLength(100)
        )
        .addStringOption(option =>
          option.setName("amount")
            .setDescription("Target subscriber count, e.g. 109M or 109000000")
            .setRequired(true)
            .setMaxLength(30)
        )
    )
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    if (guildId && !guildId.startsWith("YOUR_")) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log("Registered /average in the selected server.");
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("Registered /average globally. It can take a while to appear.");
    }
  } catch (error) {
    console.error("Could not register commands:", error);
    process.exitCode = 1;
  }
})();
