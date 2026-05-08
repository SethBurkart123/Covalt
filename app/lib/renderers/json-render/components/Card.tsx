import {
  Card as UICard,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ComponentRenderer } from "../engine";
import { asNumber, asString, spacing } from "./_shared";

export const Card: ComponentRenderer = ({ props, renderChildren }) => {
  const title = asString(props.title);
  const padding = spacing(asNumber(props.padding));

  return (
    <UICard className="bg-muted/30" style={padding ? { padding } : undefined}>
      {title ? (
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-2.5">{renderChildren()}</CardContent>
    </UICard>
  );
};
