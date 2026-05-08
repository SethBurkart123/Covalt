import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { ComponentRenderer } from "../engine";
import { asNumber, asString, spacing } from "./_shared";

export const Box: ComponentRenderer = ({ props, renderChildren }) => {
  const flexDirection = asString(props.flexDirection) === "row" ? "row" : "column";
  const padding = spacing(asNumber(props.padding));
  const gap = spacing(asNumber(props.gap));
  const borderStyle = asString(props.borderStyle);

  const style: CSSProperties = {
    display: "flex",
    flexDirection,
    gap,
    padding,
    borderStyle: borderStyle as CSSProperties["borderStyle"] | undefined,
    borderWidth: borderStyle ? 1 : undefined,
  };

  return (
    <div
      className={cn(
        "min-w-0",
        borderStyle ? "rounded-md border bg-muted/30" : undefined,
      )}
      style={style}
    >
      {renderChildren()}
    </div>
  );
};
