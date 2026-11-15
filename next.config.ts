import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // OpenUI define su librería de componentes con React (createContext, etc.).
  // Las rutas /api se compilan con la variante "react-server" de React, que no
  // trae esas APIs, así que estos paquetes se cargan con el `require` nativo de
  // Node en lugar de empaquetarse. Se usan en servidor para generar el prompt y
  // validar programas; el renderizado sigue ocurriendo en el navegador.
  serverExternalPackages: ["@openuidev/react-ui", "@openuidev/react-lang", "@openuidev/lang-core"],
};

export default nextConfig;
