const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('../../config.json');
const replacePost = require('./replacePost');
const fetchPost = require('./fetchPost');
const api = require('./api');

// In-memory storage for active requests to prevent duplicates and handle concurrency
const activeRequests = new Map(); // Key: `${postId}:${userId}`, Value: { messageId, timestamp, status }
const requestLocks = new Set(); // Keys for posts that are currently being processed

/**
 * Creates and shows a modal for inputting decline reasons
 * @param {Object} interaction - The button interaction
 * @param {string} postId - The post ID from the original request
 * @param {string} userId - The user ID from the original request
 */
async function showDeclineModal(interaction, postId, userId) {
    // Removed the active request check entirely for decline functionality
    // This allows users to decline their own requests if they have moderator permissions
    // Create the modal
    const modal = new ModalBuilder()
        .setCustomId(`decline_reason:${postId}:${userId}`)
        .setTitle('Decline Replacement Request');

    // Create the text input for decline reason
    const reasonInput = new TextInputBuilder()
        .setCustomId('decline_reason')
        .setLabel('Reason for declining the request')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Please provide a detailed reason for declining this replacement request...')
        .setRequired(true)
        .setMaxLength(1000);

    // Add the text input to an action row
    const reasonActionRow = new ActionRowBuilder().addComponents(reasonInput);

    // Add the action row to the modal
    modal.addComponents(reasonActionRow);

    // Show the modal to the user
    await interaction.showModal(modal);
}

/**
 * Sends a decline DM to the user who made the request
 * @param {Object} client - The Discord client
 * @param {string} userId - The ID of the user to DM
 * @param {string} postId - The post ID from the original request
 * @param {string} reason - The decline reason
 * @returns {Promise<boolean>} - True if DM was sent successfully, false otherwise
 */
async function sendDeclineDM(client, userId, postId, reason) {
    try {
        const user = await client.users.fetch(userId);
        
        const declineEmbed = new EmbedBuilder()
            .setColor(0xff0000) // Red color
            .setTitle('❌ Replacement Request Declined')
            .setDescription(`Your replacement request for post #${postId} has been declined.`)
            .addFields(
                { name: 'Post ID', value: postId.toString(), inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'e6AI Bot' });

        // Create a "View Post" button
        const viewPostButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('View Post')
                    .setURL(`https://e6ai.net/posts/${postId}`)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🔗')
            );

        await user.send({
            embeds: [declineEmbed],
            components: [viewPostButton]
        });
        return true;
    } catch (error) {
        // Handle specific DM blocking error more gracefully
        if (error.code === 50007) {
            console.log(`Cannot DM user ${userId} - they have DMs disabled or have blocked the bot`);
        } else {
            console.error(`Error sending decline DM to user ${userId}:`, error);
        }
        return false;
    }
}

/**
 * Posts a decline notification in the channel
 * @param {Object} channel - The channel where to post the notification
 * @param {string} messageId - The ID of the original message
 * @param {string} postId - The post ID from the original request
 * @param {string} reason - The decline reason
 * @param {string} moderatorId - The ID of the moderator who declined the request
 * @param {string} requesterId - The ID of the user who made the request
 * @returns {Promise<boolean>} - True if notification was sent successfully, false otherwise
 */
async function postDeclineNotification(channel, messageId, postId, reason, moderatorId, requesterId) {
    try {
        // Create a decline notification embed
        const declineEmbed = new EmbedBuilder()
            .setColor(0xff0000) // Red color
            .setTitle('❌ Replacement Request Declined')
            .setDescription(`Replacement request for post #${postId} has been declined by <@${moderatorId}>`)
            .addFields(
                { name: 'Post ID', value: postId.toString(), inline: true },
                { name: 'Requested by', value: `<@${requesterId}>`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'e6AI Bot' });

        // Create a "View Post" button
        const viewPostButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('View Post')
                    .setURL(`https://e6ai.net/posts/${postId}`)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🔗')
            );

        // Send the notification to the channel
        await channel.send({
            embeds: [declineEmbed],
            components: [viewPostButton]
        });
        
        console.log(`Request for post #${postId} declined by moderator ${moderatorId}`);
        return true;
    } catch (error) {
        console.error(`Error posting decline notification for message ${messageId}:`, error);
        return false;
    }
}

