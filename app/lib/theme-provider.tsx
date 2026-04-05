"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ThemeStyles } from "./types";
import { defaultThemeState, getPresetThemeStyles } from "./theme-presets";
import { applyTheme } from "./fix-global-css";

type ThemeMode = "light" | "dark";

interface ThemeState {
	currentMode: ThemeMode;
	preset: string;
	styles: ThemeStyles;
}

interface ThemeProviderProps {
	children: React.ReactNode;
	defaultPreset?: string;
}

type ThemeContextType = {
	themeState: ThemeState;
	setThemeMode: (mode: ThemeMode) => void;
	applyThemePreset: (preset: string) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function persistAndApply(state: ThemeState) {
	localStorage.setItem("theme-mode", state.currentMode);
	localStorage.setItem("theme-preset", state.preset);
	applyTheme(state);
}

export function CustomThemeProvider({
	children,
	defaultPreset,
}: ThemeProviderProps) {
	const [themeState, setThemeState] = useState<ThemeState>(defaultThemeState);

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
		applyTheme(initialState);
	}, [defaultPreset]);

	const setThemeMode = useCallback((mode: ThemeMode) => {
		setThemeState((prev) => {
			const next = { ...prev, currentMode: mode };
			persistAndApply(next);
			return next;
		});
	}, []);

	const applyThemePreset = useCallback((preset: string) => {
		setThemeState((prev) => {
			const next = { ...prev, preset, styles: getPresetThemeStyles(preset) };
			persistAndApply(next);
			return next;
		});
	}, []);

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
