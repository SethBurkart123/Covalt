import { describe, expect, it } from 'vitest';

describe('agents modules smoke imports', () => {
  it('imports agent card module', async () => {
    const mod = await import('./AgentCard');
    expect(typeof mod.AgentCard).toBe('object');
  });

  it('imports agent dialogs and skeleton modules', async () => {
    const createDialog = await import('./CreateAgentDialog');
    const deleteDialog = await import('./DeleteAgentDialog');
    const skeleton = await import('./AgentCardSkeleton');

    expect(typeof createDialog.CreateAgentDialog).toBe('function');
    expect(typeof deleteDialog.DeleteAgentDialog).toBe('function');
    expect(typeof skeleton.AgentCardSkeleton).toBe('function');
  });
});
