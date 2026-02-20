declare module "electrobun/bun" {
  export type ApplicationMenuItemConfig =
    | { type: "divider" | "separator" }
    | {
        type?: "normal";
        label?: string;
        tooltip?: string;
        action?: string;
        role?: string;
        data?: unknown;
        submenu?: Array<ApplicationMenuItemConfig>;
        enabled?: boolean;
        checked?: boolean;
        hidden?: boolean;
        accelerator?: string;
      };

  export const ApplicationMenu: {
    setApplicationMenu: (menu: Array<ApplicationMenuItemConfig>) => void;
    on: (name: "application-menu-clicked", handler: (event: any) => void) => void;
  };

  export const ContextMenu: {
    showContextMenu: (menu: Array<ApplicationMenuItemConfig>) => void;
    on: (name: "context-menu-clicked", handler: (event: any) => void) => void;
  };

  export const BrowserWindow: any;
  export const Utils: {
    quit: () => void;
    openExternal: (url: string) => boolean;
  };
  export const PATHS: {
    VIEWS_FOLDER: string;
  };

  const Electrobun: {
    events: {
      on: (event: string, handler: (event: any) => void) => void;
      off?: (event: string, handler: (event: any) => void) => void;
    };
  };

  export default Electrobun;
}
