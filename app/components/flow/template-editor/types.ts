export interface TemplateVariableOption {
  expr: string;
  label: string;
  preview?: string;
  group?: string;
  type?: string;
  hasData?: boolean;
}

export interface TemplateVariableCompletion {
  label: string;
  insertText: string;
  preview?: string;
}
