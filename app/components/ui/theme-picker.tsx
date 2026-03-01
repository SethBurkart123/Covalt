"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorSwatch } from "@/components/ui/color-swatch";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/theme-context";
import { presets } from "@/lib/theme-presets";
import { cn } from "@/lib/utils";
import type { ThemeStyleProps } from "@/lib/types";

export function ThemePicker() {
	const { preset: currentPreset, resolvedMode: mode, styles, setPreset } = useTheme();

	const getPresetLabel = (presetKey: string) =>
		presets[presetKey]?.label ||
		presetKey
			.split("-")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");

	const getSafeColor = (
		styles: ThemeStyleProps,
		property: keyof ThemeStyleProps,
	) => (styles?.[property] as string) || "#cccccc";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" className="flex items-center gap-2">
					<div className="flex gap-1">
						<ColorSwatch color={getSafeColor(styles[mode], "primary")} size="sm" />
						<ColorSwatch color={getSafeColor(styles[mode], "accent")} size="sm" />
						<ColorSwatch color={getSafeColor(styles[mode], "secondary")} size="sm" />
					</div>
					<span className="hidden sm:inline-block">
						{getPresetLabel(currentPreset)}
					</span>
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-[220px] bg-background shadow-lg rounded-md max-h-[300px] overflow-y-auto"
			>
				{Object.keys(presets).map((presetKey) => {
					const isActive = currentPreset === presetKey;
					const styles = presets[presetKey].styles[mode] || {};

					return (
						<DropdownMenuItem
							key={presetKey}
							className={cn(
								"flex items-center gap-2 cursor-pointer",
								isActive && "font-medium bg-accent text-accent-foreground",
							)}
							onClick={() => setPreset(presetKey)}
						>
							<div className="flex gap-1">
								<ColorSwatch
									color={getSafeColor(styles, "primary")}
									size="sm"
								/>
								<ColorSwatch color={getSafeColor(styles, "accent")} size="sm" />
								<ColorSwatch
									color={getSafeColor(styles, "secondary")}
									size="sm"
								/>
							</div>
							<span>{getPresetLabel(presetKey)}</span>
							{isActive && <Check className="h-4 w-4 ml-auto" />}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