/**
 * Processes a decline request
 * @param {Object} interaction - The modal submit interaction
 * @param {Object} client - The Discord client
 */
async function processDecline(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    try {
        // Extract data from the custom ID
        const customId = interaction.customId;
        const [, postId, userId] = customId.split(':');

        // Get the decline reason from the modal
        const reason = interaction.fields.getTextInputValue('decline_reason');

        // Get the replacement request channel
        if (!config.channels || !config.channels.replacementRequestChannel) {
            return interaction.editReply({ 
                content: '❌ Replacement request channel is not configured. Please contact a bot administrator.', 
                ephemeral: true 
            });
        }

        const channel = await interaction.client.channels.fetch(config.channels.replacementRequestChannel);
        
        if (!channel) {
            return interaction.editReply({ 
                content: '❌ Could not find the replacement request channel. Please contact a bot administrator.', 
                ephemeral: true 
            });
        }

        // Find the original request message with a broader search
        const messages = await channel.messages.fetch({ limit: 100 });
        let originalMessage = messages.find(msg =>
            msg.embeds.length > 0 &&
            msg.embeds[0].title === '🔄 Replacement Request' &&
            msg.embeds[0].fields.some(field =>
                field.name === 'Post ID' && field.value === postId
            )
        );

        if (!originalMessage) {
            // Try alternative search methods if the first attempt fails
            console.log(`First search failed for post #${postId}, trying alternative search...`);
            
            // Search for messages with the post ID in any field or content
            const altMessage = messages.find(msg =>
                msg.content.includes(postId) ||
                msg.embeds.some(embed =>
                    embed.fields.some(field =>
                        field.value === postId || field.name === 'Post ID'
                    )
                )
            );
            
            if (altMessage) {
                console.log(`Found alternative message for post #${postId}: ${altMessage.id}`);
                originalMessage = altMessage;
            }
        }

        if (!originalMessage) {
            console.error(`Could not find original request message for post #${postId} after searching ${messages.size} messages`);
            return interaction.editReply({
                content: `❌ Could not find the original request message for post #${postId}. The message may have been deleted or is too old.`,
                ephemeral: true
            });
        }

        // Send decline DM to the user
        const dmSent = await sendDeclineDM(client, userId, postId, reason);
        
        // Post a decline notification in the channel
        const notificationSent = await postDeclineNotification(channel, originalMessage.id, postId, reason, interaction.user.id, userId);

        // Send confirmation to the moderator
        let confirmationMessage = `✅ Replacement request for post #${postId} has been declined.`;
        if (!dmSent) {
            confirmationMessage += '\n⚠️ Failed to send DM to the user (they may have DMs disabled).';
        }
        if (!notificationSent) {
            confirmationMessage += '\n⚠️ Failed to post the decline notification.';
        }
        
        await interaction.editReply({
            content: confirmationMessage,
            ephemeral: true
        })

        // Clean up the original request message and associated images
        try {
            await originalMessage.delete();
            console.log(`Cleaned up replacement request message for post #${postId}`);

            // Find and delete the replacement image message
            try {
                const replacementImageMessage = messages.find(msg =>
                    msg.author.id === interaction.client.user.id &&
                    msg.embeds.length > 0 &&
                    msg.embeds[0].title === 'REPLACEMENT IMAGE' &&
                    msg.embeds[0].footer?.text === `For Post ID: ${postId}`
                );

                if (replacementImageMessage) {
                    await replacementImageMessage.delete();
                    console.log(`Cleaned up replacement image message for post #${postId}`);
                }
            } catch (imgError) {
                console.warn(`Failed to delete replacement image message for post #${postId}:`, imgError.message);
            }

            // Find and delete the original image message if it exists
            try {
                const originalImageMessage = messages.find(msg =>
                    msg.author.id === interaction.client.user.id &&
                    msg.embeds.length > 0 &&
                    (msg.embeds[0].title === 'ORIGINAL IMAGE:' || msg.embeds[0].title === 'ORIGINAL IMAGE (DELETED):') &&
                    msg.embeds[0].url === `https://e6ai.net/posts/${postId}`
                );

                if (originalImageMessage) {
                    await originalImageMessage.delete();
                    console.log(`Cleaned up original image message for post #${postId}`);
                }
            } catch (origImgError) {
                console.warn(`Failed to delete original image message for post #${postId}:`, origImgError.message);
            }

            // Remove from active requests and release lock
            const requestKey = `${postId}:${userId}`;
            activeRequests.delete(requestKey);

            // Release the lock on this post
            if (requestLocks.has(postId)) {
                requestLocks.delete(postId);
                console.log(`Released lock for post #${postId}`);
            }
        } catch (cleanupError) {
            console.warn(`Failed to clean up original request message for post #${postId}:`, cleanupError.message);
        }

        // Reply already sent above

    } catch (error) {
        console.error('Error processing decline request:', error);
        
        // Make sure to release lock even on error
        if (postId && requestLocks.has(postId)) {
            requestLocks.delete(postId);
            console.log(`Released lock for post #${postId} after error`);
        }
        
        await interaction.editReply({ 
            content: `❌ An error occurred while processing the decline request: ${error.message}`, 
            ephemeral: true 
        });
    }
}

