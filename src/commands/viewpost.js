const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fetchPost = require('../utils/fetchPost');
const config = require('../../config.json');

/**
 * Helper function to check if API return printing is enabled
 * @returns {boolean} True if printReturn is enabled
 */
const shouldPrintApiReturns = () => {
  return config.api && config.api.printReturn === true;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewpost')
    .setDescription('View an e6AI post by ID or URL')
    .addStringOption(option =>
      option.setName('post')
        .setDescription('The post ID or e6AI URL')
        .setRequired(true)),
        
  async execute(interaction) {
    const input = interaction.options.getString('post');
    let postId = input;
    
    if (shouldPrintApiReturns()) {
      console.log(`Viewpost command called with input: ${input}`);
    }
    
    // Extract ID from URL if provided
    if (input.startsWith('http')) {
      const match = input.match(/\/posts\/(\d+)/);
      if (match && match[1]) {
        postId = match[1];
        if (shouldPrintApiReturns()) {
          console.log(`Extracted post ID ${postId} from URL`);
        }
      } else {
        if (shouldPrintApiReturns()) {
          console.log(`Invalid URL format: ${input}`);
        }
        return interaction.reply({content: '❌ Invalid e6AI URL format', ephemeral: true});
      }
    }
    
    // Validate postId is numeric
    if (!/^\d+$/.test(postId)) {
      if (shouldPrintApiReturns()) {
        console.log(`Invalid post ID format: ${postId}`);
      }
      return interaction.reply({content: '❌ Post ID must be a number', ephemeral: true});
    }
    
    try {
      // Show "Loading..." message
      await interaction.deferReply();
      if (shouldPrintApiReturns()) {
        console.log(`Fetching post ${postId}...`);
      }
      
      // Use the new API
      const result = await fetchPost.getPost(postId);
      
      if (shouldPrintApiReturns()) {
        console.log(`Post data received successfully`);
      }
      
      // Send the embed with the built-in "Visit post" button
      await interaction.editReply({
        embeds: [result.embed],
        components: result.components || []
      });
      
    } catch (error) {
      console.error(`Error in /viewpost command:`, error);
      await interaction.editReply(`❌ Error fetching post ${postId}: ${error.message}`);
    }
  },
};