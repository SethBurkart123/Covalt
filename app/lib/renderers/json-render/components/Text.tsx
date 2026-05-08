import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asBool, asString, colorToTextClass } from "./_shared";

export const Text: ComponentRenderer = ({ props, renderChildren }) => {
  const text = asString(props.text);
  const color = asString(props.color);
  const bold = asBool(props.bold);
  const colorClass = colorToTextClass(color);
  const explicitColor = colorClass ? undefined : color;

  return (
    <span
      className={cn("leading-relaxed", colorClass, bold ? "font-semibold" : undefined)}
      style={explicitColor ? { color: explicitColor } : undefined}
    >
      {text != null ? text : renderChildren()}
    </span>
  );
};
