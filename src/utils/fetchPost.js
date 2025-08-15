/**
 * Post Fetching Module - Business logic and Discord integration
 *
 * This module provides high-level functionality for fetching and processing
 * e6AI posts in the context of a Discord bot. It uses the central API module
 * for HTTP communication and handles post-specific business logic like embed
 * creation and file URL extraction.
 *
 * @module fetchPost
 */

const api = require('./api');
const embedBuilder = require('./embedBuilder');

/**
 * Get file URL for a post
 * @param {string|number} postId - The post ID to fetch
 * @returns {Promise<string>} The file URL
 */
async function getFile(postId) {
  const responseData = await api.fetchPostData(postId);
  const post = api.extractPostFromResponse(postId, responseData);
  
  if (!post || !post.file || !post.file.url) {
    throw new Error(`Post ${postId} not found or has no file URL`);
  }
  
  return post.file.url;
}

/**
 * Get post data with embed
 * @param {string|number} postId - The post ID to fetch
 * @param {Object} options - Configuration options
 * @param {Object} options.embedOptions - Additional embed options
 * @returns {Promise<{post: Object, embed: EmbedBuilder, shouldSpoiler: boolean, components: Array|null}>} Post data, embed, spoiler flag, and components
 */
async function getPost(postId, options = {}) {
  const {
    embedOptions = {}
  } = options;

  const responseData = await api.fetchPostData(postId);
  const post = api.extractPostFromResponse(postId, responseData);
  
  if (!post) {
    throw new Error(`Post ${postId} not found`);
  }

  // Create embed (image is embedded automatically) - now async
  const { embed, shouldSpoiler, components } = await embedBuilder.createPostEmbed(post, embedOptions);

  return {
    post,
    embed,
    shouldSpoiler,
    components
  };
}

module.exports = {
  getPost,
  getFile
};