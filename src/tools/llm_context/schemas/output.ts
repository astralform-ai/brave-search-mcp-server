import { z } from 'zod';

/**
 * Keep up to date with documentation:
 * https://api-dashboard.search.brave.com/api-reference/summarizer/llm_context/get#responses
 */

const SnippetsSchema = z
  .array(z.string())
  .describe(
    `Extracted content chunks. Entries can mix plain prose, markdown-formatted text, and JSON-encoded structured data (e.g., extracted tables, schemas, or page metadata serialized as a string), so consumers should be prepared to detect and parse JSON strings rather than assuming every entry is plain text.`
  );

const SourceMetadataSchema = z
  .object({
    title: z.string().optional().describe('The page title for the referenced URL.'),
    hostname: z.string().optional().describe('The hostname extracted from the referenced URL.'),
    age: z
      .array(z.string())
      .optional()
      .describe(
        'Discovery/age information for the source, typically formatted as human-readable, ISO date, and relative-age strings. May be an empty array when unavailable.'
      ),
    site_name: z
      .string()
      .optional()
      .describe('Site name for the source (present when enable_source_metadata is true).'),
    favicon: z
      .string()
      .optional()
      .describe('Favicon URL for the source (present when enable_source_metadata is true).'),
    thumbnail: z
      .object({
        src: z.string().optional().describe('Cached/proxied thumbnail URL served by Brave.'),
        original: z.string().optional().describe('Original thumbnail URL on the source site.'),
      })
      .loose()
      .optional()
      .describe('Thumbnail image references (present when enable_source_metadata is true).'),
  })
  .loose();

export const LlmContextSearchApiResponseSchema = z.object({
  grounding: z.object({
    generic: z
      .array(
        z.object({
          url: z.url(),
          title: z.string(),
          snippets: SnippetsSchema,
        })
      )
      .describe(`Array of LLM context items with extracted web content.`),
    poi: z
      .object({
        name: z.string(),
        url: z.url(),
        title: z.string(),
        snippets: SnippetsSchema,
      })
      .nullable()
      .optional()
      .describe(`A point of interest item returned for local recall queries.`),
    map: z
      .array(
        z.object({
          name: z.string(),
          url: z.union([z.url(), z.literal('')]),
          title: z.string(),
          snippets: SnippetsSchema,
        })
      )
      .describe(
        `Map/place results. When enable_local is enabled, the response may include map data.`
      ),
  }),
  sources: z
    .record(z.url(), SourceMetadataSchema)
    .describe(
      `Metadata for each referenced URL, keyed by URL. Known fields include title, hostname, and age; site_name, favicon, and thumbnail are present when enable_source_metadata is true. Unknown fields are preserved as-is.`
    ),
});

export type LlmContextSearchApiResponse = z.infer<typeof LlmContextSearchApiResponseSchema>;
