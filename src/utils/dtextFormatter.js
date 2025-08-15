const config = require('../../config.json');

/**
 * Convert e6AI DText to Discord markdown format
 * @param {string} dtext - The DText to convert
 * @returns {string} Formatted Discord markdown
 */
module.exports.formatDText = (dtext) => {
  if (!dtext) return '';
  
  let formatted = dtext;
  
  // First, convert all formatting tags to preserve their content
  formatted = formatted.replace(/\[i\](.*?)\[\/i\]/g, '*$1*');
  formatted = formatted.replace(/\[b\](.*?)\[\/b\]/g, '**$1**');
  formatted = formatted.replace(/\[i\]\[b\](.*?)\[\/b\]\[\/i\]/g, '***$1***');
  formatted = formatted.replace(/\[b\]\[i\](.*?)\[\/i\]\[\/b\]/g, '***$1***');
  
  // Convert links "text":link -> [text](link)
  // Handle links with formatting inside them
  formatted = formatted.replace(/\"([^"]+)\":([^>\)\s]+)\)/g, (match, text, url) => {
    // Remove any remaining formatting from the link text
    let cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '');
    return `[${cleanText}](${url})`;
  });
  
  // Handle links without closing parenthesis - preserve complete text
  formatted = formatted.replace(/\"([^"]+)\":([^>\)\s]+)$/g, (match, text, url) => {
    // Remove any remaining formatting from the link text but preserve complete text
    let cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '');
    return `[${cleanText}](${url})`;
  });
  
  // Handle basic "text":link format (most common case)
  formatted = formatted.replace(/\"([^"]+)\":([^>\s]+)(?=\s|$)/g, (match, text, url) => {
    // Remove any remaining formatting from the link text
    let cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '');
    return `[${cleanText}](${url})`;
  });
  
  // Remove quote blocks but keep content
  formatted = formatted.replace(/\[quote\](.*?)\[\/quote\]/gs, '$1');
  
  // Remove table blocks but keep content
  formatted = formatted.replace(/\[table\](.*?)\[\/table\]/gs, '$1');
  
  // Remove table cells but keep content
  formatted = formatted.replace(/\[\/?(tr|td)\]/g, '');
  
  // Remove [code] blocks but keep content
  formatted = formatted.replace(/\[code\](.*?)\[\/code\]/gs, '$1');
  
  // Remove [spoiler] blocks but keep content
  formatted = formatted.replace(/\[spoiler\](.*?)\[\/spoiler\]/gs, '$1');
  
  // Convert relative links (/users/, /posts/) to absolute links
  const baseUrl = config.devmode ? 'http://localhost:3001' : 'https://e6ai.net';
  formatted = formatted.replace(/(\[([^\]]+)\]\s*\()\/(users|posts)([^\)]*)(\))/g, `[$2](${baseUrl}/$3$4)`);
  
  // Convert URLs to clickable links
  formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, '<$1>');
  
  // Clean up excessive whitespace
  formatted = formatted.replace(/\n\s*\n\s*\n/g, '\n\n');
  formatted = formatted.trim();
  
  // Remove any trailing > characters from links
  formatted = formatted.replace(/(\]\()([^)]+)(\))\>/g, '$1$2$3');
  formatted = formatted.replace(/(\[([^\]]+)\]\()([^)]+)(\))\>/g, '$1$3$4');
  
  return formatted;
};

/**
 * Remove DText tags and keep only plain text
 * @param {string} dtext - The DText to clean
 * @returns {string} Plain text
 */
module.exports.cleanDText = (dtext) => {
  if (!dtext) return '';
  
  let cleaned = dtext;
  
  // Remove all DText tags
  cleaned = cleaned.replace(/\[\/?[a-z]+\]/g, '');
  
  // Clean up excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
};