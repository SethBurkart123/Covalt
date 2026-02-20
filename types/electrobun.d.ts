declare module "electrobun/bun" {
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
