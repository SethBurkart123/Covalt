"use client";

import { ThemeModeToggle } from "./theme-mode-toggle";
import { ThemePicker } from "./theme-picker";
import { cn } from "@/lib/utils";

interface ColorThemeSwitcherProps {
	className?: string;
	align?: "start" | "center" | "end";
}

export function ColorThemeSwitcher({
	className,
	align = "center",
}: ColorThemeSwitcherProps) {
	const alignClass = {
		start: "justify-start",
		center: "justify-center",
		end: "justify-end",
	};

	return (
		<div className={cn("flex flex-row gap-4", alignClass[align], className)}>
			<ThemeModeToggle variant="outline" size="icon" />
			<ThemePicker />
		</div>
	);
}
