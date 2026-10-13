/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: "src/**/*.stories.{js,jsx,ts,tsx,mdx}",
  outDir: ".ladle-build",
  defaultStory: "主界面--空白与交互",
  addons: {
    theme: {
      defaultState: /** @type {import("@ladle/react").ThemeState} */ ("dark"),
    },
    width: {
      enabled: true,
      options: {
        island: 680,
        quick: 760,
        workspace: 1180,
        wide: 1440,
      },
    },
  },
};
