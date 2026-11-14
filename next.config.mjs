const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    }, {
      source: "/:path((?!(?:references|demo)/embed$).*)",
      headers: [{ key: "X-Frame-Options", value: "DENY" }],
    }];
  },
};

export default nextConfig;
