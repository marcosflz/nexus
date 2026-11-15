/** Compatibility exports for the backend contract and historical consumers.
 * Runtime configuration is defined in lib/runtime/spec; user-managed Agents are retired.
 */
export {
  BUILTIN_TOOL_IDS as AGENT_TOOL_IDS,
  runtimeSpecSchema as agentSpecSchema,
  defaultRuntimeSpec as defaultAgentSpec,
  toSidecarRuntime as toSidecarAgent,
  runtimeSpecJsonSchema as agentSpecJsonSchema,
} from "@/lib/runtime/spec";
export type { RuntimeSpec as AgentSpec, RuntimeSpecInput as AgentSpecInput } from "@/lib/runtime/spec";
