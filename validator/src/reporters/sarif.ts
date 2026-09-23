/**
 * SARIF Validation Reporter
 *
 * Produces a SARIF 2.1.0 (Static Analysis Results Interchange Format)
 * JSON document with results mapped from validation issues.
 */

export interface ValidationIssue {
  rule: string;
  code?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  path?: string;
}

export interface ValidationReport {
  file: string;
  issues: ValidationIssue[];
  passed: boolean;
}

export interface SARIFReporterOptions {
  /** Driver tool name (default: 'mam-validator') */
  toolName?: string;
  /** Driver tool version (default: '0.1.0') */
  toolVersion?: string;
  /** SARIF schema URI (default: SARIF 2.1.0 schema) */
  schemaUri?: string;
  /** Information URI for the tool (default: mam.dev docs) */
  informationUri?: string;
}

const DEFAULT_SCHEMA_URI =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

type SARIFLevel = 'error' | 'warning' | 'note' | 'none';

const LEVEL_MAP: Record<string, SARIFLevel> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

export class SARIFReporter {
  private options: SARIFReporterOptions;

  constructor(options?: SARIFReporterOptions) {
    this.options = {
      toolName: 'mam-validator',
      toolVersion: '0.1.0',
      schemaUri: DEFAULT_SCHEMA_URI,
      informationUri: 'https://mam.dev/docs/validation',
      ...options,
    };
  }

  report(result: ValidationReport): string {
    const rules: Array<Record<string, unknown>> = [];
    const rulesById = new Map<string, number>();

    const results = result.issues.map(issue => {
      let ruleIndex = rulesById.get(issue.rule);
      if (ruleIndex == null) {
        ruleIndex = rules.length;
        rulesById.set(issue.rule, ruleIndex);
        rules.push({
          id: issue.rule,
          name: issue.rule,
          shortDescription: {
            text: `MAM validation rule: ${issue.rule}`,
          },
          defaultConfiguration: {
            level: LEVEL_MAP[issue.severity] ?? 'none',
          },
        });
      }

      const sarifIssue: Record<string, unknown> = {
        ruleId: issue.rule,
        ruleIndex,
        level: LEVEL_MAP[issue.severity] ?? 'none',
        message: {
          text: issue.code ? `[${issue.code}] ${issue.message}` : issue.message,
        },
      };

      if (issue.line != null) {
        const region: Record<string, unknown> = {
          startLine: issue.line,
        };
        if (issue.column != null) {
          region.startColumn = issue.column;
        }
        sarifIssue.locations = [
          {
            physicalLocation: {
              artifactLocation: {
                uri: result.file.replace(/\\/g, '/'),
              },
              region,
            },
          },
        ];
      }

      return sarifIssue;
    });

    const output = {
      $schema: this.options.schemaUri,
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: this.options.toolName,
              version: this.options.toolVersion,
              informationUri: this.options.informationUri,
              rules,
            },
          },
          results,
        },
      ],
    };

    return JSON.stringify(output, null, 2);
  }
}