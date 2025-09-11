const { MessageFlags } = require('discord.js');

// Constants for file size limits (Discord's limits)
const FILE_SIZE_LIMITS = {
    DEFAULT: 8 * 1024 * 1024,        // 8MB default
    NITRO_BASIC: 50 * 1024 * 1024,   // 50MB for Nitro Basic
    NITRO: 100 * 1024 * 1024         // 100MB for Nitro
};

// Helper function for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Validates attachment file size
 * @param {Object} attachment - Discord attachment object
 * @returns {Object} - { valid: boolean, message?: string, size: number }
 */
function validateFileSize(attachment) {
    if (!attachment || !attachment.size) {
        return { valid: false, message: 'Invalid attachment or missing size information', size: 0 };
    }

    const size = attachment.size;
    
    // Use conservative 8MB limit as we don't know user's Nitro status
    if (size > FILE_SIZE_LIMITS.DEFAULT) {
        const sizeMB = (size / (1024 * 1024)).toFixed(1);
        return {
            valid: false,
            message: `File size (${sizeMB}MB) exceeds Discord's 8MB limit. Please use a smaller file.`,
            size: size
        };
    }

    return { valid: true, size: size };
}

/**
 * Validates attachment file type for replacement images
 * @param {Object} attachment - Discord attachment object
 * @returns {Object} - { valid: boolean, message?: string }
 */
function validateFileType(attachment) {
    if (!attachment || !attachment.name) {
        return { valid: false, message: 'Invalid attachment or missing filename' };
    }

    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const fileName = attachment.name.toLowerCase();
    const isValidType = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!isValidType) {
        return {
            valid: false,
            message: `Invalid file type. Please upload an image file (${allowedExtensions.join(', ')})`
        };
    }

    return { valid: true };
}

/**
 * Retry wrapper for Discord API calls with exponential backoff
 * @param {Function} apiCall - The API call function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} baseDelay - Base delay in milliseconds (default: 1000)
 * @returns {Promise} - The result of the API call
 */
async function retryDiscordCall(apiCall, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await apiCall();
        } catch (error) {
            lastError = error;
            
            // Don't retry on certain error types
            if (error.code === 50013 || // Missing Permissions
                error.code === 50001 || // Missing Access
                error.code === 10003 || // Unknown Channel
                error.code === 10008 || // Unknown Message
                error.code === 40005) { // Request entity too large
                throw error;
            }
            
            // Don't retry if this is the last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Calculate delay with exponential backoff and jitter
            const delayMs = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
            console.log(`Discord API call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs.toFixed(0)}ms...`);
            console.error('Error:', error.message);
            
            await delay(delayMs);
        }
    }
    
    throw lastError;
}

/**
 * Safe wrapper for sending messages with retry logic
 * @param {Object} channel - Discord channel object
 * @param {Object} messageOptions - Message options (embeds, files, components, etc.)
 * @returns {Promise<Message>} - The sent message
 */
async function sendMessageSafely(channel, messageOptions) {
    return retryDiscordCall(async () => {
        return await channel.send(messageOptions);
    });
}

/**
 * Safe wrapper for editing interactions with retry logic
 * @param {Object} interaction - Discord interaction object
 * @param {Object} editOptions - Edit options
 * @returns {Promise} - The edit result
 */
async function editInteractionSafely(interaction, editOptions) {
    return retryDiscordCall(async () => {
        return await interaction.editReply(editOptions);
    });
}

/**
 * Safe wrapper for fetching channels with retry logic
 * @param {Object} client - Discord client object
 * @param {string} channelId - Channel ID to fetch
 * @returns {Promise<Channel>} - The fetched channel
 */
async function fetchChannelSafely(client, channelId) {
    return retryDiscordCall(async () => {
        return await client.channels.fetch(channelId);
    });
}

module.exports = {
    FILE_SIZE_LIMITS,
    validateFileSize,
    validateFileType,
    retryDiscordCall,
    sendMessageSafely,
    editInteractionSafely,
    fetchChannelSafely,
    delay
};