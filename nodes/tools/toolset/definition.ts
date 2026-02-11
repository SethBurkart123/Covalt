/**
 * Toolset Node
 * Provides tools from an installed toolset.
 */

import type { NodeDefinition } from '../../_types';

export const toolset = {
  id: 'toolset',
  name: 'Toolset',
  description: 'Tools from an installed toolset',
  category: 'tools',
  icon: 'Package',
  executionMode: 'structural',
  
  parameters: [
    // Config: which toolset to use
    {
      id: 'toolset',
      type: 'toolset',
      label: 'Toolset',
      mode: 'constant',
    },
    
    // Output: tools provided by this toolset (left side for hub topology)
    {
      id: 'tools',
      type: 'tools',
      label: 'Tools',
      mode: 'output',
      socket: { type: 'tools', side: 'left', channel: 'link' },
    },
  ],
} as const satisfies NodeDefinition;

export default toolset;