/**
 * Processes an accept request
 * @param {Object} interaction - The button interaction
 * @param {Object} client - The Discord client
 */
async function processAccept(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    try {
        // Extract data from the custom ID
        const customId = interaction.customId;
        const [, postId, userId] = customId.split(':');

        // Get the replacement request channel
        if (!config.channels || !config.channels.replacementRequestChannel) {
            return interaction.editReply({
                content: '❌ Replacement request channel is not configured. Please contact a bot administrator.',
                ephemeral: true
            });
        }

        const channel = await interaction.client.channels.fetch(config.channels.replacementRequestChannel);
        
        if (!channel) {
            return interaction.editReply({
                content: '❌ Could not find the replacement request channel. Please contact a bot administrator.',
                ephemeral: true
            });
        }

        // Find the original request message with a broader search
        const messages = await channel.messages.fetch({ limit: 100 });
        let originalMessage = messages.find(msg =>
            msg.embeds.length > 0 &&
            msg.embeds[0].title === '🔄 Replacement Request' &&
            msg.embeds[0].fields.some(field =>
                field.name === 'Post ID' && field.value === postId
            )
        );

        if (!originalMessage) {
            // Try alternative search methods if the first attempt fails
            console.log(`First search failed for post #${postId}, trying alternative search...`);
            
            // Search for messages with the post ID in any field or content
            const altMessage = messages.find(msg =>
                msg.content.includes(postId) ||
                msg.embeds.some(embed =>
                    embed.fields.some(field =>
                        field.value === postId || field.name === 'Post ID'
                    )
                )
            );
            
            if (altMessage) {
                console.log(`Found alternative message for post #${postId}: ${altMessage.id}`);
                originalMessage = altMessage;
            }
        }

        if (!originalMessage) {
            console.error(`Could not find original request message for post #${postId} after searching ${messages.size} messages`);
            return interaction.editReply({
                content: `❌ Could not find the original request message for post #${postId}. The message may have been deleted or is too old.`,
                ephemeral: true
            });
        }

        // --- New logic to find replacement file ---

        // Find the replacement image message using the new method (with footer)
        let replacementImageMessage = messages.find(msg =>
            msg.author.id === interaction.client.user.id &&
            msg.embeds.length > 0 &&
            msg.embeds[0].title === 'REPLACEMENT IMAGE' &&
            msg.embeds[0].footer?.text === `For Post ID: ${postId}`
        );

        if (!replacementImageMessage) {
            // Fallback for older requests
            console.log(`Could not find new replacement message for post #${postId}, trying fallback...`);
            const messagesBefore = await channel.messages.fetch({ before: originalMessage.id, limit: 5 });
            replacementImageMessage = messagesBefore.find(msg =>
                msg.author.id === interaction.client.user.id &&
                msg.embeds.length > 0 &&
                (msg.embeds[0].title === 'REPLACEMENT IMAGE' || msg.embeds[0].title === 'REPLACEMENT IMAGE:') &&
                msg.embeds[0].image?.url
            );
        }

        if (!replacementImageMessage) {
            return interaction.editReply({
                content: `❌ Could not find the replacement file in the original request for post #${postId}. The message may be too old or the bot might have been updated.`,
                ephemeral: true
            });
        }

        const replacementEmbed = replacementImageMessage.embeds[0];
        const imageUrl = replacementEmbed.image?.url;

        if (!imageUrl) {
            return interaction.editReply({
                content: `❌ Could not find the replacement file in the original request for post #${postId}. The image URL was missing from the embed.`,
                ephemeral: true
            });
        }

        // Create a mock attachment object from the embed image URL
        const url = new URL(imageUrl);
        const name = url.pathname.split('/').pop();
        const imageAttachment = {
            url: imageUrl,
            name: name,
            contentType: 'image/png' // Assuming png, as we can't know for sure
        };

        // Check if the post is deleted
        const postResult = await fetchPost.getPost(postId);
        const isPostDeleted = postResult.post?.flags?.deleted;

        if (isPostDeleted) {
            // Post is deleted, show undelete button instead of proceeding with replacement
            const undeleteButton = new ButtonBuilder()
                .setCustomId(`undelete_post:${postId}:${interaction.user.id}`)
                .setLabel('UNDELETE POST')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔄');

            const undeleteActionRow = new ActionRowBuilder()
                .addComponents(undeleteButton);

            // Update the original message to show undelete option
            await originalMessage.edit({
                content: `⚠️ Post #${postId} is currently deleted. Please click the button below to undelete it before proceeding with the replacement.`,
                components: [undeleteActionRow]
            });

            await interaction.editReply({
                content: `📋 Post #${postId} is currently deleted. An 'UNDELETE POST' button has been added to the request message. Please click it first to undelete the post, then I can proceed with the replacement.`,
                ephemeral: true
            });

            return;
        }

        // Process the replacement using the replacePost utility
        const replacementResult = await replacePost.processReplacement(
            postId,
            imageAttachment,
            'Discord Bot replacement',
            {
                asPending: true,  // Set as_pending to true by default
                source: undefined // No source provided
            }
        );

        if (!replacementResult.success) {
            throw new Error(replacementResult.error || 'Replacement failed');
        }

        // Send accept DM to the user
        const dmSent = await sendAcceptDM(client, userId, postId);
        
        // Post acceptance notification in the channel
        const notificationSent = await postAcceptanceNotification(channel, postId, interaction.user.id, userId, 'accept');
        
        // Reply to the original message and disable buttons
        const replySent = await replyToOriginalMessageAndDisableButtons(channel, originalMessage.id, postId, interaction.user.id);

        // Send confirmation to the moderator first, before deleting the message
        let confirmationMessage = `✅ Replacement request for post #${postId} has been accepted and processed successfully.`;
        if (!dmSent) {
            confirmationMessage += '\n⚠️ Failed to send DM to the user (they may have DMs disabled).';
        }
        if (!replySent) {
            confirmationMessage += '\n⚠️ Failed to reply to the original message.';
        }
        
        await interaction.editReply({
            content: confirmationMessage,
            ephemeral: true
        });

        // Clean up the original request message and associated images
        try {
            await originalMessage.delete();
            console.log(`Cleaned up replacement request message for post #${postId}`);

            // Also delete the replacement image message
            if (replacementImageMessage) {
                try {
                    await replacementImageMessage.delete();
                    console.log(`Cleaned up replacement image message for post #${postId}`);
                } catch (imgError) {
                    console.warn(`Failed to delete replacement image message for post #${postId}:`, imgError.message);
                }
            }

            // Find and delete the original image message if it exists
            try {
                const originalImageMessage = messages.find(msg =>
                    msg.author.id === interaction.client.user.id &&
                    msg.embeds.length > 0 &&
                    (msg.embeds[0].title === 'ORIGINAL IMAGE:' || msg.embeds[0].title === 'ORIGINAL IMAGE (DELETED):') &&
                    msg.embeds[0].url === `https://e6ai.net/posts/${postId}`
                );

                if (originalImageMessage) {
                    await originalImageMessage.delete();
                    console.log(`Cleaned up original image message for post #${postId}`);
                }
            } catch (origImgError) {
                console.warn(`Failed to delete original image message for post #${postId}:`, origImgError.message);
            }

            // Remove from active requests and release lock
            const requestKey = `${postId}:${userId}`;
            activeRequests.delete(requestKey);

            // Release the lock on this post
            if (requestLocks.has(postId)) {
                requestLocks.delete(postId);
                console.log(`Released lock for post #${postId}`);
            }
        } catch (cleanupError) {
            console.warn(`Failed to clean up original request message for post #${postId}:`, cleanupError.message);
        }

        // Reply already sent above

    } catch (error) {
        console.error('Error processing accept request:', error);
        
        // Make sure to release lock even on error
        if (postId && requestLocks.has(postId)) {
            requestLocks.delete(postId);
            console.log(`Released lock for post #${postId} after error`);
        }
        
        await interaction.editReply({
            content: `❌ An error occurred while processing the accept request: ${error.message}`,
            ephemeral: true
        });
    }
}

