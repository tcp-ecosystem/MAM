/**
 * MAM Metadata Node Types
 */

export interface MetadataNode {
  type: 'Metadata';
  id?: string;
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  tags?: string[];
  runtime?: string;
  permissions?: string[];
  dependencies?: Record<string, string>;
}
