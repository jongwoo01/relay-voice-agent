export interface PromptMetadata {
  id: string;
  purpose: string;
  usedBy: string;
  pipeline: string;
  inputContract: string;
  outputContract: string;
}

export interface PromptSpec<TInput> {
  metadata: PromptMetadata;
  build(input: TInput): string;
}
