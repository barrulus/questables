// Minimal sanitization utilities for the Node server
import path from 'path';

export const sanitizePlainText = (input) => {
  if (typeof input !== 'string') return '';
  // Strip control characters, collapse whitespace
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000);
};

export const sanitizeHTML = (html) => {
  if (typeof html !== 'string') return '';
  // Remove script/style tags and all HTML tags as a simple hardening step
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const sanitizeFilename = (filename) => {
  if (typeof filename !== 'string') return 'file';
  const base = path.basename(filename);
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'file';
};

export const sanitizeChatMessage = (content) => sanitizePlainText(content).slice(0, 2000);

export const sanitizeUserInput = (input, maxLength = 1000) => sanitizePlainText(input).slice(0, maxLength);

export default {
  sanitizePlainText,
  sanitizeHTML,
  sanitizeFilename,
  sanitizeChatMessage,
  sanitizeUserInput,
};

