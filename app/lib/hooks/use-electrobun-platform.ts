
import { useEffect, useState } from "react";

type ElectrobunWindow = Window & {
  __COVALT_ELECTROBUN_PLATFORM?: string;
};

function readIsElectrobunMac(): boolean {
  if (typeof window === "undefined") return false;
  const platform = (window as ElectrobunWindow).__COVALT_ELECTROBUN_PLATFORM;
  if (platform) return platform === "darwin";
  return document.documentElement.classList.contains("electrobun-macos");
}

export function useIsElectrobunMac(): boolean {
  const [isElectrobunMac, setIsElectrobunMac] = useState(false);

  useEffect(() => {
    const sync = () => setIsElectrobunMac(readIsElectrobunMac());
    sync();
    const retry = window.setTimeout(sync, 250);
    return () => window.clearTimeout(retry);
  }, []);

  return isElectrobunMac;
}
