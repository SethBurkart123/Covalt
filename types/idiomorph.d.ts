declare module "idiomorph" {
  export const Idiomorph: {
    morph(
      existingNode: Element,
      newContent: string | Element,
      config?: {
        morphStyle?: "innerHTML" | "outerHTML";
        restoreFocus?: boolean;
        ignoreActive?: boolean;
        ignoreActiveValue?: boolean;
        callbacks?: Record<string, (...args: unknown[]) => unknown>;
      },
    ): void;
  };
}
