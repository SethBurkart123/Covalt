import { Separator } from "@/components/ui/separator";
import type { ComponentRenderer } from "../engine";
import { asString } from "./_shared";

export const Divider: ComponentRenderer = ({ props }) => {
  const title = asString(props.title);
  if (!title) {
    return <Separator className="my-2" />;
  }
  return (
    <div className="flex items-center gap-3 py-1">
      <Separator className="flex-1" />
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </span>
      <Separator className="flex-1" />
    </div>
  );
};
