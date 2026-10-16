import { defineApplicationRole } from 'twenty-sdk/define';

import { DEFAULT_ROLE_UNIVERSAL_IDENTIFIER } from './constants/universal-identifiers';

// The fork's DeleteRestrictedAccessChecker blocks deletes for non-admins; at app level the
// closest equivalent is a role that can write but never destroy records.
export default defineApplicationRole({
  universalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: 'Tapdata CRM Spike default role',
  description: 'Reads and writes order-to-cash records, cannot hard-delete',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
});
