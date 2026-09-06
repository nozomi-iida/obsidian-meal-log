import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meal Log",
    short_name: "Meal Log",
    start_url: "/",
    // アドレスバーを伴わない表示で起動する
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    // 既存のファビコンを流用する。意匠を持つアイコンは配置前に別途用意する
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
