import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F6F3",
        ink: "#141414",
        muted: "#6B6B6B",
        line: "rgba(20,20,20,0.10)",
        soft: "rgba(20,20,20,0.04)",
      },
      borderRadius: {
        xl: "16px",
      },
      boxShadow: {
        soft: "0 1px 0 rgba(20,20,20,0.06), 0 8px 30px rgba(20,20,20,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;


