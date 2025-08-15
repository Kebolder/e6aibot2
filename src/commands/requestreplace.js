const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const fetchPost = require('../utils/fetchPost');

const { DiscordIDs = [] } = config;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('requestreplace')
        .setDescription('Request a replacement for an e6AI post.')
        .addStringOption(option =>
            option.setName('post_id')
                .setDescription('The ID of the post to request replacement for.')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('The replacement file to upload.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the replacement request.')
                .setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    async execute(interaction) {
        const postId = interaction.options.getString('post_id');
        const fileAttachment = interaction.options.getAttachment('file');
        const reason = interaction.options.getString('reason');

        // Validate postId is numeric
        if (!/^\d+$/.test(postId)) {
            return interaction.reply({ content: '❌ Post ID must be a valid number', ephemeral: true });
        }

        // Check if replacement request channel is configured
        if (!config.channels || !config.channels.replacementRequestChannel) {
            return interaction.reply({ content: '❌ Replacement request channel is not configured. Please contact a bot administrator.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch the post to get its information
            const postResult = await fetchPost.getPost(postId);
            
            if (!postResult || !postResult.post) {
                return interaction.editReply({ content: `❌ Could not find post with ID ${postId}`, ephemeral: true });
            }

            const post = postResult.post;
            const embed = postResult.embed;

            // Create replacement request embed
            const requestEmbed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('🔄 Replacement Request')
                .setDescription(`A replacement has been requested for post #${postId}`)
                .addFields(
                    { name: 'Post ID', value: postId.toString(), inline: true },
                    { name: 'Requested by', value: `${interaction.user.displayName} (${interaction.user.id})`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Current Rating', value: post.rating?.toUpperCase() === 'E' ? '🔞 Explicit' : post.rating?.toUpperCase() === 'Q' ? '⚠️ Questionable' : post.rating?.toUpperCase() === 'S' ? '✅ Safe' : 'Unknown', inline: true },
                    { name: 'Current Status', value: post.flags?.deleted ? '🗑️ Deleted' : post.flags?.pending ? '⏳ Pending' : '✅ Approved', inline: true }
                )
                .setThumbnail(interaction.user.displayAvatarURL())
                .setTimestamp();

            // Add post image if available and not deleted
            if (post.file?.url && !post.flags?.deleted) {
                requestEmbed.setImage(post.file.url);
            }

            // Create buttons
            const visitButton = new ButtonBuilder()
                .setLabel('Visit post')
                .setURL(`https://e6ai.net/posts/${postId}`)
                .setStyle(ButtonStyle.Link)
                .setEmoji('🔗');

            // Create action row with visit button
            const actionRow = new ActionRowBuilder()
                .addComponents(visitButton);

            // Add action row for moderator buttons
            let moderatorActionRow = null;

            // Add decline and accept buttons if user is authorized
            if (DiscordIDs.length > 0 && DiscordIDs.includes(interaction.user.id)) {
                const declineButton = new ButtonBuilder()
                    .setCustomId(`decline_request:${postId}:${interaction.user.id}`)
                    .setLabel('DECLINE')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌');

                const acceptButton = new ButtonBuilder()
                    .setCustomId(`accept_request:${postId}:${interaction.user.id}`)
                    .setLabel('ACCEPT')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅');

                moderatorActionRow = new ActionRowBuilder()
                    .addComponents(declineButton, acceptButton);
            }

            // Get the replacement request channel
            const channel = await interaction.client.channels.fetch(config.channels.replacementRequestChannel);
            
            if (!channel) {
                return interaction.editReply({ content: '❌ Could not find the replacement request channel. Please contact a bot administrator.', ephemeral: true });
            }

            // Send the request to the channel with the file attachment and buttons
            const requestMessage = await channel.send({
                embeds: [requestEmbed],
                components: [actionRow, ...(moderatorActionRow ? [moderatorActionRow] : [])],
                files: [{
                    attachment: fileAttachment.url,
                    name: fileAttachment.name
                }]
            });

            // Send confirmation to the user
            await interaction.editReply({
                content: `✅ Your replacement request for post #${postId} has been submitted successfully! The file has been attached to the request message.\n\nPlease be patient as you will receive a message when a Janitor gets to your request.`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error processing requestreplace command:', error);
            
            let errorMessage = 'An error occurred while processing your replacement request.';
            if (error.message.includes('not found')) {
                errorMessage = `❌ Post ${postId} not found on e6AI`;
            } else if (error.message.includes('Access denied')) {
                errorMessage = '❌ Access denied - unable to fetch post information';
            } else {
                errorMessage += ` Error: ${error.message}`;
            }
            
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        }
    },
};