/**
 * e6AI API Client - Low-level HTTP client for e6AI service
 *
 * This module provides pure API functionality for interacting with e6AI,
 * including post data fetching and username scraping. It contains no
 * Discord-specific code and can be used independently or by other services.
 *
 * @module api
 */

const axios = require('axios');
const config = require('../../config.json');
const packageJson = require('../../package.json');

/**
 * Common headers for e6AI API requests
 * @returns {Object} Headers object
 */
const getCredentials = () => {
  if (config.devmode) {
    return {
      username: process.env.DEV_E6AI_USERNAME,
      apiKey: process.env.DEV_E6AI_API_KEY
    };
  } else {
    return {
      username: process.env.E6AI_USERNAME,
      apiKey: process.env.E6AI_API_KEY
    };
  }
};

const getCommonHeaders = () => {
  const credentials = getCredentials();
  const headers = {
    'User-Agent': config.api.userAgent.replace('{version}', packageJson.version)
  };
  
  if (credentials.apiKey) {
    headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64')}`;
  }
  
  return headers;
};

/**
 * Handle API errors consistently
 * @param {string} postId - The post ID being fetched
 * @param {Error} error - The error object
 * @throws {Error} Formatted error message
 */
const handleApiError = (postId, error) => {
  console.error(`Error fetching post ${postId}:`, {
    status: error.response?.status,
    statusText: error.response?.statusText,
    data: error.response?.data,
    message: error.message,
    config: {
      url: error.config?.url,
      method: error.config?.method
    }
  });
  
  if (error.response?.status === 404) {
    throw new Error(`Post ${postId} not found on e6AI`);
  } else if (error.response?.status === 403) {
    throw new Error('Access denied - check User-Agent or API credentials');
  } else {
    throw new Error(`Failed to fetch post from e6AI: ${error.message}`);
  }
};

/**
 * Fetch raw post data from e6AI API
 * @param {string|number} postId - The post ID to fetch
 * @returns {Promise<Object>} Raw API response data
 */
const fetchPostData = async (postId) => {
  try {
    const baseUrl = config.devmode ? 'http://localhost:3001' : 'https://e6ai.net';
    console.log(`Fetching post ${postId} from e6AI API... (using ${baseUrl})`);
    const response = await axios.get(`${baseUrl}/posts/${postId}.json`, {
      headers: getCommonHeaders()
    });
    
    console.log(`API Response status: ${response.status}`);
    console.log(`API Response data keys:`, Object.keys(response.data || {}));
    
    // Print full API response if configured
    if (config.api.printReturn) {
      console.log('=== FULL API RESPONSE ===');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('=== END API RESPONSE ===');
    }
    
    return response.data;
  } catch (error) {
    handleApiError(postId, error);
  }
};

/**
 * Extract post object from API response
 * @param {string|number} postId - The post ID
 * @param {Object} responseData - Raw API response data
 * @returns {Object} Post object
 */
const extractPostFromResponse = (postId, responseData) => {
  if (responseData && responseData.post) {
    const post = responseData.post;
    console.log(`Post ${postId} file data:`, post.file);
    if (post.file?.url) {
      console.log(`Successfully found post ${postId}: ${post.file.url}`);
    } else {
      console.log(`Post ${postId} response missing file URL:`, post.file);
    }
    return post;
  } else {
    console.log(`Post ${postId} response missing post data:`, responseData);
    return responseData;
  }
};

/**
 * Get username from e6AI user profile using the official API method
 * @param {string|number} userId - The user ID to fetch
 * @returns {Promise<string>} The username
 */
const getUsername = async (userId) => {
  try {
    const baseUrl = config.devmode ? 'http://localhost:3001' : 'https://e6ai.net';
    console.log(`Fetching username for user ${userId} from e6AI API... (using ${baseUrl})`);
    
    const response = await axios.get(`${baseUrl}/users/${userId}.json`, {
      headers: getCommonHeaders()
    });
    
    console.log(`API Response status: ${response.status}`);
    console.log(`API Response data keys:`, Object.keys(response.data || {}));
    
    // Extract username from JSON response
    if (response.data && response.data.name) {
      const username = response.data.name.trim();
      console.log(`Found username for user ${userId}: ${username}`);
      return username;
    } else {
      console.log(`Username not found in API response for user ${userId}`);
      console.log('API response data:', response.data);
      return userId.toString(); // Fallback to user ID
    }
  } catch (error) {
    console.error(`Error fetching username for user ${userId} via API:`, error.message);
    
    // If user not found, return user ID as fallback
    if (error.response?.status === 404) {
      return userId.toString();
    }
    
    // For other errors, rethrow to make them visible
    throw error;
  }
};

