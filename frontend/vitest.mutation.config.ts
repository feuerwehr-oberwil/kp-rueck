import { mergeConfig } from "vitest/config"
import config from "./vitest.config"

// Most targets are pure decisions. Only the React integration files need jsdom.
export default mergeConfig(config, { test: { environment: "node" } })
