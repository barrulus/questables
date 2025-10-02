// Input sanitization utilities for XSS prevention
import DOMPurify from 'dompurify';

const purifier = DOMPurify();
type PurifyAddHook = (
  _hookName: DOMPurify.HookName,
  _handler: (_node: Element, _event: DOMPurify.HookEvent) => void
) => void;
const addHook = purifier.addHook.bind(purifier) as PurifyAddHook;

const isElementHookEvent = (
  event: DOMPurify.HookEvent
): event is DOMPurify.SanitizeElementHookEvent => {
  return Boolean(event && 'tagName' in event);
};

// Configure DOMPurify for safe HTML content
const configureDOMPurify = () => {
  // Allow basic formatting tags but remove script and other dangerous elements
  addHook('beforeSanitizeElements', (node: Element, data: DOMPurify.HookEvent) => {
    if (!isElementHookEvent(data)) {
      return;
    }

    const tagName = data.tagName.toUpperCase();
    // Log potentially dangerous content for monitoring
    if (tagName === 'SCRIPT' || tagName === 'OBJECT' || tagName === 'EMBED') {
      console.warn('[Security] Blocked dangerous HTML element:', {
        tagName,
        nodeName: node.nodeName,
      });
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
    FORBID_TAGS: ['script', 'object', 'embed', 'link', 'style'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus'],
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
    KEEP_CONTENT: false, // Remove content of forbidden tags
  } satisfies DOMPurify.Config;

  return purifier.sanitize(dirty, config);
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
  } catch {
    console.warn('[Security] Invalid URL format:', url);
    return null;
  }
};

type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };

const sanitizeJSONValue = (value: unknown): JSONValue => {
  if (typeof value === 'string') {
    return sanitizePlainText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJSONValue(item)) as JSONValue[];
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, JSONValue> = {};
    const record = value as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      const sanitizedKey = sanitizePlainText(key);
      result[sanitizedKey] = sanitizeJSONValue(record[key]);
    }

    return result;
  }

  return sanitizePlainText(String(value));
};

/**
 * Sanitize JSON input to prevent JSON injection
 * @param jsonString - The JSON string to sanitize
 * @returns Parsed and sanitized object or null if invalid
 */
export const sanitizeJSON = (jsonString: string): JSONValue | null => {
  if (!jsonString || typeof jsonString !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonString) as JSONValue;
    return sanitizeJSONValue(parsed);
  } catch {
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
