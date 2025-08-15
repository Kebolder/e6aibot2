const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('../../config.json');
const replacePost = require('./replacePost');

/**
 * Creates and shows a modal for inputting decline reasons
 * @param {Object} interaction - The button interaction
 * @param {string} postId - The post ID from the original request
 * @param {string} userId - The user ID from the original request
 */
async function showDeclineModal(interaction, postId, userId) {
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
        console.error(`Error sending decline DM to user ${userId}:`, error);
        return false;
    }
}

/**
 * Replies to the original request message indicating it was declined and disables the decline button
 * @param {Object} channel - The channel where the original message was sent
 * @param {string} messageId - The ID of the original message
 * @param {string} postId - The post ID from the original request
 * @param {string} reason - The decline reason
 * @param {string} moderatorId - The ID of the moderator who declined the request
 */
async function replyToOriginalMessage(channel, messageId, postId, reason, moderatorId) {
    try {
        const originalMessage = await channel.messages.fetch(messageId);
        
        // Create reply embed
        const replyEmbed = new EmbedBuilder()
            .setColor(0xff9900) // Orange color
            .setTitle('⚠️ Request Declined')
            .setDescription(`Replacement request for post #${postId} has been declined.`)
            .addFields(
                { name: 'Declined by', value: `<@${moderatorId}>`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'e6AI Bot' });

        // Reply to the original message first
        await originalMessage.reply({ embeds: [replyEmbed] });

        // Now update the original message to disable both decline and accept buttons
        if (originalMessage.components && originalMessage.components.length > 0) {
            const updatedComponents = originalMessage.components.map(row => {
                if (row.components && row.components.length > 0) {
                    return ActionRowBuilder.from(row).addComponents(
                        row.components.map(component => {
                            if (component.type === ComponentType.Button) {
                                // Disable both decline and accept buttons
                                return ButtonBuilder.from(component)
                                    .setDisabled(true)
                                    .setStyle(ButtonStyle.Secondary)
                                    .setLabel(component.custom_id?.startsWith('decline_request:') ? 'DECLINED' : 'ACCEPTED');
                            }
                            return component;
                        })
                    );
                }
                return row;
            });

            // Update the original message with disabled button
            await originalMessage.edit({
                components: updatedComponents
            });
        }

        return true;
    } catch (error) {
        console.error(`Error replying to original message ${messageId}:`, error);
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

        const channel = await client.channels.fetch(config.channels.replacementRequestChannel);
        
        if (!channel) {
            return interaction.editReply({ 
                content: '❌ Could not find the replacement request channel. Please contact a bot administrator.', 
                ephemeral: true 
            });
        }

        // Find the original request message
        const messages = await channel.messages.fetch({ limit: 50 });
        const originalMessage = messages.find(msg => 
            msg.embeds.length > 0 && 
            msg.embeds[0].title === '🔄 Replacement Request' &&
            msg.embeds[0].fields.some(field => 
                field.name === 'Post ID' && field.value === postId
            )
        );

        if (!originalMessage) {
            return interaction.editReply({ 
                content: `❌ Could not find the original request message for post #${postId}.`, 
                ephemeral: true 
            });
        }

        // Send decline DM to the user
        const dmSent = await sendDeclineDM(client, userId, postId, reason);
        
        // Reply to the original message
        const replySent = await replyToOriginalMessage(channel, originalMessage.id, postId, reason, interaction.user.id);

        // Send confirmation to the moderator
        let confirmationMessage = `✅ Replacement request for post #${postId} has been declined.`;
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

    } catch (error) {
        console.error('Error processing decline request:', error);
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

        const channel = await client.channels.fetch(config.channels.replacementRequestChannel);
        
        if (!channel) {
            return interaction.editReply({
                content: '❌ Could not find the replacement request channel. Please contact a bot administrator.',
                ephemeral: true
            });
        }

        // Find the original request message
        const messages = await channel.messages.fetch({ limit: 50 });
        const originalMessage = messages.find(msg =>
            msg.embeds.length > 0 &&
            msg.embeds[0].title === '🔄 Replacement Request' &&
            msg.embeds[0].fields.some(field =>
                field.name === 'Post ID' && field.value === postId
            )
        );

        if (!originalMessage) {
            return interaction.editReply({
                content: `❌ Could not find the original request message for post #${postId}.`,
                ephemeral: true
            });
        }

        // Extract the file URL from the original message
        let fileUrl = null;
        if (originalMessage.attachments.size > 0) {
            const attachment = originalMessage.attachments.first();
            fileUrl = attachment.url;
        }

        if (!fileUrl) {
            return interaction.editReply({
                content: `❌ Could not find the replacement file in the original request for post #${postId}.`,
                ephemeral: true
            });
        }

        // Create a mock attachment object for the replacePost utility
        const imageAttachment = {
            url: fileUrl,
            name: originalMessage.attachments.first().name,
            contentType: originalMessage.attachments.first().contentType || 'image/png'
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

        // Send accept DM to the user
        const dmSent = await sendAcceptDM(client, userId, postId);
        
        // Reply to the original message and disable buttons
        const replySent = await replyToOriginalMessageAndDisableButtons(channel, originalMessage.id, postId, interaction.user.id);

        // Send confirmation to the moderator
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

    } catch (error) {
        console.error('Error processing accept request:', error);
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
        console.error(`Error sending accept DM to user ${userId}:`, error);
        return false;
    }
}

/**
 * Replies to the original request message indicating it was accepted and disables both buttons
 * @param {Object} channel - The channel where the original message was sent
 * @param {string} messageId - The ID of the original message
 * @param {string} postId - The post ID from the original request
 * @param {string} moderatorId - The ID of the moderator who accepted the request
 * @returns {Promise<boolean>} - True if operation was successful, false otherwise
 */
async function replyToOriginalMessageAndDisableButtons(channel, messageId, postId, moderatorId) {
    try {
        const originalMessage = await channel.messages.fetch(messageId);
        
        // Create reply embed
        const replyEmbed = new EmbedBuilder()
            .setColor(0x00ff00) // Green color
            .setTitle('✅ Request Accepted')
            .setDescription(`Replacement request for post #${postId} has been accepted and processed successfully.`)
            .addFields(
                { name: 'Accepted by', value: `<@${moderatorId}>`, inline: true },
                { name: 'Status', value: 'Replacement Complete', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'e6AI Bot' });

        // Reply to the original message first
        await originalMessage.reply({ embeds: [replyEmbed] });

        // Now update the original message to disable both decline and accept buttons
        if (originalMessage.components && originalMessage.components.length > 0) {
            const updatedComponents = originalMessage.components.map(row => {
                if (row.components && row.components.length > 0) {
                    return {
                        type: ComponentType.ActionRow,
                        components: row.components.map(component => {
                            if (component.type === ComponentType.Button) {
                                // Disable both decline and accept buttons
                                return {
                                    type: ComponentType.Button,
                                    custom_id: component.custom_id,
                                    disabled: true,
                                    style: ButtonStyle.Secondary, // Change color to indicate it's disabled
                                    label: component.custom_id?.startsWith('decline_request:') ? 'DECLINED' : 'ACCEPTED',
                                    emoji: component.emoji,
                                    url: component.url
                                };
                            }
                            return component;
                        })
                    };
                }
                return row;
            });

            // Update the original message with disabled buttons
            await originalMessage.edit({
                components: updatedComponents
            });
        }

        return true;
    } catch (error) {
        console.error(`Error replying to original message ${messageId}:`, error);
        return false;
    }
}

module.exports = {
    showDeclineModal,
    sendDeclineDM,
    replyToOriginalMessage,
    processDecline,
    processAccept,
    sendAcceptDM,
    replyToOriginalMessageAndDisableButtons
};