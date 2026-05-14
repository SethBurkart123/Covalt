
import { useCallback } from "react";

const AUTH_POPUP_WIDTH = 600;
const AUTH_POPUP_HEIGHT = 800;
const AUTH_POPUP_TARGET = "Authenticate";

function getCenteredPopupPosition(width: number, height: number): { left: number; top: number } {
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  return { left, top };
}

export function openOauthPopup(url: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const { left, top } = getCenteredPopupPosition(AUTH_POPUP_WIDTH, AUTH_POPUP_HEIGHT);
  window.open(
    url,
    AUTH_POPUP_TARGET,
    `width=${AUTH_POPUP_WIDTH},height=${AUTH_POPUP_HEIGHT},left=${left},top=${top}`,
  );
}

export function useOauthPopup(): (url: string) => void {
  return useCallback((url: string) => {
    openOauthPopup(url);
  }, []);
}
