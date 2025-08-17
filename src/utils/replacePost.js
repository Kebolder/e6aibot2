/**
 * Post Replacement Module - Business logic for e6AI post replacements
 *
 * This module provides high-level functionality for replacing e6AI posts,
 * including input validation, replacement workflow orchestration, and
 * post-undeletion handling. It leverages the existing fetchPost module
 * for post information and the api module for HTTP communication.
 *
 * @module replacePost
 */

const fetchPost = require('./fetchPost');
const api = require('./api');
const config = require('../../config.json');

/**
 * Helper function to check if API return printing is enabled
 * @returns {boolean} True if printReturn is enabled
 */
const shouldPrintApiReturns = () => {
  return config.api && config.api.printReturn === true;
};

/**
 * Validate replacement input parameters
 * @param {string|number} postId - The post ID to replace
 * @param {Object} imageAttachment - Discord attachment object
 * @param {string} reason - The reason for replacement
 * @param {Object} options - Additional validation options
 * @param {Array} options.allowedContentTypes - Array of allowed content types
 * @param {number} options.minReasonLength - Minimum required reason length
 * @throws {Error} If validation fails
 */
const validateInput = (postId, imageAttachment, reason, options = {}) => {
  const {
    allowedContentTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'],
    minReasonLength = 5
  } = options;

  // Validate postId
  if (!postId || !/^\d+$/.test(postId)) {
    throw new Error('Post ID must be a valid number');
  }

  // Validate image attachment
  if (!imageAttachment || !imageAttachment.url) {
    throw new Error('Valid image attachment is required');
  }

  if (!allowedContentTypes.includes(imageAttachment.contentType)) {
    const types = allowedContentTypes.join(', ');
    throw new Error(`Please upload a valid file type (${types})`);
  }

  // Validate reason
  if (!reason || reason.length < minReasonLength) {
    throw new Error(`The reason for replacement must be at least ${minReasonLength} characters long`);
  }

  // Check API credentials
  if (!process.env.E6AI_USERNAME || !process.env.E6AI_API_KEY) {
    throw new Error('Bot owner has not configured E6AI_USERNAME or E6AI_API_KEY');
  }
};

/**
 * Process a post replacement workflow
 * @param {string|number} postId - The post ID to replace
 * @param {Object} imageAttachment - Discord attachment object
 * @param {string} reason - The reason for replacement
 * @param {Object} options - Additional options
 * @param {string} options.source - Optional source URL
 * @param {boolean} options.asPending - Submit as pending (default: false)
 * @returns {Promise<{success: boolean, oldImageUrl: string, replacementData: Object}>} Replacement result
 */
const processReplacement = async (postId, imageAttachment, reason, options = {}) => {
  try {
    // Validate input first
    validateInput(postId, imageAttachment, reason, {
      allowedContentTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'],
      minReasonLength: 5
    });

    // Fetch current post data to get old image URL
    console.log(`Fetching current post ${postId} for old image URL...`);
    const postResult = await fetchPost.getPost(postId);
    const oldImageUrl = postResult.post.file?.url;

    if (!oldImageUrl) {
      throw new Error(`Could not fetch the old image. The post might not exist or the bot may not have permission to view it.`);
    }

    if (shouldPrintApiReturns()) {
      console.log(`Old image URL: ${oldImageUrl}`);
    }

    // Fetch the replacement file data
    if (shouldPrintApiReturns()) {
      console.log(`Fetching replacement file from ${imageAttachment.url}...`);
    }
    const axios = require('axios');
    const imageResponse = await axios.get(imageAttachment.url, { responseType: 'stream' });

    // Submit the replacement
    if (shouldPrintApiReturns()) {
      console.log('Submitting replacement to e6AI...');
    }
    const replacementData = await api.submitPostReplacement(
      postId,
      imageResponse.data,
      imageAttachment.name,
      imageAttachment.contentType,
      reason,
      {
        source: options.source,
        asPending: options.asPending || false
      }
    );

    if (shouldPrintApiReturns()) {
      console.log('Replacement submitted successfully');
    }
    return {
      success: true,
      oldImageUrl,
      replacementData
    };

  } catch (error) {
    console.error('Error processing replacement:', error.message);
    throw error;
  }
};

/**
 * Handle post undeletion after replacement
 * @param {string|number} postId - The post ID to undelete
 * @returns {Promise<{success: boolean, undeleteData: Object}>} Undeletion result
 */
const handlePostUndeletion = async (postId) => {
  try {
    if (shouldPrintApiReturns()) {
      console.log(`Attempting to undelete post ${postId}...`);
    }
    const undeleteData = await api.undeletePost(postId);
    
    // Wait for 2 seconds to allow the server to process the undeletion
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (shouldPrintApiReturns()) {
      console.log('Post undeleted successfully');
    }
    return {
      success: true,
      undeleteData
    };
  } catch (error) {
    console.error(`Failed to undelete post ${postId}:`, error.message);
    
    if (error.code === 10008 || error.message.includes('Unknown Message')) {
      console.log(`Post ${postId} may have been deleted from Discord, but we can still proceed with replacement`);
      return {
        success: true,
        undeleteData: null,
        warning: 'Original Discord message may have been deleted, but replacement can continue'
      };
    }
    
    return {
      success: false,
      error: error.message,
      undeleteData: null
    };
  }
};

/**
 * Refresh and get updated post message after replacement
 * @param {string|number} postId - The post ID to refresh
 * @returns {Promise<{post: Object, embed: EmbedBuilder, shouldSpoiler: boolean}>} Updated post data
 */
const refreshPostMessage = async (postId) => {
  try {
    if (shouldPrintApiReturns()) {
      console.log(`Refreshing post ${postId} after replacement...`);
    }
    const result = await fetchPost.getPost(postId);
    if (shouldPrintApiReturns()) {
      console.log('Post refreshed successfully');
    }
    return result;
  } catch (error) {
    console.error(`Error refreshing post ${postId}:`, error.message);
    throw error;
  }
};

module.exports = {
  validateInput,
  processReplacement,
  handlePostUndeletion,
  refreshPostMessage
};