/**
 * Sends an accept DM to the user who made the request
 * @param {Object} client - The Discord client
 * @param {string} userId - The ID of the user to DM
 * @param {string} postId - The post ID from the original request
 * @returns {Promise<boolean>} - True if DM was sent successfully, false otherwise
 */
async function sendAcceptDM(client, userId, postId) {
    try {
        const user = await client.users.fetch(userId);
        
        const acceptEmbed = new EmbedBuilder()
            .setColor(0x00ff00) // Green color
            .setTitle('✅ Replacement Request Accepted')
            .setDescription(`Your replacement request for post #${postId} has been accepted and processed successfully.`)
            .addFields(
                { name: 'Post ID', value: postId.toString(), inline: true },
                { name: 'Status', value: 'Replacement Complete', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'e6AI Bot' });

        // Create a "View Post" button
        const viewPostButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('View Post')
                    .setURL(`https://e6ai.net/posts/${postId}`)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🔗')
            );

        await user.send({
            embeds: [acceptEmbed],
            components: [viewPostButton]
        });
        return true;
    } catch (error) {
        // Handle specific DM blocking error more gracefully
        if (error.code === 50007) {
            console.log(`Cannot DM user ${userId} - they have DMs disabled or have blocked the bot`);
        } else {
            console.error(`Error sending accept DM to user ${userId}:`, error);
        }
        return false;
    }
}

