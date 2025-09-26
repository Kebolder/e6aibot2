const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionContextType } = require('discord.js');
const knowledgeBaseDB = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cite')
        .setDescription('Cite a knowledge base entry')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The simple name of the knowledge base entry')
                .setRequired(true)
                .setAutocomplete(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    async execute(interaction) {
        const simpleName = interaction.options.getString('name');

        await interaction.deferReply();

        const result = knowledgeBaseDB.getEntry(simpleName);

        if (!result.success) {
            await interaction.editReply({
                content: `❌ ${result.error}`
            });
            return;
        }

        const { entry } = result;

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(entry.title)
            .setDescription(entry.body)
            .setFooter({
                text: `Knowledge Base Entry: ${entry.simple_name}`,
                iconURL: interaction.client.user.displayAvatarURL()
            })
            .setTimestamp();

        if (entry.image_url && entry.image_url.trim()) {
            embed.setImage(entry.image_url);
        }

        const copyButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`copy_kb_text:${simpleName}`)
                    .setLabel('Copy Text')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

        await interaction.editReply({
            embeds: [embed],
            components: [copyButton]
        });
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();

        const result = knowledgeBaseDB.listEntries();

        if (!result.success) {
            await interaction.respond([]);
            return;
        }

        const filtered = result.entries
            .filter(entry => entry.simple_name.toLowerCase().includes(focusedValue.toLowerCase()))
            .slice(0, 25)
            .map(entry => ({
                name: `${entry.simple_name} - ${entry.title}`,
                value: entry.simple_name
            }));

        await interaction.respond(filtered);
    }
};