/**
 * Submit a post replacement to e6AI API
 * @param {string|number} postId - The ID of the post to replace
 * @param {Object} imageData - The image data stream from axios
 * @param {string} filename - The filename of the replacement file
 * @param {string} contentType - The content type of the file
 * @param {string} reason - The reason for the replacement
 * @param {Object} options - Additional options
 * @param {string} options.source - Optional source URL
 * @param {boolean} options.asPending - Submit as pending (default: false)
 * @returns {Promise<Object>} API response data
 */
const submitPostReplacement = async (postId, imageData, filename, contentType, reason, options = {}) => {
  const FormData = require('form-data');
  const axios = require('axios');
  
  try {
    const formData = new FormData();
    formData.append('post_replacement[replacement_file]', imageData, {
      filename,
      contentType
    });
    formData.append('post_replacement[reason]', reason);
    
    if (options.source) {
      formData.append('post_replacement[source]', options.source);
    }
    formData.append('post_replacement[as_pending]', options.asPending ? 'true' : 'false');

    const baseUrl = config.devmode ? 'http://localhost:3001' : 'https://e6ai.net';
    const credentials = getCredentials();
    const apiUrl = `${baseUrl}/post_replacements.json?post_id=${postId}&login=${credentials.username}&api_key=${credentials.apiKey}`;
    console.log(`Submitting replacement to: ${apiUrl}`);
    console.log(`With Reason: ${reason}, File: ${filename}`);

    const response = await axios.post(
      apiUrl,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'User-Agent': config.api.userAgent.replace('{version}', packageJson.version),
        },
      }
    );

    console.log(`Replacement submission status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error('Error submitting post replacement:', error.isAxiosError ? error.toJSON() : error);
    
    if (error.response?.status === 412) {
      // Precondition failed - likely an issue with request format or headers
      const errorDetails = error.response.data;
      let errorMessage = 'Request failed due to precondition failure';
      
      if (errorDetails?.reason) {
        errorMessage += `: ${errorDetails.reason}`;
      } else if (errorDetails?.message) {
        errorMessage += `: ${errorDetails.message}`;
      } else if (errorDetails?.errors) {
        errorMessage += `: ${JSON.stringify(errorDetails.errors)}`;
      }
      
      throw new Error(errorMessage);
    } else if (error.response?.status === 422) {
      throw new Error(`Invalid parameters for replacement: ${error.response.data?.reason || error.response.data?.message || 'Unknown error'}`);
    } else if (error.response?.status === 403) {
      throw new Error('Access denied - check API credentials or User-Agent');
    } else if (error.response?.status === 404) {
      throw new Error(`Post ${postId} not found`);
    } else {
      throw new Error(`Failed to submit replacement: ${error.message}`);
    }
  }
};

/**
 * Undelete a post via e6AI API
 * @param {string|number} postId - The ID of the post to undelete
 * @returns {Promise<Object>} API response data
 */
const undeletePost = async (postId) => {
  try {
    const baseUrl = config.devmode ? 'http://localhost:3001' : 'https://e6ai.net';
    const credentials = getCredentials();
    const undeleteUrl = `${baseUrl}/moderator/post/posts/${postId}/undelete.json`;
    const response = await axios.post(undeleteUrl, null, {
      params: {
        login: credentials.username,
        api_key: credentials.apiKey,
      },
      headers: {
        'User-Agent': config.api.userAgent.replace('{version}', packageJson.version),
      },
    });

    console.log(`Undelete request for post ${postId} status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error(`Error undeleting post ${postId}:`, error.isAxiosError ? error.toJSON() : error);
    
    if (error.response?.status === 403) {
      throw new Error('Access denied - insufficient permissions to undelete posts');
    } else if (error.response?.status === 404) {
      throw new Error(`Post ${postId} not found or already undeleted`);
    } else {
      throw new Error(`Failed to undelete post: ${error.message}`);
    }
  }
};


module.exports = {
  fetchPostData,
  extractPostFromResponse,
  getUsername,
  submitPostReplacement,
  undeletePost
};