/**
 * Previously replied to the original request message, but now just logs the action
 * @param {Object} channel - The channel where the original message was sent
 * @param {string} messageId - The ID of the original message
 * @param {string} postId - The post ID from the original request
 * @param {string} moderatorId - The ID of the moderator who accepted the request
 * @returns {Promise<boolean>} - True if operation was successful, false otherwise
 */
async function replyToOriginalMessageAndDisableButtons(channel, messageId, postId, moderatorId) {
    try {
        // We no longer reply to or edit the original message since it will be deleted
        console.log(`Request for post #${postId} accepted by moderator ${moderatorId}`);
        return true;
    } catch (error) {
        console.error(`Error processing accept for message ${messageId}:`, error);
        return false;
    }
}

/**
 * Handles the undeletion of a post and then processes the replacement
 * @param {Object} interaction - The button interaction
 * @param {string} postId - The post ID to undelete
 * @param {string} moderatorId - The ID of the moderator who initiated the undeletion
 */
async function handleUndeletePost(interaction, postId, moderatorId) {
    await interaction.deferReply({ ephemeral: true });

    try {
        // Get the replacement request channel
        if (!config.channels || !config.channels.replacementRequestChannel) {
            return interaction.editReply({
                content: '❌ Replacement request channel is not configured. Please contact a bot administrator.',
                ephemeral: true
            });
        }

        const channel = await interaction.client.channels.fetch(config.channels.replacementRequestChannel);
        
        if (!channel) {
            return interaction.editReply({
                content: '❌ Could not find the replacement request channel. Please contact a bot administrator.',
                ephemeral: true
            });
        }

        // Find the original request message with a broader search
        const messages = await channel.messages.fetch({ limit: 100 });
        let originalMessage = messages.find(msg =>
            msg.embeds.length > 0 &&
            msg.embeds[0].title === '🔄 Replacement Request' &&
            msg.embeds[0].fields.some(field =>
                field.name === 'Post ID' && field.value === postId
            )
        );

        if (!originalMessage) {
            // Try alternative search methods if the first attempt fails
            console.log(`First search failed for post #${postId}, trying alternative search...`);
            
            // Search for messages with the post ID in any field or content
            const altMessage = messages.find(msg =>
                msg.content.includes(postId) ||
                msg.embeds.some(embed =>
                    embed.fields.some(field =>
                        field.value === postId || field.name === 'Post ID'
                    )
                )
            );
            
            if (altMessage) {
                console.log(`Found alternative message for post #${postId}: ${altMessage.id}`);
                originalMessage = altMessage;
            }
        }

        if (!originalMessage) {
            console.error(`Could not find original request message for post #${postId} after searching ${messages.size} messages`);
            return interaction.editReply({
                content: `❌ Could not find the original request message for post #${postId}. The message may have deleted or is too old.`,
                ephemeral: true
            });
        }

        // Attempt to undelete the post
        const undeleteResult = await replacePost.handlePostUndeletion(postId);

        if (!undeleteResult.success) {
            throw new Error(undeleteResult.error || 'Failed to undelete post');
        }

        // --- New logic to find replacement file ---

        // Find the replacement image message using the new method (with footer)
        let replacementImageMessage = messages.find(msg =>
            msg.author.id === interaction.client.user.id &&
            msg.embeds.length > 0 &&
            msg.embeds[0].title === 'REPLACEMENT IMAGE' &&
            msg.embeds[0].footer?.text === `For Post ID: ${postId}`
        );

        if (!replacementImageMessage) {
            // Fallback for older requests
            console.log(`Could not find new replacement message for post #${postId}, trying fallback...`);
            const messagesBefore = await channel.messages.fetch({ before: originalMessage.id, limit: 5 });
            replacementImageMessage = messagesBefore.find(msg =>
                msg.author.id === interaction.client.user.id &&
                msg.embeds.length > 0 &&
                (msg.embeds[0].title === 'REPLACEMENT IMAGE' || msg.embeds[0].title === 'REPLACEMENT IMAGE:') &&
                msg.embeds[0].image?.url
            );
        }

        if (!replacementImageMessage) {
            return interaction.editReply({
                content: `❌ Could not find the replacement file in the original request for post #${postId}. The message may be too old or the bot might have been updated.`,
                ephemeral: true
            });
        }

        const replacementEmbed = replacementImageMessage.embeds[0];
        const imageUrl = replacementEmbed.image?.url;

        if (!imageUrl) {
            return interaction.editReply({
                content: `❌ Could not find the replacement file in the original request for post #${postId}. The image URL was missing from the embed.`,
                ephemeral: true
            });
        }

        // Create a mock attachment object from the embed image URL
        const url = new URL(imageUrl);
        const name = url.pathname.split('/').pop();
        const imageAttachment = {
            url: imageUrl,
            name: name,
            contentType: 'image/png' // Assuming png, as we can't know for sure
        };

        // Process the replacement using the replacePost utility
        const replacementResult = await replacePost.processReplacement(
            postId,
            imageAttachment,
            'Discord Bot replacement',
            {
                asPending: true,  // Set as_pending to true by default
                source: undefined // No source provided
            }
        );

        if (!replacementResult.success) {
            throw new Error(replacementResult.error || 'Replacement failed');
        }

        // Send confirmation DM to the original request user (if we can get it)
        const originalEmbed = originalMessage.embeds[0];
        const requestedByField = originalEmbed.fields.find(field => field.name === 'Requested by');
        let originalUserId = null;
        if (requestedByField) {
            const userIdMatch = requestedByField.value.match(/\((\d+)\)/);
            if (userIdMatch) {
                originalUserId = userIdMatch[1];
            }
        }

        if (originalUserId) {
            try {
                await sendAcceptDM(interaction.client, originalUserId, postId);
            } catch (dmError) {
                console.error(`Failed to send DM to user ${originalUserId}:`, dmError);
            }
        }
        
        // Reply to the original message and disable buttons
        const replySent = await replyToOriginalMessageAndDisableButtons(channel, originalMessage.id, postId, moderatorId);

        // Post acceptance notification in the channel
        const notificationSent = await postAcceptanceNotification(channel, postId, moderatorId, originalUserId, 'undelete');

        // Send confirmation to the moderator first, before deleting the message
        let confirmationMessage = `✅ Post #${postId} has been undeleted and the replacement has been processed successfully!`;
        if (undeleteResult.warning) {
            confirmationMessage += `\n⚠️ ${undeleteResult.warning}`;
        }
        if (!replySent) {
            confirmationMessage += '\n⚠️ Failed to reply to the original message.';
        }
        
        await interaction.editReply({
            content: confirmationMessage,
            ephemeral: true
        });
        
        // Clean up the original request message and associated images
        try {
            await originalMessage.delete();
            console.log(`Cleaned up replacement request message for post #${postId}`);

            // Also delete the replacement image message
            if (replacementImageMessage) {
                try {
                    await replacementImageMessage.delete();
                    console.log(`Cleaned up replacement image message for post #${postId}`);
                } catch (imgError) {
                    console.warn(`Failed to delete replacement image message for post #${postId}:`, imgError.message);
                }
            }

            // Find and delete the original image message if it exists
            try {
                const originalImageMessage = messages.find(msg =>
                    msg.author.id === interaction.client.user.id &&
                    msg.embeds.length > 0 &&
                    (msg.embeds[0].title === 'ORIGINAL IMAGE:' || msg.embeds[0].title === 'ORIGINAL IMAGE (DELETED):') &&
                    msg.embeds[0].url === `https://e6ai.net/posts/${postId}`
                );

                if (originalImageMessage) {
                    await originalImageMessage.delete();
                    console.log(`Cleaned up original image message for post #${postId}`);
                }
            } catch (origImgError) {
                console.warn(`Failed to delete original image message for post #${postId}:`, origImgError.message);
            }
        } catch (cleanupError) {
            console.warn(`Failed to clean up original request message for post #${postId}:`, cleanupError.message);
        }

        // Reply already sent above

    } catch (error) {
        console.error('Error processing undelete request:', error);
        
        // Make sure to release lock even on error
        if (postId && requestLocks.has(postId)) {
            requestLocks.delete(postId);
            console.log(`Released lock for post #${postId} after error`);
        }
        
        await interaction.editReply({
            content: `❌ An error occurred while processing the undelete request: ${error.message}`,
            ephemeral: true
        });
    }
}

