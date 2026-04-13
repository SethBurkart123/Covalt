import { type ComponentType, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";

interface ProviderItemHeaderProps {
  icon: ComponentType<{ size?: number; className?: string }>;
  name: string;
  description: string;
  status?: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  truncateDescription?: boolean;
}

function ProviderIdentity({
  icon: Icon,
  name,
  description,
  status,
  truncateDescription,
}: Omit<
  ProviderItemHeaderProps,
  "action" | "collapsible" | "isOpen" | "onToggle"
>) {
  return (
    <div className="flex items-center gap-3 text-left flex-1 min-w-0">
      <div className="rounded-md flex items-center justify-center">
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-none flex items-center gap-2">
          {name}
          {status}
        </div>
        <div
          className={`text-xs text-muted-foreground mt-1${truncateDescription ? " truncate" : ""}`}
        >
          {description}
        </div>
      </div>
    </div>
  );
}

export function ProviderItemHeader(props: ProviderItemHeaderProps) {
  const { action, collapsible, isOpen, onToggle } = props;

  if (collapsible) {
    return (
      <button
        className="w-full px-4 flex items-center justify-between transition-colors"
        onClick={onToggle}
      >
        <ProviderIdentity {...props} />
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={16} className="text-muted-foreground" />
        </motion.div>
      </button>
    );
  }

  return (
    <div className="w-full px-4 flex items-center justify-between">
      <ProviderIdentity {...props} />
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
