const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const packageJson = require('../../package.json');
const replacePost = require('../utils/replacePost');
const fetchPost = require('../utils/fetchPost');
const api = require('../utils/api');

const { DiscordIDs = [] } = config;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replace')
        .setDescription('Replaces an image for a given post ID (JANITOR ONLY)')
        .addStringOption(option =>
            option.setName('post_id')
                .setDescription('The ID of the post to replace.')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('The new image or video to upload.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the replacement (min 5 characters).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('source')
                .setDescription('The new source URL for the post.')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('as_pending')
                .setDescription('Submit the replacement as pending. (Default: false)')
                .setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

    async execute(interaction) {
        // Check user permissions
        if (DiscordIDs.length > 0 && !DiscordIDs.includes(interaction.user.id)) {
            await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            return;
        }

        const postId = interaction.options.getString('post_id');
        const imageAttachment = interaction.options.getAttachment('image');
        const reason = interaction.options.getString('reason');
        const source = interaction.options.getString('source');
        const asPending = interaction.options.getBoolean('as_pending') ?? false;

        await interaction.deferReply();

        try {
            // First, fetch the post to check its status (without username fetching)
            const postResult = await api.fetchPostData(postId);
            const post = api.extractPostFromResponse(postId, postResult);

            // Check if the post is deleted
            if (post.flags && post.flags.deleted) {
                // Ask for confirmation to undelete
                const confirmEmbed = new EmbedBuilder()
                    .setColor(0xff9900)
                    .setTitle('Post is Deleted')
                    .setDescription(`Post ${postId} is currently deleted. Would you like to undelete it before replacing the image?`)
                    .addFields(
                        { name: 'Post ID', value: postId.toString(), inline: true },
                        { name: 'Status', value: 'Deleted', inline: true },
                        { name: 'Action Required', value: 'Please confirm if you want to undelete this post', inline: false }
                    )
                    .setFooter({ text: 'Click the button below to confirm or cancel' });

                const confirmButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_undelete:${postId}`)
                            .setLabel('Confirm Undelete')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`cancel_undelete:${postId}`)
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Danger)
                    );

                const confirmationMessage = await interaction.editReply({
                    embeds: [confirmEmbed],
                    components: [confirmButton]
                });

                // Create a collector for the buttons
                const collector = confirmationMessage.createMessageComponentCollector({
                    time: 30000 // 30 seconds
                });

                collector.on('collect', async (buttonInteraction) => {
                    if (buttonInteraction.user.id !== interaction.user.id) {
                        await buttonInteraction.reply({
                            content: 'These buttons are not for you.',
                            ephemeral: true
                        });
                        return;
                    }

                    await buttonInteraction.deferUpdate();

                    if (buttonInteraction.customId.startsWith('confirm_undelete:')) {
                        try {
                            // Delete the confirmation embed
                            await interaction.deleteReply();

                            // Undelete the post
                            const undeleteResult = await replacePost.handlePostUndeletion(postId);
                            if (!undeleteResult.success) {
                                throw new Error(undeleteResult.error || 'Failed to undelete post');
                            }
                            
                            // If there was a warning about the Discord message, let the user know
                            if (undeleteResult.warning) {
                                console.log(undeleteResult.warning);
                            }

                            // Wait a moment for the undeletion to process
                            await new Promise(resolve => setTimeout(resolve, 2000));

                            // Now proceed with the replacement
                            await processReplacement(true);
                        } catch (error) {
                            console.error(`Error undeleting post ${postId}:`, error);
                            await interaction.followUp({
                                content: `Failed to undelete post: ${error.message}`,
                                ephemeral: true
                            });
                        }
                    } else if (buttonInteraction.customId.startsWith('cancel_undelete:')) {
                        // Delete the confirmation embed
                        await interaction.deleteReply();
                        await interaction.followUp({
                            content: 'Replacement cancelled.',
                            ephemeral: true
                        });
                    }
                });

                collector.on('end', async (collected, reason) => {
                    if (reason === 'time') {
                        try {
                            // Delete the timed out confirmation embed
                            await interaction.deleteReply();
                        } catch (error) {
                            console.error('Error deleting timed out message:', error);
                        }
                    }
                });

                return; // Exit here, don't proceed with replacement yet
            }

            // If not deleted, proceed directly with replacement
            await processReplacement();

        } catch (error) {
            console.error('Error processing replace command:', error);
            
            let errorMessage = 'An error occurred while trying to process the replacement.';
            if (error.message.includes('Invalid parameters') ||
                error.message.includes('not found') ||
                error.message.includes('Access denied')) {
                errorMessage = `❌ ${error.message}`;
            } else if (error.response) {
                errorMessage += ` API Error: ${error.response.status} - ${error.response.statusText}. `;
                if(error.response.data && (error.response.data.reason || error.response.data.message)) {
                    errorMessage += `Reason: ${error.response.data.reason || error.response.data.message}`;
                } else if (error.response.data) {
                    errorMessage += `Details: ${JSON.stringify(error.response.data).substring(0,500)}`;
                }
            } else if (error.request) {
                errorMessage += ' No response received from the API. Is the local server running and accessible?';
            } else {
                errorMessage += ` ${error.message}`;
            }
            
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        }

        async function processReplacement() {
            try {
                // Process the replacement using the new modular approach
                const replacementResult = await replacePost.processReplacement(
                    postId,
                    imageAttachment,
                    reason,
                    { source, asPending }
                );

                if (!replacementResult.success) {
                    throw new Error(replacementResult.error || 'Replacement failed');
                }

                // Show success confirmation
                const successEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('Post Successfully Replaced')
                    .setDescription(`Post ${postId} has been successfully replaced and updated on e6AI.net.`)
                    .setFooter({ text: 'Showing updated post below...' });

                await interaction.followUp({ embeds: [successEmbed] });

                // Refresh and display the updated post
                const updatedPostResult = await replacePost.refreshPostMessage(postId);
                
                // Create embed for the updated post
                const { embed } = updatedPostResult;
                
                const newMessage = await interaction.followUp({ embeds: [embed] });

            } catch (error) {
                console.error('Error in processReplacement:', error);
                throw error; // Re-throw to be caught by the outer try-catch
            }
        }
    },
};