/**
 * Automatically clean up stale locks and requests
 * This runs periodically to ensure no locks get stuck
 */
function cleanupStaleLocks() {
    const now = Date.now();
    const staleThreshold = 15 * 60 * 1000; // 15 minutes
    let clearedLocks = 0;
    let clearedRequests = 0;
    
    // Clean up stale request locks
    for (const postId of requestLocks) {
        // Since we don't store timestamps with locks, 
        // we'll check if there's a corresponding active request
        let hasActiveRequest = false;
        for (const [key, value] of activeRequests.entries()) {
            if (key.startsWith(`${postId}:`)) {
                hasActiveRequest = true;
                break;
            }
        }
        
        // If no active request, clear the lock
        if (!hasActiveRequest) {
            requestLocks.delete(postId);
            console.log(`Auto-cleared stale lock for post #${postId}`);
            clearedLocks++;
        }
    }
    
    // Clean up stale active requests
    for (const [key, request] of activeRequests.entries()) {
        // Check if request is older than threshold
        if (now - request.timestamp > staleThreshold) {
            activeRequests.delete(key);
            console.log(`Auto-cleared stale request: ${key}`);
            clearedRequests++;
            
            // Also clear any associated lock
            const postId = key.split(':')[0];
            if (requestLocks.has(postId)) {
                requestLocks.delete(postId);
                console.log(`Auto-cleared associated lock for post #${postId}`);
                clearedLocks++;
            }
        }
    }
    
    if (clearedLocks > 0 || clearedRequests > 0) {
        console.log(`Auto-cleanup completed: cleared ${clearedLocks} locks and ${clearedRequests} stale requests`);
    }
}

