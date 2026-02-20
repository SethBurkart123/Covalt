export default {
  app: {
    name: "Agno Desktop",
    identifier: "com.agno.desktop",
    version: "0.1.0",
  },
  build: {
    copy: {
      out: "views/mainview",
      "backend/dist/agno-backend": "backend/agno-backend",
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    targets: "current",
  },
};
