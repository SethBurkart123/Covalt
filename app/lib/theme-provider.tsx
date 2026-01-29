"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeMode, ThemeState, ThemeProviderProps } from "./types";
import { defaultThemeState, getPresetThemeStyles } from "./theme-presets";
import { applyTheme } from "./fix-global-css";

type ThemeContextType = {
	themeState: ThemeState;
	setThemeMode: (mode: ThemeMode) => void;
	applyThemePreset: (preset: string) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function CustomThemeProvider({
	children,
	defaultPreset,
}: ThemeProviderProps) {
	const [themeState, setThemeState] = useState<ThemeState>(defaultThemeState);
	const [isInitialized, setIsInitialized] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const savedTheme = localStorage.getItem("theme-mode") as ThemeMode | null;
		const savedPreset =
			localStorage.getItem("theme-preset") || defaultPreset || "default";

		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;

		const initialState = {
			currentMode: savedTheme || (prefersDark ? "dark" : "light"),
			preset: savedPreset,
			styles: getPresetThemeStyles(savedPreset),
		};

		setThemeState(initialState);
		setIsInitialized(true);
		applyTheme(initialState);
	}, [defaultPreset]);

	useEffect(() => {
		if (typeof window === "undefined" || !isInitialized) return;

		localStorage.setItem("theme-mode", themeState.currentMode);
		localStorage.setItem("theme-preset", themeState.preset);
		applyTheme(themeState);
	}, [themeState, isInitialized]);

	const setThemeMode = (mode: ThemeMode) => {
		setThemeState((prev) => ({
			...prev,
			currentMode: mode,
		}));
	};

	const applyThemePreset = (preset: string) => {
		setThemeState((prev) => ({
			...prev,
			preset,
			styles: getPresetThemeStyles(preset),
		}));
	};

	return (
		<ThemeContext.Provider
			value={{ themeState, setThemeMode, applyThemePreset }}
		>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme(): ThemeContextType {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
