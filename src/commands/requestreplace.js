const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../../config.json');
const fetchPost = require('../utils/fetchPost');
const handleDecline = require('../utils/handleDecline');
const { validateFileSize, validateFileType, sendMessageSafely, editInteractionSafely, fetchChannelSafely, delay } = require('../utils/discordRetry');

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
            return interaction.reply({ content: '❌ Post ID must be a valid number', flags: MessageFlags.Ephemeral });
        }

        // Validate file size
        const fileSizeValidation = validateFileSize(fileAttachment);
        if (!fileSizeValidation.valid) {
            return interaction.reply({ content: `❌ ${fileSizeValidation.message}`, flags: MessageFlags.Ephemeral });
        }

        // Validate file type
        const fileTypeValidation = validateFileType(fileAttachment);
        if (!fileTypeValidation.valid) {
            return interaction.reply({ content: `❌ ${fileTypeValidation.message}`, flags: MessageFlags.Ephemeral });
        }

        // Check if replacement request channel is configured
        if (!config.channels || !config.channels.replacementRequestChannel) {
            return interaction.reply({ content: '❌ Replacement request channel is not configured. Please contact a bot administrator.', flags: MessageFlags.Ephemeral });
        }

        // Check if there's already an active request for this post/user combination
        const requestKey = `${postId}:${interaction.user.id}`;
        if (handleDecline.activeRequests.has(requestKey)) {
            const existingRequest = handleDecline.activeRequests.get(requestKey);
            if (existingRequest.status === 'pending' || Date.now() - existingRequest.timestamp < 300000) { // 5 minutes
                return interaction.reply({
                    content: '❌ You already have an active replacement request for this post. Please wait for it to be processed or declined before making another request.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Acquire lock for this post to prevent concurrent processing
        if (handleDecline.requestLocks.has(postId)) {
            return interaction.reply({
                content: '❌ This post is currently being processed. Please wait a moment and try again.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Add lock for this post
        handleDecline.requestLocks.add(postId);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Fetch the post to get its information
            const postResult = await fetchPost.getPost(postId);
            
            if (!postResult || !postResult.post) {
                return editInteractionSafely(interaction, { content: `❌ Could not find post with ID ${postId}` });
            }

            const post = postResult.post;

            // Get the replacement request channel with retry logic
            const channel = await fetchChannelSafely(interaction.client, config.channels.replacementRequestChannel);
            
            if (!channel) {
                return editInteractionSafely(interaction, { content: '❌ Could not find the replacement request channel. Please contact a bot administrator.' });
            }

            // 1. Send replacement image
            const replacementImageEmbed = new EmbedBuilder()
                .setTitle('REPLACEMENT IMAGE')
                .setColor(0xFFA500) // Orange
                .setImage(`attachment://${fileAttachment.name}`)
                .setFooter({ text: `For Post ID: ${postId}` });

            const replacementImageMessage = await sendMessageSafely(channel, {
                embeds: [replacementImageEmbed],
                files: [{
                    attachment: fileAttachment.url,
                    name: fileAttachment.name
                }]
            });

            await delay(200);

            // 2. Send original image
            const filterTags = Array.isArray(config.tagsToFilter)
                ? config.tagsToFilter.flatMap(tag => tag.split(',').map(t => t.trim()))
                : [];
            const shouldSpoiler = filterTags.length > 0 &&
                post.tags?.general?.some(tag => filterTags.includes(tag));

            let originalImageMessage = null;
            if (post.file?.url && !post.flags?.deleted && !shouldSpoiler) {
                const originalImageEmbed = new EmbedBuilder()
                    .setTitle('ORIGINAL IMAGE:')
                    .setURL(`https://e6ai.net/posts/${postId}`)
                    .setImage(post.file.url)
                    .setColor(0x0099ff); // Blue
                originalImageMessage = await sendMessageSafely(channel, { embeds: [originalImageEmbed] });
            }

            await delay(200);

            // 3. Send main request embed with buttons
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

            const visitButton = new ButtonBuilder()
                .setLabel('Visit post')
                .setURL(`https://e6ai.net/posts/${postId}`)
                .setStyle(ButtonStyle.Link)
                .setEmoji('🔗');

            const actionRow = new ActionRowBuilder().addComponents(visitButton);

            let moderatorActionRow = null;
            if (DiscordIDs.length > 0) {
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

                moderatorActionRow = new ActionRowBuilder().addComponents(declineButton, acceptButton);
            }

            const mainMessage = await sendMessageSafely(channel, {
                embeds: [requestEmbed],
                components: [actionRow, ...(moderatorActionRow ? [moderatorActionRow] : [])]
            });

            // Track this active request with all message IDs
            handleDecline.activeRequests.set(requestKey, {
                mainMessageId: mainMessage.id,
                replacementImageMessageId: replacementImageMessage.id,
                originalImageMessageId: originalImageMessage ? originalImageMessage.id : null,
                timestamp: Date.now(),
                status: 'pending',
                channelId: channel.id
            });

            // Send confirmation to the user
            await editInteractionSafely(interaction, {
                content: `✅ Your replacement request for post #${postId} has been submitted successfully! The file has been attached to the request message.\n\nPlease be patient as you will receive a message when a Janitor gets to your request.`
            });

            // Release lock after successful submission
            handleDecline.requestLocks.delete(postId);

        } catch (error) {
            console.error('Error processing requestreplace command:', error);
            
            // Release lock on error
            handleDecline.requestLocks.delete(postId);
            
            let errorMessage = 'An error occurred while processing your replacement request.';
            if (error.message.includes('not found')) {
                errorMessage = `❌ Post ${postId} not found on e6AI`;
            } else if (error.message.includes('Access denied')) {
                errorMessage = '❌ Access denied - unable to fetch post information';
            } else if (error.name === 'AbortError' || error.message.includes('aborted')) {
                errorMessage = '❌ Request timed out. This may be due to a large file size or network issues. Please try again with a smaller file.';
            } else if (error.code === 40005) {
                errorMessage = '❌ File too large. Discord has a file size limit. Please use a smaller image.';
            } else {
                errorMessage += ` Error: ${error.message}`;
            }
            
            await editInteractionSafely(interaction, { content: errorMessage });
        }
    },
};