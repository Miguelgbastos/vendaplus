import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/kommo", destination: "/configuracoes/kommo", permanent: false },
      { source: "/admin/tenants", destination: "/configuracoes/empresas", permanent: false },
      { source: "/admin/usuarios", destination: "/configuracoes/usuarios", permanent: false },
    ];
  },
};

export default nextConfig;
