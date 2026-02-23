export default {
  app: {
    name: "Covalt Desktop",
    identifier: "com.covalt.desktop",
    version: "0.1.0",
  },
  build: {
    copy: {
      out: "views/mainview",
      "backend/dist/covalt-backend": "backend/covalt-backend",
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    targets: "current",
  },
};
