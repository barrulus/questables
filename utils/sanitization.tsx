// Input sanitization utilities for XSS prevention
import DOMPurify from 'dompurify';

// Configure DOMPurify for safe HTML content
const configureDOMPurify = () => {
  // Allow basic formatting tags but remove script and other dangerous elements
  DOMPurify.addHook('beforeSanitizeElements', (node, data) => {
    // Log potentially dangerous content for monitoring
    if (data.tagName === 'SCRIPT' || data.tagName === 'OBJECT' || data.tagName === 'EMBED') {
      console.warn('[Security] Blocked dangerous HTML element:', data.tagName);
    }
  });
};

// Initialize DOMPurify configuration
configureDOMPurify();

/**
 * Sanitize HTML content for chat messages and user-generated content
 * @param dirty - The potentially dangerous HTML string
 * @param allowedTags - Array of allowed HTML tags
 * @returns Sanitized HTML string
 */
export const sanitizeHTML = (
  dirty: string,
  allowedTags: string[] = ['b', 'i', 'em', 'strong', 'u', 'br', 'p']
): string => {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  const config = {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['class'], // Only allow class attributes for styling
    FORBID_SCRIPTS: true,
    FORBID_TAGS: ['script', 'object', 'embed', 'link', 'style'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus'],
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
    KEEP_CONTENT: false, // Remove content of forbidden tags
  };

  return DOMPurify.sanitize(dirty, config);
};

/**
 * Sanitize plain text input by removing HTML tags and dangerous characters
 * @param input - The input string to sanitize
 * @returns Sanitized plain text string
 */
export const sanitizePlainText = (input: string): string => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove HTML tags completely
  let sanitized = input.replace(/<[^>]*>/g, '');
  
  // Remove potentially dangerous characters
  sanitized = sanitized.replace(/[<>'"&]/g, (match) => {
    const htmlEntities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '&': '&amp;'
    };
    return htmlEntities[match] || match;
  });

  return sanitized.trim();
};

/**
 * Sanitize filename for file uploads
 * @param filename - The original filename
 * @returns Safe filename
 */
export const sanitizeFilename = (filename: string): string => {
  if (!filename || typeof filename !== 'string') {
    return 'untitled';
  }

  // Remove path separators and dangerous characters
  let sanitized = filename.replace(/[/\\?%*:|"<>]/g, '');
  
  // Remove leading dots and spaces
  sanitized = sanitized.replace(/^[.\s]+/, '');
  
  // Remove trailing spaces
  sanitized = sanitized.replace(/\s+$/, '');
  
  // Replace spaces with underscores
  sanitized = sanitized.replace(/\s+/g, '_');
  
  // Limit length
  if (sanitized.length > 100) {
    const ext = sanitized.substring(sanitized.lastIndexOf('.'));
    const name = sanitized.substring(0, sanitized.lastIndexOf('.'));
    sanitized = name.substring(0, 100 - ext.length) + ext;
  }
  
  // Fallback for empty names
  if (!sanitized) {
    sanitized = 'untitled';
  }
  
  return sanitized;
};

/**
 * Sanitize chat message content specifically for D&D chat
 * @param content - The chat message content
 * @returns Sanitized chat message
 */
export const sanitizeChatMessage = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Allow basic formatting for D&D chat
  const allowedTags = ['b', 'i', 'em', 'strong', 'u', 'br'];
  
  // First sanitize as HTML
  let sanitized = sanitizeHTML(content, allowedTags);
  
  // Limit message length
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000) + '...';
  }
  
  return sanitized;
};

/**
 * Sanitize user input for database storage
 * @param input - The user input
 * @param maxLength - Maximum allowed length
 * @returns Sanitized input safe for database storage
 */
export const sanitizeUserInput = (input: string, maxLength: number = 1000): string => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = sanitizePlainText(input);
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
};

/**
 * Validate and sanitize URL input
 * @param url - The URL to validate and sanitize
 * @returns Safe URL or null if invalid
 */
export const sanitizeURL = (url: string): string | null => {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsedURL = new URL(url);
    
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsedURL.protocol)) {
      console.warn('[Security] Blocked non-HTTP URL:', parsedURL.protocol);
      return null;
    }
    
    // Block localhost and private IPs in production
    if (process.env.NODE_ENV === 'production') {
      const hostname = parsedURL.hostname.toLowerCase();
      if (hostname === 'localhost' || 
          hostname === '127.0.0.1' ||
          hostname.startsWith('10.') ||
          hostname.startsWith('192.168.') ||
          hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
        console.warn('[Security] Blocked private/local URL:', hostname);
        return null;
      }
    }
    
    return parsedURL.href;
  } catch (error) {
    console.warn('[Security] Invalid URL format:', url);
    return null;
  }
};

/**
 * Sanitize JSON input to prevent JSON injection
 * @param jsonString - The JSON string to sanitize
 * @returns Parsed and sanitized object or null if invalid
 */
export const sanitizeJSON = (jsonString: string): any | null => {
  if (!jsonString || typeof jsonString !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonString);
    
    // Recursively sanitize string values in the object
    const sanitizeObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return sanitizePlainText(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      } else if (obj && typeof obj === 'object') {
        const sanitized: any = {};
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            const sanitizedKey = sanitizePlainText(key);
            sanitized[sanitizedKey] = sanitizeObject(obj[key]);
          }
        }
        return sanitized;
      }
      return obj;
    };
    
    return sanitizeObject(parsed);
  } catch (error) {
    console.warn('[Security] Invalid JSON input');
    return null;
  }
};

// Export configuration for external use
export const sanitizationConfig = {
  maxMessageLength: 2000,
  maxFilenameLength: 100,
  maxUserInputLength: 1000,
  allowedHTMLTags: ['b', 'i', 'em', 'strong', 'u', 'br', 'p'],
  allowedProtocols: ['http:', 'https:']
};