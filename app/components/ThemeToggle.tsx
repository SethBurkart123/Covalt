import { useId } from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useTheme } from "@/contexts/theme-context"

const items = [
  { value: "1", label: "Light", icon: 
    <div className="force-light">
      <svg width="100%" height="100%" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadowL" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" flood-opacity=".3"></feDropShadow>
          </filter>
        </defs>
        <rect x="28" y="22" rx="14" ry="14" width="264" height="156" fill="var(--card)" stroke="var(--border)"></rect>
        <rect x="28" y="22" width="264" height="28" rx="14" ry="14" fill="var(--muted)"></rect>
        <circle cx="46" cy="36" r="5" fill="var(--destructive)"></circle>
        <circle cx="62" cy="36" r="5" fill="var(--accent)"></circle>
        <circle cx="78" cy="36" r="5" fill="var(--chart-1)"></circle>
        <g stroke="var(--muted-foreground)" stroke-linecap="round" stroke-width="8" opacity="0.5">
          <line x1="56" y1="70" x2="204" y2="70"></line>
          <line x1="56" y1="98" x2="248" y2="98" stroke-width="10"></line>
          <line x1="56" y1="128" x2="190" y2="128"></line>
          <line x1="56" y1="156" x2="168" y2="156"></line>
        </g>
      </svg>
    </div>
   },
  { value: "2", label: "Dark", icon:
    <div className="force-dark">
      <svg width="100%" height="100%" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
        <rect x="28" y="22" rx="14" ry="14" width="264" height="156" fill="var(--card)" stroke="var(--border)"></rect>
        <rect x="28" y="22" width="264" height="28" rx="14" ry="14" fill="var(--muted)"></rect>
        <circle cx="46" cy="36" r="5" fill="var(--muted-foreground)"></circle>
        <circle cx="62" cy="36" r="5" fill="var(--muted-foreground)"></circle>
        <circle cx="78" cy="36" r="5" fill="var(--muted-foreground)"></circle>
        <g stroke="var(--muted-foreground)" stroke-linecap="round" stroke-width="8" opacity="0.5">
          <line x1="56" y1="70" x2="204" y2="70"></line>
          <line x1="56" y1="98" x2="248" y2="98" stroke-width="10"></line>
          <line x1="56" y1="128" x2="190" y2="128"></line>
          <line x1="56" y1="156" x2="168" y2="156"></line>
        </g>
      </svg>
    </div>
   },
  { value: "3", label: "System", icon:
    <div>
      <svg width="100%" height="100%" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="leftHalfMask">
            <rect x="0" y="0" width="320" height="200" fill="black"></rect>
            <rect x="28" y="22" width="132" height="156" fill="white"></rect>
          </mask>
        </defs>
        <g className="force-dark">
          <rect x="28" y="22" rx="14" ry="14" width="264" height="156" fill="var(--card)" stroke="var(--border)"></rect>
          <rect x="28" y="22" width="264" height="28" rx="14" ry="14" fill="var(--muted)"></rect>
          <circle cx="46" cy="36" r="5" fill="var(--muted-foreground)"></circle>
          <circle cx="62" cy="36" r="5" fill="var(--muted-foreground)"></circle>
          <circle cx="78" cy="36" r="5" fill="var(--muted-foreground)"></circle>
          <g stroke="var(--muted-foreground)" stroke-linecap="round" stroke-width="8" opacity="0.5">
            <line x1="56" y1="70" x2="204" y2="70"></line>
            <line x1="56" y1="98" x2="248" y2="98" stroke-width="10"></line>
            <line x1="56" y1="128" x2="190" y2="128"></line>
            <line x1="56" y1="156" x2="168" y2="156"></line>
          </g>
        </g>
        <g className="force-light" mask="url(#leftHalfMask)">
          <rect x="28" y="22" rx="14" ry="14" width="264" height="156" fill="var(--card)" stroke="var(--border)"></rect>
          <rect x="28" y="22" width="264" height="28" rx="14" ry="14" fill="var(--muted)"></rect>
          <circle cx="46" cy="36" r="5" fill="var(--destructive)"></circle>
          <circle cx="62" cy="36" r="5" fill="var(--accent)"></circle>
          <circle cx="78" cy="36" r="5" fill="var(--chart-1)"></circle>
          <g stroke="var(--muted-foreground)" stroke-linecap="round" stroke-width="8" opacity="0.5">
            <line x1="56" y1="70" x2="204" y2="70"></line>
            <line x1="56" y1="98" x2="248" y2="98" stroke-width="10"></line>
            <line x1="56" y1="128" x2="190" y2="128"></line>
            <line x1="56" y1="156" x2="168" y2="156"></line>
          </g>
        </g>              
      </svg>
    </div>
   },
]

function mapThemeToValue(theme: "light" | "dark" | "system"): string {
  switch (theme) {
    case "light":
      return "1"
    case "dark":
      return "2"
    case "system":
      return "3"
  }
}

function mapValueToTheme(value: string): "light" | "dark" | "system" {
  switch (value) {
    case "1":
      return "light"
    case "2":
      return "dark"
    case "3":
      return "system"
    default:
      return "system"
  }
}

export default function ThemeToggle() {
  const id = useId()
  const { theme, setTheme } = useTheme()

  const handleValueChange = (value: string) => {
    const newTheme = mapValueToTheme(value)
    setTheme(newTheme)
  }

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm leading-none font-medium text-foreground">
        Choose a theme
      </legend>
      <RadioGroup 
        className="flex gap-3" 
        value={mapThemeToValue(theme)}
        onValueChange={handleValueChange}
      >
        {items.map((item) => {
          const isChecked = item.value === mapThemeToValue(theme)
          return (
          <label 
            className={`rounded-lg border ${
              isChecked ? "dark:bg-black/10 bg-white/10 border-border" : "bg-card/10 border-border/10"
            }`}
            key={`${id}-${item.value}`}
          >
            <RadioGroupItem
              id={`${id}-${item.value}`}
              value={item.value}
              className="peer sr-only after:absolute after:inset-0"
            />
            {item.icon}
            <span className="group pb-4 pl-4 mt-2 flex items-center gap-1 peer-data-[state=unchecked]:text-muted-foreground/70">
              <CheckIcon
                size={16}
                className="group-peer-data-[state=unchecked]:hidden"
                aria-hidden="true"
              />
              <MinusIcon
                size={16}
                className="group-peer-data-[state=checked]:hidden"
                aria-hidden="true"
              />
              <span className="text-xs font-medium">{item.label}</span>
            </span>
          </label>
          )
        })}
      </RadioGroup>
    </fieldset>
  )
}
