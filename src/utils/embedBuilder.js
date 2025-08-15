const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dtextFormatter = require('./dtextFormatter');
const api = require('./api');
const config = require('../../config.json');
const packageJson = require('../../package.json');

/**
 * Create a post embed with customizable options
 * @param {Object} post - The post data from e6AI API
 * @param {Object} options - Configuration options
 * @param {boolean} options.includeDescription - Include post description
 * @param {string} options.customColor - Custom embed color
 * @param {boolean} options.hyperlinkUsernames - Create hyperlinks for usernames
 * @param {boolean} options.includeButton - Include the "Visit post" button (default: true)
 * @returns {Promise<{embed: EmbedBuilder, shouldSpoiler: boolean, components: Array|null}>} The configured embed, spoiler flag, and components
 */
module.exports.createPostEmbed = async (post, options = {}) => {
  const {
    includeDescription = true,
    customColor,
    hyperlinkUsernames = true,
    includeButton = true
  } = options;

  // Check if any filtered tags are present in the post's general tags
  // Handle both array format and single string with comma-separated tags
  const filterTags = Array.isArray(config.tagsToFilter)
    ? config.tagsToFilter.flatMap(tag => tag.split(',').map(t => t.trim()))
    : [];
  
  const shouldSpoiler = filterTags.length > 0 &&
    post.tags?.general?.some(tag => filterTags.includes(tag));

  // Fetch usernames for uploader and approver
  let uploaderUsername = post.uploader_id;
  let approverUsername = post.approver_id;

  try {
    if (post.uploader_id) {
      uploaderUsername = await api.getUsername(post.uploader_id);
    }
    if (post.approver_id) {
      approverUsername = await api.getUsername(post.approver_id);
    }
  } catch (error) {
    console.error('Error fetching usernames:', error.message);
    // Fallback to IDs if username fetching fails
    uploaderUsername = post.uploader_id;
    approverUsername = post.approver_id;
  }

  // Set embed color based on status
  let embedColor = customColor || '#0099ff'; // Default blue
  if (!customColor) {
    if (post.flags?.deleted) {
      embedColor = '#ff0000'; // Red for Deleted
    } else if (post.flags?.pending) {
      embedColor = '#0099ff'; // Blue for Pending
    } else {
      embedColor = '#00ff00'; // Green for Approved
    }
  }

  // Format description if included
  let description = null;
  if (includeDescription && post.description) {
    description = dtextFormatter.formatDText(post.description);
    if (!description || description.trim().length === 0) {
      description = 'No description';
    }
  } else if (includeDescription) {
    description = 'No description';
  }

  // Create embed
  const embed = new EmbedBuilder()
    .setTitle(`Post #${post.id}`)
    .setURL(`${config.devmode ? 'http://localhost:3001' : 'https://e6ai.net'}/posts/${post.id}`)
    .setDescription(description)
    .setColor(embedColor)
    .addFields(
      {
        name: 'Rating:',
        value: `${post.rating?.toUpperCase() === 'E' ? '🔞 Explicit' : post.rating?.toUpperCase() === 'Q' ? '⚠️ Questionable' : post.rating?.toUpperCase() === 'S' ? '✅ Safe' : 'Unknown'}`,
        inline: true
      },
      {
        name: 'Status:',
        value: post.flags?.deleted ? '🗑️ Deleted' : post.flags?.pending ? '⏳ Pending' : '✅ Approved',
        inline: true
      },
      {
        name: 'Approver:',
        value: post.approver_id ? (hyperlinkUsernames ? `[${approverUsername}](${config.devmode ? 'http://localhost:3001' : 'https://e6ai.net'}/users/${post.approver_id})` : approverUsername) : 'None',
        inline: true
      },
      {
        name: 'Uploader:',
        value: post.uploader_id ? (hyperlinkUsernames ? `[${uploaderUsername}](${config.devmode ? 'http://localhost:3001' : 'https://e6ai.net'}/users/${post.uploader_id})` : uploaderUsername) : 'Unknown',
        inline: true
      },
      {
        name: 'Favorites:',
        value: post.fav_count?.toString() || '0',
        inline: true
      },
      {
        name: 'Score',
        value: `Up: ${post.score?.up || 0} | Down: ${Math.abs(post.score?.down || 0)} | Total: ${post.score?.total || 0}`,
        inline: true
      }
    );

  // Set the image if available and post is not deleted
  if (post.file?.url && !post.flags?.deleted) {
    if (shouldSpoiler) {
      // Use || link || syntax to create a spoiler link instead of showing the image directly
      let finalDescription = description || 'No description';
      if (shouldSpoiler) {
        finalDescription += `\n\n|| ${post.file.url} ||`;
      }
      embed.setDescription(finalDescription);
    } else {
      embed.setImage(post.file.url);
    }
  }

  // Create the "Visit post" button if requested
  let components = null;
  if (includeButton) {
    const visitButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Visit post')
          .setURL(`${config.devmode ? 'http://localhost:3001' : 'https://e6ai.net'}/posts/${post.id}`)
          .setStyle(ButtonStyle.Link)
          .setEmoji('🔗')
      );
    components = [visitButton];
  }

  return {
    embed,
    shouldSpoiler,
    components
  };
};