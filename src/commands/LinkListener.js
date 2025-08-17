const fetchPost = require('../utils/fetchPost');

class LinkListener {
  constructor() {
    this.processedMessages = new Set();
  }
  
  async handleMessage(message) {
    // Ignore bot messages and messages we've already processed
    if (message.author.bot || this.processedMessages.has(message.id)) return;
    this.processedMessages.add(message.id);
    
    // Extract e6AI post IDs from message
    const postIds = this.extractPostIds(message.content);
    
    if (postIds.length === 0) return;
    
    try {
      // Process each post ID
      for (const postId of postIds) {
        console.log(`Processing post ${postId} from LinkListener...`);
        
        // Use the new API
        const result = await fetchPost.getPost(postId);
        
        console.log(`Found post ${postId}: ${result.post.id}`);
        
        // Send the embed with the built-in "Visit post" button
        // Use content instead of embeds to ensure buttons appear properly
        const content = result.shouldSpoiler ? `|| ${result.post.file.url} ||` : null;
        
        await message.channel.send({
          content: content,
          embeds: [result.embed],
          files: [],
          components: result.components || []
        });
      }
    } catch (error) {
      console.error('Error processing e6AI links:', error);
    }
  }
  
  extractPostIds(content) {
    // Extract post IDs from e6AI URLs
    const regex = /https?:\/\/e6ai\.net\/posts\/(\d+)/gi;
    const matches = [...content.matchAll(regex)];
    return [...new Set(matches.map(m => m[1]))]; // Return unique IDs
  }
  
  cleanup() {
    // Clear processed messages older than 1 hour
    const now = Date.now();
    // We'll implement proper cleanup later
  }
}

module.exports = LinkListener;