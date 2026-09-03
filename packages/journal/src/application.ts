import type {AgentObservation} from "../../kernel/src/index.js";
import type {SaiRegionApplication} from "../../mcp/src/index.js";
import type {JournalRepository} from "./index.js";

const encodedSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function attachJournalNotice(observation: AgentObservation, notice: Awaited<ReturnType<JournalRepository["reviewInboxFor"]>>, maxBytes: number): AgentObservation {
  const fitted = structuredClone(notice);
  fitted.review_opportunities = fitted.review_opportunities.slice(0, 20);
  fitted.invitations = fitted.invitations.slice(0, 20);
  fitted.authored_submissions = fitted.authored_submissions.slice(0, 20);
  observation.journal = fitted;
  let endedInvitationIndex = fitted.invitations.findLastIndex((invitation) => invitation.status !== "pending");
  while (encodedSize(observation) > maxBytes && endedInvitationIndex >= 0) {
    fitted.invitations.splice(endedInvitationIndex, 1);
    endedInvitationIndex = fitted.invitations.findLastIndex((invitation) => invitation.status !== "pending");
  }
  while (encodedSize(observation) > maxBytes && fitted.review_opportunities.length) fitted.review_opportunities.pop();
  while (encodedSize(observation) > maxBytes && fitted.authored_submissions.length) fitted.authored_submissions.pop();
  while (encodedSize(observation) > maxBytes && fitted.invitations.length) fitted.invitations.pop();
  if (encodedSize(observation) > maxBytes) delete observation.journal;
  return observation;
}

export function createJournalAwareApplication(world: SaiRegionApplication, journal: JournalRepository): SaiRegionApplication {
  return {
    async observe(agentId, input): Promise<AgentObservation> {
      const observation = await world.observe(agentId, input);
      return attachJournalNotice(observation, await journal.reviewInboxFor(agentId), input?.max_bytes ?? 4_096);
    },
    async act(agentId, input) { return world.act(agentId, input); },
    async memory(agentId, input) { return world.memory(agentId, input); },
    async season(agentId, input) { return world.season(agentId, input); },
    async activity(agentId, input) { return world.activity(agentId, input); },
  };
}
