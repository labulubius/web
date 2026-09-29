import type { Metadata } from "next";
import { AgentFrame } from "./agent-frame";

export const metadata: Metadata = {
  title: "Pi Agent",
  description: "Private Pi coding agent running on the Mac mini.",
};

export default function AgentPage() {
  return <AgentFrame />;
}
