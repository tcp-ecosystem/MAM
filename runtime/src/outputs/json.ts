/**
 * JSON Output Formatter
 */

export class JSONOutput {
  format(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  getMimeType(): string {
    return 'application/json';
  }

  getExtension(): string {
    return '.json';
  }
}
