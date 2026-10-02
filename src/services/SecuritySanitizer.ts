/**
 * SecuritySanitizer.ts
 *
 * Centralized utility for HTML sanitization, control character stripping,
 * prompt injection delimiter wrapping, and API key validation.
 */

export class SecuritySanitizer {
  /**
   * Strips HTML tags, removes unprintable ASCII control characters,
   * normalizes whitespace, and trims the input.
   */
  static sanitizeText(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input
      // Remove dangerous tag blocks and their inner contents
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, ' ')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, ' ')
      // Block level tags become space to prevent word joining
      .replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|td|blockquote|section|article)\b[^>]*>/gi, ' ')
      // Strip all remaining inline HTML tags
      .replace(/<[^>]+>/g, '')
      // Remove control characters (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize multiple whitespace characters to a single space
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Robust HTML tag stripping and entity decoding for incoming external rich text.
   */
  static sanitizeHtml(html: string): string {
    if (!html || typeof html !== 'string') {
      return '';
    }

    let text = html
      // Strip dangerous blocks and their contents
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, ' ')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, ' ')
      // Block level tags become spaces
      .replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|td|blockquote|section|article)\b[^>]*>/gi, ' ')
      // Strip all remaining inline tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      // Numeric decimal and hex entities
      .replace(/&#(\d+);/g, (_, dec) => {
        try {
          return String.fromCharCode(parseInt(dec, 10));
        } catch {
          return '';
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch {
          return '';
        }
      })
      // Strip control characters
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();

    return text;
  }

  /**
   * Isolates untrusted external or user-supplied content inside XML-style delimiter tags,
   * neutralizing any attempt to escape or close the delimiter tag from within the content.
   */
  static wrapWithUntrustedDelimiter(content: string, tag: string = 'untrusted_content'): string {
    const safeTag = (tag || 'untrusted_content').replace(/[^a-zA-Z0-9_-]/g, '') || 'untrusted_content';
    const cleanContent = this.sanitizeHtml(content || '');

    // Neutralize any closing or opening tags that match the delimiter
    const tagNeutralizer = new RegExp(`</?\\s*${safeTag}\\s*[^>]*>`, 'gi');
    const neutralized = cleanContent.replace(tagNeutralizer, '');

    return `<${safeTag}>\n${neutralized}\n</${safeTag}>`;
  }

  /**
   * Validates API key formatting for supported AI providers (Gemini, OpenAI).
   */
  static validateApiKey(key: string, provider: 'gemini' | 'openai'): boolean {
    if (!key || typeof key !== 'string') {
      return false;
    }

    const trimmed = key.trim();
    if (!trimmed) {
      return false;
    }

    if (provider === 'gemini') {
      // Google Gemini API keys typically start with AIzaSy and are ~39 characters long
      const geminiRegex = /^AIzaSy[A-Za-z0-9_-]{30,45}$/;
      return geminiRegex.test(trimmed);
    }

    if (provider === 'openai') {
      // OpenAI API keys typically start with sk- or sk-proj- or sk-svc- and are >= 20 characters
      const openAiRegex = /^sk-(?:proj-|svc-)?[A-Za-z0-9_-]{20,}$/;
      return openAiRegex.test(trimmed);
    }

    return false;
  }

  /**
   * Sanitizes user input titles (events, subjects, tasks) against HTML injection,
   * unprintable ASCII control characters, unpaired UTF-16 surrogates, and excessive length.
   */
  static sanitizeTitle(input: string, maxLength: number = 120): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    // First strip unpaired UTF-16 surrogates that corrupt JSON and UTF-8 encodings
    let clean = input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

    // Strip HTML and control characters
    clean = this.sanitizeHtml(clean);

    if (clean.length > maxLength) {
      clean = clean.slice(0, maxLength).trim();
    }

    return clean;
  }

  /**
   * Sanitizes multi-line notes and descriptions (preserves newlines while removing
   * dangerous HTML, scripts, and control characters).
   */
  static sanitizeNotes(input: string, maxLength: number = 1000): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    // Strip unpaired UTF-16 surrogates
    let clean = input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

    // Strip dangerous tags and their contents
    clean = clean
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, ' ')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, ' ')
      .replace(/<[^>]+>/g, '') // Strip remaining inline HTML
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Strip control characters except \r and \n

    if (clean.length > maxLength) {
      clean = clean.slice(0, maxLength).trim();
    }

    return clean.trim();
  }

  /**
   * Defensive numeric sanitizer for floating point values (e.g. grades, weights).
   * Parses string with comma or period, rejects NaN and Infinity, and clamps to [min, max].
   */
  static sanitizeNumber(val: unknown, min: number = 0, max: number = 1000, fallback: number = 0): number {
    if (val === null || val === undefined) return fallback;

    let num: number;
    if (typeof val === 'number') {
      num = val;
    } else if (typeof val === 'string') {
      const cleanStr = val.replace(',', '.').trim();
      num = parseFloat(cleanStr);
    } else {
      return fallback;
    }

    if (isNaN(num) || !isFinite(num)) {
      return fallback;
    }

    return Math.max(min, Math.min(num, max));
  }

  /**
   * Defensive integer sanitizer (e.g. absences, durations, intervals).
   * Clamps between [min, max] and rounds to nearest integer.
   */
  static sanitizeInteger(val: unknown, min: number = 0, max: number = 1000, fallback: number = 0): number {
    const num = this.sanitizeNumber(val, min, max, fallback);
    return Math.round(num);
  }

  /**
   * Redacts sensitive API keys and tokens from strings, URLs, or error messages
   * to guarantee zero credential leakage in logs or reports.
   */
  static redactApiKeys(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      // Google Gemini API keys (AIzaSy...)
      .replace(/AIzaSy[A-Za-z0-9_-]{30,45}/g, '[REDACTED_API_KEY]')
      // OpenAI API keys (sk-...)
      .replace(/sk-(?:proj-|svc-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
      // URL query params like ?key=... or &key=...
      .replace(/([?&]key=)[^&\s"'>]+/gi, '$1[REDACTED_API_KEY]')
      // Bearer auth tokens in logs
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED_API_KEY]');
  }

  /**
   * Sanitizes and validates a URL from external APIs (like GitHub).
   * Ensures the URL uses http/https protocol and blocks unsafe schemes (javascript:, file:, data:, etc.)
   */
  static sanitizeUrl(url: string | null | undefined): string {
    if (!url || typeof url !== 'string') {
      return '';
    }
    const trimmed = url.trim();
    // Allow only http:// and https:// URLs without control characters or HTML/quotes
    if (!/^https?:\/\/[^\s"'<>\x00-\x1F\x7F]+$/i.test(trimmed)) {
      return '';
    }
    return trimmed;
  }

  /**
   * Checks if an input string contains common SQL injection patterns.
   */
  static containsSqlInjection(input: string): boolean {
    if (!input || typeof input !== 'string') return false;
    const sqlPatterns = [
      /(\b(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE)\s+(TABLE|DATABASE|INDEX|FROM|INTO)\b)/i,
      /(;\s*(DROP|DELETE|TRUNCATE|ALTER|CREATE|INSERT|UPDATE)\b)/i,
      /(\bUNION\s+(ALL\s+)?SELECT\b)/i,
      /((\bOR\b|\bAND\b)\s+['"]?1['"]?\s*=\s*['"]?1)/i,
      /(['"]\s*(\bOR\b|\bAND\b)\s+['"]?[^'"]+['"]?\s*=\s*['"]?[^'"]+['"]?)/i,
      /(--\s*$|--\s+[a-zA-Z0-9])/i,
    ];
    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Checks if a date string is malformed or represents a bizarre date (e.g. month > 12, day > 31, year > 2100).
   */
  static isBizarreDate(dateStr: string | null | undefined): boolean {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const trimmed = dateStr.trim();
    if (!trimmed) return false;
    const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return true;
      if (year < 1900 || year > 2100) return true;
    }
    return false;
  }
}