// Run cleanup immediately on module load
cleanupStaleLocks();

// Then run cleanup every 5 minutes
setInterval(cleanupStaleLocks, 5 * 60 * 1000);

/**
 * Posts an acceptance notification in the channel
 * @param {Object} channel - The channel where to post the notification
 * @param {string} postId - The post ID from the original request
 * @param {string} moderatorId - The ID of the moderator who accepted the request
 * @param {string} requesterId - The ID of the user who made the request
 * @param {string} actionType - Type of action ('accept' or 'undelete')
 * @returns {Promise<boolean>} - True if notification was sent successfully, false otherwise
 */
async function postAcceptanceNotification(channel, postId, moderatorId, requesterId, actionType = 'accept') {
    try {
        const actionEmoji = actionType === 'undelete' ? '🔄' : '✅';
        const actionTitle = actionType === 'undelete' ? 'Post Undeleted & Replacement Processed' : 'Replacement Request Accepted';
        
        // Create an acceptance notification embed
        const acceptEmbed = new EmbedBuilder()
            .setColor(0x00ff00) // Green color
            .setTitle(`${actionEmoji} ${actionTitle}`)
            .setDescription(`${actionType === 'undelete' ? 'Post undeleted and replacement processed' : 'Replacement request processed'} for post #${postId} by <@${moderatorId}>`)
            .addFields(
                { name: 'Post ID', value: postId.toString(), inline: true },
                { name: 'Requested by', value: `<@${requesterId}>`, inline: true },
                { name: 'Status', value: 'Complete', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'e6AI Bot' });

        // Create a "Visit Post" button
        const visitPostButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Visit Post')
                    .setURL(`https://e6ai.net/posts/${postId}`)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🔗')
            );

        // Send the notification to the channel
        await channel.send({
            embeds: [acceptEmbed],
            components: [visitPostButton]
        });
        
        console.log(`${actionType} notification posted for post #${postId} by moderator ${moderatorId}`);
        return true;
    } catch (error) {
        console.error(`Error posting ${actionType} notification for post ${postId}:`, error);
        return false;
    }
}

module.exports = {
    showDeclineModal,
    sendDeclineDM,
    postDeclineNotification,
    processDecline,
    processAccept,
    sendAcceptDM,
    replyToOriginalMessageAndDisableButtons,
    handleUndeletePost,
    postAcceptanceNotification,
    activeRequests,
    requestLocks
};