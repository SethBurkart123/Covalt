import type { ComponentRenderer } from "../engine";
import { asString } from "./_shared";

const SIZE_BY_LEVEL: Record<string, string> = {
  h1: "text-lg",
  h2: "text-base",
  h3: "text-sm",
  h4: "text-sm",
};

export const Heading: ComponentRenderer = ({ props, renderChildren }) => {
  const level = asString(props.level) ?? "h2";
  const text = asString(props.text);
  const sizeClass = SIZE_BY_LEVEL[level] ?? SIZE_BY_LEVEL.h2;
  const className = `font-semibold tracking-tight text-foreground ${sizeClass}`;
  const content = text ?? renderChildren();

  switch (level) {
    case "h1":
      return <h1 className={className}>{content}</h1>;
    case "h3":
      return <h3 className={className}>{content}</h3>;
    case "h4":
      return <h4 className={className}>{content}</h4>;
    default:
      return <h2 className={className}>{content}</h2>;
  }
};
