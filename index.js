// Require the necessary discord.js classes
const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Import the LinkListener
const LinkListener = require('./src/commands/LinkListener');

// Import config
const config = require('./config.json');

// Create LinkListener instance
const linkListener = new LinkListener();

// Import command deployer
const deployCommands = require('./deploy');

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, async readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    console.log(`Bot ID: ${readyClient.user.id}`);
    console.log(`Owner ID: ${process.env.OWNER_ID}`);
    
    // Deploy commands
    await deployCommands.execute(readyClient);
    
    console.log('LinkListener initialized - watching for e6ai.net links');
    
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT - shutting down gracefully...');
    
    
    // Destroy Discord client
    if (client) {
        console.log('Destroying Discord client...');
        await client.destroy();
    }
    
    console.log('Bot shutdown complete');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM - shutting down gracefully...');
    
    
    // Destroy Discord client
    if (client) {
        console.log('Destroying Discord client...');
        await client.destroy();
    }
    
    console.log('Bot shutdown complete');
    process.exit(0);
});

// Listen for messages and automatically process e6ai.net links
client.on(Events.MessageCreate, async message => {
    try {
        await linkListener.handleMessage(message);
    } catch (error) {
        console.error('Error handling message:', error);
    }
});

/**
 * Helper function to disable buttons on a message immediately after interaction
 * @param {Interaction} interaction - The button interaction
 */
async function disableButtonsOnMessage(interaction) {
    try {
        const message = interaction.message;
        if (!message || !message.components || message.components.length === 0) {
            return;
        }
        
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
        
        // Create new components with disabled buttons
        const updatedComponents = message.components.map(row => {
            const actionRow = ActionRowBuilder.from(row);
            
            // Update each button in the row
            const updatedButtons = row.components.map(component => {
                if (component.type === ComponentType.Button) {
                    // Handle differently based on button type
                    if (component.style === ButtonStyle.Link) {
                        // For link buttons, keep them as is
                        return ButtonBuilder.from(component);
                    } else {
                        // For non-link buttons, disable them and change style
                        const newButton = new ButtonBuilder()
                            .setCustomId(component.customId)
                            .setLabel(component.label + ' (Processing...)')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true);
                            
                        // Copy emoji if present
                        if (component.emoji) {
                            newButton.setEmoji(component.emoji);
                        }
                        
                        return newButton;
                    }
                }
                return component;
            });
            
            // Replace components in the action row
            return new ActionRowBuilder().addComponents(updatedButtons);
        });
        
        // Update the message with disabled buttons
        await message.edit({ components: updatedComponents });
        console.log('Buttons disabled on message:', message.id);
    } catch (error) {
        console.error('Error disabling buttons:', error);
        // Don't throw - this is a non-critical operation
    }
}

// Handle interactions (slash commands, buttons, modals)
client.on(Events.InteractionCreate, async interaction => {
    // Handle slash command interactions
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        
        if (!command) {
            console.error(`Command ${interaction.commandName} not found`);
            return;
        }
        
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing command ${interaction.commandName}:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '❌ There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: '❌ There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
        return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
        const handleDecline = require('./src/utils/handleDecline');
        const config = require('./config.json');
        const { DiscordIDs = [] } = config;

        // Check if user is authorized for moderator buttons
        if (DiscordIDs.length > 0 && !DiscordIDs.includes(interaction.user.id)) {
            // Check if this is a moderator button
            if (interaction.customId.startsWith('decline_request:') || interaction.customId.startsWith('accept_request:')) {
                return interaction.reply({
                    content: '❌ You are not authorized to use this button.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Handle decline button
        if (interaction.customId.startsWith('decline_request:')) {
            try {
                // Extract post ID and user ID from custom ID
                const [, postId, userId] = interaction.customId.split(':');
                
                // Immediately disable buttons on the message (fire and forget)
                disableButtonsOnMessage(interaction);
                
                // Show the decline modal
                await handleDecline.showDeclineModal(interaction, postId, userId);
            } catch (error) {
                console.error('Error handling decline button:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing your request.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
            return;
        }

        // Handle accept button
        if (interaction.customId.startsWith('accept_request:')) {
            try {
                // Immediately disable buttons on the message (fire and forget)
                disableButtonsOnMessage(interaction);
                
                // Process the accept request directly
                await handleDecline.processAccept(interaction, client);
            } catch (error) {
                console.error('Error handling accept button:', error);
                 if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing your request.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
            return;
        }

        // Handle undelete button
        if (interaction.customId.startsWith('undelete_post:')) {
            try {
                // Extract data from the custom ID
                const customId = interaction.customId;
                const [, postId, moderatorId] = customId.split(':');
                
                // Immediately disable buttons on the message (fire and forget)
                disableButtonsOnMessage(interaction);
                
                // Process the undeletion
                await handleDecline.handleUndeletePost(interaction, postId, moderatorId);
            } catch (error) {
                console.error('Error handling undelete button:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing your request.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
            return;
        }

        // Handle other buttons here if needed
        return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        // Handle decline reason modal
        if (interaction.customId.startsWith('decline_reason:')) {
            const handleDecline = require('./src/utils/handleDecline');
            
            try {
                await handleDecline.processDecline(interaction, client);
            } catch (error) {
                console.error('Error processing decline modal:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing your decline request.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
            return;
        }

        // Handle other modals here if needed
        return;
    }
});

// Cleanup rate limit data periodically
// LinkListenerConfig is no longer needed - cleanup interval is handled internally
setInterval(() => {
    linkListener.cleanup();
}, 3600000); // 1 hour cleanup interval

// Log in to Discord with your client's token
client.login(process.env.BOT_TOKEN);
