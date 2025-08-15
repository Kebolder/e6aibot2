// Require the necessary discord.js classes
const { Client, Events, GatewayIntentBits } = require('discord.js');
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
                await interaction.followUp({ content: '❌ There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ There was an error while executing this command!', ephemeral: true });
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
                    ephemeral: true
                });
            }
        }

        // Handle decline button
        if (interaction.customId.startsWith('decline_request:')) {
            try {
                // Extract post ID and user ID from custom ID
                const [, postId, userId] = interaction.customId.split(':');
                
                // Show the decline modal
                await handleDecline.showDeclineModal(interaction, postId, userId);
            } catch (error) {
                console.error('Error handling decline button:', error);
                await interaction.reply({
                    content: '❌ An error occurred while processing your request.',
                    ephemeral: true
                });
            }
            return;
        }

        // Handle accept button
        if (interaction.customId.startsWith('accept_request:')) {
            try {
                // Process the accept request directly
                await handleDecline.processAccept(interaction, client);
            } catch (error) {
                console.error('Error handling accept button:', error);
                await interaction.reply({
                    content: '❌ An error occurred while processing your request.',
                    ephemeral: true
                });
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
                await interaction.reply({
                    content: '❌ An error occurred while processing your decline request.',
                    ephemeral: true
                });
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
