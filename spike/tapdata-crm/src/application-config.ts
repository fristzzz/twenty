import { defineApplication } from 'twenty-sdk/define';

import { DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from './constants/universal-identifiers';

export const APP_DISPLAY_NAME = 'Tapdata CRM Spike';
export const APP_DESCRIPTION = 'Order-to-cash spike: 产品 / 报价 / 合同 / 回款分期';
export const APPLICATION_UNIVERSAL_IDENTIFIER =
  '7d1c4f0a-6b78-4f3a-9b2e-5c1a8f0d3e21';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  defaultRoleUniversalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
});
