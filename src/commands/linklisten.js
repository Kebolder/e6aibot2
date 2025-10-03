const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const database = require('../utils/database');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('linklisten')
        .setDescription('Toggle link listening for a channel (Owner only)')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to toggle link listening for')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Check if user is the bot owner
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: '❌ Only the bot owner can use this command.',
                ephemeral: true
            });
        }

        const channel = interaction.options.getChannel('channel');

        // Toggle the link listener for the channel
        const result = database.toggleLinkListener(channel.id);

        if (!result.success) {
            return interaction.reply({
                content: `❌ Error toggling link listener: ${result.error}`,
                ephemeral: true
            });
        }

        const status = result.enabled ? '✅ enabled' : '❌ disabled';
        return interaction.reply({
            content: `Link listening has been ${status} for ${channel}.`,
            ephemeral: true
        });
    }
};
