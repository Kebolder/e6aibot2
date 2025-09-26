const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, InteractionContextType } = require('discord.js');
const config = require('../../config.json');
const knowledgeBaseDB = require('../utils/database');

const { DiscordIDs = [] } = config;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('knowledgebase')
        .setDescription('Manage knowledge base entries')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new knowledge base entry'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a knowledge base entry')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The simple name of the entry to remove')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit an existing knowledge base entry')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The simple name of the entry to edit')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    async execute(interaction) {
        if (DiscordIDs.length > 0 && !DiscordIDs.includes(interaction.user.id)) {
            await interaction.reply({
                content: 'You are not authorized to use this command.',
                ephemeral: true
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'add':
                await this.handleAdd(interaction);
                break;
            case 'remove':
                await this.handleRemove(interaction);
                break;
            case 'edit':
                await this.handleEdit(interaction);
                break;
            default:
                await interaction.reply({
                    content: 'Unknown subcommand.',
                    ephemeral: true
                });
        }
    },

    async handleAdd(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('kb_add_modal')
            .setTitle('Add Knowledge Base Entry');

        const simpleNameInput = new TextInputBuilder()
            .setCustomId('kb_simple_name')
            .setLabel('Simple Name (for /cite command)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., rules, guidelines, faq')
            .setMaxLength(50)
            .setRequired(true);

        const titleInput = new TextInputBuilder()
            .setCustomId('kb_title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Display title for the knowledge base entry')
            .setMaxLength(100)
            .setRequired(true);

        const bodyInput = new TextInputBuilder()
            .setCustomId('kb_body')
            .setLabel('Body')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('The main content of the knowledge base entry')
            .setMaxLength(4000)
            .setRequired(true);

        const imageInput = new TextInputBuilder()
            .setCustomId('kb_image')
            .setLabel('Image URL (Optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://example.com/image.png')
            .setMaxLength(500)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(simpleNameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(bodyInput),
            new ActionRowBuilder().addComponents(imageInput)
        );

        await interaction.showModal(modal);
    },

    async handleRemove(interaction) {
        const simpleName = interaction.options.getString('name');

        await interaction.deferReply({ ephemeral: true });

        const result = knowledgeBaseDB.removeEntry(simpleName);

        if (result.success) {
            await interaction.editReply({
                content: `✅ Knowledge base entry "${simpleName}" has been removed.`
            });
        } else {
            await interaction.editReply({
                content: `❌ ${result.error}`
            });
        }
    },

    async handleEdit(interaction) {
        const simpleName = interaction.options.getString('name');

        // First, get the existing entry
        const result = knowledgeBaseDB.getEntry(simpleName);

        if (!result.success) {
            await interaction.reply({
                content: `❌ ${result.error}`,
                ephemeral: true
            });
            return;
        }

        const { entry } = result;

        const modal = new ModalBuilder()
            .setCustomId(`kb_edit_modal:${simpleName}`)
            .setTitle('Edit Knowledge Base Entry');

        const simpleNameInput = new TextInputBuilder()
            .setCustomId('kb_simple_name')
            .setLabel('Simple Name (for /cite command)')
            .setStyle(TextInputStyle.Short)
            .setValue(entry.simple_name)
            .setMaxLength(50)
            .setRequired(true);

        const titleInput = new TextInputBuilder()
            .setCustomId('kb_title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setValue(entry.title)
            .setMaxLength(100)
            .setRequired(true);

        const bodyInput = new TextInputBuilder()
            .setCustomId('kb_body')
            .setLabel('Body')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.body)
            .setMaxLength(4000)
            .setRequired(true);

        const imageInput = new TextInputBuilder()
            .setCustomId('kb_image')
            .setLabel('Image URL (Optional)')
            .setStyle(TextInputStyle.Short)
            .setValue(entry.image_url || '')
            .setMaxLength(500)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(simpleNameInput),
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(bodyInput),
            new ActionRowBuilder().addComponents(imageInput)
        );

        await interaction.showModal(modal);
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